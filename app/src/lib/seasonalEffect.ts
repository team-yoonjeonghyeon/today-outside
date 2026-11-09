/**
 * 홈 계절 효과(components/SeasonalEffect)를 무엇으로 띄울지 정해요.
 *
 * - 지금 실제로 눈(PTY 3)·비/눈(PTY 2)이 올 때만 눈. 맑은 겨울날에 눈을 뿌리면 날씨 앱으로서 거짓말이 돼요.
 * - 낙엽은 계절 연출이라 날짜(KST 9~11월)로 정하고, 비·눈이 올 땐 안 띄워요.
 */
export type EffectKind = "snow" | "leaves";

/** "…T14:30:00+09:00"의 월. 기기 타임존에 안 흔들리게 문자열에서 바로 읽어요. */
function kstMonth(iso: string): number {
  const match = iso.match(/^\d{4}-(\d{2})/);
  return match ? Number(match[1]) : 0;
}

export function seasonalEffectKind(pty: number | undefined, generatedAt: string): EffectKind | null {
  if (pty === 2 || pty === 3) return "snow";
  if (pty !== undefined && pty !== 0) return null; // 비·소나기
  const month = kstMonth(generatedAt);
  return month >= 9 && month <= 11 ? "leaves" : null;
}
