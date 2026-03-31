import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface EcosystemViewerProps {
  ecoPoints: number;
  className?: string;
  darkWrapper?: boolean;
}

function getState(ecoPoints: number): number {
  if (ecoPoints >= 10000) return 6;
  if (ecoPoints >= 2500) return 5;
  if (ecoPoints >= 1200) return 4;
  if (ecoPoints >= 600) return 3;
  if (ecoPoints >= 200) return 2;
  return 1;
}

const ZOOM_CONFIG: Record<number, { scale: number; translateY: string }> = {
  1: { scale: 1.8, translateY: "15%" },
  2: { scale: 1.5, translateY: "10%" },
  3: { scale: 1.2, translateY: "5%" },
  4: { scale: 1.1, translateY: "2%" },
  5: { scale: 1, translateY: "0%" },
  6: { scale: 1, translateY: "0%" },
};

/* -- SVG sub-components -- */

function Sky({ state }: { state: number }) {
  const skies: Record<number, [string, string, string]> = {
    1: ["#C4956A", "#D4A574", "#B8C4CE"],
    2: ["#D4A574", "#B8D4E3", "#E8D5A0"],
    3: ["#87CEEB", "#B0E0F0", "#87CEEB"],
    4: ["#7EC8E3", "#A0D8EF", "#7EC8E3"],
    5: ["#6BBFE0", "#8ED0E8", "#6BBFE0"],
    6: ["#1B2A4A", "#2D4A6A", "#1B3A5A"],
  };
  const [top, mid, bot] = skies[state];
  return (
    <>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={top} />
          <stop offset="50%" stopColor={mid} />
          <stop offset="100%" stopColor={bot} />
        </linearGradient>
      </defs>
      <rect width="800" height="450" fill="url(#sky)" />
    </>
  );
}

function Sun({ state }: { state: number }) {
  if (state <= 1) return null;
  const opacity = state === 2 ? 0.5 : 0.85;
  return (
    <g>
      <circle cx="650" cy="80" r="32" fill="#F4A261" opacity={opacity} />
      <circle cx="650" cy="80" r="48" fill="#F4A261" opacity={0.12}>
        <animate
          attributeName="r"
          values="48;58;48"
          dur="4s"
          repeatCount="indefinite"
        />
      </circle>
    </g>
  );
}

function Aurora() {
  return (
    <g className="animate-aurora">
      <ellipse
        cx="400"
        cy="60"
        rx="350"
        ry="40"
        fill="url(#auroraGrad)"
        opacity="0.15"
      />
      <defs>
        <linearGradient id="auroraGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#52B788" />
          <stop offset="33%" stopColor="#48CAE4" />
          <stop offset="66%" stopColor="#B197FC" />
          <stop offset="100%" stopColor="#52B788" />
        </linearGradient>
      </defs>
    </g>
  );
}

