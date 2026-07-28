import type {
  Level,
  Profile,
  Surface,
  Verdict,
  WeatherPoint,
} from './types';
import { solarAltitude } from './geo';

/* ────────────────────────────────────────────────
   1. 체감온도
   기상청 여름철 체감온도 산식 (2022.6.2 개정)
   Tw는 Stull(2011) 습구온도 근사식
   ──────────────────────────────────────────────── */

export function wetBulb(ta: number, rh: number): number {
  const r = Math.max(5, Math.min(99, rh));
  return (
    ta * Math.atan(0.151977 * Math.sqrt(r + 8.313659)) +
    Math.atan(ta + r) -
    Math.atan(r - 1.67633) +
    0.00391838 * Math.pow(r, 1.5) * Math.atan(0.023101 * r) -
    4.686035
  );
}

export function feelsLikeSummer(ta: number, rh: number): number {
  const tw = wetBulb(ta, rh);
  return (
    -0.2442 +
    0.55399 * tw +
    0.45535 * ta -
    0.0022 * tw * tw +
    0.00278 * tw * ta +
    3.0
  );
}

/** 겨울철 풍속냉각지수. 10℃ 이하 + 풍속 1.3m/s 이상에서만 유효 */
export function feelsLikeWinter(ta: number, ws: number): number {
  const v = Math.pow(ws * 3.6, 0.16);
  return 13.12 + 0.6215 * ta - 11.37 * v + 0.3965 * ta * v;
}

export function feelsLike(ta: number, rh: number, ws: number, month: number): number {
  if (month >= 5 && month <= 9) return feelsLikeSummer(ta, rh);
  if (ta <= 10 && ws >= 1.3) return feelsLikeWinter(ta, ws);
  return ta;
}

/* ────────────────────────────────────────────────
   2. 노면온도 추정
   T_road = T_air + k × SR_norm × (1 − 0.03×WS) + R_residual
   ──────────────────────────────────────────────── */

export const K_SURFACE: Record<Surface, number> = {
  asphalt: 24,
  pavement: 18,
  grass: 7,
  soil: 6,
};

const SKY_FACTOR: Record<number, number> = { 1: 1.0, 3: 0.6, 4: 0.3 };

/** 일사량 정규화값 추정 (0~1) */
export function solarNorm(altitudeDeg: number, sky: number, pty: number): number {
  if (altitudeDeg <= 0) return 0;
  const base = Math.sin((altitudeDeg * Math.PI) / 180);
  let f = SKY_FACTOR[sky] ?? 0.6;
  if (pty > 0) f *= 0.5; // 강수 중이면 추가 감쇠
  return Math.max(0, Math.min(1, base * f));
}

/**
 * 잔열항. 일몰 후 τ=90분 지수감쇠, 초기값 +5℃
 * hoursAfterSunset이 음수(주간)면 0
 */
export function residual(hoursAfterSunset: number): number {
  if (hoursAfterSunset <= 0) return 0;
  return 5 * Math.exp(-(hoursAfterSunset * 60) / 90);
}

export function roadTemp(
  airTemp: number,
  windSpeed: number,
  srNorm: number,
  hoursAfterSunset: number,
  surface: Surface
): number {
  const attenuation = Math.max(0.6, 1 - 0.03 * windSpeed); // 최대 40% 감쇠
  const dT = K_SURFACE[surface] * srNorm * attenuation + residual(hoursAfterSunset);
  return airTemp + dT;
}

export function roadTempAll(
  airTemp: number,
  windSpeed: number,
  srNorm: number,
  hoursAfterSunset: number
): Record<Surface, number> {
  const out = {} as Record<Surface, number>;
  (Object.keys(K_SURFACE) as Surface[]).forEach((s) => {
    out[s] = round1(roadTemp(airTemp, windSpeed, srNorm, hoursAfterSunset, s));
  });
  return out;
}

/* ────────────────────────────────────────────────
   3. 서브스코어 정규화 (0~100)
   ──────────────────────────────────────────────── */

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export function sHeat(ft: number): number {
  if (ft <= 25) return 0;
  if (ft <= 31) return lerp(ft, 25, 31, 0, 40);
  if (ft <= 33) return lerp(ft, 31, 33, 40, 60);
  if (ft <= 35) return lerp(ft, 33, 35, 60, 80);
  if (ft <= 38) return lerp(ft, 35, 38, 80, 100);
  return 100;
}

export function sUv(uvi: number): number {
  if (uvi <= 2) return lerp(uvi, 0, 2, 0, 15);
  if (uvi <= 5) return lerp(uvi, 3, 5, 20, 40);
  if (uvi <= 7) return lerp(uvi, 6, 7, 45, 60);
  if (uvi <= 10) return lerp(uvi, 8, 10, 65, 85);
  return 100;
}

