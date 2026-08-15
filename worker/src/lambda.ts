/**
 * AWS Lambda 어댑터 + 기상청 응답 캐시.
 * worker/src/lambda.ts
 *
 * 기존 index.ts / kma.ts / engine.ts / geo.ts는 한 줄도 안 고쳐요.
 * kma.ts가 기상청을 fetch로 부르기 때문에, 전역 fetch를 감싸서 그 앞에 캐시를 둡니다.
 *
 * 캐시는 2단이에요.
 *   1단 메모리   — 같은 컨테이너가 살아있는 동안. 즉시, 무료.
 *   2단 DynamoDB — 컨테이너가 여러 개여도 공유. TTL로 자동 삭제.
 *
 * 최종 판정이 아니라 "기상청 원본"을 캐싱하는 게 핵심이에요.
 * profile만 다른 요청 3건이 캐시 하나를 같이 쓰게 됩니다.
 */
import {
  type AttributeValue,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import * as https from 'node:https';
import worker from './index';
import { kstParts, nowKst, toGrid, yyyymmdd } from './geo';
import { judge, type Computed } from './engine';
import type { HourSlot, JudgeResponse, Profile } from './types';

const TABLE = process.env.CACHE_TABLE ?? '';
const ddb = TABLE ? new DynamoDBClient({}) : null;

/* ────────────────────────────────── 캐시 정책 */

const KMA_HOST = 'apis.data.go.kr';
const KAKAO_HOST = 'dapi.kakao.com';
const KAKAO_KEY = process.env.KAKAO_REST_KEY ?? '';

/** 엔드포인트별 보관 시간(초). URL에 base_time이 들어있어 새 발표가 나오면 키가 저절로 바뀌어요. */
function ttlSeconds(url: string): number {
  if (url.includes('UltraSrtNcst')) return 40 * 60;      // 실황: 매시 갱신
  if (url.includes('UltraSrtFcst')) return 45 * 60;      // 초단기예보: 매시 30분 발표
  if (url.includes('VilageFcst')) return 3 * 60 * 60;    // 단기예보: 3시간 주기
  if (/Wrn|Warn/i.test(url)) return 10 * 60;             // 특보: 갑자기 바뀔 수 있음
  if (/Uv|Idx/i.test(url)) return 3 * 60 * 60;           // 생활기상지수: 3시간 단위
  return 30 * 60;
}

/** serviceKey는 비밀이라 캐시 키에서 빼요. 어차피 항상 같은 값이라 구분에 필요 없어요. */
function cacheKeyOf(url: string): string {
  const u = new URL(url);
  u.searchParams.delete('serviceKey');
  return `${u.pathname}?${u.searchParams.toString()}`;
}

/** 기상청은 실패해도 HTTP 200으로 주는 경우가 있어요. 성공 응답만 캐싱합니다. */
function isSuccessBody(text: string): boolean {
  return /"resultCode"\s*:\s*"?0*0"?/.test(text) || /<resultCode>\s*0*0\s*<\/resultCode>/.test(text);
}

/* ────────────────────────────────── 1단: 메모리 */

interface Entry {
  body: string;
  expiresAt: number; // epoch seconds
}

const memory = new Map<string, Entry>();
const MEMORY_MAX = 200;

function memoryGet(key: string): string | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt * 1000 <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.body;
}

function memorySet(key: string, entry: Entry): void {
  if (memory.size >= MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  memory.set(key, entry);
}

/* ────────────────────────────────── 2단: DynamoDB */

async function ddbGet(key: string): Promise<Entry | null> {
  if (!ddb) return null;
  try {
    const out = await ddb.send(
      new GetItemCommand({ TableName: TABLE, Key: { cacheKey: { S: key } } })
    );
    const item = out.Item;
    if (!item?.body?.S || !item.expiresAt?.N) return null;

    const expiresAt = Number(item.expiresAt.N);
    // TTL 삭제는 최대 48시간까지 늦어질 수 있어서 만료는 직접 확인해야 해요.
    if (expiresAt * 1000 <= Date.now()) return null;

    return { body: item.body.S, expiresAt };
  } catch (e) {
    console.error('[cache] get 실패', e);
    return null; // 캐시 장애가 요청 실패로 번지면 안 돼요.
  }
}

async function ddbPut(key: string, entry: Entry): Promise<void> {
  if (!ddb) return;
  try {
    await ddb.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: {
          cacheKey: { S: key },
          body: { S: entry.body },
          expiresAt: { N: String(entry.expiresAt) },
        },
      })
    );
  } catch (e) {
    console.error('[cache] put 실패', e);
  }
}

async function ddbDelete(key: string): Promise<void> {
  if (!ddb) return;
  try {
    await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { cacheKey: { S: key } } }));
  } catch (e) {
    console.error('[cache] delete 실패', e);
  }
}

/* ────────────────────────────────── fetch 가로채기 */

const originalFetch = globalThis.fetch;

const cachedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // 기상청 GET 요청만 캐싱해요. 나머지는 그대로 통과.
  const method = (init?.method ?? 'GET').toUpperCase();
  if (!url.includes(KMA_HOST) || method !== 'GET') {
    return originalFetch(input as RequestInfo, init);
  }

  const key = cacheKeyOf(url);

  const hitMemory = memoryGet(key);
  if (hitMemory !== null) {
    return new Response(hitMemory, { status: 200 });
  }

  const hitDdb = await ddbGet(key);
  if (hitDdb) {
    memorySet(key, hitDdb);
    return new Response(hitDdb.body, { status: 200 });
  }

  const res = await originalFetch(input as RequestInfo, init);
  const text = await res.text();

  if (res.ok && isSuccessBody(text)) {
    const entry: Entry = {
      body: text,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds(url),
    };
    memorySet(key, entry);
    await ddbPut(key, entry);
  }

  // 본문을 이미 읽었으니 새 Response로 돌려줘요.
  return new Response(text, { status: res.status, headers: res.headers });
};

globalThis.fetch = cachedFetch;

/* ────────────────────────────────── Lambda 진입점 */

interface FunctionUrlEvent {
  rawPath?: string;
  rawQueryString?: string;
  requestContext?: { http?: { method?: string } };
  body?: string;
  isBase64Encoded?: boolean;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}


/* ────────────────────────────────── 좌표 → 행정구역 (카카오) */

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** 좌표는 소수점 4자리(약 11m)로 반올림해서 캐시 적중률을 올려요. */
const roundCoord = (v: number) => Math.round(v * 1e4) / 1e4;

interface KakaoDoc {
  region_type: 'B' | 'H';
  region_1depth_name: string;
  region_2depth_name: string;
  region_3depth_name: string;
  code: string;
}

async function handleRegion(lat: number, lon: number): Promise<LambdaResponse> {
  if (!KAKAO_KEY) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'NO_KAKAO_KEY', message: '카카오 키가 설정되지 않았어요' }),
    };
  }

  const x = roundCoord(lon);
  const y = roundCoord(lat);
  const key = `kakao:coord2region:${x},${y}`;

  let text = memoryGet(key);
  if (text === null) {
    const hit = await ddbGet(key);
    if (hit) {
      memorySet(key, hit);
      text = hit.body;
    }
  }

  if (text === null) {
    const res = await originalFetch(
      `https://${KAKAO_HOST}/v2/local/geo/coord2regioncode.json?x=${x}&y=${y}`,
      { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } }
    );
    text = await res.text();
    if (res.ok) {
      // 행정구역은 거의 안 바뀌니 30일 보관
      const entry: Entry = { body: text, expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400 };
      memorySet(key, entry);
      await ddbPut(key, entry);
    } else {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'KAKAO_UNAVAILABLE', message: '위치 정보를 가져오지 못했어요' }),
      };
    }
  }

  const docs: KakaoDoc[] = JSON.parse(text).documents ?? [];
  // 법정동(B)을 우선 쓰고 없으면 행정동(H)
  const doc = docs.find((d) => d.region_type === 'B') ?? docs[0];
  if (!doc) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'NOT_FOUND', message: '해당 좌표의 행정구역을 찾지 못했어요' }),
    };
  }

  const { nx, ny } = toGrid(lat, lon);
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      sido: doc.region_1depth_name,
      sigungu: doc.region_2depth_name,
      dong: doc.region_3depth_name,
      // 화면 표시용. 구가 없는 시는 동까지 붙여야 구체적이에요.
      label: doc.region_2depth_name
        ? `${doc.region_2depth_name} ${doc.region_3depth_name}`.trim()
        : doc.region_1depth_name,
      code: doc.code,
      nx,
      ny,
    }),
  };
}


