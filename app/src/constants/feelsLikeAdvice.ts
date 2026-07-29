/**
 * 체감온도 지표 상세(F5)용 조언 문구.
 * 법정 기준(폭염작업 31℃ / 휴식 33℃)·기획서 서브스코어 구간에 맞춘 밴드별 조언.
 * 규칙 기반(LLM 미사용). **의료·진단 표현 금지** — 물·그늘·휴식·복장·시간대 같은 생활 안내만.
 * 판정 한 줄(now.headline)이 이미 말하는 것과 겹치지 않게, 구체 행동으로 채웠어요.
 */
import type { Profile } from "./judge";

export type FeelsBand = "쾌적" | "보통" | "주의" | "위험" | "매우위험";

/** 체감온도(℃) → 밴드. 경계는 법정 31/33/35℃에 맞췄어요. */
export function feelsLikeBand(feelsLike: number): FeelsBand {
  if (feelsLike < 25) return "쾌적";
  if (feelsLike < 31) return "보통";
  if (feelsLike < 33) return "주의";
  if (feelsLike < 35) return "위험";
  return "매우위험";
}

interface FeelsAdvice {
  headline: string; // 한 줄 안내 (생활 안내, 비의료)
  tips: string[]; // 공통
  runner?: string[]; // 러닝·운동 추가
  worker?: string[]; // 야외 작업 추가
  dog?: string[]; // 반려견 전용 (사람 팁 대신). 강아지 더위 관점 — 그늘·물·짧게·헐떡임
}

export const FEELS_ADVICE: Record<FeelsBand, FeelsAdvice> = {
  쾌적: {
    headline: "활동하기 좋은 온도예요",
    tips: ["가볍게 물만 챙기면 충분해요"],
    dog: ["시원해서 산책하기 좋아요"],
  },
  보통: {
    headline: "덥지만 견딜 만해요. 수분을 미리 챙겨요",
    tips: [
      "목마르기 전에 물을 마셔요",
      "얇고 통풍 잘 되는 옷을 입어요",
    ],
    dog: ["그늘 위주로 걷고 물을 챙겨줘요"],
  },
  주의: {
    headline: "더위가 부담되는 온도예요. 무리하지 않게 해요",
    tips: [
      "15~20분마다 물을 나눠 마셔요",
      "그늘을 자주 찾아요",
    ],
    runner: ["강도를 낮추고 짧게 뛰어요"],
    worker: ["그늘이나 냉방 공간에서 자주 쉬어요"],
    dog: ["그늘 위주로 짧게 걷고 물을 자주 챙겨줘요"],
  },
  위험: {
    headline: "많이 더워요. 한낮 활동은 짧게, 그늘 위주로 해요",
    tips: [
      "물을 자주 나눠 마셔요",
      "헐렁하고 밝은 색 옷을 입어요",
    ],
    runner: ["이른 아침이나 해 진 뒤로 옮기면 좋아요"],
    worker: ["2시간마다 그늘에서 20분 이상 쉬어요"],
    dog: [
      "숨을 헐떡이면 그늘에서 쉬게 해줘요",
      "산책은 짧게, 물을 자주 줘요",
    ],
  },
  매우위험: {
    headline: "매우 더워요. 가능하면 실내가 좋아요",
    tips: [
      "꼭 나가야 하면 아주 짧게, 그늘로만 다녀요",
      "물을 자주 마셔요",
    ],
    runner: ["오늘 러닝은 실내나 저녁으로 미루면 좋아요"],
    worker: ["가장 더운 시간은 피하고 그늘에서 자주 쉬어요"],
    dog: [
      "한낮 산책은 미루고 배변만 짧게 다녀와요",
      "안고 이동해도 좋아요",
    ],
  },
};

/** 프로필별 팁. 반려견은 dog 전용 팁만, 사람은 공통 + 프로필 추가. */
export function feelsTips(band: FeelsBand, profile: Profile): string[] {
  const a = FEELS_ADVICE[band];
  if (profile === "dog") return a.dog ?? [];
  return [
    ...a.tips,
    ...(profile === "runner" ? a.runner ?? [] : []),
    ...(profile === "worker" ? a.worker ?? [] : []),
  ];
}
