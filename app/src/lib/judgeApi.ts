/**
 * judge API 클라이언트. docs/judge-api-spec.md 계약을 그대로 타입으로 옮겼어요.
 * 계산은 서버가 전부 하고, 여기서는 호출과 타입만 다뤄요.
 */
import type { JudgeLevel, Profile } from "../constants/judge";

export const API_BASE_URL = "https://p3645aoqlgvlatlhgueesj4mt40ukhdc.lambda-url.ap-northeast-2.on.aws";

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
  /**
   * 강수형태 0 없음 / 1 비 / 2 비눈 / 3 눈 / 4 소나기, 그리고 1시간 강수량(mm).
   *
   * 서버가 이 필드를 내보내기 시작한 게 화면보다 나중이라 옵션이에요 — 배포가 아직 안 된
   * 서버는 이 값 없이 응답해요. 없으면 비 안내를 아예 안 그려요(있지도 않은 값을 0으로
   * 단정해서 "비 안 와요"라고 말하면 안 되니까요).
   */
  pty?: number;
  rain?: number;
}

export interface HourSlot {
  hour: number;
  level: JudgeLevel;
  feelsLike: number;
  roadTemp: number;
  /** 강수형태. 위 Metrics.pty와 같은 이유로 옵션이에요. */
  pty?: number;
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
  return withRainPreview(body as JudgeResponse);
}

/**
 * 개발 중에만 도는 강수 미리보기. 주소에 `?rain=1`을 붙이면 응답에 비를 끼워 넣어요.
 *
 * 강수 필드는 워커에 막 넣은 거라 배포된 서버는 아직 안 내려줘요. 그렇다고 실제 비가 올
 * 때까지 기다려서 화면을 확인할 수도 없어서, 개발 중에만 쓰는 확인용 스위치를 뒀어요.
 *
 * `import.meta.env.DEV`는 프로덕션 빌드에서 false로 상수 폴딩돼서 이 블록 전체가 번들에서
 * 사라져요 — 출시본에는 들어가지 않아요.
 */
function withRainPreview(body: JudgeResponse): JudgeResponse {
  if (!import.meta.env.DEV) return body;
  if (typeof window === "undefined") return body;
  if (new URLSearchParams(window.location.search).get("rain") !== "1") return body;

  const nowHour = Number(body.generatedAt.match(/T(\d{2}):/)?.[1] ?? 0);
  return {
    ...body,
    // 지금은 비, 1시간 2.5mm.
    metrics: { ...body.metrics, pty: 1, rain: 2.5 },
    // 지금부터 3시간은 비, 그 뒤 두 칸 쉬었다가 저녁에 소나기 — 연속/불연속을 같이 봐요.
    hourly: body.hourly.map((slot) => ({
      ...slot,
      pty:
        slot.hour >= nowHour && slot.hour < nowHour + 3
          ? 1
          : slot.hour >= nowHour + 5 && slot.hour < nowHour + 7
            ? 4
            : 0,
    })),
  };
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

export type NotificationType = "morningBriefing" | "dangerAlert" | "walkTimeAlert";

export interface NotificationRegion {
  name: string;
  nx: number;
  ny: number;
}

/**
 * 알림 동의(requestNotificationAgreement newAgreement) 뒤에 호출해서 식별키·지역·프로필을
 * 서버에 저장해요. 실제 조건 판정·발송(스마트 발송)은 아직 서버에 없어요 — 지금은 "누가
 * 동의했는지"만 기록해두는 단계예요. 실패해도 토글은 그냥 켜져요(이미 동의 UI는 진짜로
 * 띄웠으니까요) — best-effort로 두고 조용히 넘어가요.
 */
export async function subscribeNotification(params: {
  anonKey: string;
  type: NotificationType;
  profile: Profile;
  regions: NotificationRegion[];
}): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/notify/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function unsubscribeNotification(anonKey: string, type: NotificationType): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/notify/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonKey, type }),
    });
  } catch {
    // 실패해도 로컬 토글은 그냥 꺼져요 — 다음에 다시 껐다 켜면 서버 쪽도 정리돼요.
  }
}
