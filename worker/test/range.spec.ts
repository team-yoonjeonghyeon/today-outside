import { describe, it, expect } from "vitest";
import { buildDailyRange, dailyRangeAdvice } from "../src/engine";
import { pickDailyExtremes } from "../src/kma";
import type { FcstHour } from "../src/kma";

/* ────────── 일교차 (이슈 #51) ────────── */
describe("dailyRangeAdvice", () => {
	it("일교차 10℃ 이상이면 겉옷 안내", () => {
		expect(dailyRangeAdvice(3, 13)).toBe("일교차가 10℃예요. 얇은 겉옷을 챙겨요");
	});

	it("일교차 15℃ 이상이면 겹쳐 입기 안내", () => {
		expect(dailyRangeAdvice(0, 16)).toBe("일교차가 16℃로 커요. 겹쳐 입고 겉옷을 챙겨요");
	});

	it("일교차가 10℃ 미만이면 안내 없음", () => {
		expect(dailyRangeAdvice(5, 14.9)).toBeNull();
	});

	it("최저가 15℃를 넘는 더운 계절엔 일교차가 커도 안내 없음", () => {
		expect(dailyRangeAdvice(16, 32)).toBeNull();
	});

	it("최저가 딱 15℃면 안내해요", () => {
		expect(dailyRangeAdvice(15, 27)).toBe("일교차가 12℃예요. 얇은 겉옷을 챙겨요");
	});
});

describe("buildDailyRange", () => {
	it("TMN/TMX가 있으면 그 값을 쓰고 basis는 forecast", () => {
		expect(buildDailyRange({ tmn: 3, tmx: 15 }, [8, 9, 12])).toEqual({
			min: 3,
			max: 15,
			diff: 12,
			basis: "forecast",
			advice: "일교차가 12℃예요. 얇은 겉옷을 챙겨요",
		});
	});

	it("TMN/TMX가 없으면 시간별 기온에서 뽑고 basis는 hourly", () => {
		expect(buildDailyRange({}, [4, 6, 10, 14, 9])).toEqual({
			min: 4,
			max: 14,
			diff: 10,
			basis: "hourly",
			advice: "일교차가 10℃예요. 얇은 겉옷을 챙겨요",
		});
	});

	it("둘 중 하나만 있으면 시간별 기온으로 폴백", () => {
		expect(buildDailyRange({ tmn: 3 }, [5, 9])?.basis).toBe("hourly");
		expect(buildDailyRange({ tmx: 15 }, [5, 9])?.basis).toBe("hourly");
	});

	it("최고가 최저보다 낮은 이상한 값이면 시간별 기온으로 폴백", () => {
		const r = buildDailyRange({ tmn: 15, tmx: 3 }, [5, 9]);
		expect(r).toMatchObject({ min: 5, max: 9, basis: "hourly" });
	});

	it("최저와 최고가 같아도 (일교차 0) 정상", () => {
		expect(buildDailyRange({ tmn: 10, tmx: 10 }, [])).toMatchObject({ diff: 0, advice: null });
	});

	it("아무 데이터도 없으면 null", () => {
		expect(buildDailyRange({}, [])).toBeNull();
	});

	it("소수점은 1자리로 반올림", () => {
		expect(buildDailyRange({ tmn: 2.04, tmx: 14.26 }, [])).toMatchObject({ min: 2, max: 14.3, diff: 12.2 });
	});
});

describe("pickDailyExtremes", () => {
	const slot = (date: string, hour: number, extra: Partial<FcstHour> = {}): [string, FcstHour] => [
		`${date}-${String(hour).padStart(2, "0")}00`,
		{ date, hour, ...extra },
	];

	it("오늘 날짜의 TMN/TMX를 맵 전체에서 찾아요 (행 시각이 달라도)", () => {
		const m = new Map([slot("20261102", 6, { tmn: 3 }), slot("20261102", 15, { tmx: 15 })]);
		expect(pickDailyExtremes("20261102", m)).toEqual({ tmn: 3, tmx: 15 });
	});

	it("다른 날짜(내일) 값은 무시해요", () => {
		const m = new Map([slot("20261103", 6, { tmn: -2 }), slot("20261103", 15, { tmx: 8 })]);
		expect(pickDailyExtremes("20261102", m)).toEqual({});
	});

	it("앞에 넘긴 맵이 우선하고, 없는 값만 뒤 맵에서 채워요", () => {
		const latest = new Map([slot("20261102", 15, { tmx: 16 })]);
		const early = new Map([slot("20261102", 6, { tmn: 4 }), slot("20261102", 15, { tmx: 99 })]);
		expect(pickDailyExtremes("20261102", latest, early)).toEqual({ tmn: 4, tmx: 16 });
	});

	it("null·undefined 맵은 건너뛰어요", () => {
		const m = new Map([slot("20261102", 6, { tmn: 3 })]);
		expect(pickDailyExtremes("20261102", null, undefined, m)).toEqual({ tmn: 3 });
	});
});