/** 주소 검색: 사용자가 친 글자로 전국 읍면동까지 찾아요. */
async function handleSearch(q: string): Promise<LambdaResponse> {
  if (!KAKAO_KEY) {
    return { statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'NO_KAKAO_KEY', message: '카카오 키가 설정되지 않았어요' }) };
  }

  const key = `kakao:search:${q}`;
  let text = memoryGet(key);
  if (text === null) {
    const hit = await ddbGet(key);
    if (hit) { memorySet(key, hit); text = hit.body; }
  }

  if (text === null) {
    const res = await originalFetch(
      `https://${KAKAO_HOST}/v2/local/search/address.json?size=15&query=${encodeURIComponent(q)}`,
      { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } }
    );
    text = await res.text();
    if (res.ok) {
      // 주소는 거의 안 바뀌니 7일 보관. 같은 검색어가 반복될수록 이득이에요.
      const entry: Entry = { body: text, expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400 };
      memorySet(key, entry);
      await ddbPut(key, entry);
    } else {
      return { statusCode: 502, headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'KAKAO_UNAVAILABLE', message: '검색에 실패했어요' }) };
    }
  }

  interface AddrDoc {
    address_name: string;
    x: string;
    y: string;
    address?: {
      region_1depth_name: string;
      region_2depth_name: string;
      region_3depth_name: string;
      b_code: string;
    };
  }

  const docs: AddrDoc[] = JSON.parse(text).documents ?? [];
  const seen = new Set<string>();
  const results = [];

  for (const d of docs) {
    const a = d.address;
    if (!a) continue;
    const lat = Number(d.y);
    const lon = Number(d.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // 같은 동이 도로명/지번으로 중복돼 나오는 걸 걸러요.
    const dedupe = `${a.region_2depth_name}|${a.region_3depth_name}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    results.push({
      sido: a.region_1depth_name,
      sigungu: a.region_2depth_name,
      dong: a.region_3depth_name,
      label: `${a.region_2depth_name} ${a.region_3depth_name}`.trim() || d.address_name,
      code: a.b_code,
      lat,
      lon,
      ...toGrid(lat, lon),
    });
  }

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ results }) };
}

/* ────────────────────────────────── 알림 구독 (Phase 1) */

// requestNotificationAgreement로 실제 동의를 받은 사용자의 식별키·지역·프로필만 저장해요.
// 이미 배포돼 있는 캐시 테이블(CACHE_TABLE)을 그대로 재사용해요 — 새 테이블을 만들 필요가
// 없고, cacheKey 파티션 키 하나만 있으면 되는 스키마라 그대로 맞아요. 캐시처럼 짧은 TTL로
// 지워지면 안 되니 expiresAt을 2년 뒤로 멀리 둬요.
//
// 조건 판정과 발송은 이제 아래 Phase 2 구역에 있어요 — 아침 브리핑(runMorningBriefing)과
// 조건부 알림 두 종류(runDangerAlert·runWalkTimeAlert)예요. 다만 실제로 도착하려면 코드 밖
// 준비가 남아 있어요: mTLS 인증서(TOSS_MTLS_CERT/KEY) 등록, 토스가 요구하는 고정 IP 방화벽
// 허용(NAT Gateway 등), 그리고 EventBridge Scheduler 등록이에요.

const NOTIFICATION_TYPES = ['morningBriefing', 'dangerAlert', 'walkTimeAlert'] as const;
type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// 앱인토스 콘솔 > 스마트 발송 > 알림 동의문에 등록해 둔 발송 코드예요.
// app/src/screens/Settings.tsx의 NOTIFICATION_TEMPLATE_CODES와 값이 같아야 해요 — 프론트가
// 동의를 요청할 때 쓰는 코드랑 여기서 실제로 발송할 때 쓰는 코드가 다르면 발송이 실패해요.
const NOTIFICATION_TEMPLATE_CODES: Record<NotificationType, string> = {
  morningBriefing: 'today-outside-morning-brief',
  dangerAlert: 'today-outside-danger-alert',
  walkTimeAlert: 'today-outside-walk-time',
};

interface SubscribeBody {
  anonKey: string;
  type: NotificationType;
  profile: Profile;
  regions: { name: string; nx: number; ny: number }[];
}

function subscriptionKey(type: NotificationType, anonKey: string): string {
  return `sub:${type}:${anonKey}`;
}

function parseEventBody(event: FunctionUrlEvent): unknown {
  if (!event.body) return null;
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isSubscribeBody(body: unknown): body is SubscribeBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (typeof b.anonKey !== 'string' || b.anonKey.length === 0) return false;
  if (typeof b.type !== 'string' || !NOTIFICATION_TYPES.includes(b.type as NotificationType)) {
    return false;
  }
  if (typeof b.profile !== 'string') return false;
  if (!Array.isArray(b.regions)) return false;
  return b.regions.every(
    (r) =>
      r &&
      typeof r === 'object' &&
      typeof (r as Record<string, unknown>).name === 'string' &&
      typeof (r as Record<string, unknown>).nx === 'number' &&
      typeof (r as Record<string, unknown>).ny === 'number'
  );
}

async function handleNotifySubscribe(event: FunctionUrlEvent): Promise<LambdaResponse> {
  const body = parseEventBody(event);
  if (!isSubscribeBody(body)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'INVALID_PARAM',
        message: 'anonKey, type, profile, regions를 확인해 주세요',
      }),
    };
  }

  const record = {
    profile: body.profile,
    regions: body.regions,
    subscribedAt: new Date().toISOString(),
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 365 * 86400; // 2년 뒤
  await ddbPut(subscriptionKey(body.type, body.anonKey), {
    body: JSON.stringify(record),
    expiresAt,
  });

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
}

async function handleNotifyUnsubscribe(event: FunctionUrlEvent): Promise<LambdaResponse> {
  const body = parseEventBody(event) as Record<string, unknown> | null;
  const anonKey = body?.anonKey;
  const type = body?.type;
  if (
    typeof anonKey !== 'string' ||
    anonKey.length === 0 ||
    typeof type !== 'string' ||
    !NOTIFICATION_TYPES.includes(type as NotificationType)
  ) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'INVALID_PARAM', message: 'anonKey, type을 확인해 주세요' }),
    };
  }

  await ddbDelete(subscriptionKey(type as NotificationType, anonKey));

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
}

/* ────────────────────────────────── 동네 기분 투표 */

/**
 * "지금 우리 동네 어때요?" 😊 😐 😥 — 텍스트 없는 1단계 소셜 기능이에요.
 *
 * 남기는 게 셋 중 하나뿐이라 검수할 내용이 없어요(UGC 모더레이션·신고 기능 불필요).
 * 집계도 숫자 하나라서 참여자가 적어도 화면이 성립해요 — "1명이 좋대요"도 문장이 되니까요.
 *
 * ## 방 단위는 시군구
 * 동으로 묶으면 대부분의 동네가 텅 비고, 시도(서울 940만)로 묶으면 남 얘기가 돼요.
 * 시군구(약 250개, 마포구 38만)가 사람은 모이면서 날씨도 사실상 같은 선이에요. 동은
 * "우리 동네에서 몇 명 참여했는지"를 덧붙이는 보조 정보로만 써요.
 *
 * ## 저장
 * 기존 CACHE_TABLE을 그대로 재사용해요(파티션 키 cacheKey 하나 + TTL expiresAt).
 * 항목은 두 종류예요.
 *
 *   집계  mood:{지역}:{날짜}       — good/soso/bad 카운터 + 동별 카운터(d_공덕동)
 *   내 표 moodvote:{지역}:{날짜}:{기기ID} — 뭘 골랐는지 (하루 한 표 + 다시 보여주기용)
 *
 * 카운터는 DynamoDB의 원자적 ADD로 올려요. 집계 문서를 읽고-고쳐-쓰면 동시에 투표한 두
 * 사람 중 한 표가 조용히 사라지는데, ADD는 그런 일이 없어요. Scan은 쓰지 않아요 —
 * 홈 화면을 열 때마다 테이블 전체를 훑는 건 감당이 안 되니까요(scanSubscriptions 주석 참고).
 */

const MOODS = ['good', 'soso', 'bad'] as const;
type Mood = (typeof MOODS)[number];

function isMood(v: unknown): v is Mood {
  return typeof v === 'string' && (MOODS as readonly string[]).includes(v);
}

/**
 * 동 이름을 화면에 보여주기 시작하는 최소 참여자 수.
 *
 * 참여자가 1~2명인 동은 "[공덕동] + 시각"만으로 사람이 좁혀져요. 시골 읍면이나 신도시
 * 초기처럼 모수가 작은 곳에서 특히 그래요. 그 아래면 동 정보를 아예 빼고 시군구 집계만
 * 내려줘요.
 */
const DONG_MIN_PARTICIPANTS = 3;

/**
 * 한마디는 **프리셋 id만** 저장해요 (예: `nice_today`). 문장 자체는 앱이 들고 있어서
 * 서버에는 사용자가 쓴 글자가 한 개도 안 들어와요 — 그래서 검수·신고 기능이 필요 없어요.
 * 형식을 좁게 막아두면(영소문자·숫자·밑줄) 한글이나 공백이 섞여 들어올 길도 없어요.
 */
const MESSAGE_ID_PATTERN = /^[a-z0-9_]{1,24}$/;

/**
 * 한마디를 담아두는 칸 수. 꽉 차면 **가장 오래된 것부터 덮어써요**(링 버퍼).
 *
 * 계속 append하면 인기 지역에서 항목이 400KB 한도까지 자라요. 그렇다고 "오래된 걸 잘라내기"를
 * 매번 하려면 읽고-고쳐-쓰기가 돼서 동시에 남긴 한마디가 사라질 수 있고요. 칸을 고정해두고
 * 순번(seq)으로 자리를 정하면 둘 다 피해요 — 항목 크기는 영원히 그대로고, 각자 자기 칸만
 * 쓰니 서로 덮어쓸 일도 없어요.
 *
 * 화면에 보내는 20개보다 넉넉하게 잡아서, 보고 있는 사이에 밀려나 사라지는 일이 없게 했어요.
 */
const MESSAGE_RING_SIZE = 40;

/** 화면에 내려보내는 최근 한마디 수. 피드가 아니라 스쳐가는 몇 줄이라 길 필요가 없어요. */
const MESSAGE_FEED_SIZE = 20;


interface MoodMessage {
  /** 프리셋 id */
  id: string;
  /** 남긴 사람의 동네. 참여자가 적은 동은 아래에서 빈 문자열로 가려요. */
  dong: string;
  /** 남긴 순번. 칸 순서와 시간 순서가 다를 수 있어서, 최신순 정렬은 이 값으로 해요. */
  seq: number;
}

interface MoodSummary {
  date: string;
  region: string;
  counts: Record<Mood, number>;
  total: number;
  /** 내 동네 참여자 수. 인원이 DONG_MIN_PARTICIPANTS 미만이거나 동을 모르면 null. */
  dong: { name: string; count: number } | null;
  /** 이 기기가 오늘 이 지역에 남긴 표. 아직 안 했으면 null. */
  my: Mood | null;
  /** 동 이름이 몇 명부터 보이는지 — 화면이 "아직 조용해요" 문구를 고를 때 써요. */
  dongMinParticipants: number;
  /**
   * 최근 한마디(최신순). 동을 모르는 지역에서 남긴 건 dong이 빈 문자열이에요.
   *
   * 문장별 집계가 아니라 개별 줄을 내려보내요. 위쪽 기분 투표가 이미 "몇 명이 어떻게
   * 느꼈나"를 숫자로 말하고 있어서, 한마디까지 숫자로 만들면 같은 일을 두 번 하게 돼요.
   * 한마디가 하는 일은 동네 이름이 붙은 한 줄이 주는 사람 냄새예요.
   */
  messages: { id: string; dong: string }[];
  /** 오늘 이 지역에 남은 한마디 총 개수. messages(최근 20개)보다 클 수 있어요. */
  messageTotal: number;
  /** 이 기기가 오늘 남긴 한마디의 프리셋 id. 아직 안 남겼으면 null. */
  myMessage: string | null;
}

/**
 * 키·속성 이름에 쓸 수 있게 이름을 다듬어요. 한글과 공백은 그대로 둬야 "서울특별시 마포구"가
 * 살아남으니, 제어문자와 구분자(:)만 걷어내고 길이만 잘라요. 결과가 비면 400으로 막아요.
 *
 * 정규식 대신 한 글자씩 보는 이유는, 제어문자 범위를 정규식 리터럴로 적으면 소스 파일에
 * 실제 제어문자가 섞여 들어가기 쉬워서예요.
 */
function moodCleanName(value: unknown, max = 40): string {
  if (typeof value !== 'string') return '';
  let cleaned = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    if (ch === ':') continue;
    cleaned += ch;
  }
  return cleaned.trim().slice(0, max);
}

/** 기기 ID는 앱이 만든 UUID 꼴만 받아요 (임의 문자열로 키 공간을 어지럽히지 못하게). */
function moodCleanDeviceId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return /^[0-9a-fA-F-]{8,64}$/.test(value) ? value : '';
}

/** 오늘 날짜(KST, YYYYMMDD). 자정이 지나면 키가 바뀌어서 집계가 저절로 처음부터 다시 시작해요. */
function moodToday(): string {
  return yyyymmdd(nowKst());
}

/**
 * 만료 시각(unix 초) — 오늘 자정(KST) + 2시간.
 *
 * 키에 날짜가 들어 있어서 지난 날짜 항목은 어차피 아무도 읽지 않아요. TTL은 테이블이
 * 무한정 커지지 않게 하는 청소 용도예요(DynamoDB TTL 삭제는 최대 48시간까지 늦어질 수 있어요).
 */
function moodExpiresAt(): number {
  const p = kstParts(nowKst());
  const remain = 86400 - (p.hour * 3600 + p.minute * 60);
  return Math.floor(Date.now() / 1000) + remain + 2 * 3600;
}

function moodTallyKey(region: string, date: string): string {
  return `mood:${region}:${date}`;
}

function moodVoteKey(region: string, date: string, deviceId: string): string {
  return `moodvote:${region}:${date}:${deviceId}`;
}

/** 동별 카운터는 집계 항목의 최상위 속성으로 둬요 — 중첩 맵과 달리 ADD를 그대로 쓸 수 있어요. */
function moodDongAttr(dong: string): string {
  return `d_${dong}`;
}


function moodCount(item: Record<string, AttributeValue> | undefined, attr: string): number {
  const raw = item?.[attr]?.N;
  const n = raw === undefined ? 0 : Number(raw);
  // 표를 옮길 때 감소도 하는 구조라, 데이터가 어긋나도 음수가 화면에 나가진 않게 막아요.
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 저장된 한마디를 읽어요. 형식이 어긋난 항목은 조용히 건너뛰어요. */
function moodMessagesOf(item: Record<string, AttributeValue> | undefined): MoodMessage[] {
  const raw = item?.msgs?.L;
  if (!Array.isArray(raw)) return [];

  const out: MoodMessage[] = [];
  for (const entry of raw) {
    const id = entry?.M?.i?.S;
    if (typeof id !== 'string' || !MESSAGE_ID_PATTERN.test(id)) continue;
    out.push({ id, dong: entry.M?.d?.S ?? '', seq: Number(entry.M?.s?.N ?? '0') });
  }
  return out;
}

function moodSummaryFrom(
  item: Record<string, AttributeValue> | undefined,
  region: string,
  date: string,
  dong: string,
  my: Mood | null,
  myMessage: string | null
): MoodSummary {
  const counts: Record<Mood, number> = {
    good: moodCount(item, 'good'),
    soso: moodCount(item, 'soso'),
    bad: moodCount(item, 'bad'),
  };
  const dongCount = dong ? moodCount(item, moodDongAttr(dong)) : 0;
  const stored = moodMessagesOf(item);

  // 칸 순서는 시간 순서와 달라요(링 버퍼라 한 바퀴 돌면 앞칸이 최신이 돼요). 순번으로 정렬해요.
  //
  // 동 이름은 참여자 수와 무관하게 그대로 내보내요. 고를 수 있는 문장이 우리가 미리 쓴
  // 것뿐이라 여기서 알아낼 개인 정보가 없어요.
  const messages = [...stored]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, MESSAGE_FEED_SIZE)
    .map((message) => ({ id: message.id, dong: message.dong }));

  return {
    date,
    region,
    counts,
    total: counts.good + counts.soso + counts.bad,
    dong: dong && dongCount >= DONG_MIN_PARTICIPANTS ? { name: dong, count: dongCount } : null,
    my,
    dongMinParticipants: DONG_MIN_PARTICIPANTS,
    messages,
    // 화면이 몇 줄만 보여주고 "외 N명이 더 남겼어요"라고 말할 수 있게 총 개수도 같이 줘요.
    //
    // 보관된 칸 수(stored.length)를 세면 40에서 멈춰요 — 링 버퍼라 그 이상은 덮어쓰거든요.
    // 그러면 100명이 남긴 날도 "외 35명"으로 실제보다 작게 말하게 돼요. 순번(seq)은 새
    // 한마디마다 하나씩 올라가니까 오늘 남긴 사람 수 그대로예요.
    messageTotal: Math.max(stored.length, Number(item?.seq?.N ?? '0') || 0),
    myMessage,
  };
}

/**
 * 이 기기가 오늘 이 지역에서 한 일. 하루 한 표·한마디 하나를 지키고, 마음이 바뀌었을 때
 * 이전 것을 되돌리는 데 써요.
 */
interface MoodDeviceRecord {
  mood: Mood | null;
  /** 남긴 한마디의 프리셋 id */
  message: string | null;
  /** 내 한마디가 들어간 칸과 순번 — 바꿀 때 그 자리가 아직 내 것인지 확인하는 데 써요. */
  messageIndex: number | null;
  messageSeq: number | null;
  dong: string;
}

async function readMoodDevice(key: string): Promise<MoodDeviceRecord | null> {
  const entry = await ddbGet(key);
  if (!entry) return null;
  try {
    const parsed = JSON.parse(entry.body) as Record<string, unknown>;
    return {
      mood: isMood(parsed.mood) ? parsed.mood : null,
      message:
        typeof parsed.message === 'string' && MESSAGE_ID_PATTERN.test(parsed.message)
          ? parsed.message
          : null,
      messageIndex: typeof parsed.messageIndex === 'number' ? parsed.messageIndex : null,
      messageSeq: typeof parsed.messageSeq === 'number' ? parsed.messageSeq : null,
      dong: typeof parsed.dong === 'string' ? parsed.dong : '',
    };
  } catch {
    return null;
  }
}

interface MoodAction {
  mood?: Mood;
  /** 프리셋 id. 이미 오늘 남겼으면 그 자리를 덮어써요. */
  message?: string;
}

/** 한마디가 어느 칸에 들어갔는지 — 나중에 바꿀 때 그 자리가 아직 내 것인지 확인하려고 남겨요. */
interface MessageSlot {
  index: number;
  seq: number;
}

/**
 * 표·한마디를 반영하고 갱신된 집계를 돌려줘요. 쓰기 한 번으로 끝나서 뒤에 다시 읽을 필요가
 * 없어요(ReturnValues로 갱신 결과를 그대로 받아요).
 *
 * 세 가지가 한 항목에서 같이 움직여요.
 *   - 기분 카운터(good/soso/bad) — 원자적 ADD. 이전 표가 있으면 되돌리고 새 표를 더해요.
 *   - 동 카운터(d_공덕동) — 투표든 한마디든 **오늘 처음 참여할 때 한 번만** 세요.
 *     이래야 "3명 이상인 동만 이름 노출" 규칙이 투표자·한마디 양쪽에 똑같이 적용돼요.
 *   - 한마디 목록(msgs) — list_append는 원자적이라 동시에 남겨도 서로 덮어쓰지 않아요.
 *     바꾸는 경우엔 내 자리(msgs[i])만 지정해서 덮어쓰고요.
 */
async function applyMoodAction(
  region: string,
  date: string,
  dong: string,
  previous: MoodDeviceRecord | null,
  action: MoodAction
): Promise<Record<string, AttributeValue> | undefined> {
  if (!ddb) return undefined;

  // 속성별 증감을 먼저 모아요. 같은 속성이 두 번 등장하면 DynamoDB가 거부하기 때문에
  // (예: 같은 동에서 mood만 바꾼 경우 d_공덕동이 +1/−1로 겹쳐요) 여기서 합쳐서 상쇄해요.
  const deltas = new Map<string, number>();
  const bump = (attr: string, by: number) => deltas.set(attr, (deltas.get(attr) ?? 0) + by);

  if (action.mood) {
    bump(action.mood, 1);
    if (previous?.mood) bump(previous.mood, -1);
  }
  // 동은 "오늘 이 지역에 처음 참여했나"로만 세요 — 투표 후 한마디를 남겨도 한 명이에요.
  if (dong && previous?.dong !== dong) bump(moodDongAttr(dong), 1);
  if (previous?.dong && previous.dong !== dong) bump(moodDongAttr(previous.dong), -1);


  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = { ':exp': { N: String(moodExpiresAt()) } };
  const setParts = ['expiresAt = :exp'];
  const addParts: string[] = [];

  let i = 0;
  for (const [attr, delta] of deltas) {
    if (delta === 0) continue; // 상쇄돼서 바뀔 게 없는 속성은 건드리지 않아요.
    const nameRef = `#a${i}`;
    const valueRef = `:v${i}`;
    names[nameRef] = attr;
    values[valueRef] = { N: String(delta) };
    addParts.push(`${nameRef} ${valueRef}`);
    i += 1;
  }

  // 새 한마디는 순번을 먼저 받아요. ADD가 원자적이라 동시에 남겨도 번호가 겹치지 않아요.
  const needsNewSlot = Boolean(action.message) && previous?.messageIndex == null;
  if (needsNewSlot) {
    values[':one'] = { N: '1' };
    addParts.push('seq :one');

    // msgs는 고정 크기(MESSAGE_RING_SIZE) 링 버퍼예요. DynamoDB의 `SET msgs[i] = value`는
    // 그 인덱스가 이미 존재할 때만 허용돼요(list_append처럼 이어붙이는 게 아니에요) — 그래서
    // 오늘 이 지역에 msgs가 아직 없으면(첫 참여) writeMoodMessage의 SET msgs[index]가 매번
    // ValidationException으로 실패하고, 그 실패는 조용히 삼켜져서 한마디가 하나도 안 쌓이는
    // 버그였어요. 여기서 40칸짜리 빈 리스트로 먼저 초기화해두면 그 다음 SET msgs[index]가
    // 항상 유효한 자리를 가리켜요. if_not_exists라 이미 있으면 손대지 않고, 여러 기기가
    // 동시에 첫 참여해도 서로 덮어쓰지 않아요(둘 다 같은 값을 쓰려고만 해요).
    values[':emptyMsgs'] = {
      L: Array.from({ length: MESSAGE_RING_SIZE }, () => ({ M: { i: { S: '' } } })),
    };
    setParts.push('msgs = if_not_exists(msgs, :emptyMsgs)');
  }

  const expression =
    `SET ${setParts.join(', ')}` + (addParts.length > 0 ? ` ADD ${addParts.join(', ')}` : '');

  const out = await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { cacheKey: { S: moodTallyKey(region, date) } },
      UpdateExpression: expression,
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  );
  return out.Attributes;
}

