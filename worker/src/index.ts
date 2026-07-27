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
  judge,
  round1,
  uviLabel,
} from './engine';
import { Env, estimateUvi, fetchNcst, fetchUvi, fetchVilage } from './kma';

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
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname !== '/judge') return err('NOT_FOUND', '없는 경로예요', 404);

    const nx = Number(url.searchParams.get('nx'));
    const ny = Number(url.searchParams.get('ny'));
    const profile = url.searchParams.get('profile') as Profile;
    const areaNo = url.searchParams.get('areaNo');

    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !PROFILES.includes(profile)) {
      return err('INVALID_PARAM', 'nx, ny, profile을 확인해 주세요', 400);
    }

    try {
      const now = nowKst();
      const p = kstParts(now);
      const { lat, lon } = toLatLon(nx, ny);
      const sunset = estimateSunsetHour(p.year, p.month, p.day, lat, lon);
      const today = yyyymmdd(now);

      const [ncst, fcst, uviMap] = await Promise.all([
        fetchNcst(env, nx, ny),
        fetchVilage(env, nx, ny),
        fetchUvi(env, areaNo),
      ]);

      const dateParts = { year: p.year, month: p.month, day: p.day };

      const uviAt = (hour: number, srNorm: number): number => {
        if (uviMap) {
          const exact = uviMap.get(hour);
          if (exact !== undefined) return exact;
        }
        return estimateUvi(srNorm);
      };

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
      let nowC = compute(nowPoint, p.month, lat, lon, dateParts, sunset);
      nowPoint.uvi = uviAt(p.hour, nowC.srNorm);
      nowC = { ...nowC, uvi: nowPoint.uvi };

      const verdict = judge(profile, nowC, ncst.airTemp, ncst.pty);

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
        let c = compute(point, p.month, lat, lon, dateParts, sunset);
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
        alert: null,
        source: '기상청',
      };

      return json(body);
    } catch (e) {
      console.error(e);
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
