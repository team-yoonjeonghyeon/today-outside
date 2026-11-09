import { useEffect, useState, type CSSProperties } from "react";
import type { EffectKind } from "../lib/seasonalEffect";

/**
 * 홈 진입 때 잠깐 떨어지는 계절 효과 — 눈 오는 날엔 눈송이, 가을(9~11월) 맑은 날엔 낙엽.
 *
 * - 지금 실제로 눈(PTY 3)·비/눈(PTY 2)이 올 때만 눈을 내려요. 겨울이라고 맑은 날에 눈을 뿌리면
 *   날씨 앱으로서 거짓말이 돼요.
 * - 낙엽은 계절 연출이라 날짜(KST 월)로 정하고, 비·눈이 올 땐 안 띄워요.
 * - 한 번 몇 초 재생하고 사라져요. 탭 전환·뒤로가기로 홈이 다시 그려져도 같은 효과는 세션당 한 번만.
 * - 화면 위에 떠 있지만 pointer-events: none이라 터치를 막지 않고, 스크린 리더엔 숨겨요.
 * - 동작 줄이기(prefers-reduced-motion)를 켠 사용자에겐 안 보여요.
 *
 * 흰 눈은 라이트 배경에서 안 보여서 유니코드 대신 토스 2d 이모지 PNG를 써요(앱 다른 아이콘과 같은 스타일).
 */

const ICONS: Record<EffectKind, string[]> = {
  snow: ["https://static.toss.im/2d-icons/emoji/png/4x/u2744.png"], // ❄
  leaves: [
    "https://static.toss.im/2d-icons/emoji/png/4x/u1F342.png", // 🍂
    "https://static.toss.im/2d-icons/emoji/png/4x/u1F341.png", // 🍁
  ],
};

const PARTICLE_COUNT = 14;
// 가장 늦게 출발한 조각이 화면을 다 지나갈 때까지(지연 최대 + 낙하 최대) 기다렸다가 내려요.
const MAX_DELAY_S = 2.5;
const MAX_FALL_S = 6;
const LIFETIME_MS = (MAX_DELAY_S + MAX_FALL_S) * 1000 + 300;

// 세션(앱 실행) 동안 이미 보여준 효과. 모듈 변수라 새로고침 전까지 유지돼요.
const played = new Set<EffectKind>();

interface Particle {
  src: string;
  left: number; // vw
  size: number; // px
  delay: number; // s
  duration: number; // s
  sway: number; // px, 좌우로 흔들리는 폭
  spin: number; // deg
}

function makeParticles(kind: EffectKind): Particle[] {
  const icons = ICONS[kind];
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    src: icons[i % icons.length],
    left: Math.random() * 100,
    size: kind === "snow" ? 12 + Math.random() * 10 : 18 + Math.random() * 10,
    delay: Math.random() * MAX_DELAY_S,
    duration: (kind === "snow" ? 4.5 : 4) + Math.random() * 2,
    sway: (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 40),
    spin: kind === "snow" ? 90 + Math.random() * 90 : 180 + Math.random() * 360,
  }));
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const KEYFRAMES = `
@keyframes seasonal-fall {
  0%   { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 0; }
  10%  { opacity: 0.9; }
  50%  { transform: translate3d(var(--sway), 50vh, 0) rotate(calc(var(--spin) / 2)); }
  90%  { opacity: 0.9; }
  100% { transform: translate3d(0, 110vh, 0) rotate(var(--spin)); opacity: 0; }
}`;

export default function SeasonalEffect({ kind }: { kind: EffectKind | null }) {
  const [active, setActive] = useState<EffectKind | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!kind || played.has(kind) || prefersReducedMotion()) return;
    played.add(kind);
    setParticles(makeParticles(kind));
    setActive(kind);
    let finished = false;
    const timer = window.setTimeout(() => {
      finished = true;
      setActive(null);
    }, LIFETIME_MS);
    return () => {
      window.clearTimeout(timer);
      // 다 보여주기 전에 끊겼으면(StrictMode 이중 실행 포함) 다음에 다시 보여줄 수 있게 되돌려요.
      if (!finished) {
        played.delete(kind);
        setActive(null);
      }
    };
  }, [kind]);

  if (!active) return null;

  return (
    <div
      aria-hidden
      style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 1000 }}
    >
      <style>{KEYFRAMES}</style>
      {particles.map((p, i) => (
        <img
          key={i}
          src={p.src}
          alt=""
          style={
            {
              position: "absolute",
              top: 0,
              left: `${p.left}vw`,
              width: p.size,
              height: p.size,
              opacity: 0,
              animation: `seasonal-fall ${p.duration}s ease-in ${p.delay}s 1 both`,
              "--sway": `${p.sway}px`,
              "--spin": `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
