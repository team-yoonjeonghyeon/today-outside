import type {
  Alert,
  HourSlot,
  JudgeResponse,
  Level,
  Metrics,
  Profile,
  WeatherPoint,
} from './types';
import { isValidGrid, kstParts, nowKst, solarAltitude, toLatLon, yyyymmdd } from './geo';
import {
  compute,
  findBestWindow,
  hazardGate,
  judge,
  round1,
  smoothSolar,
  solarNorm,
  uviLabel,
} from './engine';
import {
  earliestTodayVilageBase,
  Env,
  estimateUvi,
  fetchHeatWarning,
  fetchLightning,
  fetchNcst,
  fetchUvi,
  fetchVilage,
} from './kma';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function err(code: string, message: string, status: number) {
  return json({ error: code, message }, status);
}

const PROFILES: Profile[] = ['runner', 'worker', 'dog'];

/** 일몰 시각을 태양고도로 근사 (18시 이후 처음 고도<=0 이 되는 시각) */
function estimateSunsetHour(
  year: number,
  month: number,
  day: number,
  lat: number,
  lon: number
): number {
  for (let h = 16; h <= 22; h += 0.25) {
    if (solarAltitude(year, month, day, h, lat, lon) <= 0) return h;
  }
  return 19.5;
}

/**
 * fetchHeatWarning은 기상청 특보 목록 → 통보문 상세, 이렇게 KMA를 순차로 2번 불러요
 * (kma.ts 참고). 나머지 4개 병렬 호출은 전부 1번씩이라, 캐시가 없는 새 좌표에서는 이
 * 브랜치 혼자 전체 /judge 응답 시간을 2배 가까이 끌어올려요 — 실측으로 4~6초까지 걸렸어요.
 * 폭염특보는 홈 상단 배너용 부가 정보고 실패해도 이미 null로 조용히 넘어가게 설계돼 있어서
 * (fetchHeatWarning 자체 try/catch), 판정 핵심 데이터까지 붙잡아둘 이유가 없어요.
 *
 * 그래서 여기서 타임아웃을 걸어요: timeoutMs 안에 못 끝내면 이번 응답은 null로 먼저 내보내고,
 * 원래 요청은 ctx.waitUntil로 응답 이후에도 계속 흘러가게 둬서 — 다음 요청부턴 캐시로
 * 빠르게 뜨게 해요(KMA 응답 캐시는 fetchHeatWarning 내부 cachedJson이 이미 채워줘요).
 */
