import { kstParts, nowKst, yyyymmdd } from './geo';

const NCST = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';
const USFCST = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst';
const VILAGE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const UV = 'https://apis.data.go.kr/1360000/LivingWthrIdxServiceV4/getUVIdxV4';
// 기상특보 조회서비스. 키에 이 서비스가 활성화돼 있어야 해요 (아니면 XML/에러 → 안전하게 null 폴백)
const WARN = 'https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList';
// 특보 통보문 상세. 본청(108) 통보문 t6에 전국 폭염 구역이 등급별로 나열돼요.
const WARN_MSG = 'https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnMsg';
// 본청(전국 통보) 지점번호
const STN_HQ = '108';

export interface Env {
  KMA_API_KEY: string;
}

/** 초단기실황 발표: 매시 40분. 40분 전이면 이전 시각 사용 */
export function ncstBase(d: Date) {
  const p = kstParts(d);
  let h = p.hour;
  let date = new Date(d);
  if (p.minute < 45) {
    h -= 1;
    if (h < 0) {
      h = 23;
      date = new Date(d.getTime() - 86400000);
    }
  }
  return { baseDate: yyyymmdd(date), baseTime: `${String(h).padStart(2, '0')}00` };
}

/** 단기예보 발표: 02,05,08,11,14,17,20,23시 + 10분 버퍼 */
export function vilageBase(d: Date) {
  const p = kstParts(d);
  const slots = [23, 20, 17, 14, 11, 8, 5, 2];
  const cur = p.hour * 60 + p.minute;
  for (const s of slots) {
    if (cur >= s * 60 + 15) {
      return { baseDate: yyyymmdd(d), baseTime: `${String(s).padStart(2, '0')}00` };
    }
  }
  const prev = new Date(d.getTime() - 86400000);
  return { baseDate: yyyymmdd(prev), baseTime: '2300' };
}

async function cachedJson(url: string, ttlSeconds: number): Promise<any> {
  const req = new Request(url, { method: 'GET' });
  // caches.default는 wrangler dev 로컬에서는 동작하지 않음. 배포 환경에서만 캐시됨.
  const cache = (globalThis as any).caches?.default;

  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit.json();
  }

  const res = await fetch(req);
  if (!res.ok) throw new Error(`KMA HTTP ${res.status}`);

  const body = await res.text();
  if (body.trimStart().startsWith('<')) {
    // 키 미활성 등의 경우 XML 에러가 내려옴
    throw new Error(`KMA returned non-JSON: ${body.slice(0, 200)}`);
  }
  const json = JSON.parse(body);

  const code = json?.response?.header?.resultCode;
  if (code && code !== '00') {
    throw new Error(`KMA ${code} ${json.response.header.resultMsg}`);
  }

  if (cache) {
    const toCache = new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${ttlSeconds}`,
      },
    });
    await cache.put(req, toCache);
  }
  return json;
}

function items(json: any): any[] {
  const it = json?.response?.body?.items?.item;
  if (!it) return [];
  return Array.isArray(it) ? it : [it];
}

export interface Ncst {
  airTemp: number;
  humidity: number;
  windSpeed: number;
  pty: number;
  /** 1시간 강수량(mm). 호우 하드게이트용. 초단기실황 RN1 */
  rain: number;
  baseDate: string;
  baseTime: string;
}

export async function fetchNcst(env: Env, nx: number, ny: number): Promise<Ncst> {
  const { baseDate, baseTime } = ncstBase(nowKst());
  const url =
    `${NCST}?serviceKey=${encodeURIComponent(env.KMA_API_KEY)}` +
    `&numOfRows=20&pageNo=1&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;

  const json = await cachedJson(url, 600); // 10분
  const map: Record<string, number> = {};
  items(json).forEach((i) => (map[i.category] = Number(i.obsrValue)));

  return {
    airTemp: map.T1H ?? 0,
    humidity: map.REH ?? 60,
    windSpeed: map.WSD ?? 1,
    pty: map.PTY ?? 0,
    rain: Number.isFinite(map.RN1) ? map.RN1 : 0, // '강수없음'이면 NaN → 0
    baseDate,
    baseTime,
  };
}

export interface FcstHour {
  date: string;
  hour: number;
  airTemp?: number;
  humidity?: number;
  windSpeed?: number;
  sky?: number;
  pty?: number;
}

