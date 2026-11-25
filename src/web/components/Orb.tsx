import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

// Each state is a set of three glowing layers inside a dark lens.
const PALETTES: Record<OrbState, [string, string, string]> = {
  idle: ["#5b47e0", "#2bb8b0", "#8fd4ff"],
  listening: ["#1fbf8f", "#5be3c4", "#c9ffe9"],
  thinking: ["#e9a23b", "#5b47e0", "#ffd9a0"],
  speaking: ["#7a5cff", "#ff6fb1", "#ffe0f2"],
};

/** A living orb drawn on canvas. `level` (0–1) is mic or speech loudness. */
export function Orb({
  state,
  level,
  size = 260,
  onClick,
  label,
}: {
  state: OrbState;
  level: number;
  size?: number;
  onClick?: () => void;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ state, level, smooth: 0 });
  live.current.state = state;
  live.current.level = level;

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size * dpr;
    c.height = size * dpr;
    ctx.scale(dpr, dpr);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const s = live.current;
      s.smooth += (s.level - s.smooth) * 0.18;
      const speed = reduce ? 0.15 : s.state === "thinking" ? 1.6 : s.state === "idle" ? 0.45 : 0.9;
      const energy = (s.state === "idle" ? 0.05 : 0.09) + s.smooth * 0.22;
      const cx = size / 2;
      const cy = size / 2;
      const R = size * 0.3 * (1 + s.smooth * 0.08 + (reduce ? 0 : Math.sin(t * 1.3) * 0.015));

      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = "lighter";
      const colours = PALETTES[s.state];
      colours.forEach((colour, layer) => {
        const phase = layer * 2.1;
        const r0 = R * (1 - layer * 0.16);
        ctx.beginPath();
        const N = 72;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          const wobble =
            Math.sin(a * 3 + t * speed * 1.7 + phase) * energy +
            Math.sin(a * 5 - t * speed * 1.1 + phase * 1.3) * energy * 0.6 +
            Math.sin(a * 2 + t * speed * 0.7) * energy * 0.5;
          const r = r0 * (1 + wobble);
          const x = cx + Math.cos(a) * r + Math.sin(t * speed * 0.6 + phase) * size * 0.02;
          const y = cy + Math.sin(a) * r + Math.cos(t * speed * 0.5 + phase) * size * 0.02;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const g = ctx.createRadialGradient(cx - r0 * 0.25, cy - r0 * 0.3, r0 * 0.05, cx, cy, r0 * 1.15);
        g.addColorStop(0, colour + "ee");
        g.addColorStop(0.55, colour + "88");
        g.addColorStop(1, colour + "00");
        ctx.fillStyle = g;
        ctx.fill();
      });
      // A soft highlight, like light on glass.
      ctx.globalCompositeOperation = "source-over";
      const h = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 0, cx - R * 0.35, cy - R * 0.4, R * 0.6);
      h.addColorStop(0, "rgba(255,255,255,0.35)");
      h.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = h;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <button type="button" className={`orb orb-${state}`} onClick={onClick} aria-label={label} style={{ width: size, height: size }}>
      <canvas ref={canvas} style={{ width: size, height: size }} aria-hidden />
    </button>
  );
}