/**
 * 한마디를 칸에 써요. 반환값은 갱신된 항목과 내 칸 정보예요.
 *
 * 바꾸는 경우엔 원래 칸에 덮어쓰되, **그 자리가 아직 내 것일 때만** 써요(ConditionExpression).
 * 링 버퍼라 한 바퀴가 돌면 내 칸을 이미 다른 사람이 차지했을 수 있는데, 조건 없이 쓰면
 * 남의 한마디를 지워버려요. 조건이 어긋나면 새로 남긴 것처럼 다음 칸을 받아요.
 */
async function writeMoodMessage(
  region: string,
  date: string,
  dong: string,
  message: string,
  seq: number,
  previous: MoodDeviceRecord | null
): Promise<{ item: Record<string, AttributeValue> | undefined; slot: MessageSlot }> {
  const reusing = previous?.messageIndex != null && previous.messageSeq != null;
  const index = reusing ? previous!.messageIndex! : (seq - 1) % MESSAGE_RING_SIZE;
  const entrySeq = reusing ? previous!.messageSeq! : seq;

  const command = new UpdateItemCommand({
    TableName: TABLE,
    Key: { cacheKey: { S: moodTallyKey(region, date) } },
    UpdateExpression: `SET msgs[${index}] = :entry, expiresAt = :exp`,
    ExpressionAttributeValues: {
      ':entry': { M: { i: { S: message }, d: { S: dong }, s: { N: String(entrySeq) } } },
      ':exp': { N: String(moodExpiresAt()) },
      ...(reusing ? { ':mySeq': { N: String(previous!.messageSeq!) } } : {}),
    },
    ...(reusing ? { ConditionExpression: `msgs[${index}].s = :mySeq` } : {}),
    ReturnValues: 'ALL_NEW',
  });

  try {
    const out = await ddb!.send(command);
    return { item: out.Attributes, slot: { index, seq: entrySeq } };
  } catch (e) {
    // 내 칸이 이미 밀려났어요 — 바꾸기가 아니라 새로 남기는 걸로 처리해요.
    if (!reusing || (e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
    const fresh = await allocateMessageSeq(region, date);
    return writeMoodMessage(region, date, dong, message, fresh, null);
  }
}

/** 칸을 새로 받아야 할 때 순번만 따로 올려요 (되돌아온 경로에서만 써요). */
async function allocateMessageSeq(region: string, date: string): Promise<number> {
  const out = await ddb!.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { cacheKey: { S: moodTallyKey(region, date) } },
      UpdateExpression: 'SET expiresAt = :exp ADD seq :one',
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':exp': { N: String(moodExpiresAt()) },
      },
      ReturnValues: 'ALL_NEW',
    })
  );
  return Number(out.Attributes?.seq?.N ?? '1');
}

