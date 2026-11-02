/**
 * 체감온도로 가르는 "오늘 날씨 성격" — 더운 날용 문구를 가을·겨울에 그대로 쓰지 않게 해요.
 *
 * 5℃는 서버(worker engine)가 판정 문장을 추위용으로 바꾸는 기준이고, 25℃는 체감온도 조언의
 * "쾌적" 상한(feelsLikeAdvice)이에요. 이 사이(5~25℃)는 가을·초봄이라 더위도 추위도 아니에요.
 * 경계는 초안이에요(이슈 #48).
 */
export type WeatherMode = "cold" | "mild" | "warm";

export const COLD_BELOW = 5;
export const WARM_FROM = 25;

export function weatherMode(feelsLike: number): WeatherMode {
  if (feelsLike < COLD_BELOW) return "cold";
  if (feelsLike < WARM_FROM) return "mild";
  return "warm";
}