export async function fetchVilage(
  env: Env,
  nx: number,
  ny: number
): Promise<Map<string, FcstHour>> {
  const { baseDate, baseTime } = vilageBase(nowKst());
  const url =
    `${VILAGE}?serviceKey=${encodeURIComponent(env.KMA_API_KEY)}` +
    `&numOfRows=900&pageNo=1&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;

  const json = await cachedJson(url, 3 * 3600); // 3시간
  const out = new Map<string, FcstHour>();

  for (const i of items(json)) {
    const key = `${i.fcstDate}-${i.fcstTime}`;
    const cur =
      out.get(key) ??
      ({ date: i.fcstDate, hour: Number(String(i.fcstTime).slice(0, 2)) } as FcstHour);

    const v = Number(i.fcstValue);
    switch (i.category) {
      case 'TMP': cur.airTemp = v; break;
      case 'REH': cur.humidity = v; break;
      case 'WSD': cur.windSpeed = v; break;
      case 'SKY': cur.sky = v; break;
      case 'PTY': cur.pty = v; break;
    }
    out.set(key, cur);
  }
  return out;
}

/** 자외선지수. areaNo(행정구역코드)가 필요. 없으면 null */
export async function fetchUvi(
  env: Env,
  areaNo: string | null
): Promise<Map<number, number> | null> {
  if (!areaNo) return null;

  const d = nowKst();
  const p = kstParts(d);
  // 발표 06시/18시. 가장 최근 발표 사용
  const t = p.hour >= 18 ? '18' : p.hour >= 6 ? '06' : '18';
  const date = p.hour >= 6 ? yyyymmdd(d) : yyyymmdd(new Date(d.getTime() - 86400000));

  const url =
    `${UV}?serviceKey=${encodeURIComponent(env.KMA_API_KEY)}` +
    `&pageNo=1&numOfRows=10&dataType=JSON&areaNo=${areaNo}&time=${date}${t}`;

  try {
    const json = await cachedJson(url, 6 * 3600);
    const row = items(json)[0];
    if (!row) return null;

    // h0, h3, h6 ... 형태로 3시간 간격 제공
    const out = new Map<number, number>();
    for (let k = 0; k <= 24; k += 3) {
      const raw = row[`h${k}`];
      if (raw === undefined || raw === '') continue;
      out.set((p.hour + k) % 24, Number(raw));
    }
    return out;
  } catch {
    return null;
  }
}

/** 자외선 API 실패 시 태양고도 기반 추정 */
export function estimateUvi(srNorm: number): number {
  return Math.max(0, Math.round(12 * Math.pow(srNorm, 1.2)));
}

/**
 * 낙뢰 예보. 초단기예보(getUltraSrtFcst)의 LGT 카테고리를 봐요.
 * 발표 매시 30분, 45분 버퍼 → ncstBase와 동일 규칙 재사용.
 * 지금~이후 예보 슬롯 중 LGT>0이 하나라도 있으면 true. 실패하면 false.
 */
export async function fetchLightning(env: Env, nx: number, ny: number): Promise<boolean> {
  const { baseDate, baseTime } = ncstBase(nowKst());
  const url =
    `${USFCST}?serviceKey=${encodeURIComponent(env.KMA_API_KEY)}` +
    `&numOfRows=300&pageNo=1&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;
  try {
    const json = await cachedJson(url, 600); // 10분
    return items(json).some((i) => i.category === 'LGT' && Number(i.fcstValue) > 0);
  } catch {
    return false;
  }
}

export type HeatLevel = '중대경보' | '경보' | '주의보';

/**
 * 지역명("고양시 일산동구", "서울 강남구")에서 특보 구역 매칭 토큰을 뽑아요.
 * 통보문 t6는 시/군 단위("경기도(고양, ...)", "부산")로 나열되므로 첫 어절의 시/군/구 접미사를 떼요.
 * 예) "고양시 일산동구" → "고양", "서울 강남구" → "서울", "부산 해운대구" → "부산"
 */
