import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { hazardGate, judge, sHeat, findBestWindow } from "../src/engine";
import type { Computed } from "../src/engine";
import type { Verdict } from "../src/types";
import { extractAreaToken, heatLevelForArea, nationwideHeatLevel } from "../src/kma";
import { isValidGrid } from "../src/geo";
import { pickRegion } from "../src/kakao";

const ctx = () => createExecutionContext();

function req(path: string) {
	return new Request(`https://example.com${path}`);
}

/* ────────── 라우팅 · 검증 (네트워크 안 탐) ────────── */
describe("routing & validation", () => {
	it("/health → ok", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/health"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("없는 경로 → 404 NOT_FOUND", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/nope"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(404);
		expect(((await res.json()) as { error: string }).error).toBe("NOT_FOUND");
	});

	it("nx/ny 누락 → 400 (503 아님) — 검증 버그 회귀 방지", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/judge?profile=dog"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("INVALID_PARAM");
	});

	it("잘못된 profile → 400", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/judge?nx=57&ny=127&profile=cat"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(400);
	});

	it("nx만 있고 ny 누락 → 400", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/judge?nx=57&profile=dog"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(400);
	});

	it("격자 범위 밖 → 400 (503 아님) — KMA로 새지 않아요", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/judge?nx=9999&ny=9999&profile=dog"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("INVALID_PARAM");
	});

	it("음수 격자 → 400", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/judge?nx=-5&ny=-5&profile=dog"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(400);
	});

	it("/region: lat/lon 누락 → 400", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/region"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(400);
	});

	it("/region: 카카오 키 없으면 → 502 (프론트 폴백 신호)", async () => {
		const c = ctx();
		const res = await worker.fetch(req("/region?lat=37.5443&lon=126.9515"), env, c);
		await waitOnExecutionContext(c);
		expect(res.status).toBe(502);
		expect(((await res.json()) as { error: string }).error).toBe("REGION_UNAVAILABLE");
	});
});

/* ────────── 카카오 역지오코딩 파싱 ────────── */
describe("pickRegion", () => {
	it("행정동(H) 우선", () => {
		const docs = [
			{ region_type: "B", region_1depth_name: "서울특별시", region_2depth_name: "마포구", region_3depth_name: "공덕동" },
			{ region_type: "H", region_1depth_name: "서울특별시", region_2depth_name: "마포구", region_3depth_name: "공덕제1동" },
		];
		expect(pickRegion(docs)).toEqual({ sido: "서울특별시", sigungu: "마포구", dong: "공덕제1동" });
	});

	it("H 없으면 첫 항목", () => {
		const docs = [{ region_type: "B", region_1depth_name: "부산광역시", region_2depth_name: "해운대구", region_3depth_name: "우동" }];
		expect(pickRegion(docs)?.sigungu).toBe("해운대구");
	});

	it("시군구 비면 시도로 대체 (세종 등)", () => {
		const docs = [{ region_type: "H", region_1depth_name: "세종특별자치시", region_2depth_name: "", region_3depth_name: "" }];
		expect(pickRegion(docs)).toEqual({ sido: "세종특별자치시", sigungu: "세종특별자치시", dong: "" });
	});

	it("빈 배열 → null", () => {
		expect(pickRegion([])).toBeNull();
	});
});

/* ────────── 격자 범위 검증 ────────── */
describe("isValidGrid", () => {
	it("유효 격자", () => {
		expect(isValidGrid(57, 127)).toBe(true);
		expect(isValidGrid(1, 1)).toBe(true);
		expect(isValidGrid(149, 253)).toBe(true);
	});

	it("범위 밖 → false", () => {
		expect(isValidGrid(0, 127)).toBe(false);
		expect(isValidGrid(150, 127)).toBe(false);
		expect(isValidGrid(57, 254)).toBe(false);
		expect(isValidGrid(-5, -5)).toBe(false);
	});

	it("비정수·NaN → false", () => {
		expect(isValidGrid(57.5, 127)).toBe(false);
		expect(isValidGrid(NaN, 127)).toBe(false);
	});
});

