/**
 * judge API 클라이언트. docs/judge-api-spec.md 계약을 그대로 타입으로 옮겼어요.
 * 계산은 서버가 전부 하고, 여기서는 호출과 타입만 다뤄요.
 */
import type { JudgeLevel, Profile } from "../constants/judge";

const API_BASE_URL = "https://p3645aoqlgvlatlhgueesj4mt40ukhdc.lambda-url.ap-northeast-2.on.aws";

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

export interface RegionLookup {
  sido: string;
  sigungu: string;
  dong: string;
  // 서버가 이미 "구 동" 형태로 조합해 준 표시용 문자열이에요 — 세종시처럼 구가 없는 곳은
  // sido로 자동 폴백돼 있어서, 프론트에서 직접 조합하지 않고 이 값을 그대로 써요.
  label: string;
  code: string;
  nx: number;
  ny: number;
}

/**
 * 좌표 → 행정구역(카카오 역지오코딩, 동 단위까지). 중심점 최근접 방식(findNearestRegion)은
 * 경계 동네를 이웃 구로 잘못 잡을 수 있어서(공덕동→서대문구), GPS로 지역 라벨을 뽑을 땐 이 쪽이 더
 * 정확해요. 카카오 키 미설정·장애·미매칭이면 4xx/5xx로 실패해요 — 그때만 호출부가
 * findNearestRegion으로 폴백해요.
 */
export async function fetchRegion(lat: number, lon: number): Promise<RegionLookup> {
  const query = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await fetch(`${API_BASE_URL}/region?${query.toString()}`);
  if (!res.ok) {
    throw new Error(`region lookup failed: ${res.status}`);
  }
  return (await res.json()) as RegionLookup;
}

export interface RegionSearchResult {
  sido: string;
  sigungu: string;
  dong: string;
  label: string;
  code: string;
  lat: number;
  lon: number;
  nx: number;
  ny: number;
}

/**
 * 주소·동 이름으로 카카오 주소 검색(동 단위). 결과가 없으면 빈 배열 — 에러가 아니에요.
 * 카카오 키 미설정·장애면 502 — 호출부가 data/regions.json 기반 구 단위 검색(searchRegions)으로
 * 폴백해요 (정책: 위치 관련 기능이 부분 실패해도 검색 자체는 계속 동작해야 해요).
 */
export async function searchRegionsRemote(query: string): Promise<RegionSearchResult[]> {
  const url = new URLSearchParams({ q: query });
  const res = await fetch(`${API_BASE_URL}/search?${url.toString()}`);
  if (!res.ok) {
    throw new Error(`region search failed: ${res.status}`);
  }
  const body = (await res.json()) as { results: RegionSearchResult[] };
  return body.results;
}