export function sRoad(rt: number): number {
  if (rt <= 35) return 0;
  if (rt <= 45) return lerp(rt, 35, 45, 0, 40);
  if (rt <= 52) return lerp(rt, 45, 52, 40, 70);
  if (rt <= 60) return lerp(rt, 52, 60, 70, 90);
  return 100;
}

/* ────────────────────────────────────────────────
   4. 프로필 가중치 + 판정
   ──────────────────────────────────────────────── */

const WEIGHTS: Record<Profile, { heat: number; uv: number; road: number }> = {
  runner: { heat: 0.55, uv: 0.3, road: 0.15 },
  worker: { heat: 0.65, uv: 0.25, road: 0.1 },
  dog: { heat: 0.4, uv: 0.1, road: 0.5 },
};

function scoreToLevel(score: number): Level {
  if (score < 20) return 1;
  if (score < 40) return 2;
  if (score < 60) return 3;
  if (score < 80) return 4;
  return 5;
}

export interface Computed {
  feelsLike: number;
  roadTemp: number;
  roadBySurface: Record<Surface, number>;
  srNorm: number;
  uvi: number;
}

export function compute(
  p: WeatherPoint,
  month: number,
  lat: number,
  lon: number,
  date: { year: number; month: number; day: number },
  sunsetHour: number,
  srOverride?: number
): Computed {
  const alt = solarAltitude(date.year, date.month, date.day, p.hour, lat, lon);
  // srOverride가 오면 이미 시간축 스무딩된 값이므로 잔열항을 따로 더하지 않음
  const srNorm = srOverride ?? solarNorm(alt, p.sky, p.pty);
  const hoursAfterSunset = srOverride !== undefined ? -1 : p.hour - sunsetHour;
  const bySurface = roadTempAll(p.airTemp, p.windSpeed, srNorm, hoursAfterSunset);

  return {
    feelsLike: round1(feelsLike(p.airTemp, p.humidity, p.windSpeed, month)),
    roadTemp: bySurface.asphalt,
    roadBySurface: bySurface,
    srNorm,
    uvi: p.uvi,
  };
}

/** 반려견 지면 높이 체감 보정. 습도 효과를 잃지 않도록 체감온도와 max */
export function dogFeltTemp(airTemp: number, road: number, fl: number): number {
  return Math.max(fl, airTemp + 0.35 * (road - airTemp));
}

export function judge(
  profile: Profile,
  c: Computed,
  airTemp: number,
  pty: number
): Verdict {
  const heatInput =
    profile === 'dog' ? dogFeltTemp(airTemp, c.roadTemp, c.feelsLike) : c.feelsLike;

  const w = WEIGHTS[profile];
  const score =
    w.heat * sHeat(heatInput) + w.uv * sUv(c.uvi) + w.road * sRoad(c.roadTemp);

  let level = scoreToLevel(score);
  let gate: string | null = null;

  // 하드 게이트
  const raise = (min: Level, id: string) => {
    if (level < min) {
      level = min;
      gate = id;
    }
  };

  if (c.uvi >= 11) raise(3, 'UV_11');
  if (profile === 'worker' && c.feelsLike >= 33) raise(3, 'WORKER_33');
  if (profile === 'dog' && c.roadTemp >= 52) raise(4, 'DOG_ROAD_52');
  if (c.feelsLike >= 35) raise(4, 'HEAT_35');
  if (c.roadTemp >= 60) raise(5, 'ROAD_60');
  if (pty > 0 && pty !== 3) raise(3, 'RAIN');

  const { headline, reason } = sentence(profile, level, c, gate);

  return { level, score: Math.round(score), headline, reason, gate };
}

/* ────────────────────────────────────────────────
   5. 문장 생성 (규칙 기반. LLM 미사용)
   ──────────────────────────────────────────────── */

const HEADLINES: Record<Profile, Record<Level, string>> = {
  runner: {
    1: '지금 나가기 좋아요',
    2: '물만 챙기면 괜찮아요',
    3: '강도를 낮추고 짧게 뛰어요',
    4: '지금은 실내가 좋아요',
    5: '저녁까지 미뤄요',
  },
  worker: {
    1: '지금 작업하기 좋아요',
    2: '물을 자주 마셔요',
    3: '2시간마다 20분씩 쉬어요',
    4: '작업 강도를 낮춰요',
    5: '가장 더운 시간은 피해요',
  },
  dog: {
    1: '지금 산책하기 좋아요',
    2: '그늘 위주로 걸어요',
    3: '아스팔트는 피하고 짧게 다녀와요',
    4: '지금은 흙길이나 잔디로만 가요',
    5: '배변만 짧게, 안고 이동해요',
  },
};

