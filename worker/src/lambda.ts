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
} from '@aws-sdk/client-dynamodb';
import * as https from 'node:https';
import worker from './index';
import { toGrid } from './geo';
import type { JudgeResponse, Profile } from './types';

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
// 조건 판정(매일 8시·체감온도 위험 단계·산책 좋은 시간대)과 실제 발송(스마트 발송
// sendMessage 호출)은 여기 없어요 — mTLS 인증서 발급, 그리고 토스가 요구하는 고정 IP(방화벽
// 허용)를 이 Lambda에 어떻게 붙일지(NAT Gateway 등)부터 정리돼야 안전하게 붙일 수 있어요.

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

/* ────────────────────────────────── 스마트 발송 (Phase 2 — 아직 아무도 안 불러요) */

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
 * 스마트 발송 sendMessage 호출. 아직 아무 데서도 안 불러요 — Phase 2(조건 판정 크론)가
 * 생기면 그때 여기를 호출하게 돼요. 지금은 다음 두 가지가 없어서 실제로 성공은 못 해요.
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

// EventBridge Scheduler가 매일 08:00(Asia/Seoul) 크론으로 이 Lambda를 아래 입력으로 호출하도록
// 등록하면 돼요: { "task": "morningBriefing" }. Function URL(API Gateway/ALB) 요청은
// requestContext가 항상 있어서, 이 필드로 "스케줄 호출인지 HTTP 요청인지"를 구분해요.
interface ScheduledEvent {
  task: 'morningBriefing';
}

function isScheduledEvent(event: unknown): event is ScheduledEvent {
  return !!event && typeof event === 'object' && (event as Record<string, unknown>).task === 'morningBriefing';
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

export const handler = async (
  event: FunctionUrlEvent | ScheduledEvent
): Promise<LambdaResponse | { ok: boolean; sent: number; failed: number; skipped: number; total: number }> => {
  if (isScheduledEvent(event)) {
    const result = await runMorningBriefing();
    return { ok: true, ...result };
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
  const body = await res.text();

  if (pending.length) await Promise.allSettled(pending);

  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return { statusCode: res.status, headers, body };
};
