/**
 * 동네 기분 투표의 선택지·문구.
 *
 * 아이콘은 유니코드 이모지 대신 토스 2d-icons PNG예요 — 유니코드로 두면 기기 기본 이모지
 * 폰트로 렌더링돼서(예: 아이폰 이모지) 앱 다른 곳의 아이콘 스타일과 안 맞아요
 * (constants/rain.ts의 RAIN_ICON과 같은 이유예요).
 */
import type { Profile } from "./judge";

export type Mood = "good" | "soso" | "bad";

/** 화면에 놓이는 순서 — 좋음 → 보통 → 별로 */
export const MOOD_ORDER: Mood[] = ["good", "soso", "bad"];

/**
 * 집계 한 줄에서 "제일 많은 쪽"을 고를 때 쓰는 순서 — 나쁜 것부터 봐요.
 *
 * 표가 같을 때(예: 좋음 5 · 별로 5) 먼저 본 쪽이 이겨요. 이 앱은 나가도 되는지를 돕는
 * 쪽이라, 절반이 별로라고 한 날을 "좋대요"로 요약하면 안 돼요. 그래서 동점은 나쁜 쪽으로
 * 기울여요.
 */
export const MOOD_SEVERITY_ORDER: Mood[] = ["bad", "soso", "good"];

export const MOOD_OPTIONS: Record<Mood, { icon: string; label: string }> = {
  good: {
    icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F60A.png", // 😊
    label: "좋아요",
  },
  soso: {
    icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F610.png", // 😐
    label: "그냥",
  },
  bad: {
    icon: "https://static.toss.im/2d-icons/emoji/png/4x/u1F625.png", // 😥
    label: "별로",
  },
};

/** "마포구 23명 중 18명이 ___" 뒤에 붙는 말 */
export const MOOD_VERDICT_PHRASE: Record<Mood, string> = {
  good: "좋대요",
  soso: "그냥 그렇대요",
  bad: "별로래요",
};

/* ────────── 한마디 (2단계) ────────── */

/**
 * 남길 수 있는 한마디는 **여기 적힌 문장 중에서만** 골라요. 자유 입력이 아니에요.
 *
 * 서버에는 문장이 아니라 **id만** 올라가요(`nice_today`). 그래서 사용자가 쓴 글자가 서버에
 * 한 개도 저장되지 않고, 검수·신고 기능 없이도 안전해요. 문구를 고치고 싶으면 여기만
 * 바꾸면 되고, id를 그대로 두면 이미 남겨진 한마디도 새 문구로 같이 바뀌어요.
 *
 * id를 **바꾸거나 지우면** 그 id로 남겨진 한마디는 화면에서 조용히 사라져요(앱이 모르는
 * id는 건너뛰거든요). 문구만 다듬을 땐 id를 유지하세요.
 */
export interface MoodPreset {
  id: string;
  text: string;
}

/**
 * 프로필과 무관하게 항상 고를 수 있는 것들.
 *
 * 바람은 좋기도 나쁘기도 해서 한 문장으로 두면 뜻이 안 통해요("바람 미쳤어요"가 시원하다는
 * 건지 세다는 건지 알 수 없어요). 그래서 방향을 나눠 두 개로 뒀어요.
 */
const COMMON_PRESETS: MoodPreset[] = [
  { id: "nice_today", text: "오늘 너무 좋아요" },
  { id: "windy_cool", text: "바람 시원해요" },
  { id: "windy_strong", text: "바람이 너무 세요" },
  { id: "hot", text: "생각보다 더 더워요" },
  { id: "cooler_than_looks", text: "보기보다 시원해요" },
  { id: "bring_umbrella", text: "우산 챙기세요" },
  { id: "dusty", text: "공기가 좀 답답해요" },
  // 물은 러너·견주·작업자 모두에게 해당돼서 프로필별이 아니라 공통에 뒀어요.
  { id: "water_up", text: "물 많이 챙기세요" },
];

/**
 * 프로필별로 하나씩 더 얹어요 — 같은 날씨도 러너·견주·야외 작업자가 다르게 겪으니까,
 * 그 사람만 할 수 있는 말이 하나쯤 있으면 카드가 훨씬 자기 얘기처럼 읽혀요.
 */
const PROFILE_PRESETS: Record<Profile, MoodPreset[]> = {
  runner: [
    { id: "good_pace", text: "오늘 페이스 잘 나와요" },
    { id: "too_humid_run", text: "습해서 금방 지쳐요" },
  ],
  dog: [
    { id: "paw_hot", text: "발바닥 조심하세요" },
    { id: "shade_only", text: "그늘로만 다녔어요" },
  ],
  worker: [
    { id: "need_break", text: "자주 쉬어가세요" },
    { id: "sun_harsh", text: "햇볕이 따가워요" },
  ],
};

export function moodPresetsFor(profile: Profile): MoodPreset[] {
  return [...PROFILE_PRESETS[profile], ...COMMON_PRESETS];
}

/** 서버가 내려준 id를 문장으로. 앱이 모르는 id면 null이라 화면에서 건너뛰어요. */
export function moodPresetText(id: string): string | null {
  return ALL_PRESETS.get(id) ?? null;
}

const ALL_PRESETS = new Map<string, string>(
  [...COMMON_PRESETS, ...Object.values(PROFILE_PRESETS).flat()].map((p) => [p.id, p.text]),
);
