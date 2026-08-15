export type Level = 1 | 2 | 3 | 4 | 5;
export type Profile = 'runner' | 'worker' | 'dog';
export type Surface = 'asphalt' | 'pavement' | 'grass' | 'soil';

export interface Verdict {
  level: Level;
  score: number;
  headline: string;
  reason: string;
  gate: string | null;
}

export interface Metrics {
  airTemp: number;
  humidity: number;
  windSpeed: number;
  feelsLike: number;
  uvi: number;
  uviLabel: string;
  roadTemp: number;
  roadTempEstimated: boolean;
  roadBasis: string;
  roadBySurface: Record<Surface, number>;
  /** 지금 강수형태(초단기실황 PTY). 0 없음 / 1 비 / 2 비눈 / 3 눈 / 4 소나기 */
  pty: number;
  /** 지금 1시간 강수량(mm). 초단기실황 RN1 — '강수없음'이면 0이에요. */
  rain: number;
}

export interface HourSlot {
  hour: number;
  level: Level;
  feelsLike: number;
  roadTemp: number;
  /**
   * 강수형태 0 없음 / 1 비 / 2 비눈 / 3 눈 / 4 소나기.
   *
   * 판정 엔진은 예전부터 이 값을 쓰고 있었는데(비 오면 등급을 올려요) 응답에는 안 실려서
   * 화면이 "왜 등급이 올랐는지"를 보여줄 수 없었어요. 시간별로 그대로 내보내요.
   */
  pty: number;
  /** 1시간 강수량(PCP) — 기상청 원문 구간 문자열 그대로("1.0~4.9mm" 등). 비가 없거나
   * 서버가 아직 못 받았으면 없어요. 프론트가 화면에 쓸 대표값은 이 문자열에서 직접 뽑아요 —
   * 서버가 정확한 mm인 척 숫자를 지어내지 않아요. */
  pcp?: string;
}

export interface BestWindow {
  start: number;
  end: number;
  label: string;
}

export interface Alert {
  type: string;
  text: string;
}

export interface JudgeResponse {
  generatedAt: string;
  observedAt: string;
  stale: boolean;
  profile: Profile;
  now: Verdict;
  metrics: Metrics;
  hourly: HourSlot[];
  bestWindow: BestWindow | null;
  alert: Alert | null;
  source: string;
}

/** 판정 엔진 입력 1슬롯 */
export interface WeatherPoint {
  hour: number;
  airTemp: number;
  humidity: number;
  windSpeed: number;
  /** 하늘상태 1 맑음 / 3 구름많음 / 4 흐림 */
  sky: 1 | 3 | 4;
  /** 강수형태 0 없음 / 1 비 / 2 비눈 / 3 눈 / 4 소나기 */
  pty: number;
  uvi: number;
}
