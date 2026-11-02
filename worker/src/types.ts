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
  /**
   * 이 시간의 자외선지수·기온. 화면엔 안 쓰지만(그건 feelsLike·roadTemp로 이미 충분해요),
   * Lambda 어댑터가 "지난 시간은 다시 계산하지 않고 저장해둔 값을 쓴다"를 하려면 judge()를
   * 프로필별로 다시 돌릴 수 있어야 해서 필요해요 — level만 저장하면 그 시간을 처음 관측한
   * 프로필로 고정돼버려서, 다른 프로필로 보면 틀린 등급이 나와요. lambda.ts 참고.
   */
  uvi: number;
  airTemp: number;
  /** 이 시간의 흙길 노면온도. 강아지 프로필 문장("아스팔트 32℃, 흙길은 30℃예요")을
   * judge()로 다시 만들려면 필요해요 — 위 uvi·airTemp 주석과 같은 이유예요. */
  roadTempSoil: number;
}

export interface BestWindow {
  start: number;
  end: number;
  label: string;
}

/** 오늘 최저·최고기온과 일교차. 판정 등급에는 반영하지 않는 안내용 정보예요. */
export interface DailyRange {
  min: number;
  max: number;
  /** max - min */
  diff: number;
  /**
   * 값의 출처. `forecast`는 기상청 단기예보의 일 최저(TMN)·최고(TMX)고, `hourly`는 그 값이
   * 응답에 없어서 06~23시 시간별 기온에서 직접 뽑은 값이에요 — 06시 이전 새벽 최저는 빠져 있을 수 있어요.
   */
  basis: 'forecast' | 'hourly';
  /** 규칙 기반 안내 문장. 안내할 일교차가 아니면 null. */
  advice: string | null;
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
  /** 오늘 최저·최고기온과 일교차. 예전 서버 응답에는 없을 수 있어요. */
  dailyRange?: DailyRange;
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
