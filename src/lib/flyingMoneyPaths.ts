import { mulberry32 } from './pixelGalaxy';

/**
 * Flight plans for the winged bills drifting across the 404 page: each bill
 * gets a smooth closed loop (as SVG path data for `<animateMotion>`) that
 * wanders over the viewport and sometimes slips off an edge, plus the timing
 * knobs for its flap, bob and rock. Pure and seeded.
 */

export interface PlannedBill {
  id: number;
  /** Closed cubic-Bezier loop in viewport pixels. */
  path: string;
  /** Seconds for one lap. */
  duration: number;
  /** Seconds into the lap at load, so bills do not start in a line. */
  lapOffset: number;
  /** Screen pixels per sprite pixel. */
  scale: number;
  opacity: number;
  flapPeriod: number;
  flapOffset: number;
  bobPeriod: number;
  bobAmplitude: number;
  rockPeriod: number;
  rockDegrees: number;
}

interface Point {
  x: number;
  y: number;
}

// Whole numbers keep the pixel art crisp: 48 to 112 px wide bills.
const SCALES = [3, 3, 4, 4, 5, 6, 7];

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function billCountFor(width: number, height: number): number {
  return Math.min(10, Math.max(4, Math.round((width * height) / 200000)));
}

/** Catmull-Rom through the points, closed, expressed as cubic Beziers. */
function closedSplinePath(points: Point[]): { d: string; length: number } {
  const count = points.length;
  let d = `M${round(points[0].x)} ${round(points[0].y)}`;
  let length = 0;

  for (let i = 0; i < count; i += 1) {
    const p0 = points[(i - 1 + count) % count];
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    const p3 = points[(i + 2) % count];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`;

    let previous = p1;
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const inv = 1 - t;
      const x = inv ** 3 * p1.x + 3 * inv * inv * t * c1.x + 3 * inv * t * t * c2.x + t ** 3 * p2.x;
      const y = inv ** 3 * p1.y + 3 * inv * inv * t * c1.y + 3 * inv * t * t * c2.y + t ** 3 * p2.y;
      length += Math.hypot(x - previous.x, y - previous.y);
      previous = { x, y };
    }
  }

  return { d, length };
}

function planLoop(rng: () => number, width: number, height: number): Point[] {
  const waypoints = 5 + Math.floor(rng() * 3);
  const centerX = width * (0.5 + (rng() - 0.5) * 0.3);
  const centerY = height * (0.5 + (rng() - 0.5) * 0.3);
  const phase = rng() * Math.PI * 2;
  const direction = rng() < 0.5 ? 1 : -1;

  return Array.from({ length: waypoints }, (_, i) => {
    const angle = phase + direction * ((i + (rng() - 0.5) * 0.5) / waypoints) * Math.PI * 2;
    const radiusX = width * (0.28 + rng() * 0.4);
    const radiusY = height * (0.26 + rng() * 0.4);
    return { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY };
  });
}

export function planFlyingBills(width: number, height: number, seed: number): PlannedBill[] {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const count = billCountFor(width, height);

  const bills = Array.from({ length: count }, (_, id): PlannedBill => {
    const scale = SCALES[Math.floor(rng() * SCALES.length)];
    const loop = planLoop(rng, width, height);
    const { d, length } = closedSplinePath(loop);
    // Farther (smaller) bills crawl, nearer ones drift a little faster.
    const speed = 18 + (scale - 3) * 5 + rng() * 8;
    const duration = Math.max(30, length / speed);

    return {
      id,
      path: d,
      duration: round(duration),
      lapOffset: round(rng() * duration),
      scale,
      opacity: round(0.55 + (scale - 3) * 0.1),
      // A lazy flap to match the slow drift.
      flapPeriod: round(0.9 + rng() * 0.4),
      flapOffset: round(rng() * 0.7),
      bobPeriod: round(2 + rng() * 1.6),
      bobAmplitude: round(2 + rng() * 3),
      rockPeriod: round(3 + rng() * 2.5),
      rockDegrees: round(4 + rng() * 5),
    };
  });

  // Paint far bills first so near ones overlap them.
  return bills.sort((a, b) => a.scale - b.scale);
}