/**
 * `GET  /mood?region=..&dong=..&deviceId=..` — 오늘 이 시군구의 집계 + 최근 한마디
 * `POST /mood` `{region, dong, deviceId, mood?, message?}` — 표·한마디를 남기고 갱신된 집계
 *
 * POST는 `mood`와 `message` 중 적어도 하나가 있어야 해요. 둘 다 보내도 되고요.
 * 응답 형태는 둘 다 MoodSummary로 같아요. 화면이 POST 뒤에 한 번 더 조회하지 않아도 되게요.
 */
async function handleMood(event: FunctionUrlEvent, method: string): Promise<LambdaResponse> {
  if (!ddb) {
    // 저장소가 없는 환경에서는 기능만 조용히 꺼요 — 판정은 이 값 없이도 그대로 동작해야 해요.
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'MOOD_DISABLED', message: '기분 투표가 꺼져 있어요' }),
    };
  }

  const isPost = method === 'POST';
  const body = isPost ? (parseEventBody(event) as Record<string, unknown> | null) : null;
  const query = new URLSearchParams(event.rawQueryString ?? '');
  const pick = (key: string): unknown => (isPost ? body?.[key] : query.get(key));

  const region = moodCleanName(pick('region'));
  const dong = moodCleanName(pick('dong'));
  const deviceId = moodCleanDeviceId(pick('deviceId'));

  if (!region || !deviceId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'INVALID_PARAM', message: 'region, deviceId를 확인해 주세요' }),
    };
  }

  const date = moodToday();
  const deviceKey = moodVoteKey(region, date, deviceId);

  try {
    if (!isPost) {
      const [tallyItem, device] = await Promise.all([
        ddb
          .send(
            new GetItemCommand({ TableName: TABLE, Key: { cacheKey: { S: moodTallyKey(region, date) } } })
          )
          .then((out) => out.Item),
        readMoodDevice(deviceKey),
      ]);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(
          moodSummaryFrom(tallyItem, region, date, dong, device?.mood ?? null, device?.message ?? null)
        ),
      };
    }

    const rawMood = pick('mood');
    const rawMessage = pick('message');
    const mood = isMood(rawMood) ? rawMood : undefined;
    const message =
      typeof rawMessage === 'string' && MESSAGE_ID_PATTERN.test(rawMessage) ? rawMessage : undefined;

    if (!mood && !message) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'INVALID_PARAM', message: 'mood 또는 message를 확인해 주세요' }),
      };
    }

    const previous = await readMoodDevice(deviceKey);

    // 1) 카운터를 올리고, 새 한마디면 칸 순번도 같이 받아요 (쓰기 한 번).
    // 여기서 실패하면 아직 아무것도 반영 안 됐으니 그대로 502 — 재시도해도 안전해요.
    let item = await applyMoodAction(region, date, dong, previous, {
      ...(mood ? { mood } : {}),
      ...(message ? { message } : {}),
    });

    // 2) 한마디는 받은 순번의 칸에 써요. 칸이 꽉 차면 가장 오래된 것 위에 덮여요.
    let slot: MessageSlot | null =
      previous?.messageIndex != null && previous.messageSeq != null
        ? { index: previous.messageIndex, seq: previous.messageSeq }
        : null;

    // 1)은 이미 커밋됐어요 — 여기부터는 실패해도 요청을 502로 되돌리지 않아요. 그러면 카운터만
    // 오르고 화면은 "체크 안 됨"으로 보이는 상태가 반복돼요(다음 클릭도 previous를 못 읽어서
    // 또 새 참여자로 처리되니까요). 대신 실패한 단계는 로그만 남기고, 이미 아는 값(mood·message)
    // 으로 최선의 응답을 돌려줘서 화면이 항상 "방금 누른 게 반영됐다"고 보이게 해요.
    if (message) {
      try {
        const written = await writeMoodMessage(
          region,
          date,
          dong,
          message,
          Number(item?.seq?.N ?? '1'),
          previous
        );
        item = written.item ?? item;
        slot = written.slot;
      } catch (e) {
        console.error('[mood] 한마디 칸 기록 실패 — 집계는 이미 반영됐어요', e);
      }
    }

    // 3) 마지막에 내 기록을 남겨요(하루 한 표·한마디 판단, 다음 방문 시 선택 상태 복원용).
    //    이것도 best-effort예요 — 실패해도 방금 반영된 집계·한마디를 무효로 만들지 않아요.
    try {
      await ddbPut(deviceKey, {
        body: JSON.stringify({
          mood: mood ?? previous?.mood ?? null,
          message: message ?? previous?.message ?? null,
          messageIndex: slot?.index ?? null,
          messageSeq: slot?.seq ?? null,
          dong,
        }),
        expiresAt: moodExpiresAt(),
      });
    } catch (e) {
      console.error('[mood] 기기 기록 저장 실패 — 다음 요청은 새 참여자로 처리될 수 있어요', e);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(
        moodSummaryFrom(
          item,
          region,
          date,
          dong,
          mood ?? previous?.mood ?? null,
          message ?? previous?.message ?? null
        )
      ),
    };
  } catch (e) {
    console.error('[mood]', e);
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'MOOD_UNAVAILABLE', message: '잠시 후 다시 시도해주세요' }),
    };
  }
}

