import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { EffectKind } from "../lib/seasonalEffect";

/**
 * 홈 계절 효과 — 눈 오는 날엔 눈송이, 가을(9~11월) 맑은 날엔 낙엽.
 *
 * - 지금 실제로 눈(PTY 3)·비/눈(PTY 2)이 올 때만 눈을 내려요. 겨울이라고 맑은 날에 눈을 뿌리면
 *   날씨 앱으로서 거짓말이 돼요.
 * - 낙엽은 계절 연출이라 날짜(KST 월)로 정하고, 비·눈이 올 땐 안 띄워요.
 * - 낙엽은 홈에 있는 동안 천천히 계속 내려요 — 한 장이 바닥에 닿거나 치워지면 위에서 새 낙엽이 떨어져요.
 * - 눈은 진입 때 한 번 몇 초만 내려요. 탭 전환·뒤로가기로 홈이 다시 그려져도 세션당 한 번만.
 * - 낙엽은 집어서 치울 수 있어요 — 톡 치면 옆으로 날아가고, 끌었다 놓으면 던진 방향으로 날아가요.
 *   낙엽 조각만 터치를 받고 나머지 영역은 pointer-events: none이라 화면 조작을 막지 않아요.
 *   눈송이는 터치를 받지 않아요. 스크린 리더엔 효과 전체를 숨겨요.
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

// 눈송이는 작고 색이 연해서 많이, 크게 내려야 "눈 오는 날"처럼 보여요.
// 낙엽은 계속 내리니까 한 화면에 너무 많지 않게 — 천천히 떨어져서 12장이면 충분히 차요.
const PARTICLE_COUNT: Record<EffectKind, number> = { snow: 22, leaves: 12 };
// 작은 낙엽도 손가락으로 집기 쉽게 이미지 둘레에 투명한 터치 여백을 둬요.
const HIT_PAD = 10;
const TOSS_MS = 450;

// 세션(앱 실행) 동안 이미 보여준 한 번짜리 효과(눈). 모듈 변수라 새로고침 전까지 유지돼요.
const played = new Set<EffectKind>();

// 낙엽처럼 계속 이어지는 효과인지. 계속 효과는 세션 제한 없이 홈에 있는 동안 돌아요.
const isContinuous = (kind: EffectKind) => kind === "leaves";

let nextParticleId = 0;

interface Particle {
  id: number;
  anim: string; // keyframes 이름
  src: string;
  left: number; // vw
  size: number; // px
  delay: number; // s
  duration: number; // s
  sway: number; // px, 좌우로 흔들리는 폭
  spin: number; // deg
}

/**
 * 조각 하나. `first`는 처음 깔리는 조각 — 낙엽은 시작 시점을 넓게 흩어서 한꺼번에 쏟아지지 않고
 * 처음부터 띄엄띄엄 내리게 해요. 다시 생기는 낙엽은 곧바로(0~2초 안에) 떨어지기 시작해요.
 */
