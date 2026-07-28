import type {
  HourSlot,
  JudgeResponse,
  Level,
  Metrics,
  Profile,
  WeatherPoint,
} from './types';
import { kstParts, nowKst, solarAltitude, toLatLon, yyyymmdd } from './geo';
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname !== '/judge') return err('NOT_FOUND', '없는 경로예요', 404);

    // 파라미터 검증. get()은 누락 시 null → Number(null)=0(유한값)이라 그냥 두면 통과해버려요.
    const nxRaw = url.searchParams.get('nx');
    const nyRaw = url.searchParams.get('ny');
    const nx = Number(nxRaw);
    const ny = Number(nyRaw);
    const profile = url.searchParams.get('profile') as Profile;
    const areaNo = url.searchParams.get('areaNo');

    if (
      nxRaw === null ||
      nyRaw === null ||
      !Number.isFinite(nx) ||
      !Number.isFinite(ny) ||
      !PROFILES.includes(profile)
    ) {
      return err('INVALID_PARAM', 'nx, ny, profile을 확인해 주세요', 400);
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
        fetchHeatWarning(env),
      ]);

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
        const f = fcst.get(key);

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
