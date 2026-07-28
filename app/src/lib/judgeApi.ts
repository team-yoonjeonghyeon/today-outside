/**
 * judge API 클라이언트. docs/judge-api-spec.md 계약을 그대로 타입으로 옮겼어요.
 * 계산은 서버가 전부 하고, 여기서는 호출과 타입만 다뤄요.
 */
import type { JudgeLevel, Profile } from "../constants/judge";

const API_BASE_URL = "https://today-outside-api.yoonjeonghyeon.workers.dev";

export interface Verdict {
  level: JudgeLevel;
  score: number;
  headline: string;
  reason: string;
  gate: string | null;
}

export interface RoadBySurface {
  asphalt: number;
  pavement: number;
  grass: number;
  soil: number;
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
  roadBySurface: RoadBySurface;
}

export interface HourSlot {
  hour: number;
  level: JudgeLevel;
  feelsLike: number;
  roadTemp: number;
}

export interface BestWindow {
  start: number;
  end: number;
  label: string;
}

export interface JudgeAlert {
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
  alert: JudgeAlert | null;
  source: string;
}

export interface JudgeErrorBody {
  error: "INVALID_PARAM" | "NOT_FOUND" | "UPSTREAM_UNAVAILABLE";
  message: string;
}

export class JudgeApiError extends Error {
  body: JudgeErrorBody;

  constructor(body: JudgeErrorBody) {
    super(body.message);
    this.body = body;
  }
}

export interface FetchJudgeParams {
  nx: number;
  ny: number;
  profile: Profile;
  areaNo?: string;
}

export async function fetchJudge({
  nx,
  ny,
  profile,
  areaNo,
}: FetchJudgeParams): Promise<JudgeResponse> {
  const query = new URLSearchParams({
    nx: String(nx),
    ny: String(ny),
    profile,
  });
  if (areaNo) query.set("areaNo", areaNo);

  const res = await fetch(`${API_BASE_URL}/judge?${query.toString()}`);
  const body = await res.json();

  if (!res.ok) {
    throw new JudgeApiError(body as JudgeErrorBody);
  }
  return body as JudgeResponse;
}