export function extractAreaToken(area: string): string {
  const words = area.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const strip = (w: string) =>
    w.replace(/(특별자치도|특별자치시|특별시|광역시|자치도|시|군|구|도)$/u, '') || w;
  // "강원도 평창", "경기도 고양시"처럼 도-접두면 t6는 시/군 단위로 나열되므로 두 번째 어절을 써요.
  // "서울 강남구", "부산 해운대구", "고양시 일산동구"는 첫 어절(광역시/시)이 곧 t6 키예요.
  if (/도$/u.test(words[0]) && words.length >= 2) return strip(words[1]);
  return strip(words[0]);
}

/**
 * 본청(108) 통보문 t6에서 특정 구역의 폭염특보 등급을 판정해요.
 * t6 형식: "o 폭염중대경보 : ...\no 폭염경보 : 경기도(고양, ...), 서울(...)\no 폭염주의보 : ..."
 * 중대경보 > 경보 > 주의보 우선. 어디에도 없으면 null.
 */
export function heatLevelForArea(t6: string, token: string): HeatLevel | null {
  if (!token) return null;
  const clause = (label: string): string => {
    const m = t6.match(new RegExp(`폭염${label}\\s*:([^\\n]*)`, 'u'));
    return m ? m[1] : '';
  };
  if (clause('중대경보').includes(token)) return '중대경보';
  if (clause('경보').includes(token)) return '경보';
  if (clause('주의보').includes(token)) return '주의보';
  return null;
}

/** 전국(area 미지정)에 발효 중인 최고 등급 폭염특보. 하위호환 폴백용. */
export function nationwideHeatLevel(t6: string): HeatLevel | null {
  const has = (label: string) => new RegExp(`폭염${label}\\s*:\\s*\\S`, 'u').test(t6);
  if (has('중대경보')) return '중대경보';
  if (has('경보')) return '경보';
  if (has('주의보')) return '주의보';
  return null;
}

function heatAlertText(level: HeatLevel): { type: string; text: string } {
  if (level === '주의보') {
    return { type: 'heat', text: '폭염주의보가 발효 중이에요. 물을 자주 마시고 그늘에서 쉬어요' };
  }
  return { type: 'heat', text: '폭염경보가 발효 중이에요. 한낮 야외 활동을 줄여요' };
}

/**
 * 폭염특보 — 지역 인식. 본청(108) 통보문 t6(전국 폭염 구역 목록)를 받아,
 * area가 주어지면 그 구역의 등급을, 없으면 전국 최고 등급을 노출해요.
 * 서비스 미신청/에러/폭염 없음이면 안전하게 null (배너 미노출).
 */
export async function fetchHeatWarning(
  env: Env,
  area?: string | null
): Promise<{ type: string; text: string } | null> {
  const today = yyyymmdd(nowKst());
  const from = yyyymmdd(new Date(nowKst().getTime() - 2 * 86400000));
  const listUrl =
    `${WARN}?serviceKey=${encodeURIComponent(env.KMA_API_KEY)}` +
    `&pageNo=1&numOfRows=100&dataType=JSON&fromTmFc=${from}&toTmFc=${today}`;
  try {
    // 1) 본청(108)의 최신 폭염 통보문 tmFc 찾기. 폭염 통보문이 없으면 전국에 폭염특보 없음.
    const list = items(await cachedJson(listUrl, 1800)); // 30분
    const heat108 = list.filter(
      (r) => String(r.stnId) === STN_HQ && String(r.title ?? '').includes('폭염')
    );
    if (heat108.length === 0) return null;
    const tmFc = heat108
      .map((r) => String(r.tmFc))
      .sort()
      .at(-1)!;

    // 2) 통보문 상세 → t6(현재 발효 특보 현황)
    const msgUrl =
      `${WARN_MSG}?serviceKey=${encodeURIComponent(env.KMA_API_KEY)}` +
      `&pageNo=1&numOfRows=10&dataType=JSON&stnId=${STN_HQ}&tmFc=${tmFc}`;
    const rows = items(await cachedJson(msgUrl, 1800));
    if (rows.length === 0) return null;
    const t6 = String(rows.map((r) => String(r.t6 ?? '')).sort((a, b) => b.length - a.length)[0]);

    const level = area ? heatLevelForArea(t6, extractAreaToken(area)) : nationwideHeatLevel(t6);
    return level ? heatAlertText(level) : null;
  } catch {
    return null;
  }
}
