/**
 * 강수형태(PTY) 표시 규칙. 기상청 코드 0 없음 / 1 비 / 2 비눈 / 3 눈 / 4 소나기.
 *
 * 판정 엔진은 예전부터 비를 등급에 반영했는데(비 오면 한 단계 올려요) 화면에는 그 근거가
 * 안 보였어요. 여기서 코드 → 사람이 읽는 말로 한 번만 바꿔서 홈·시간창이 같이 써요.
 */
export const RAIN_ICON = "https://static.toss.im/2d-icons/emoji/png/4x/u2614.png"; // ☔

/** 비/눈이 오는 중인지. 값이 없으면(서버 미배포) null — "안 온다"와 구분해요. */
export function isWet(pty: number | undefined): boolean | null {
  if (pty === undefined) return null;
  return pty > 0;
}

/** 화면에 쓸 이름. 0이거나 값이 없으면 null이에요. */
export function precipitationLabel(pty: number | undefined): string | null {
  switch (pty) {
    case 1:
      return "비";
    case 2:
      return "비/눈";
    case 3:
      return "눈";
    case 4:
      return "소나기";
    default:
      return null;
  }
}

/**
 * 지금부터 24시 사이에 비가 시작하는 첫 시각. 이미 오는 중이면 null이에요
 * (그건 "지금 와요"로 따로 보여주니까요).
 */
export function nextWetHour(
  hourly: { hour: number; pty?: number }[],
  currentHour: number
): { hour: number; label: string } | null {
  for (const slot of hourly) {
    if (slot.hour <= currentHour) continue;
    const label = precipitationLabel(slot.pty);
    if (label) return { hour: slot.hour, label };
  }
  return null;
}
