import { describe, expect, it } from 'vitest';

import { generatePixelGalaxy, mulberry32, pickPixelSize } from './pixelGalaxy';

describe('pickPixelSize', () => {
  it('stays chunky on normal screens and grows on huge ones', () => {
    expect(pickPixelSize(390, 844)).toBe(4);
    expect(pickPixelSize(1920, 1080)).toBe(4);
    expect(pickPixelSize(3840, 2160)).toBe(8);
  });
});

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('generatePixelGalaxy', () => {
  const width = 120;
  const height = 70;

  it('paints an opaque RGBA buffer of the requested size', () => {
    const galaxy = generatePixelGalaxy(width, height, 7);
    expect(galaxy.width).toBe(width);
    expect(galaxy.height).toBe(height);
    expect(galaxy.pixels).toHaveLength(width * height * 4);
    for (let i = 3; i < galaxy.pixels.length; i += 4) {
      expect(galaxy.pixels[i]).toBe(255);
    }
  });

  it('is deterministic for a seed and different across seeds', () => {
    const first = generatePixelGalaxy(width, height, 1234);
    const again = generatePixelGalaxy(width, height, 1234);
    const other = generatePixelGalaxy(width, height, 4321);
    expect(Array.from(again.pixels)).toEqual(Array.from(first.pixels));
    expect(again.twinklers).toEqual(first.twinklers);
    expect(Array.from(other.pixels)).not.toEqual(Array.from(first.pixels));
  });

  it('keeps space mostly dark while still showing a bright galactic band', () => {
    const galaxy = generatePixelGalaxy(width, height, 99);
    let total = 0;
    let bright = 0;
    for (let i = 0; i < galaxy.pixels.length; i += 4) {
      const luminance = (galaxy.pixels[i] + galaxy.pixels[i + 1] + galaxy.pixels[i + 2]) / 3;
      total += luminance;
      if (luminance > 120) bright += 1;
    }
    const mean = total / (galaxy.pixels.length / 4);
    expect(mean).toBeGreaterThan(8);
    expect(mean).toBeLessThan(110);
    expect(bright).toBeGreaterThan(20);
  });

  it('hands bright stars to the renderer inside the canvas', () => {
    const galaxy = generatePixelGalaxy(width, height, 5);
    expect(galaxy.twinklers.length).toBeGreaterThan(0);
    for (const star of galaxy.twinklers) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(width);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(height);
      expect(star.period).toBeGreaterThan(0);
    }
  });
});