function Stars() {
  const stars = [
    { cx: 80, cy: 30 },
    { cx: 200, cy: 55 },
    { cx: 350, cy: 25 },
    { cx: 500, cy: 45 },
    { cx: 620, cy: 20 },
    { cx: 720, cy: 60 },
    { cx: 150, cy: 70 },
    { cx: 450, cy: 15 },
  ];
  return (
    <g>
      {stars.map((s, i) => (
        <circle key={i} cx={s.cx} cy={s.cy} r={1.2} fill="white" opacity={0.7}>
          <animate
            attributeName="opacity"
            values="0.3;0.9;0.3"
            dur={`${2 + i * 0.3}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </g>
  );
}

function CloudShape({
  x,
  y,
  scale = 1,
  speed = 30,
}: {
  x: number;
  y: number;
  scale?: number;
  speed?: number;
}) {
  return (
    <g
      className="animate-cloud-drift"
      style={{ animationDuration: `${speed}s` }}
    >
      <g transform={`translate(${x},${y}) scale(${scale})`}>
        <ellipse cx="0" cy="0" rx="35" ry="14" fill="white" opacity="0.65" />
        <ellipse cx="18" cy="-6" rx="22" ry="11" fill="white" opacity="0.55" />
        <ellipse cx="-12" cy="-4" rx="20" ry="10" fill="white" opacity="0.6" />
      </g>
    </g>
  );
}

function Ground({ state }: { state: number }) {
  const groundColor =
    state === 1 ? "#5C4033" : state === 2 ? "#4A3728" : "#2D6A4F";
  const grassColor = "#52B788";
  return (
    <g>
      <path
        d={`M0,370 Q200,360 400,368 Q600,376 800,365 L800,450 L0,450 Z`}
        fill={groundColor}
      />
      {state >= 2 && (
        <path
          d={`M0,368 Q200,358 400,366 Q600,374 800,363 L800,372 Q600,378 400,370 Q200,362 0,370 Z`}
          fill={grassColor}
          opacity={0.5}
        />
      )}
      {state >= 3 &&
        Array.from({ length: 16 }).map((_, i) => (
          <ellipse
            key={i}
            cx={30 + i * 50}
            cy={368 - (i % 3)}
            rx={12}
            ry={3}
            fill={grassColor}
            opacity={0.35 + (i % 3) * 0.1}
            className="animate-breathing"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      {state === 1 && (
        <g
          opacity="0.35"
          stroke="#8B6914"
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          <path d="M120,380 L135,395 L128,400" fill="none" />
          <path d="M320,385 L340,398" fill="none" />
          <path d="M520,382 L530,396 L525,402" fill="none" />
          <path d="M680,378 L695,394" fill="none" />
        </g>
      )}
      {state === 1 && (
        <g opacity="0.3">
          <ellipse cx="360" cy="385" rx={4} ry={2.5} fill="#8B7355" />
          <ellipse cx="430" cy="388" rx={3} ry={2} fill="#9C8B6E" />
          <ellipse cx="385" cy="392" rx={2.5} ry={1.5} fill="#7A6B50" />
        </g>
      )}
    </g>
  );
}

function Seedling() {
  return (
    <g className="animate-breathing" style={{ transformOrigin: "400px 375px" }}>
      <rect x="398" y="360" width="4" height="15" rx="2" fill="#6B8F71" />
      <ellipse cx="393" cy="357" rx={8} ry={6} fill="#74C69D" />
      <ellipse cx="407" cy="359" rx={7} ry={5} fill="#95D5B2" />
    </g>
  );
}

function Raindrop() {
  return (
    <g className="animate-raindrop">
      <path
        d="M400,80 Q402,95 400,110 Q398,95 400,80 Z"
        fill="#48CAE4"
        opacity="0.7"
      />
    </g>
  );
}

function DustParticles() {
  const particles = [
    { x: 350, y: 350, delay: 0 },
    { x: 420, y: 355, delay: 1.5 },
    { x: 380, y: 340, delay: 3 },
  ];
  return (
    <g>
      {particles.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={1.5}
          fill="#D4A574"
          opacity="0.5"
          className="animate-dust-rise"
          style={{ animationDelay: `${p.delay}s` }}
        />
      ))}
    </g>
  );
}

function SmallPlant() {
  const leaves = [
    { cx: -10, cy: -8, rx: 9, ry: 6, rotate: -25, delay: 0 },
    { cx: 10, cy: -12, rx: 8, ry: 5, rotate: 20, delay: 0.4 },
    { cx: -6, cy: -20, rx: 7, ry: 5, rotate: -15, delay: 0.8 },
    { cx: 8, cy: -24, rx: 7, ry: 4.5, rotate: 25, delay: 1.2 },
    { cx: 0, cy: -28, rx: 6, ry: 5, rotate: 0, delay: 0.6 },
  ];
  return (
    <g transform="translate(400,370)">
      <rect x="-3" y="-30" width="6" height="30" rx="3" fill="#5B8C5A" />
      {leaves.map((l, i) => (
        <ellipse
          key={i}
          cx={l.cx}
          cy={l.cy}
          rx={l.rx}
          ry={l.ry}
          fill={i % 2 === 0 ? "#74C69D" : "#95D5B2"}
          transform={`rotate(${l.rotate} ${l.cx} ${l.cy})`}
          className="animate-leaf-sway"
          style={{
            transformOrigin: `${l.cx}px ${l.cy}px`,
            animationDelay: `${l.delay}s`,
          }}
        />
      ))}
    </g>
  );
}

function SmallFlowers() {
  const flowers = [
    { x: 350, y: 372, color: "#E76F51" },
    { x: 440, y: 375, color: "#F4A261" },
    { x: 370, y: 378, color: "#B197FC" },
  ];
  return (
    <g>
      {flowers.map((f, i) => (
        <g
          key={i}
          className="animate-breathing"
          style={{
            animationDelay: `${i * 0.8}s`,
            transformOrigin: `${f.x}px ${f.y}px`,
          }}
        >
          <rect
            x={f.x - 0.8}
            y={f.y}
            width={1.6}
            height={8}
            rx={0.8}
            fill="#5B8C5A"
          />
          <circle cx={f.x} cy={f.y} r={4} fill={f.color} opacity={0.85} />
          <circle cx={f.x} cy={f.y} r={1.8} fill="white" opacity={0.6} />
        </g>
      ))}
    </g>
  );
}

function Butterfly({
  startX,
  startY,
  duration = 8,
}: {
  startX: number;
  startY: number;
  duration?: number;
}) {
  return (
    <motion.g
      animate={{ x: [0, 30, -10, 40, 0], y: [0, -25, -10, -35, 0] }}
      transition={{ duration, repeat: Infinity, ease: "linear" }}
    >
      <text x={startX} y={startY} fontSize="13" opacity="0.8">
        🦋
      </text>
    </motion.g>
  );
}

function YoungTree({
  x,
  y,
  scale = 1,
}: {
  x: number;
  y: number;
  scale?: number;
}) {
  return (
    <motion.g
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 12 }}
      style={{ transformOrigin: `${x}px ${y}px` }}
    >
      <g
        transform={`translate(${x},${y}) scale(${scale})`}
        className="animate-tree-sway"
        style={{ transformOrigin: `0px 0px` }}
      >
        <rect x="-5" y="-45" width="10" height="45" rx="4" fill="#6B4226" />
        <ellipse cx="-18" cy="-42" rx={18} ry={16} fill="#40916C" />
        <ellipse cx="16" cy="-50" rx={16} ry={14} fill="#52B788" />
        <ellipse cx="0" cy="-58" rx={20} ry={18} fill="#74C69D" />
        <ellipse cx="-8" cy="-46" rx={8} ry={7} fill="#95D5B2" opacity={0.4} />
        <ellipse cx="6" cy="-54" rx={7} ry={6} fill="#B7E4C7" opacity={0.3} />
      </g>
    </motion.g>
  );
}

function FullTree({
  x,
  y,
  scale = 1,
  variant = 0,
}: {
  x: number;
  y: number;
  scale?: number;
  variant?: number;
}) {
  const greens = [
    ["#2D6A4F", "#40916C", "#52B788"],
    ["#1B4332", "#2D6A4F", "#40916C"],
    ["#40916C", "#52B788", "#74C69D"],
  ];
  const [dark, mid, light] = greens[variant % 3];
  const swayDelay = variant * 0.7;
  return (
    <motion.g
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 100,
        damping: 14,
        delay: variant * 0.15,
      }}
      style={{ transformOrigin: `${x}px ${y}px` }}
    >
      <g
        transform={`translate(${x},${y}) scale(${scale})`}
        className="animate-tree-sway"
        style={{ transformOrigin: "0px 0px", animationDelay: `${swayDelay}s` }}
      >
        <rect x="-6" y="-60" width="12" height="60" rx="5" fill="#5C3A1E" />
        <ellipse cx="-22" cy="-55" rx={22} ry={20} fill={dark} />
        <ellipse cx="20" cy="-60" rx={20} ry={18} fill={mid} />
        <ellipse cx="0" cy="-72" rx={26} ry={22} fill={mid} />
        <ellipse cx="-12" cy="-68" rx={18} ry={16} fill={light} opacity={0.6} />
        <ellipse cx="10" cy="-76" rx={16} ry={14} fill={light} opacity={0.5} />
        {variant === 0 && (
          <ellipse
            cx="-8"
            cy="-80"
            rx={14}
            ry={12}
            fill="#95D5B2"
            opacity={0.4}
          />
        )}
      </g>
    </motion.g>
  );
}

function Stream({ state }: { state: number }) {
  const width = state >= 4 ? 12 : 6;
  return (
    <g>
      <path
        d={`M0,395 Q200,388 400,393 Q600,398 800,390`}
        stroke="#48CAE4"
        strokeWidth={width}
        fill="none"
        opacity={0.5}
        strokeLinecap="round"
      />
      <path
        d={`M0,395 Q200,388 400,393 Q600,398 800,390`}
        stroke="white"
        strokeWidth={1.5}
        fill="none"
        opacity={0.2}
        className="animate-stream-flow"
      />
      {state >= 4 &&
        [180, 380, 580].map((sx, i) => (
          <circle
            key={i}
            cx={sx}
            cy={392 + (i % 2) * 3}
            r={2}
            fill="white"
            className="animate-sparkle"
            style={{ animationDelay: `${i * 0.7}s` }}
          />
        ))}
    </g>
  );
}

function BirdV({
  startX,
  startY,
  speed = 12,
}: {
  startX: number;
  startY: number;
  speed?: number;
}) {
  return (
    <g className="animate-bird-fly" style={{ animationDuration: `${speed}s` }}>
      <path
        d={`M${startX},${startY} Q${startX + 5},${startY - 5} ${startX + 10},${startY}`}
        stroke="#1B4332"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        opacity="0.5"
      />
    </g>
  );
}

function DeerSilhouette({ x, y }: { x: number; y: number }) {
  return (
    <g className="animate-bob" style={{ animationDuration: "3s" }}>
      <text x={x} y={y} fontSize="16" opacity="0.6">
        🦌
      </text>
    </g>
  );
}

function Waterfall() {
  return (
    <g>
      <rect
        x="680"
        y="280"
        width="6"
        height="85"
        rx="3"
        fill="#48CAE4"
        opacity="0.3"
      />
      <rect
        x="682"
        y="280"
        width="2"
        height="85"
        rx="1"
        fill="white"
        opacity="0.2"
        className="animate-stream-flow"
      />
    </g>
  );
}

function Fireflies({ count = 6 }: { count?: number }) {
  const positions = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: 100 + ((i * 120) % 600),
        y: 280 + ((i * 37) % 80),
        delay: i * 0.5,
        dur: 1.8 + (i % 3) * 0.4,
      })),
    [count],
  );
  return (
    <g>
      {positions.map((f, i) => (
        <circle
          key={i}
          cx={f.x}
          cy={f.y}
          r={2}
          fill="#FFE566"
          className="animate-firefly-glow"
          style={{
            animationDelay: `${f.delay}s`,
            animationDuration: `${f.dur}s`,
            filter: "drop-shadow(0 0 4px rgba(255,229,102,0.8))",
          }}
        />
      ))}
    </g>
  );
}

function GoldenGlow({ x, y }: { x: number; y: number }) {
  return (
    <g className="animate-tree-glow">
      <ellipse cx={x} cy={y - 70} rx={40} ry={35} fill="#F4A261" opacity="0.08">
        <animate
          attributeName="opacity"
          values="0.06;0.12;0.06"
          dur="4s"
          repeatCount="indefinite"
        />
      </ellipse>
      <ellipse cx={x} cy={y - 70} rx={55} ry={50} fill="#F4A261" opacity="0.04">
        <animate
          attributeName="opacity"
          values="0.03;0.07;0.03"
          dur="4s"
          repeatCount="indefinite"
          begin="0.5s"
        />
      </ellipse>
    </g>
  );
}

/* -- Main Component -- */
export default function EcosystemViewer({
  ecoPoints,
  className = "",
  darkWrapper = false,
}: EcosystemViewerProps) {
  const state = getState(ecoPoints);
  const containerRef = useRef<HTMLDivElement>(null);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const defaultZoom = ZOOM_CONFIG[state];
  const currentScale = manualZoom ?? defaultZoom.scale;
  const currentTranslateY = manualZoom ? "0%" : defaultZoom.translateY;
  const isManuallyZoomed = manualZoom !== null;

  // Wheel zoom handler
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const base = manualZoom ?? defaultZoom.scale;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.min(2.5, Math.max(0.8, base + delta));
      setManualZoom(next);
    },
    [manualZoom, defaultZoom.scale],
  );

  // Touch pinch zoom
  const lastDistance = useRef<number | null>(null);
  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastDistance.current !== null) {
        const diff = (dist - lastDistance.current) * 0.005;
        const base = manualZoom ?? defaultZoom.scale;
        const next = Math.min(2.5, Math.max(0.8, base + diff));
        setManualZoom(next);
      }
      lastDistance.current = dist;
    },
    [manualZoom, defaultZoom.scale],
  );

  const handleTouchEnd = useCallback(() => {
    lastDistance.current = null;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchMove, handleTouchEnd]);

  const resetZoom = () => {
    setIsTransitioning(true);
    setManualZoom(null);
    setTimeout(() => setIsTransitioning(false), 600);
  };

  const wrapperClass = darkWrapper
    ? `rounded-3xl bg-bg-dark-panel p-3 ${className}`
    : className;

  const transitionDuration = isTransitioning ? "0.6s" : "1.2s";

  return (
    <div className={wrapperClass}>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-2xl"
        onWheel={handleWheel}
        style={{ touchAction: "none" }}
      >
        {/* Reset button */}
        {isManuallyZoomed && (
          <button
            onClick={resetZoom}
            className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full bg-card/80 backdrop-blur-sm shadow-card flex items-center justify-center text-xs font-bold text-foreground hover:bg-card transition-colors"
            title="Reset zoom"
          >
            ⟳
          </button>
        )}

        <div
          style={{
            transform: `scale(${currentScale}) translateY(${currentTranslateY})`,
            transition: `transform ${transitionDuration} ease-out`,
            transformOrigin: "center center",
          }}
        >
          <svg
            viewBox="0 0 800 450"
            className="w-full h-full"
            preserveAspectRatio="xMidYMid slice"
          >
            <Sky state={state} />
            {state >= 6 && (
              <>
                <Stars />
                <Aurora />
              </>
            )}
            <Sun state={state} />
            {state >= 3 && <CloudShape x={150} y={65} speed={35} />}
            {state >= 3 && <CloudShape x={520} y={90} scale={0.8} speed={28} />}
            {state >= 4 && <CloudShape x={350} y={50} scale={1.1} speed={25} />}
            {state >= 4 && (
              <g opacity="0.2">
                <polygon
                  points="0,320 120,200 240,300 360,220 480,320"
                  fill="#2D6A4F"
                />
                <polygon
                  points="400,320 520,210 640,280 720,200 800,320"
                  fill="#40916C"
                />
              </g>
            )}
            {state >= 5 && <Waterfall />}
            {state >= 3 && <BirdV startX={-20} startY={110} speed={12} />}
            {state >= 4 && <BirdV startX={-60} startY={140} speed={15} />}
            {state >= 5 && (
              <>
                <BirdV startX={-30} startY={90} speed={10} />
                <BirdV startX={-80} startY={160} speed={18} />
              </>
            )}
            <Ground state={state} />
            {state >= 3 && <Stream state={state} />}

            <AnimatePresence>
              {state === 1 && (
                <motion.g
                  key="seed"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 150 }}
                  style={{ transformOrigin: "400px 375px" }}
                >
                  <Seedling />
                  <Raindrop />
                  <DustParticles />
                </motion.g>
              )}
              {state === 2 && (
                <motion.g
                  key="sprout"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 120 }}
                  style={{ transformOrigin: "400px 370px" }}
                >
                  <SmallPlant />
                  <SmallFlowers />
                  <Butterfly startX={450} startY={340} />
                </motion.g>
              )}
              {state >= 3 && (
                <YoungTree
                  key="tree-center"
                  x={400}
                  y={368}
                  scale={state >= 4 ? 1.2 : 1}
                />
              )}
              {state >= 4 && (
                <FullTree
                  key="full-center"
                  x={400}
                  y={368}
                  scale={1.1}
                  variant={0}
                />
              )}
              {state >= 5 && (
                <>
                  <FullTree
                    key="tree-left"
                    x={220}
                    y={372}
                    scale={0.85}
                    variant={1}
                  />
                  <FullTree
                    key="tree-right"
                    x={580}
                    y={370}
                    scale={0.9}
                    variant={2}
                  />
                  <FullTree
                    key="tree-far-left"
                    x={100}
                    y={374}
                    scale={0.65}
                    variant={0}
                  />
                  <FullTree
                    key="tree-far-right"
                    x={680}
                    y={372}
                    scale={0.7}
                    variant={1}
                  />
                </>
              )}
              {state >= 6 && (
                <>
                  <FullTree
                    key="tree-6a"
                    x={300}
                    y={370}
                    scale={0.75}
                    variant={2}
                  />
                  <FullTree
                    key="tree-6b"
                    x={500}
                    y={372}
                    scale={0.8}
                    variant={0}
                  />
                  <GoldenGlow x={400} y={368} />
                </>
              )}
            </AnimatePresence>

            {state >= 4 && <DeerSilhouette x={130} y={365} />}
            {state >= 6 && (
              <g className="animate-bob" style={{ animationDuration: "2.5s" }}>
                <text x={620} y={367} fontSize="14" opacity="0.5">
                  🐇
                </text>
              </g>
            )}
            {state >= 2 && <Butterfly startX={450} startY={330} duration={8} />}
            {state >= 4 && (
              <Butterfly startX={250} startY={340} duration={11} />
            )}
            {state >= 5 && <Fireflies count={state >= 6 ? 10 : 6} />}
            {state >= 3 && (
              <motion.g
                animate={{ y: [0, 200], x: [0, 25], opacity: [0.7, 0] }}
                transition={{
                  duration: 6,
                  repeat: Infinity,
                  ease: "linear",
                  delay: 2,
                }}
              >
                <text x="340" y="260" fontSize="10">
                  🍃
                </text>
              </motion.g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