function heatWarningWithTimeout(
  env: Env,
  area: string | null,
  ctx: ExecutionContext,
  timeoutMs = 1500
): Promise<Alert | null> {
  const task = fetchHeatWarning(env, area);
  ctx.waitUntil(task.then(() => undefined, () => undefined));

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    task.then(
      (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    );
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    // /region·/search 역지오코딩은 Lambda 어댑터(lambda.ts)가 자체 처리해요.
    if (url.pathname !== '/judge') return err('NOT_FOUND', '없는 경로예요', 404);

    // 파라미터 검증. get()은 누락 시 null → Number(null)=0이라 그냥 두면 통과해버려요.
    // isValidGrid가 누락(0)·비정수·NaN·격자 범위 밖을 전부 걸러내요 → 잘못된 좌표는 503이 아니라 400.
    const nx = Number(url.searchParams.get('nx'));
    const ny = Number(url.searchParams.get('ny'));
    const profile = url.searchParams.get('profile') as Profile;
    const areaNo = url.searchParams.get('areaNo');
    // 지역명(예: "고양시 일산동구"). 폭염특보를 이 구역으로 필터. 없으면 전국 폴백.
    const area = url.searchParams.get('area');

    if (!isValidGrid(nx, ny) || !PROFILES.includes(profile)) {
      return err('INVALID_PARAM', 'nx, ny(격자 범위), profile을 확인해 주세요', 400);
    }

    // stale 폴백 캐시. 성공 응답을 URL(nx·ny·profile·areaNo) 단위로 저장하고,
    // 업스트림 장애 시 마지막 성공 응답을 stale:true로 서빙해요 (빈 화면 금지, 기획서 §10).
    // caches.default는 배포 환경에서만 동작해요.
    const cache = (globalThis as any).caches?.default as Cache | undefined;
    const cacheKey = new Request(url.toString());

    try {
      const now = nowKst();
      const p = kstParts(now);
      const { lat, lon } = toLatLon(nx, ny);
      const sunset = estimateSunsetHour(p.year, p.month, p.day, lat, lon);
      const today = yyyymmdd(now);

      const [ncst, fcst, uviMap, lightning, heatWarn] = await Promise.all([
        fetchNcst(env, nx, ny),
        fetchVilage(env, nx, ny),
        fetchUvi(env, areaNo),
        fetchLightning(env, nx, ny),
        heatWarningWithTimeout(env, area, ctx),
      ]);

      // 최신 발표는 발표 시각 이전 시간을 안 줘요(예: 20시 발표엔 06~19시가 없어요).
      // 그런 지난 시간이 하나라도 있으면 오늘 새벽 첫 발표를 추가로 받아서 메꿔요 — 그
      // 발표는 하루 전체(06~23시)를 담고 있어서, 아무도 그 시간에 들어와본 적 없는
      // "콜드 스타트" 상황에서도 지금 날씨로 퉁치지 않고 실제 그 시간의 예보값을 쓸 수 있어요.
      // 이미 커버되는 날(대부분)엔 이 추가 호출이 아예 안 일어나요.
      let earlyFcst: Awaited<ReturnType<typeof fetchVilage>> | null = null;
      const needsBackfill = Array.from({ length: Math.max(0, p.hour - 6) }, (_, i) => 6 + i).some(
        (h) => !fcst.get(`${today}-${String(h).padStart(2, '0')}00`)
      );
      if (needsBackfill) {
        // 실패해도 조용히 넘어가요 — 이 호출이 없던 시절의 지금 날씨 폴백으로 돌아갈 뿐,
        // 이거 하나 때문에 /judge 전체가 502로 죽으면 안 돼요(부가 개선이지 필수 데이터가
        // 아니에요).
        earlyFcst = await fetchVilage(env, nx, ny, earliestTodayVilageBase(now)).catch(() => null);
      }

      const dateParts = { year: p.year, month: p.month, day: p.day };

      const uviAt = (hour: number, srNorm: number): number => {
        if (uviMap) {
          const exact = uviMap.get(hour);
          if (exact !== undefined) return exact;
        }
        return estimateUvi(srNorm);
      };

      /* ── 일사량 시간축 스무딩 (노면 축열) ── */
      const srRaw: number[] = [];
      for (let h = 0; h <= 23; h++) {
        const f = fcst.get(`${today}-${String(h).padStart(2, '0')}00`);
        const alt = solarAltitude(p.year, p.month, p.day, h, lat, lon);
        srRaw.push(solarNorm(alt, f?.sky ?? 3, f?.pty ?? 0));
      }
      const srSmooth = smoothSolar(srRaw);

      /* ── 현재 판정 ── */
      const nowAlt = solarAltitude(p.year, p.month, p.day, p.hour, lat, lon);
      const nowPoint: WeatherPoint = {
        hour: p.hour,
        airTemp: ncst.airTemp,
        humidity: ncst.humidity,
        windSpeed: ncst.windSpeed,
        sky: (fcst.get(`${today}-${String(p.hour).padStart(2, '0')}00`)?.sky ?? 3) as 1 | 3 | 4,
        pty: ncst.pty,
        uvi: 0,
      };
      let nowC = compute(nowPoint, p.month, lat, lon, dateParts, sunset, srSmooth[p.hour]);
      nowPoint.uvi = uviAt(p.hour, nowC.srNorm);
      nowC = { ...nowC, uvi: nowPoint.uvi };

      // 낙뢰·호우는 가중합/다른 게이트를 덮어써서 매우위험으로 강제 (기획서 3-5)
      const verdict = hazardGate(
        judge(profile, nowC, ncst.airTemp, ncst.pty),
        profile,
        ncst.rain,
        lightning
      );

      /* ── 시간창 06~23시 ── */
      const hourly: HourSlot[] = [];
      for (let h = 6; h <= 23; h++) {
        const key = `${today}-${String(h).padStart(2, '0')}00`;
        // 최신 발표에 없으면(발표 시각 이전 시간) 오늘 새벽 첫 발표로 메꿔요 — 그것도 없어야
        // (이론상 거의 없어요, 첫 발표가 하루를 통째로 담고 있으니까요) 지금 날씨로 대신 채워요.
        // 지금 날씨 폴백은 정확하진 않지만 화면에서 그 시간이 통째로 사라지는 것보단 나아요.
        // 이 시간을 실제로 정확히 보여주는 일은 배열에서 빼는 게 아니라 lambda.ts의 시간별
        // 판정 동결(freezeHourly)이 해요 — 그 시간이 "지금"이었을 때 계산해둔 값을
        // 저장해뒀다가 지난 뒤엔 그 값을 그대로 돌려줘요.
        const f = fcst.get(key) ?? earlyFcst?.get(key);
        const point: WeatherPoint = {
          hour: h,
          airTemp: f?.airTemp ?? ncst.airTemp,
          humidity: f?.humidity ?? ncst.humidity,
          windSpeed: f?.windSpeed ?? ncst.windSpeed,
          sky: (f?.sky ?? 3) as 1 | 3 | 4,
          pty: f?.pty ?? 0,
          uvi: 0,
        };
        let c = compute(point, p.month, lat, lon, dateParts, sunset, srSmooth[h]);
        c = { ...c, uvi: uviAt(h, c.srNorm) };
        const v = judge(profile, c, point.airTemp, point.pty);

        hourly.push({
          hour: h,
          level: v.level,
          feelsLike: c.feelsLike,
          roadTemp: c.roadTemp,
          pty: point.pty,
          uvi: c.uvi,
          airTemp: round1(point.airTemp),
          roadTempSoil: c.roadBySurface.soil,
          // 빈 문자열도 "이 시간엔 강수량 구간이 없다"는 유효한 값이라 undefined일 때만 빼요
          // (truthy 체크였으면 ""가 카테고리 자체가 없었던 것과 구분 없이 사라졌어요).
          ...(f?.pcp !== undefined ? { pcp: f.pcp } : {}),
        });
      }

      const bestWindow = findBestWindow(
        hourly.map((h) => ({ hour: h.hour, level: h.level as Level })),
        p.hour
      );

      const metrics: Metrics = {
        airTemp: round1(ncst.airTemp),
        humidity: ncst.humidity,
        windSpeed: round1(ncst.windSpeed),
        feelsLike: nowC.feelsLike,
        uvi: nowC.uvi,
        uviLabel: uviLabel(nowC.uvi),
        roadTemp: nowC.roadTemp,
        roadTempEstimated: true,
        roadBasis: roadBasis(ncst.airTemp, nowC.srNorm, ncst.windSpeed),
        roadBySurface: nowC.roadBySurface,
        pty: ncst.pty,
        rain: ncst.rain,
      };

      const body: JudgeResponse = {
        generatedAt: isoKst(now),
        observedAt: `${ncst.baseDate.slice(0, 4)}-${ncst.baseDate.slice(4, 6)}-${ncst.baseDate.slice(6, 8)}T${ncst.baseTime.slice(0, 2)}:00:00+09:00`,
        stale: false,
        profile,
        now: verdict,
        metrics,
        hourly,
        bestWindow,
        alert: heatWarn,
        source: '기상청',
      };

      // 마지막 성공 응답을 stale 폴백용으로 저장 (1시간 TTL)
      if (cache) {
        const store = new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
        });
        ctx.waitUntil(cache.put(cacheKey, store));
      }

      return json(body);
    } catch (e) {
      console.error(e);

      // 업스트림 장애 시 마지막 성공 응답을 stale:true로 서빙 (빈 화면 금지)
      if (cache) {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const cached = (await hit.json()) as JudgeResponse;
          return json({ ...cached, stale: true });
        }
      }

      return err('UPSTREAM_UNAVAILABLE', '잠시 후 다시 시도해 주세요', 503);
    }
  },
};

function roadBasis(airTemp: number, srNorm: number, ws: number): string {
  const sun = srNorm >= 0.7 ? '강한 햇빛' : srNorm >= 0.35 ? '보통 햇빛' : '약한 햇빛';
  const wind = ws < 2 ? '약한 바람' : ws < 5 ? '보통 바람' : '강한 바람';
  return `기온 ${Math.round(airTemp)}℃ + ${sun} + ${wind} 기준`;
}

function isoKst(d: Date): string {
  const p = kstParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00+09:00`;
}
