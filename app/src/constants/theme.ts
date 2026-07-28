import type { CSSProperties } from "react";
import { adaptive } from "@toss/tds-colors";
import { MINT } from "./judge";

/**
 * 화면 전반의 주요 CTA 버튼(<Button color="primary">)에 공통으로 얹는 스타일.
 * 디자인프레임 .btn 참고 — 시그니처 버튼 색(민트 400 + 잉크 텍스트)은
 * granite.config.ts의 brand.primaryColor(민트 700, 판정 '좋음' 색)와 달라서
 * TDS Button의 CSS 변수 오버라이드로 따로 입혀요.
 */
export const PRIMARY_BUTTON_STYLE: CSSProperties = {
  ["--button-background-color" as string]: MINT[400],
  ["--button-color" as string]: MINT[900],
} as CSSProperties;

/**
 * 보조 CTA 버튼(취소·건너뛰기류, "지역 직접 고르기" 같은). 디자인프레임 .btn.ghost 참고 —
 * 배경 없이 텍스트만 보이는 스타일이라, Button의 variant="weak"(민트 틴트 배경)를 쓰면 안 돼요.
 */
export const GHOST_BUTTON_STYLE: CSSProperties = {
  ["--button-background-color" as string]: "transparent",
  ["--button-color" as string]: adaptive.grey700,
} as CSSProperties;

/**
 * "추정" 배지. 디자인프레임 .badge 참고 — 노면온도처럼 실측이 아닌 추정값에는
 * 항상 이 배지를 붙여요 (CLAUDE.md 제약: 노면온도에는 항상 '추정' 배지 표시).
 */
export const ESTIMATED_BADGE_STYLE: CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 6px",
  borderRadius: 5,
  background: adaptive.grey200,
  color: adaptive.grey700,
  marginLeft: 6,
  verticalAlign: 2,
};
