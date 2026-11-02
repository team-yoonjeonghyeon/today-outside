import { describe, it, expect } from "vitest";
import { findBestWindow, formatHourMinute } from "../src/engine";
import type { Level } from "../src/types";

/** [시각, 등급] 목록에서 hourly 배열을 만들어요 */
const hours = (rows: [number, Level][]) => rows.map(([hour, level]) => ({ hour, level }));

/* ────────── 최적 시간창 일몰 정보 (이슈 #52) ────────── */
describe("findBestWindow sunset info", () => {
	const fall = hours([
		[13, 4], [14, 4], [15, 2], [16, 2], [17, 2], [18, 1], [19, 1], [20, 1],
	]);

	it("일몰 시각을 안 넘기면 결과가 기존과 같아요 (추가 필드 없음)", () => {
		expect(findBestWindow(fall, 12)).toEqual({ start: 15, end: 20, label: "오후 3시부터 좋아요" });
	});

	it("해지기 전에 시작하면 afterSunset=false, 해가 떠 있는 마지막 칸을 알려줘요", () => {
		// 일몰 17:42 → 17시 칸(17~18시)까지가 해가 떠 있는 칸
		const w = findBestWindow(fall, 12, 17.7);
		expect(w).toMatchObject({ start: 15, end: 20, afterSunset: false, daylightEnd: 17 });
	});

	it("시간창이 일몰 전에 끝나면 daylightEnd는 창의 끝이에요", () => {
		const earlyEnd = hours([[13, 4], [14, 2], [15, 1], [16, 1], [17, 4], [18, 4]]);
		const w = findBestWindow(earlyEnd, 12, 17.7);
		expect(w).toMatchObject({ start: 14, end: 16, afterSunset: false, daylightEnd: 16 });
	});

	it("해진 뒤에 시작하면 afterSunset=true이고 daylightEnd는 없어요", () => {
		const nightOnly = hours([[13, 4], [16, 4], [17, 4], [18, 4], [19, 2], [20, 1], [21, 1]]);
		const w = findBestWindow(nightOnly, 12, 17.7);
		expect(w).toMatchObject({ start: 19, end: 21, afterSunset: true });
		expect(w).not.toHaveProperty("daylightEnd");
	});

	it("일몰이 시간창 시작 칸의 중간이면 그 칸은 아직 해가 떠 있는 칸이에요", () => {
		const w = findBestWindow(hours([[16, 4], [17, 2], [18, 1], [19, 1]]), 15, 17.7);
		expect(w).toMatchObject({ start: 17, afterSunset: false, daylightEnd: 17 });
	});

	it("여름처럼 좋은 시간이 해진 뒤 저녁뿐이어도 시간창 선택은 그대로예요", () => {
		const summer = hours([[12, 5], [15, 4], [18, 3], [20, 2], [21, 1], [22, 1]]);
		const plain = findBestWindow(summer, 11);
		const withSun = findBestWindow(summer, 11, 19.7);
		expect(withSun).toMatchObject({ start: plain?.start, end: plain?.end, label: plain?.label });
		expect(withSun?.afterSunset).toBe(true);
	});

	it("좋은 시간이 없으면 일몰을 넘겨도 null이에요", () => {
		expect(findBestWindow(hours([[13, 4], [14, 5]]), 12, 17.7)).toBeNull();
	});
});

describe("formatHourMinute", () => {
	it("소수 시각을 HH:MM으로", () => {
		expect(formatHourMinute(17.75)).toBe("17:45");
		expect(formatHourMinute(19.5)).toBe("19:30");
		expect(formatHourMinute(7)).toBe("07:00");
	});

	it("분이 60으로 올림되면 시를 올려요", () => {
		expect(formatHourMinute(17.999)).toBe("18:00");
	});
});
