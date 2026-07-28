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

export const PROFILE_META: Record<
  Profile,
  { label: string; emoji: string }
> = {
  runner: { label: "러닝·운동", emoji: "🏃" },
  dog: { label: "반려견 산책", emoji: "🐕" },
  worker: { label: "야외 작업", emoji: "🦺" },
};

// 홈 탭바 표시 순서 (디자인프레임 F1/F2 tabbar 기준)
export const PROFILE_ORDER: Profile[] = ["runner", "dog", "worker"];

// 최초 진입 시 기본 탭. 재방문부터는 마지막으로 본 탭을 Storage에서 읽어요 (TODO).
export const DEFAULT_PROFILE: Profile = "dog";

export interface SavedRegion {
  emojiSrc: string;
  name: string;
  nx: number;
  ny: number;
  levelLabel: string;
  levelColor: string;
}

// 저장된 지역(최대 3개) 목업 데이터. 홈의 지역 전환 바텀시트(F2·F3·F7)와 F6(위치 권한 거부) 화면이 같은 목록을 공유해요.
// TODO: Storage에서 실제 저장된 지역을 읽어와요. data/ 지역·격자 매핑(기획서 data/ 폴더)이 아직 없어서
// nx/ny는 기상청 동네예보 격자 좌표표 기준 기억나는 값을 임시로 넣었어요 — 강남구·해운대구 값은 검증 전이니
// data/ 매핑이 생기면 반드시 그 값으로 교체해요. levelLabel도 실제로는 judge API 응답이어야 해요.
export const SAVED_REGIONS: SavedRegion[] = [
  {
    emojiSrc: "https://static.toss.im/2d-icons/emoji/png/4x/u1F3E0.png",
    name: "고양시 일산동구",
    nx: 57,
    ny: 127,
    levelLabel: "좋음",
    levelColor: LEVEL_COLORS[1],
  },
  {
    emojiSrc: "https://static.toss.im/2d-icons/emoji/png/4x/u1F3E2.png",
    name: "서울 강남구",
    nx: 61,
    ny: 126,
    levelLabel: "주의",
    levelColor: LEVEL_COLORS[3],
  },
  {
    emojiSrc: "https://static.toss.im/2d-icons/emoji/png/4x/u1F30A.png",
    name: "부산 해운대구",
    nx: 99,
    ny: 75,
    levelLabel: "보통",
    levelColor: "#8B95A1",
  },
];

// docs/judge-api-spec.md "uviLabel" 구간
export function uviLabel(uvi: number): string {
  if (uvi < 3) return "낮음";
  if (uvi < 6) return "보통";
  if (uvi < 8) return "높음";
  if (uvi < 11) return "매우높음";
  return "위험";
}