/* ────────────────────────────────── 스마트 발송 (Phase 2) */

// 인증서·개인키는 절대 코드/커밋에 넣지 않아요 — Lambda 환경변수에 base64로 저장해두고
// 여기서만 디코딩해요. PEM은 여러 줄이라 환경변수에 그대로 넣으면 도구마다 줄바꿈 처리가
// 달라서 깨지기 쉬워요 — base64 한 줄로 저장하면 어떤 배포 도구를 써도 안전해요.
//   TOSS_MTLS_CERT = cert.pem 파일을 base64로 인코딩한 값
//   TOSS_MTLS_KEY  = key.pem 파일을 base64로 인코딩한 값
function mtlsCredentials(): { cert: string; key: string } | null {
  const certB64 = process.env.TOSS_MTLS_CERT;
  const keyB64 = process.env.TOSS_MTLS_KEY;
  if (!certB64 || !keyB64) return null;
  return {
    cert: Buffer.from(certB64, 'base64').toString('utf-8'),
    key: Buffer.from(keyB64, 'base64').toString('utf-8'),
  };
}

const TOSS_API_HOST = 'apps-in-toss-api.toss.im';

interface SendSmartMessageParams {
  templateSetCode: string;
  context: Record<string, unknown>;
  /** 사용자 식별 — 앱에서 getAnonymousKey()로 받은 해시. anonKey/userKey 중 하나는 있어야 해요. */
  anonKey?: string;
  userKey?: string;
}

