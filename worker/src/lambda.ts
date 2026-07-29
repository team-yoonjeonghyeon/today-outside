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
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import worker from './index';

const TABLE = process.env.CACHE_TABLE ?? '';
const ddb = TABLE ? new DynamoDBClient({}) : null;

/* ────────────────────────────────── 캐시 정책 */

const KMA_HOST = 'apis.data.go.kr';

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
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export const handler = async (event: FunctionUrlEvent): Promise<LambdaResponse> => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : '';

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
