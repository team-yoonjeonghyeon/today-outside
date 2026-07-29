/**
 * 판정 등급·프로필 공용 상수.
 * docs/오늘나가도되나_디자인프레임 (2).html 색 토큰(:root) 기준 — 기획서·CLAUDE.md의 #0E9F6E보다 이 파일이 최신이에요.
 * 화면마다 색·라벨을 하드코딩하지 말고 이 파일을 참조해요.
 */

export type JudgeLevel = 1 | 2 | 3 | 4 | 5;

export type Profile = "runner" | "worker" | "dog";

// granite.config.ts의 brand.primaryColor와 동일한 값 (MINT 700 · Surfie Green · 판정 '좋음')
export const BRAND_COLOR = "#0C816A";

export const LEVEL_COLORS: Record<JudgeLevel, string> = {
  1: "#0C816A",
  2: "#A3C13A",
  3: "#F5A524",
  4: "#F2711C",
  5: "#E03131",
};

/**
 * 버튼·선택 상태 전용 민트 팔레트. LEVEL_COLORS[1](판정 '좋음')과는 값이 달라요 —
 * 등록값(브랜드·좋음)은 --mint700, 버튼·인터랙션은 --mint400 계열을 써요.
 */
export const MINT = {
  400: "#48F9D6", // Aquamarine · 버튼 배경 · 시그니처
  200: "#88F1CE", // Spray · 선택 상태
  700: "#0C816A", // Surfie Green · 브랜드 · 판정 좋음 (= BRAND_COLOR)
  900: "#05392F", // 민트 위에 올리는 잉크 텍스트
  50: "#EAFDF6", // 틴트 배경
  border: "#B7EEDC", // 틴트 배경 카드의 테두리 (.permcard, .notice 등)
} as const;

export const LEVEL_LABELS: Record<JudgeLevel, string> = {
  1: "좋음",
  2: "보통",
  3: "주의",
  4: "위험",
  5: "매우 위험",
};

/**
 * 홈(F2·F3·F7) 지표 히어로 카드(가장 중요한 지표 1개를 크게 보여주는 카드)의
 * 배경·테두리·아이콘 배경. 디자인프레임의 등급별 카드 톤을 정리한 값이에요.
 * 히어로 카드는 그 화면의 전체 판정 등급(now.level)과 같은 색조를 써요.
 */
export const HERO_TINTS: Record<
  JudgeLevel,
  { background: string; border: string; iconBackground: string }
> = {
  1: { background: MINT[50], border: "#B7EEDC", iconBackground: MINT[200] },
  2: { background: "#F6F9EC", border: "#DCE8B0", iconBackground: "#DCE8B0" },
  3: { background: "#FFF8EC", border: "#FCE3B4", iconBackground: "#FCE3B4" },
  4: { background: "#FFF3EC", border: "#FBD3BC", iconBackground: "#FBD3BC" },
  5: { background: "#FDECEC", border: "#F5C2C2", iconBackground: "#F5C2C2" },
};

// icon은 앱빌더가 실제로 쓰는 토스 2d-icons 에셋 URL이에요(F1 앱빌더 화면 코드 기준) —
// 화면에 아이콘(예: ListRow 왼쪽 원)을 그릴 땐 이 값을 써요. emoji는 캡션 텍스트 안에
// 인라인으로 넣을 때만 써요(예: Timeline 상단 "🏃 러닝·운동 · 강남구") — 텍스트라 이미지
// URL을 넣을 수 없어서 따로 둬요.
export const PROFILE_META: Record<
  Profile,
  { label: string; emoji: string; icon: string }
> = {
  runner: {
    label: "러닝·운동",
    emoji: "🏃",
    icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F3C3.1.W.png",
  },
  dog: {
    label: "반려견 산책",
    emoji: "🐕",
    icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F415_u1F9BA.png",
  },
  worker: {
    label: "야외 작업",
    emoji: "🦺",
    icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F9BA.png",
  },
};

// 홈 탭바 표시 순서 (디자인프레임 F1/F2 tabbar 기준)
export const PROFILE_ORDER: Profile[] = ["runner", "dog", "worker"];

// 최초 진입 시 기본 탭. 재방문부터는 마지막으로 본 탭을 Storage에서 읽어요 (useLastProfile).
export const DEFAULT_PROFILE: Profile = "dog";

// 홈(F2·F3·F7)의 지표 카드 3종 + F5(지표 상세)가 공유하는 지표 키.
// 카드를 누르면 이 키를 들고 F5로 이동해요 (docs/오늘나가도되나_디자인프레임.html 화면 흐름도:
// "지표 카드 › (체감·자외선·노면) → F5 지표 상세(해당 지표)").
export type MetricKey = "feelsLike" | "uv" | "road";

export const METRIC_EMOJI: Record<MetricKey, string> = {
  feelsLike: "https://static.toss.im/2d-icons/emoji/png/4x/u1F321.png",
  uv: "https://static.toss.im/2d-icons/emoji/png/4x/u2600.png",
  road: "https://static.toss.im/2d-icons/emoji/png/4x/u1F6E4.png",
};

export const METRIC_LABELS: Record<MetricKey, string> = {
  feelsLike: "체감온도",
  uv: "자외선",
  road: "노면 온도",
};

// docs/judge-api-spec.md "uviLabel" 구간
export function uviLabel(uvi: number): string {
  if (uvi < 3) return "낮음";
  if (uvi < 6) return "보통";
  if (uvi < 8) return "높음";
  if (uvi < 11) return "매우높음";
  return "위험";
}