interface SendSmartMessageResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * 스마트 발송 sendMessage 호출. 아침 브리핑·조건부 알림이 모두 여기를 거쳐요. 다만 다음
 * 두 가지가 없으면 호출해도 실패해요(코드 밖 준비물이에요).
 *   1) TOSS_MTLS_CERT / TOSS_MTLS_KEY 환경변수 (인증서 발급받아 base64로 등록해야 함)
 *   2) 토스가 요구하는 고정 IP 방화벽 허용 (이 Lambda가 NAT Gateway로 나가도록 설정해야 함,
 *      안 하면 인증서가 있어도 방화벽에서 막혀요)
 */
export async function sendSmartMessage(
  params: SendSmartMessageParams
): Promise<SendSmartMessageResult> {
  const creds = mtlsCredentials();
  if (!creds) {
    return { ok: false, status: 0, body: 'TOSS_MTLS_CERT/TOSS_MTLS_KEY가 설정 안 됐어요' };
  }
  if (!params.anonKey && !params.userKey) {
    return { ok: false, status: 0, body: 'anonKey 또는 userKey 중 하나는 있어야 해요' };
  }

  const requestBody = JSON.stringify({
    templateSetCode: params.templateSetCode,
    context: params.context,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: TOSS_API_HOST,
        path: '/api-partner/v1/apps-in-toss/messenger/send-message',
        method: 'POST',
        cert: creds.cert,
        key: creds.key,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          ...(params.anonKey ? { 'x-anon-key': params.anonKey } : {}),
          ...(params.userKey ? { 'x-toss-user-key': params.userKey } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, body: data });
        });
      }
    );
    req.on('error', (e) => resolve({ ok: false, status: 0, body: String(e) }));
    req.write(requestBody);
    req.end();
  });
}

/* ────────────────────────────────── 아침 브리핑 (Phase 2) */

// EventBridge Scheduler가 이 Lambda를 아래 입력으로 호출하도록 등록하면 돼요.
//   { "task": "morningBriefing" }  — 매일 08:00 (Asia/Seoul)
//   { "task": "hourlyCheck" }      — 매시 정각 (Asia/Seoul), 조건부 알림 두 종류를 함께 확인해요
// Function URL(API Gateway/ALB) 요청은 requestContext가 항상 있어서, 이 필드로 "스케줄
// 호출인지 HTTP 요청인지"를 구분해요.
const SCHEDULED_TASKS = ['morningBriefing', 'hourlyCheck'] as const;
type ScheduledTask = (typeof SCHEDULED_TASKS)[number];

interface ScheduledEvent {
  task: ScheduledTask;
}

function isScheduledEvent(event: unknown): event is ScheduledEvent {
  if (!event || typeof event !== 'object') return false;
  const task = (event as Record<string, unknown>).task;
  return typeof task === 'string' && SCHEDULED_TASKS.includes(task as ScheduledTask);
}

/**
 * 지금 시각(Asia/Seoul)의 "시"와 날짜(YYYY-MM-DD)예요.
 *
 * Lambda는 UTC로 돌아서 `new Date().getHours()`를 그대로 쓰면 9시간이 어긋나요. 발송 조건이
 * "그 정각인가"라서 시(hour)가 어긋나면 엉뚱한 시간에 나가요. 서버 타임존 설정에 기대지 않고
 * 여기서 직접 KST로 환산해요.
 */
function nowInKst(): { hour: number; date: string } {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { hour: kst.getUTCHours(), date: kst.toISOString().slice(0, 10) };
}

/**
 * 하루 한 번 제한용 표식. 발송에 성공하면 이 키를 남겨두고, 다음 정각 체크에서 이미 있으면
 * 건너뛰어요 — 위험 단계가 몇 시간씩 이어져도 알림은 그날 한 번만 가요.
 *
 * 구독 레코드와 같은 캐시 테이블을 쓰되 접두사가 `sent:`라 `sub:` 스캔에는 안 걸려요.
 * 이틀 뒤 TTL로 알아서 사라져요(날짜가 바뀌면 키 자체가 달라지니 오래 둘 이유가 없어요).
 */
function sentTodayKey(type: NotificationType, anonKey: string, date: string): string {
  return `sent:${type}:${date}:${anonKey}`;
}

async function alreadySentToday(type: NotificationType, anonKey: string, date: string): Promise<boolean> {
  return (await ddbGet(sentTodayKey(type, anonKey, date))) !== null;
}

async function markSentToday(type: NotificationType, anonKey: string, date: string): Promise<void> {
  await ddbPut(sentTodayKey(type, anonKey, date), {
    body: '1',
    expiresAt: Math.floor(Date.now() / 1000) + 2 * 86400,
  });
}

interface SubscriptionRecord {
  profile: Profile;
  regions: { name: string; nx: number; ny: number }[];
  subscribedAt: string;
}

/**
 * `sub:{type}:{anonKey}` 형태의 구독 레코드를 전부 훑어요. CACHE_TABLE이 기상청·카카오 캐시랑
 * 같이 쓰는 테이블이라(파티션 키 하나뿐, GSI 없음) Scan이 테이블 전체를 읽고 나서
 * FilterExpression으로 걸러요 — 구독자·캐시 항목이 많아지면 비용·속도가 부담될 수 있어요.
 * 그때는 구독 전용 테이블이나 GSI(예: type을 파티션 키로)로 옮기는 걸 권장해요. 지금 규모
 * (Phase 1, 발송 대상 최대 수백 명)에서는 이 정도로 충분해요.
 */
async function scanSubscriptions(type: NotificationType): Promise<{ anonKey: string; record: SubscriptionRecord }[]> {
  if (!ddb) return [];
  const prefix = subscriptionKey(type, '');
  const results: { anonKey: string; record: SubscriptionRecord }[] = [];
  let ExclusiveStartKey: Record<string, AttributeValue> | undefined;

  do {
    const out = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'begins_with(cacheKey, :prefix)',
        ExpressionAttributeValues: { ':prefix': { S: prefix } },
        ExclusiveStartKey,
      })
    );
    for (const item of out.Items ?? []) {
      const cacheKey = item.cacheKey?.S;
      const body = item.body?.S;
      const expiresAt = Number(item.expiresAt?.N ?? '0');
      if (!cacheKey || !body) continue;
      if (expiresAt * 1000 <= Date.now()) continue; // 만료(2년 지난) 구독은 건너뛰어요.
      const anonKey = cacheKey.slice(prefix.length);
      try {
        results.push({ anonKey, record: JSON.parse(body) as SubscriptionRecord });
      } catch {
        // 손상된 레코드는 건너뛰어요.
      }
    }
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return results;
}

/** index.ts의 /judge 핸들러를 그대로 재사용해요(캐시·판정 로직 중복 방지) — Function URL
 *  요청과 동일하게 합성 Request를 만들어 worker.fetch에 직접 넘겨요. */
async function fetchJudgeInternal(nx: number, ny: number, profile: Profile): Promise<JudgeResponse | null> {
  const request = new Request(`https://lambda.local/judge?nx=${nx}&ny=${ny}&profile=${profile}`);
  const env = { KMA_API_KEY: process.env.KMA_API_KEY ?? '' } as never;
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;
  const res = await worker.fetch(request, env, ctx);
  if (!res.ok) return null;
  return (await res.json()) as JudgeResponse;
}

/**
 * 아침 브리핑 발송 본체. 구독자마다 저장 지역의 첫 번째(가장 먼저 등록한 대표 지역) 하나만
 * 요약해서 보내요 — 여러 지역을 각각 보낼지는 사용자 반응 보고 나중에 정해요.
 *
 * context에 넣는 필드 이름(regionLabel·headline·reason·feelsLike·roadTemp)은 임시로 정한
 * 값이에요. 앱인토스 콘솔 > 스마트 발송에 등록한 today-outside-morning-brief 템플릿의 실제
 * 변수 이름과 반드시 맞춰야 발송이 성공해요 — 다르면 여기 필드 이름을 수정해 주세요.
 */
