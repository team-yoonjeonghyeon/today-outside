import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { hazardGate, judge, sHeat, findBestWindow } from "../src/engine";
import type { Computed } from "../src/engine";
import type { Verdict } from "../src/types";

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