/* ────────── 낙뢰 · 호우 하드게이트 ────────── */
describe("hazardGate", () => {
	const base: Verdict = {
		level: 1,
		score: 10,
		headline: "지금 산책하기 좋아요",
		reason: "무리 없어요",
		gate: null,
	};

	it("낙뢰 → level 5, gate LIGHTNING, 사유 대체", () => {
		const v = hazardGate(base, "dog", 0, true);
		expect(v.level).toBe(5);
		expect(v.gate).toBe("LIGHTNING");
		expect(v.reason).toContain("천둥");
	});

	it("시간당 15mm↑ → level 5, gate HEAVY_RAIN", () => {
		const v = hazardGate(base, "runner", 18, false);
		expect(v.level).toBe(5);
		expect(v.gate).toBe("HEAVY_RAIN");
		expect(v.reason).toContain("18mm");
	});

	it("14mm는 게이트 미발동 (경계값)", () => {
		const v = hazardGate(base, "runner", 14, false);
		expect(v.level).toBe(1);
		expect(v.gate).toBeNull();
	});

	it("낙뢰가 강수보다 우선", () => {
		const v = hazardGate(base, "worker", 30, true);
		expect(v.gate).toBe("LIGHTNING");
	});

	it("헤드라인은 프로필별 level5 문구로 교체", () => {
		expect(hazardGate(base, "dog", 20, false).headline).toBe("배변만 짧게, 안고 이동해요");
		expect(hazardGate(base, "worker", 20, false).headline).toBe("가장 더운 시간은 피해요");
	});
});

/* ────────── 기존 로직 회귀 ────────── */
describe("engine 회귀", () => {
	it("sHeat 경계값", () => {
		expect(sHeat(25)).toBe(0);
		expect(sHeat(31)).toBe(40);
		expect(sHeat(33)).toBe(60);
		expect(sHeat(38)).toBe(100);
	});

	it("findBestWindow: 현재 이후 level<=2 연속 구간", () => {
		const hourly = [
			{ hour: 12, level: 4 as const },
			{ hour: 13, level: 4 as const },
			{ hour: 14, level: 2 as const },
			{ hour: 15, level: 1 as const },
			{ hour: 16, level: 1 as const },
		];
		const w = findBestWindow(hourly, 12);
		expect(w?.start).toBe(14);
		expect(w?.end).toBe(16);
	});

	it("judge: 무더위 dog는 노면 가중으로 등급 상승", () => {
		const c: Computed = {
			feelsLike: 33,
			roadTemp: 51,
			roadBySurface: { asphalt: 51, pavement: 46, grass: 38, soil: 37 },
			srNorm: 0.8,
			uvi: 8,
		};
		const v = judge("dog", c, 32, 0);
		expect(v.level).toBeGreaterThanOrEqual(4);
	});
});

/* ────────── 폭염특보 지역 파싱 (본청 통보문 t6) ────────── */
describe("heat warning area parsing", () => {
	// 실제 108 통보문 t6 형식
	const t6 =
		"o 폭염중대경보 : 경상남도(양산, 의령, 창녕)\n" +
		"o 폭염경보 : 경기도(고양, 남양주, 오산), 서울(서울동남권, 서울동북권), 부산, 대구\n" +
		"o 폭염주의보 : 경기도(광명, 과천, 수원), 인천, 서해5도\n" +
		"o 열대야주의보 : 서울, 인천";

	it("extractAreaToken: 시/군/구 접미사 제거", () => {
		expect(extractAreaToken("고양시 일산동구")).toBe("고양");
		expect(extractAreaToken("서울 강남구")).toBe("서울");
		expect(extractAreaToken("부산 해운대구")).toBe("부산");
		expect(extractAreaToken("양산시")).toBe("양산");
	});

	it("extractAreaToken: 도-접두는 뒤 시/군을 씀", () => {
		expect(extractAreaToken("강원도 평창")).toBe("평창");
		expect(extractAreaToken("경기도 고양시")).toBe("고양");
		expect(extractAreaToken("제주특별자치도 제주시")).toBe("제주");
	});

	it("heatLevelForArea: 경보 구역", () => {
		expect(heatLevelForArea(t6, "고양")).toBe("경보");
		expect(heatLevelForArea(t6, "부산")).toBe("경보");
	});

	it("heatLevelForArea: 중대경보 우선", () => {
		expect(heatLevelForArea(t6, "양산")).toBe("중대경보");
	});

	it("heatLevelForArea: 주의보 구역", () => {
		expect(heatLevelForArea(t6, "수원")).toBe("주의보");
		expect(heatLevelForArea(t6, "인천")).toBe("주의보");
	});

	it("heatLevelForArea: 특보 없는 구역 → null", () => {
		expect(heatLevelForArea(t6, "제주")).toBeNull();
		expect(heatLevelForArea(t6, "")).toBeNull();
	});

	it("nationwideHeatLevel: 전국 최고 등급", () => {
		expect(nationwideHeatLevel(t6)).toBe("중대경보");
		expect(nationwideHeatLevel("o 폭염주의보 : 인천")).toBe("주의보");
		expect(nationwideHeatLevel("o 강풍주의보 : 인천")).toBeNull();
	});
});