export async function runMorningBriefing(): Promise<{ sent: number; failed: number; skipped: number; total: number }> {
  const subs = await scanSubscriptions('morningBriefing');
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // 기상청 호출·스마트 발송 API에 한 번에 너무 많이 몰리지 않게 5명씩 나눠 처리해요.
  const CONCURRENCY = 5;
  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    const batch = subs.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ anonKey, record }) => {
        const region = record.regions[0];
        if (!region) {
          skipped++;
          return;
        }
        try {
          const judgeResult = await fetchJudgeInternal(region.nx, region.ny, record.profile);
          if (!judgeResult) {
            failed++;
            return;
          }
          const result = await sendSmartMessage({
            templateSetCode: NOTIFICATION_TEMPLATE_CODES.morningBriefing,
            anonKey,
            context: {
              regionLabel: region.name,
              headline: judgeResult.now.headline,
              reason: judgeResult.now.reason,
              feelsLike: judgeResult.metrics.feelsLike,
              roadTemp: judgeResult.metrics.roadTemp,
            },
          });
          if (result.ok) {
            sent++;
          } else {
            failed++;
            console.error('[morningBriefing] 발송 실패', anonKey, result.status, result.body);
          }
        } catch (e) {
          failed++;
          console.error('[morningBriefing] 처리 실패', anonKey, e);
        }
      })
    );
  }

  console.log(`[morningBriefing] 완료 sent=${sent} failed=${failed} skipped=${skipped} total=${subs.length}`);
  return { sent, failed, skipped, total: subs.length };
}

/* ────────────────────────────────── 조건부 알림 (매시 정각) */

interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
  total: number;
}

/**
 * 조건부 알림 한 종류를 처리해요. 매시 정각에 불려서, 구독자마다 내 장소를 판정해 보고
 * `shouldSend`가 true일 때만 보내요 — "그 정각이 조건에 해당하는가"를 그 자리에서 확인하는
 * 방식이라, 위험해지는 시각·산책하기 좋은 시각에 맞춰 도착해요.
 *
 * 아침 브리핑과 다른 점은 두 가지예요.
 *  1) 조건을 만족해야만 보내요(아침 브리핑은 무조건 발송).
 *  2) 하루 한 번만 보내요 — 위험 단계가 오후 내내 이어져도 알림이 매시간 오면 안 되니까요.
 *
 * 아침 브리핑과 뼈대가 같아서 스캔·배치·판정 호출은 그대로 두고, 다른 부분(조건·문맥)만
 * 인자로 받아요.
 */
async function runConditionalAlert(
  type: 'dangerAlert' | 'walkTimeAlert',
  shouldSend: (judge: JudgeResponse, kstHour: number) => boolean,
  buildContext: (judge: JudgeResponse, region: { name: string }) => Record<string, unknown>
): Promise<DispatchResult> {
  const subs = await scanSubscriptions(type);
  const { hour, date } = nowInKst();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const CONCURRENCY = 5;
  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    const batch = subs.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ anonKey, record }) => {
        const region = record.regions[0];
        if (!region) {
          skipped++;
          return;
        }
        try {
          // 오늘 이미 보냈으면 판정 호출도 하지 않아요 — 기상청 호출을 아끼려고 먼저 확인해요.
          if (await alreadySentToday(type, anonKey, date)) {
            skipped++;
            return;
          }

          const judgeResult = await fetchJudgeInternal(region.nx, region.ny, record.profile);
          if (!judgeResult) {
            failed++;
            return;
          }
          if (!shouldSend(judgeResult, hour)) {
            skipped++;
            return;
          }

          const result = await sendSmartMessage({
            templateSetCode: NOTIFICATION_TEMPLATE_CODES[type],
            anonKey,
            context: buildContext(judgeResult, region),
          });
          if (result.ok) {
            // 표식은 발송에 성공했을 때만 남겨요 — 실패했는데 남기면 그날은 영영 못 받아요.
            await markSentToday(type, anonKey, date);
            sent++;
          } else {
            failed++;
            console.error(`[${type}] 발송 실패`, anonKey, result.status, result.body);
          }
        } catch (e) {
          failed++;
          console.error(`[${type}] 처리 실패`, anonKey, e);
        }
      })
    );
  }

  console.log(`[${type}] 완료 hour=${hour} sent=${sent} failed=${failed} skipped=${skipped} total=${subs.length}`);
  return { sent, failed, skipped, total: subs.length };
}

/** 위험 시간대 — 지금 판정이 4(위험) 이상이면 그 시각에 알려요. */
export async function runDangerAlert(): Promise<DispatchResult> {
  return runConditionalAlert(
    'dangerAlert',
    (judge) => judge.now.level >= 4,
    (judge, region) => ({
      regionLabel: region.name,
      headline: judge.now.headline,
      reason: judge.now.reason,
      feelsLike: judge.metrics.feelsLike,
      roadTemp: judge.metrics.roadTemp,
    })
  );
}

/**
 * 산책 추천 시간 — 오늘의 좋은 시간대가 지금 막 시작하는 정각에 알려요.
 * bestWindow가 없는 날(특별히 더 좋은 시간이 없는 날)은 아무것도 보내지 않아요.
 */
export async function runWalkTimeAlert(): Promise<DispatchResult> {
  return runConditionalAlert(
    'walkTimeAlert',
    (judge, kstHour) => judge.bestWindow?.start === kstHour,
    (judge, region) => ({
      regionLabel: region.name,
      windowLabel: judge.bestWindow?.label ?? '',
      headline: judge.now.headline,
      feelsLike: judge.metrics.feelsLike,
      roadTemp: judge.metrics.roadTemp,
    })
  );
}

/** 매시 정각 체크 — 조건부 알림 두 종류를 함께 확인해요. */
export async function runHourlyCheck(): Promise<{ dangerAlert: DispatchResult; walkTimeAlert: DispatchResult }> {
  // 한쪽이 실패해도 다른 쪽은 나가야 해서 순차로 돌려요(동시에 돌리면 기상청 호출이 몰려요).
  const dangerAlert = await runDangerAlert();
  const walkTimeAlert = await runWalkTimeAlert();
  return { dangerAlert, walkTimeAlert };
}

/* ────────────────────────────────── 시간별 판정 동결 (지난 시간 재계산 방지) */

/**
 * 기상청 단기예보는 3시간마다 새로 발표되는데, 새 발표엔 이미 지난 시간이 더 이상 안 들어있어요.
 * index.ts는 그 시간을 지금 날씨(ncst)로 대신 채워서 내보내는데, 그대로 두면 "아침에
 * 위험했던 시간이 오후엔 지금 날씨 기준 좋음으로" 바뀌어 보여요. 그런데 우리는 그 시간이
 * "지금"이었을 때 이미 한 번 정확하게 계산해봤을 수 있어요 — 그 값을 저장해두고, 지난
 * 시간은 재계산(=index.ts의 ncst 폴백) 대신 저장값을 그대로 돌려줘요. '오늘' 하루만 다루면
 * 되니(내일이 되면 다른 키예요) 자정 지나면 저절로 리셋돼요.
 *
 * level은 프로필마다 달라서 저장하지 않아요 — feelsLike·roadTemp·uvi·airTemp 같은 "그 시간의
 * 물리량"만 저장해두고, 읽을 때 요청받은 프로필로 judge()를 다시 돌려요. 그래야 아침에 dog
 * 프로필로 처음 관측된 시간을 낮에 runner 프로필로 봐도 정확해요.
 *
 * 딱 한 번도 "지금"으로 관측되지 못하고 지나간 시간(예: 그날 처음 켠 게 오후, 또는 이 기능이
 * 배포된 당일의 그 이전 시간들)은 저장값이 없어서 index.ts의 ncst 폴백값이 그대로 나가요 —
 * 부정확할 순 있어도 화면에서 그 시간이 통째로 사라지진 않아요.
 */
interface FrozenHour {
  feelsLike: number;
  roadTemp: number;
  roadTempSoil: number;
  pty: number;
  pcp?: string;
  uvi: number;
  airTemp: number;
}

// v2 — 배포 첫날 "지금" 시간까지 얼려버리는 버그가 있었어요. 그때 잘못 저장된 v1 키는
// 그냥 버려두고(하루 지나면 TTL로 알아서 사라져요) 새 접두어로 깨끗하게 다시 시작해요.
function hourFreezeKey(nx: number, ny: number, date: string): string {
  return `hourfreeze2:${nx}:${ny}:${date}`;
}

