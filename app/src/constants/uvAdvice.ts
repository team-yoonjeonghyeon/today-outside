/**
 * 자외선 지표 상세(F5)용 조언 문구.
 * 기상청 자외선지수 단계별 대응요령 기반, 규칙 기반(LLM 미사용).
 * metrics.uviLabel("낮음"~"위험")로 조회. 사람(러너·야외작업)은 공통 tips + 프로필별 추가,
 * 반려견은 사람 팁(차단제·모자) 대신 dog 전용 팁(그늘 위주 등)을 써요.
 * 앱인토스 UX 라이팅 적용(해요체·능동형·긍정형). 의료·진단 표현 없음.
 */
import type { Profile } from "./judge";

export type UvLabel = "낮음" | "보통" | "높음" | "매우높음" | "위험";

interface UvAdvice {
  headline: string; // 한 줄 안내·경고
  tips: string[]; // 사람 공통
  runner?: string[]; // 러닝·운동 추가
  worker?: string[]; // 야외 작업 추가
  dog?: string[]; // 반려견 전용 (사람 팁 대신). 강아지에게 자외선은 부차적이라 대체로 가벼움
}

export const UV_ADVICE: Record<UvLabel, UvAdvice> = {
  낮음: {
    headline: "자외선 걱정 없이 활동해도 좋아요",
    tips: ["민감한 피부라면 가볍게 차단제만 발라요"],
  },
  보통: {
    headline: "적당한 편이에요. 한낮엔 그늘을 챙겨요",
    tips: [
      "외출 20분 전 자외선차단제를 발라요",
      "챙 있는 모자나 선글라스를 챙겨요",
    ],
    dog: ["그늘 위주로 걸어요"],
  },
  높음: {
    headline: "자외선이 꽤 강해요. 그늘을 챙겨요",
    tips: [
      "자외선차단제를 바르고 2시간마다 다시 발라요",
      "챙 넓은 모자와 선글라스를 써요",
    ],
    runner: ["긴 러닝이면 땀에 강한 방수 차단제를 골라요"],
    worker: ["긴팔로 팔을 가리면 좋아요"],
    dog: ["그늘 위주로 걷고 한낮은 피해요"],
  },
  매우높음: {
    headline: "자외선이 매우 강해요. 오전 10시~오후 3시는 직사광을 피해요",
    tips: [
      "차단제를 2시간마다 꼼꼼히 발라요. 땀이 나면 더 자주요",
      "챙 넓은 모자·선글라스·긴팔로 가려요",
    ],
    runner: ["그늘 코스나 이른 아침·해 진 뒤로 옮기면 좋아요"],
    worker: ["그늘에서 쉴 때 차단제를 다시 발라요"],
    dog: [
      "직사광 아래 오래 걷지 않아요",
      "코·귀처럼 털 적은 곳은 햇볕에 약해요",
    ],
  },
  위험: {
    headline: "자외선이 위험 단계예요. 한낮엔 짧게, 가능하면 실내가 좋아요",
    tips: [
      "꼭 나가야 하면 모자·선글라스·긴팔로 최대한 가려요",
      "차단제를 자주 덧발라요",
    ],
    runner: ["한낮 러닝은 미루고 해 진 뒤로 옮기면 좋아요"],
    worker: ["직사광 아래 장시간 작업은 피하고 그늘을 자주 써요"],
    dog: ["한낮 산책은 짧게, 해 진 뒤가 좋아요"],
  },
};

/** 프로필별 팁. 반려견은 dog 전용 팁만, 사람은 공통 + 프로필 추가. */
export function uvTips(label: UvLabel, profile: Profile): string[] {
  const a = UV_ADVICE[label];
  if (profile === "dog") return a.dog ?? [];
  return [
    ...a.tips,
    ...(profile === "runner" ? a.runner ?? [] : []),
    ...(profile === "worker" ? a.worker ?? [] : []),
  ];
}