function makeParticle(kind: EffectKind, first: boolean): Particle {
  const icons = ICONS[kind];
  const base = {
    id: nextParticleId++,
    src: icons[Math.floor(Math.random() * icons.length)],
    left: Math.random() * 100,
  };
  if (kind === "snow") {
    return {
      ...base,
      anim: "seasonal-fall",
      size: 18 + Math.random() * 12,
      delay: Math.random() * 2.5,
      duration: 4.5 + Math.random() * 2,
      sway: (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 40),
      spin: 90 + Math.random() * 90,
    };
  }
  return {
    ...base,
    anim: "seasonal-drift",
    size: 18 + Math.random() * 10,
    delay: first ? Math.random() * 9 : Math.random() * 2,
    duration: 9 + Math.random() * 4,
    sway: (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 40),
    spin: (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 240),
  };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 떨어지는 중인 요소의 지금 회전각 — 집었을 때 각도가 튀지 않게 이어받아요. */
function currentRotation(el: HTMLElement): number {
  try {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  } catch {
    return 0;
  }
}

const KEYFRAMES = `
@keyframes seasonal-fall {
  0%   { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 0; }
  10%  { opacity: 0.9; }
  50%  { transform: translate3d(var(--sway), 50vh, 0) rotate(calc(var(--spin) / 2)); }
  90%  { opacity: 0.9; }
  100% { transform: translate3d(0, 110vh, 0) rotate(var(--spin)); opacity: 0; }
}
@keyframes seasonal-drift {
  0%   { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 0; }
  8%   { opacity: 0.9; }
  25%  { transform: translate3d(var(--sway), 18vh, 0) rotate(calc(var(--spin) * 0.25)); }
  50%  { transform: translate3d(calc(var(--sway) * -0.6), 46vh, 0) rotate(calc(var(--spin) * 0.5)); }
  75%  { transform: translate3d(calc(var(--sway) * 0.8), 76vh, 0) rotate(calc(var(--spin) * 0.75)); }
  92%  { opacity: 0.9; }
  100% { transform: translate3d(0, 110vh, 0) rotate(var(--spin)); opacity: 0; }
}`;

type PieceState =
  | { mode: "fall" }
  | { mode: "held"; x: number; y: number; rot: number }
  | { mode: "toss"; x: number; y: number; rot: number };

interface DragInfo {
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number; // px/ms
  vy: number;
}

function Piece({ p, grabbable, onDone }: { p: Particle; grabbable: boolean; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<DragInfo | null>(null);
  const [state, setState] = useState<PieceState>({ mode: "fall" });
  const box = p.size + HIT_PAD * 2;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!grabbable || !el || state.mode !== "fall") return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 캡처가 안 되는 환경이어도 끌기 자체는 동작해요(손가락이 낙엽 밖으로 빠르게 나가면 놓친 것처럼 보일 뿐).
    }
    drag.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: e.timeStamp,
      vx: 0,
      vy: 0,
    };
    setState({ mode: "held", x: rect.left, y: rect.top, rot: currentRotation(el) });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || state.mode !== "held") return;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    // 최근 움직임에 가중치를 둔 속도 — 놓는 순간의 손놀림 방향으로 던져요.
    d.vx = d.vx * 0.5 + ((e.clientX - d.lastX) / dt) * 0.5;
    d.vy = d.vy * 0.5 + ((e.clientY - d.lastY) / dt) * 0.5;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setState({ mode: "held", x: e.clientX - d.offsetX, y: e.clientY - d.offsetY, rot: state.rot });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || state.mode !== "held") return;
    drag.current = null;
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    let { vx, vy } = d;
    if (moved < 6) {
      // 톡 친 거면 옆으로 살짝 쓸어내듯 날려요.
      vx = (Math.random() < 0.5 ? -1 : 1) * 1.4;
      vy = -0.6;
    } else {
      const speed = Math.hypot(vx, vy);
      if (speed < 0.8) {
        // 천천히 놓아도 화면 밖까지는 날아가게 최소 속도를 맞춰요.
        const k = speed === 0 ? 0 : 0.8 / speed;
        vx = speed === 0 ? 0 : vx * k;
        vy = speed === 0 ? 0.8 : vy * k;
      }
    }
    const fling = 500; // ms 동안 그 속도로 갔을 때의 위치까지
    setState({
      mode: "toss",
      x: state.x + vx * fling,
      y: state.y + vy * fling,
      rot: state.rot + vx * 120,
    });
  };

  const base: CSSProperties = {
    position: "absolute",
    width: box,
    height: box,
    padding: HIT_PAD,
    boxSizing: "border-box",
    pointerEvents: grabbable && state.mode !== "toss" ? "auto" : "none",
    touchAction: "none",
    cursor: grabbable ? (state.mode === "held" ? "grabbing" : "grab") : undefined,
  };

  const style: CSSProperties =
    state.mode === "fall"
      ? ({
          ...base,
          top: 0,
          left: `calc(${p.left}vw - ${HIT_PAD}px)`,
          opacity: 0,
          animation: `${p.anim} ${p.duration}s ${p.anim === "seasonal-drift" ? "ease-in-out" : "ease-in"} ${p.delay}s 1 both`,
          "--sway": `${p.sway}px`,
          "--spin": `${p.spin}deg`,
        } as CSSProperties)
      : {
          ...base,
          top: 0,
          left: 0,
          opacity: state.mode === "toss" ? 0 : 1,
          transform: `translate3d(${state.x}px, ${state.y}px, 0) rotate(${state.rot}deg) scale(${
            state.mode === "held" ? 1.25 : 0.7
          })`,
          transition:
            state.mode === "toss"
              ? `transform ${TOSS_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${TOSS_MS}ms ease-out`
              : "none",
        };

  return (
    <div
      ref={ref}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onAnimationEnd={() => state.mode === "fall" && onDone()}
      onTransitionEnd={(e) => state.mode === "toss" && e.propertyName === "opacity" && onDone()}
    >
      <img src={p.src} alt="" draggable={false} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}

export default function SeasonalEffect({ kind }: { kind: EffectKind | null }) {
  const [active, setActive] = useState<EffectKind | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const doneCount = useRef(0);
  const finished = useRef(false);

  useEffect(() => {
    if (!kind || prefersReducedMotion()) return;
    const continuous = isContinuous(kind);
    if (!continuous) {
      if (played.has(kind)) return;
      played.add(kind);
    }
    doneCount.current = 0;
    finished.current = false;
    setParticles(Array.from({ length: PARTICLE_COUNT[kind] }, () => makeParticle(kind, true)));
    setActive(kind);
    return () => {
      // 한 번짜리 효과를 다 보여주기 전에 끊겼으면(StrictMode 이중 실행 포함) 다음에 다시 보여줄 수 있게 되돌려요.
      if (!continuous && !finished.current) played.delete(kind);
      setActive(null);
    };
  }, [kind]);

  // 조각이 바닥까지 떨어졌거나 치워졌을 때.
  // - 낙엽(계속 효과): 그 자리에 새 낙엽을 하나 만들어 위에서 다시 떨어뜨려요.
  // - 눈(한 번짜리): 하나씩 세고, 다 끝나면 효과를 내려요.
  const handleDone = (id: number) => {
    if (active && isContinuous(active)) {
      const kindNow = active;
      setParticles((ps) => ps.map((p) => (p.id === id ? makeParticle(kindNow, false) : p)));
      return;
    }
    doneCount.current += 1;
    if (doneCount.current >= particles.length) {
      finished.current = true;
      setActive(null);
    }
  };

  if (!active) return null;

  return (
    <div
      aria-hidden
      style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 1000 }}
    >
      <style>{KEYFRAMES}</style>
      {particles.map((p) => (
        <Piece key={p.id} p={p} grabbable={active === "leaves"} onDone={() => handleDone(p.id)} />
      ))}
    </div>
  );
}
