/**
 * 체감온도로 가르는 "오늘 날씨 성격" — 더운 날용 문구를 가을·겨울에 그대로 쓰지 않게 해요.
 *
 * 10℃ 아래부터 추위용 문구를 써요. 서버(worker engine)는 판정 문장을 5℃ 미만에서 추위용으로
 * 바꾸지만, 체감 5~10℃에 "시원해요"·"활동하기 좋은 온도예요"가 뜨는 게 어색해서 앱은 더 일찍
 * 바꿔요. 25℃는 체감온도 조언의 "쾌적" 상한(feelsLikeAdvice)이에요. 이 사이(10~25℃)는
 * 가을·초봄이라 더위도 추위도 아니에요. 경계는 초안이에요(이슈 #48).
 */
export type WeatherMode = "cold" | "mild" | "warm";

export const COLD_BELOW = 10;
export const WARM_FROM = 25;

export function weatherMode(feelsLike: number): WeatherMode {
  if (feelsLike < COLD_BELOW) return "cold";
  if (feelsLike < WARM_FROM) return "mild";
  return "warm";
}