function sentence(
  profile: Profile,
  level: Level,
  c: Computed,
  gate: string | null
): { headline: string; reason: string } {
  const headline = HEADLINES[profile][level];

  let reason: string;
  if (gate === 'ROAD_60' || gate === 'DOG_ROAD_52' || (profile === 'dog' && c.roadTemp >= 45)) {
    reason = `아스팔트가 ${Math.round(c.roadTemp)}℃까지 올라 발바닥에 무리가 갈 수 있어요`;
  } else if (profile === 'dog') {
    reason = `아스팔트 ${Math.round(c.roadTemp)}℃, 흙길은 ${Math.round(c.roadBySurface.soil)}℃예요`;
  } else if (gate === 'RAIN') {
    reason = '비가 오고 있어요';
  } else if (gate === 'UV_11') {
    reason = `자외선지수가 ${c.uvi}로 위험 단계예요`;
  } else if (c.feelsLike >= 31) {
    reason = `체감온도가 ${Math.round(c.feelsLike)}℃예요`;
  } else if (c.uvi >= 6) {
    reason = `자외선지수가 ${c.uvi}로 높아요`;
  } else {
    reason = `체감온도 ${Math.round(c.feelsLike)}℃, 자외선 ${c.uvi}예요`;
  }

  if (level === 1 && profile !== 'dog') {
    reason = `체감온도 ${Math.round(c.feelsLike)}℃, 자외선 ${c.uvi}로 무리 없어요`;
  }

  return { headline, reason };
}

/**
 * 낙뢰·호우 하드게이트. 기획서 3-5 "낙뢰 예보 / 시간당 강수 15mm↑ → 매우 위험 (사유 대체 표시)".
 * 가중합·다른 게이트를 전부 무시하고 최고 등급으로 올린 뒤 사유를 위험 문구로 갈아끼워요.
 * 낙뢰가 강수보다 우선이에요.
 */
export function hazardGate(
  base: Verdict,
  profile: Profile,
  rainMmPerHour: number,
  lightning: boolean
): Verdict {
  if (lightning) {
    return {
      ...base,
      level: 5,
      headline: HEADLINES[profile][5],
      reason: '천둥·번개가 예보됐어요. 지금은 안전한 실내가 좋아요',
      gate: 'LIGHTNING',
    };
  }
  if (rainMmPerHour >= 15) {
    return {
      ...base,
      level: 5,
      headline: HEADLINES[profile][5],
      reason: `시간당 ${Math.round(rainMmPerHour)}mm 강한 비가 내려요. 지금은 실내가 좋아요`,
      gate: 'HEAVY_RAIN',
    };
  }
  return base;
}

/* ────────────────────────────────────────────────
   6. 시간창 계산
   ──────────────────────────────────────────────── */

export function findBestWindow(
  hourly: { hour: number; level: Level }[],
  currentHour: number
): { start: number; end: number; label: string } | null {
  const after = hourly.filter((h) => h.hour > currentHour);
  let runStart = -1;

  for (let i = 0; i < after.length; i++) {
    const ok = after[i].level <= 2;
    if (ok && runStart < 0) runStart = after[i].hour;
    if (!ok && runStart >= 0) {
      if (after[i].hour - runStart >= 2) {
        return { start: runStart, end: after[i].hour - 1, label: label(runStart) };
      }
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    const last = after[after.length - 1].hour;
    if (last - runStart >= 1) {
      return { start: runStart, end: last, label: label(runStart) };
    }
  }
  return null;
}

function label(hour: number): string {
  if (hour < 12) return `오전 ${hour}시부터 좋아요`;
  if (hour === 12) return '낮 12시부터 좋아요';
  if (hour < 18) return `오후 ${hour - 12}시부터 좋아요`;
  return `저녁 ${hour - 12}시부터 좋아요`;
}

export function uviLabel(uvi: number): string {
  if (uvi < 3) return '낮음';
  if (uvi <= 5) return '보통';
  if (uvi <= 7) return '높음';
  if (uvi <= 10) return '매우높음';
  return '위험';
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ────────────────────────────────────────────────
   7. 노면 축열 스무딩
   일몰 경계에서 잔열항이 계단처럼 튀는 문제를 해결.
   일사량을 τ=90분 지수감쇠로 시간축에 번지게 한다.
   ──────────────────────────────────────────────── */

export function smoothSolar(sr: number[]): number[] {
  const decay = Math.exp(-60 / 90);
  const out: number[] = [];
  let carry = 0;
  for (let h = 0; h < sr.length; h++) {
    carry = Math.max(sr[h], carry * decay);
    out.push(carry);
  }
  return out;
}
