import type { BestWindow } from "./judgeApi";

/**
 * 시간창이 일몰과 어떻게 만나는지 짧게 알려주는 문구. 서버가 일몰 정보를 안 내려주면 null —
 * 모르는 걸 단정하지 않아요.
 *
 * 시간창을 고르는 건 일몰과 무관해요(여름엔 좋은 시간이 해진 뒤 저녁에 잡히는 게 정상이에요).
 * 여기서는 "그 시간이 어두운지"만 덧붙여 말해요.
 */
export function sunsetNote(
  bestWindow: BestWindow | null,
  sunset: string | undefined,
): { short: string; long: string } | null {
  if (!bestWindow || bestWindow.afterSunset === undefined) return null;

  if (bestWindow.afterSunset) {
    return {
      short: "해가 진 뒤예요",
      long: sunset ? `일몰 ${sunset} · 해가 진 뒤 시간대예요` : "해가 진 뒤 시간대예요",
    };
  }

  // 해지기 전에 시작하는데 창이 일몰을 넘겨 이어질 때만 알려줘요. 일몰 전에 끝나면 할 말이 없어요.
  const crossesSunset = bestWindow.daylightEnd !== undefined && bestWindow.daylightEnd < bestWindow.end;
  if (!crossesSunset) return null;
  return {
    short: sunset ? `일몰 ${sunset} 전까지 밝아요` : "해지기 전까지 밝아요",
    long: sunset ? `일몰 ${sunset} · 그 전까지가 밝아요` : "해지기 전까지가 밝아요",
  };
}

/** 시간창이 없는 날에도 일몰 시각 자체는 알려줄 수 있어요. */
export function sunsetOnly(sunset: string | undefined): string | null {
  return sunset ? `일몰 ${sunset}` : null;
}