/** mood와 같은 규칙 — 오늘 자정(KST) + 2시간. TTL 삭제가 늦어져도 날짜가 키에 있어서 안전해요. */
function hourFreezeExpiresAt(): number {
  const p = kstParts(nowKst());
  const remain = 86400 - (p.hour * 3600 + p.minute * 60);
  return Math.floor(Date.now() / 1000) + remain + 2 * 3600;
}

async function readFrozenHours(key: string): Promise<Record<string, FrozenHour>> {
  const entry = await ddbGet(key);
  if (!entry) return {};
  try {
    const parsed = JSON.parse(entry.body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, FrozenHour>) : {};
  } catch {
    return {};
  }
}

function toFrozenHour(slot: HourSlot): FrozenHour {
  return {
    feelsLike: slot.feelsLike,
    roadTemp: slot.roadTemp,
    roadTempSoil: slot.roadTempSoil,
    pty: slot.pty,
    ...(slot.pcp !== undefined ? { pcp: slot.pcp } : {}),
    uvi: slot.uvi,
    airTemp: slot.airTemp,
  };
}

/** 저장된 물리량으로 judge()를 다시 돌려서 이 프로필의 등급을 얻어요. */
function hourSlotFromFrozen(hour: number, profile: Profile, frozen: FrozenHour): HourSlot {
  const c: Computed = {
    feelsLike: frozen.feelsLike,
    roadTemp: frozen.roadTemp,
    roadBySurface: {
      asphalt: frozen.roadTemp,
      pavement: frozen.roadTemp,
      grass: frozen.roadTemp,
      soil: frozen.roadTempSoil,
    },
    srNorm: 0,
    uvi: frozen.uvi,
  };
  const v = judge(profile, c, frozen.airTemp, frozen.pty);
  return {
    hour,
    level: v.level,
    feelsLike: frozen.feelsLike,
    roadTemp: frozen.roadTemp,
    roadTempSoil: frozen.roadTempSoil,
    pty: frozen.pty,
    ...(frozen.pcp !== undefined ? { pcp: frozen.pcp } : {}),
    uvi: frozen.uvi,
    airTemp: frozen.airTemp,
  };
}

/**
 * `/judge` 응답의 hourly[]에서 "지금보다 앞선" 시간만 저장값으로 덮어써요. 지금 시간은
 * 절대 안 건드려요 — 지금은 아직 진행 중이라 이번 요청 안에서도 계속 바뀔 수 있는데,
 * 지금까지 얼려버리면 그 시간 안에 비가 새로 시작해도 두 번째 조회부턴 업데이트가
 * 안 돼요. 처음 관측하는(지금 막 지나간) 시간은 저장해두고요. 실패해도(파싱 오류·
 * DynamoDB 장애) 원본 응답을 그대로 돌려주면 되는 부가 기능이라 호출부에서
 * try/catch로 감싸요.
 */
async function freezeHourly(
  nx: number,
  ny: number,
  profile: Profile,
  rawBody: string
): Promise<string | null> {
  const parsed = JSON.parse(rawBody) as JudgeResponse;
  if (!Array.isArray(parsed.hourly) || parsed.hourly.length === 0) return null;

  const nowHour = kstParts(nowKst()).hour;
  const date = yyyymmdd(nowKst());
  const key = hourFreezeKey(nx, ny, date);
  const frozen = await readFrozenHours(key);

  const byHour = new Map(parsed.hourly.map((slot) => [slot.hour, slot]));
  const toFreeze: Record<string, FrozenHour> = {};

  // h < nowHour만 — 지금 시간(h === nowHour)은 절대 얼리지 않아요.
  const lastPastHour = Math.min(23, nowHour - 1);
  for (let h = 6; h <= lastPastHour; h++) {
    const existing = frozen[String(h)];
    if (existing) {
      // 저장된 값이 있으면 무조건 그걸 써요 — 이번 응답이 재계산했더라도 무시해요.
      byHour.set(h, hourSlotFromFrozen(h, profile, existing));
      continue;
    }
    // 처음 관측하는 시간 — index.ts가 내려준 값(예보 있으면 예보, 없으면 ncst 폴백)을
    // 저장해서 다음부턴 이 값을 그대로 써요. index.ts는 항상 06~23시를 다 채워서 주니까
    // live가 없는 경우는 없어요.
    const live = byHour.get(h);
    if (live) toFreeze[String(h)] = toFrozenHour(live);
  }

  if (Object.keys(toFreeze).length > 0) {
    await ddbPut(key, {
      body: JSON.stringify({ ...frozen, ...toFreeze }),
      expiresAt: hourFreezeExpiresAt(),
    });
  }

  const hourly = [...byHour.values()].sort((a, b) => a.hour - b.hour);
  return JSON.stringify({ ...parsed, hourly });
}

export const handler = async (
  event: FunctionUrlEvent | ScheduledEvent
): Promise<LambdaResponse | Record<string, unknown>> => {
  if (isScheduledEvent(event)) {
    if (event.task === 'hourlyCheck') {
      return { ok: true, ...(await runHourlyCheck()) };
    }
    return { ok: true, ...(await runMorningBriefing()) };
  }

  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : '';

  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };

  // 카카오를 쓰는 경로는 기존 워커에 없어서 여기서 직접 처리해요. index.ts는 그대로 둡니다.
  if (path === '/search') {
    const sp = new URLSearchParams(event.rawQueryString ?? '');
    const q = (sp.get('q') ?? '').trim();
    if (q.length < 2) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ results: [] }) };
    }
    try {
      return await handleSearch(q);
    } catch (e) {
      console.error('[search]', e);
      return { statusCode: 502, headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'KAKAO_UNAVAILABLE', message: '검색에 실패했어요' }) };
    }
  }

  if (path === '/region') {
    const sp = new URLSearchParams(event.rawQueryString ?? '');
    const lat = Number(sp.get('lat'));
    const lon = Number(sp.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'INVALID_PARAM', message: 'lat, lon을 확인해 주세요' }),
      };
    }
    try {
      return await handleRegion(lat, lon);
    } catch (e) {
      console.error('[region]', e);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'KAKAO_UNAVAILABLE', message: '위치 정보를 가져오지 못했어요' }),
      };
    }
  }

  if (path === '/notify/subscribe' && method === 'POST') {
    return handleNotifySubscribe(event);
  }
  if (path === '/notify/subscribe' && method === 'DELETE') {
    return handleNotifyUnsubscribe(event);
  }

  // 동네 기분 투표. index.ts(판정)와 아무 관계가 없고 DynamoDB를 직접 쓰므로 여기서 처리해요.
  if (path === '/mood' && (method === 'GET' || method === 'POST')) {
    return handleMood(event, method);
  }

  // 호스트는 아무거나 상관없어요. index.ts는 pathname과 searchParams만 봐요.
  const request = new Request(`https://lambda.local${path}${qs}`, { method });

  const env = { KMA_API_KEY: process.env.KMA_API_KEY ?? '' } as never;

  // Worker의 waitUntil은 "응답 뒤에 마저 처리"인데 Lambda는 응답과 동시에 얼어붙어요.
  // 그래서 끝까지 기다립니다.
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
  } as never;

  const res: Response = await worker.fetch(request, env, ctx);
  let body = await res.text();

  if (pending.length) await Promise.allSettled(pending);

  // /judge 성공 응답의 지난 시간을 저장값으로 덮어써요. 부가 기능이라 실패해도 원본을
  // 그대로 내보내면 돼요(파싱 오류·DynamoDB 장애가 판정 자체를 막으면 안 돼요).
  if (path === '/judge' && res.status === 200) {
    try {
      const sp = new URLSearchParams(event.rawQueryString ?? '');
      const nx = Number(sp.get('nx'));
      const ny = Number(sp.get('ny'));
      const profile = sp.get('profile') as Profile | null;
      if (Number.isFinite(nx) && Number.isFinite(ny) && profile) {
        const patched = await freezeHourly(nx, ny, profile, body);
        if (patched) body = patched;
      }
    } catch (e) {
      console.error('[hourfreeze]', e);
    }
  }

  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return { statusCode: res.status, headers, body };
};
