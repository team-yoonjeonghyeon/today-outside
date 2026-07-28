import { kstParts, nowKst, yyyymmdd } from './geo';

const NCST = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';
const USFCST = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst';
const VILAGE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const UV = 'https://apis.data.go.kr/1360000/LivingWthrIdxServiceV4/getUVIdxV4';
// 기상특보 조회서비스. 키에 이 서비스가 활성화돼 있어야 해요 (아니면 XML/에러 → 안전하게 null 폴백)
const WARN = 'https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList';

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

/**
 * 폭염특보. 기상특보 조회서비스에서 발효 중인 특보 목록을 받아 '폭염'을 찾아요.
 * 이 서비스가 키에 없거나 응답이 XML/에러면 안전하게 null을 돌려줘요 (배너 미노출).
 * stnId 없이 전국 목록을 받아 텍스트에 '폭염'이 있으면 노출 — 지역 필터는 areaNo/stnId 매핑이 생기면 정교화.
 */
export async function fetchHeatWarning(env: Env): Promise<{ type: string; text: string } | null> {
  const today = yyyymmdd(nowKst());
  const from = yyyymmdd(new Date(nowKst().getTime() - 2 * 86400000));
  const url =
    `${WARN}?serviceKey=${encodeURIComponent(env.KMA_API_KEY)}` +
    `&pageNo=1&numOfRows=50&dataType=JSON&fromTmFc=${from}&toTmFc=${today}`;
  try {
    const json = await cachedJson(url, 1800); // 30분
    const rows = items(json);
    // t1(제목)·t2(내용) 등에 '폭염'이 들어간 발효 특보를 찾아요
    const hit = rows.find((r) => {
      const blob = `${r.title ?? ''} ${r.t1 ?? ''} ${r.t2 ?? ''} ${r.tmFc ?? ''}`;
      return blob.includes('폭염');
    });
    if (!hit) return null;
    const warn = String(hit.title ?? hit.t1 ?? '폭염특보').includes('경보')
      ? '폭염경보'
      : '폭염주의보';
    return { type: 'heat', text: `${warn}가 발효 중이에요. 한낮 야외 활동을 줄여요` };
  } catch {
    return null;
  }
}
