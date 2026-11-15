import { useEffect, useRef } from "react";

export interface SkyGlobePin {
  key: string;
  label: string;
  ra: number;
  dec: number;
}

interface SkyContextGlobeProps {
  pins: SkyGlobePin[];
  activeKey: string | null;
  /** Live cutout center when custom / overrides pin. */
  activeRa?: number | null;
  activeDec?: number | null;
  fovDeg: number;
  onSelect: (key: string) => void;
}

type Vec3 = { x: number; y: number; z: number };

function raDecToVec(raDeg: number, decDeg: number): Vec3 {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const c = Math.cos(dec);
  return {
    x: c * Math.cos(ra),
    y: Math.sin(dec),
    z: c * Math.sin(ra),
  };
}

function norm(v: Vec3): Vec3 {
  const L = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Rotate so `look` faces +Z (toward camera), +Y up as much as possible. */
function basisFacing(look: Vec3): { right: Vec3; up: Vec3; fwd: Vec3 } {
  const fwd = norm(look);
  const worldUp = { x: 0, y: 1, z: 0 };
  let right = cross(worldUp, fwd);
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) {
    right = cross({ x: 1, y: 0, z: 0 }, fwd);
  }
  right = norm(right);
  const up = norm(cross(fwd, right));
  return { right, up, fwd };
}

function project(
  v: Vec3,
  basis: { right: Vec3; up: Vec3; fwd: Vec3 },
  cx: number,
  cy: number,
  r: number,
) {
  const x = dot(v, basis.right);
  const y = dot(v, basis.up);
  const z = dot(v, basis.fwd);
  return {
    sx: cx + x * r,
    sy: cy - y * r,
    depth: z,
  };
}

/**
 * Compact celestial-sphere context: five challenge pins + FOV cone.
 * Canvas only — no Three.js weight. Honest cutout orientation, not a survey map.
 */
