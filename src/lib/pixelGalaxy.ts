/**
 * Procedural pixel-art Milky Way for the 404 page. Pure and seeded: the same
 * (width, height, seed) always paints the same galaxy, so the renderer can
 * regenerate it on resize without the sky changing underneath the user.
 *
 * Look: a diagonal band of star clouds with a bright warm bulge, a dark dust
 * lane down its spine, a cooler purple/teal halo, Bayer-dithered into a small
 * set of palette steps so it reads as pixel art rather than a smooth gradient.
 */

export type Rgb = readonly [number, number, number];

export interface GalaxyStar {
  x: number;
  y: number;
  color: Rgb;
  /** Radians; offsets this star's twinkle from the others. */
  phase: number;
  /** Seconds per twinkle cycle. */
  period: number;
}

export interface PixelGalaxy {
  width: number;
  height: number;
  /** RGBA, `width * height * 4` bytes, fully opaque. */
  pixels: Uint8ClampedArray;
  /** Bright stars left out of `pixels` for the renderer to animate. */
  twinklers: GalaxyStar[];
}

const MIN_PIXEL_SIZE = 4;
const MAX_GALAXY_WIDTH = 480;

/** CSS pixels per galaxy pixel: chunky, but capped so huge screens stay cheap. */
export function pickPixelSize(viewportWidth: number, viewportHeight: number): number {
  return Math.max(MIN_PIXEL_SIZE, Math.ceil(Math.max(viewportWidth, viewportHeight) / MAX_GALAXY_WIDTH));
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash2(ix, iy, seed) * (1 - sx) + hash2(ix + 1, iy, seed) * sx;
  const bottom = hash2(ix, iy + 1, seed) * (1 - sx) + hash2(ix + 1, iy + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + octave * 101) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hex(value: string): Rgb {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

type RampStop = readonly [number, Rgb];

const WARM_RAMP: RampStop[] = [
  [0, hex('#04030c')],
  [0.14, hex('#0b0a2a')],
  [0.28, hex('#1d1457')],
  [0.42, hex('#4a2090')],
  [0.56, hex('#8e3a9e')],
  [0.7, hex('#d4627f')],
  [0.84, hex('#ffb571')],
  [1, hex('#fff1d2')],
];

const COOL_RAMP: RampStop[] = [
  [0, hex('#04030c')],
  [0.14, hex('#07112c')],
  [0.28, hex('#0f2a5e')],
  [0.42, hex('#1a4fa0')],
  [0.56, hex('#2f86c8')],
  [0.7, hex('#6cd0e0')],
  [0.84, hex('#c4f2f6')],
  [1, hex('#f4ffff')],
];

function sampleRamp(ramp: RampStop[], t: number): Rgb {
  for (let i = 1; i < ramp.length; i += 1) {
    const [stop, color] = ramp[i];
    if (t <= stop) {
      const [prevStop, prevColor] = ramp[i - 1];
      const k = (t - prevStop) / (stop - prevStop);
      return [
        prevColor[0] + (color[0] - prevColor[0]) * k,
        prevColor[1] + (color[1] - prevColor[1]) * k,
        prevColor[2] + (color[2] - prevColor[2]) * k,
      ];
    }
  }
  return ramp[ramp.length - 1][1];
}

const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function bayer(x: number, y: number): number {
  return (BAYER_4X4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

const STAR_COLORS: Rgb[] = [
  hex('#ffffff'),
  hex('#ffffff'),
  hex('#dfe9ff'),
  hex('#b9d0ff'),
  hex('#fff1c2'),
  hex('#ffd49a'),
];

const INTENSITY_LEVELS = 11;
const MAX_INTENSITY = 0.82;
const HUE_LEVELS = 4;

export function generatePixelGalaxy(width: number, height: number, seed: number): PixelGalaxy {
  const rng = mulberry32(seed);
  const noiseSeed = Math.floor(rng() * 1e9);
  const diagonal = Math.hypot(width, height);

  const slopeSign = rng() < 0.5 ? -1 : 1;
  const angle = slopeSign * (0.25 + rng() * 0.45);
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  const centerX = width * (0.38 + rng() * 0.24);
  const centerY = height * (0.38 + rng() * 0.24);
  const bulgeAlong = (rng() - 0.5) * 0.3;
  const bandWidth = 0.11 + rng() * 0.05;
  const laneOffset = (rng() - 0.5) * 0.03;

  const pixels = new Uint8ClampedArray(width * height * 4);
  const bandBoost = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / diagonal;
      const v = y / diagonal;
      const dx = x - centerX;
      const dy = y - centerY;
      const along = (dx * axisX + dy * axisY) / diagonal;
      const across = (-dx * axisY + dy * axisX) / diagonal;

      const warped = across + (fbm(u * 3.2, v * 3.2, noiseSeed, 4) - 0.5) * 0.24;
      const taper = 0.5 + 0.5 * Math.exp(-((along / 0.5) ** 2));
      const half = bandWidth * taper;
      const band = Math.exp(-((warped / half) ** 2) * 1.2);
      const bulge = Math.exp(-(((along - bulgeAlong) ** 2) / 0.045 + (warped ** 2) / 0.006));
      const clouds = fbm(u * 11, v * 11, noiseSeed + 7, 5);
      const dustNoise = fbm(u * 15, v * 15, noiseSeed + 13, 4);
      const lane = Math.exp(-(((warped - laneOffset) / (half * 0.3)) ** 2));
      const dust = lane * smoothstep(0.4, 0.68, dustNoise);
      const halo = Math.exp(-((warped / (half * 2.8)) ** 2)) * 0.2;

      let intensity = band * (0.28 + 0.8 * clouds) + bulge * 0.6;
      intensity *= 1 - 0.88 * dust;
      intensity += halo * (0.5 + clouds * 0.5);
      // Capped below the ramp's near-white top so the core glows warm and the
      // page's text stays readable on top of it.
      intensity = clamp01(intensity) * MAX_INTENSITY;
      bandBoost[y * width + x] = clamp01(band + bulge);

      const hueNoise = fbm(u * 5 + 40, v * 5 + 40, noiseSeed + 29, 3);
      const coolness = smoothstep(0.38, 0.7, hueNoise * (1 - bulge * 0.85));

      const dither = bayer(x, y);
      const level = Math.floor(intensity * INTENSITY_LEVELS + dither) / INTENSITY_LEVELS;
      const hueLevel = Math.floor(coolness * HUE_LEVELS + dither) / HUE_LEVELS;
      const warm = sampleRamp(WARM_RAMP, clamp01(level));
      const cool = sampleRamp(COOL_RAMP, clamp01(level));

      const offset = (y * width + x) * 4;
      pixels[offset] = warm[0] + (cool[0] - warm[0]) * hueLevel;
      pixels[offset + 1] = warm[1] + (cool[1] - warm[1]) * hueLevel;
      pixels[offset + 2] = warm[2] + (cool[2] - warm[2]) * hueLevel;
      pixels[offset + 3] = 255;
    }
  }

  const twinklers: GalaxyStar[] = [];
  const paintStar = (x: number, y: number, color: Rgb, strength: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels[offset] = Math.min(255, pixels[offset] + color[0] * strength);
    pixels[offset + 1] = Math.min(255, pixels[offset + 1] + color[1] * strength);
    pixels[offset + 2] = Math.min(255, pixels[offset + 2] + color[2] * strength);
  };

  const starCount = Math.round((width * height) / 85);
  for (let i = 0; i < starCount; i += 1) {
    const x = Math.floor(rng() * width);
    const y = Math.floor(rng() * height);
    // Stars crowd into the band, thin out in the void.
    if (rng() > 0.28 + 0.72 * bandBoost[y * width + x]) continue;

    const brightness = rng() ** 3;
    const color = STAR_COLORS[Math.floor(rng() * STAR_COLORS.length)];
    const sparkle = brightness > 0.9 && rng() < 0.5;

    if (brightness > 0.5 || sparkle) {
      twinklers.push({ x, y, color, phase: rng() * Math.PI * 2, period: 1.6 + rng() * 3.4 });
      if (sparkle) {
        paintStar(x - 1, y, color, 0.35);
        paintStar(x + 1, y, color, 0.35);
        paintStar(x, y - 1, color, 0.35);
        paintStar(x, y + 1, color, 0.35);
      }
      continue;
    }
    paintStar(x, y, color, 0.28 + brightness * 1.1);
  }

  return { width, height, pixels, twinklers };
}