export function SkyContextGlobe({
  pins,
  activeKey,
  activeRa = null,
  activeDec = null,
  fovDeg,
  onSelect,
}: SkyContextGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const hitRef = useRef<{ key: string; sx: number; sy: number }[]>([]);
  const dragRef = useRef<{ lx: number; ly: number; yaw: number; pitch: number } | null>(null);
  const viewRef = useRef({ yaw: 0, pitch: 0.15 });

  useEffect(() => {
    const active = pins.find((p) => p.key === activeKey);
    const ra = activeRa ?? active?.ra ?? 269.45;
    const dec = activeDec ?? active?.dec ?? 4.69;
    // Face the active cutout; keep a slight tilt so the sphere reads in 3D.
    viewRef.current = {
      yaw: (-ra * Math.PI) / 180,
      pitch: Math.max(-0.6, Math.min(0.6, ((-dec * Math.PI) / 180) * 0.35 + 0.12)),
    };
  }, [activeKey, activeRa, activeDec, pins]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let alive = true;

    const paint = () => {
      if (!alive) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth || 280;
      const h = wrap.clientHeight || 200;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cx = w / 2;
      const cy = h / 2 + 4;
      const R = Math.min(w, h) * 0.38;

      const { yaw, pitch } = viewRef.current;
      const look = {
        x: Math.cos(pitch) * Math.sin(yaw),
        y: Math.sin(pitch),
        z: Math.cos(pitch) * Math.cos(yaw),
      };
      // Camera looks along +Z in view space; face toward -look so active sky is front.
      const basis = basisFacing({ x: -look.x, y: -look.y, z: -look.z });

      ctx.clearRect(0, 0, w, h);

      // Sphere shell
      const grd = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
      grd.addColorStop(0, "#1a2740");
      grd.addColorStop(0.7, "#0b1220");
      grd.addColorStop(1, "#070b12");
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = "rgba(143, 163, 187, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Meridians / parallels (subtle)
      ctx.strokeStyle = "rgba(143, 163, 187, 0.12)";
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        const dec = (i * 30 * Math.PI) / 180;
        ctx.beginPath();
        let started = false;
        for (let ra = 0; ra <= 360; ra += 6) {
          const v = raDecToVec(ra, (dec * 180) / Math.PI);
          const p = project(v, basis, cx, cy, R);
          if (p.depth < -0.05) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.sx, p.sy);
            started = true;
          } else ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();
      }
      for (let ra = 0; ra < 360; ra += 45) {
        ctx.beginPath();
        let started = false;
        for (let dec = -90; dec <= 90; dec += 6) {
          const v = raDecToVec(ra, dec);
          const p = project(v, basis, cx, cy, R);
          if (p.depth < -0.05) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.sx, p.sy);
            started = true;
          } else ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();
      }

      // Telescope at center
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#e8a045";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const activePin = pinsRef.current.find((p) => p.key === activeKey);
      const aimRa = activeRa ?? activePin?.ra ?? null;
      const aimDec = activeDec ?? activePin?.dec ?? null;

      if (aimRa != null && aimDec != null) {
        const aim = raDecToVec(aimRa, aimDec);
        const tip = project(aim, basis, cx, cy, R);
        if (tip.depth > -0.2) {
          // Pointing ray
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(tip.sx, tip.sy);
          ctx.strokeStyle = "rgba(232, 160, 69, 0.85)";
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // FOV ring (exaggerated so 0.1° vs 0.3° reads; real angle is tiny on a sphere)
          const ringPx = Math.max(7, Math.min(26, 7 + fovDeg * 28));
          ctx.beginPath();
          ctx.arc(tip.sx, tip.sy, ringPx, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(56, 189, 248, 0.75)";
          ctx.lineWidth = 1.25;
          ctx.stroke();
          ctx.fillStyle = "rgba(56, 189, 248, 0.08)";
          ctx.fill();
        }
      }

      // Pins
      const hits: { key: string; sx: number; sy: number }[] = [];
      const sorted = [...pinsRef.current].sort((a, b) => {
        const da = project(raDecToVec(a.ra, a.dec), basis, cx, cy, R).depth;
        const db = project(raDecToVec(b.ra, b.dec), basis, cx, cy, R).depth;
        return da - db;
      });

      for (const pin of sorted) {
        const p = project(raDecToVec(pin.ra, pin.dec), basis, cx, cy, R);
        if (p.depth < -0.15) continue;
        const active = pin.key === activeKey;
        const rad = active ? 5.5 : 3.8;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
        ctx.fillStyle = active ? "#e8a045" : "#7dd3fc";
        ctx.fill();
        ctx.strokeStyle = active ? "#fff" : "rgba(255,255,255,0.55)";
        ctx.lineWidth = active ? 1.4 : 0.9;
        ctx.stroke();

        ctx.font = active
          ? "600 10px IBM Plex Sans, sans-serif"
          : "500 9px IBM Plex Sans, sans-serif";
        ctx.fillStyle = active ? "#fff" : "rgba(232, 238, 246, 0.85)";
        ctx.textAlign = "left";
        ctx.fillText(pin.label, p.sx + rad + 4, p.sy + 3);

        hits.push({ key: pin.key, sx: p.sx, sy: p.sy });
      }
      hitRef.current = hits;

      raf = window.requestAnimationFrame(paint);
    };

    raf = window.requestAnimationFrame(paint);

    const onPointerDown = (e: PointerEvent) => {
      dragRef.current = {
        lx: e.clientX,
        ly: e.clientY,
        yaw: viewRef.current.yaw,
        pitch: viewRef.current.pitch,
      };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.lx;
      const dy = e.clientY - d.ly;
      // Grab-the-sphere: content follows the finger (not camera-orbit inverted).
      viewRef.current = {
        yaw: d.yaw - dx * 0.008,
        pitch: Math.max(-1.1, Math.min(1.1, d.pitch - dy * 0.008)),
      };
    };
    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      const moved = Math.hypot(e.clientX - d.lx, e.clientY - d.ly);
      if (moved > 6) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let best: { key: string; dist: number } | null = null;
      for (const h of hitRef.current) {
        const dist = Math.hypot(h.sx - x, h.sy - y);
        if (dist < 16 && (!best || dist < best.dist)) best = { key: h.key, dist };
      }
      if (best) onSelectRef.current(best.key);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);

    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
  }, [activeKey, activeRa, activeDec, fovDeg]);

  return (
    <div className="sky-context" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="sky-context-canvas"
        aria-label="Sky context globe. Drag to rotate. Click a pin to load that target."
      />
      <p className="sky-context-caption">
        Cutout on the sky — not the full survey map. Drag to turn · click a star.
      </p>
    </div>
  );
}

/** Fallback pins from sample index (challenge five). */
export const CHALLENGE_SKY_PINS: SkyGlobePin[] = [
  { key: "barnard", label: "Barnard's Star", ra: 269.452077, dec: 4.693365 },
  { key: "epsindi", label: "Epsilon Indi B", ra: 331.044147, dec: -56.782844 },
  { key: "wise0855", label: "WISE 0855", ra: 133.818908, dec: -7.247048 },
  { key: "rwaur", label: "RW Aurigae", ra: 76.956526, dec: 30.401438 },
  { key: "rdra", label: "R Draconis", ra: 248.167611, dec: 66.754979 },
];
