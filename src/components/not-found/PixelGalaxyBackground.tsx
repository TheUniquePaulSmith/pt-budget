'use client';

import React, { useEffect, useRef } from 'react';

import { generatePixelGalaxy, pickPixelSize, type PixelGalaxy } from '@/lib/pixelGalaxy';

interface PixelGalaxyBackgroundProps {
  /** Same seed, same sky; a new seed per visit makes every 404 different. */
  seed: number;
  reducedMotion: boolean;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAt: number;
}

const FRAME_INTERVAL_MS = 90;
const RESIZE_DEBOUNCE_MS = 150;
const SHOOTING_STAR_LIFE_S = 0.9;
const SHOOTING_STAR_TRAIL = 7;

/**
 * Full-viewport pixel-art Milky Way. The galaxy is painted once into an
 * offscreen canvas at roughly 4 CSS px per pixel; each frame (about 11 per
 * second, for a stop-motion feel) copies it over and re-lights the twinkling
 * stars and the occasional shooting star.
 */
export default function PixelGalaxyBackground({ seed, reducedMotion }: PixelGalaxyBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let galaxy: PixelGalaxy | null = null;
    let base: HTMLCanvasElement | null = null;
    let frameHandle = 0;
    let resizeTimer = 0;
    let lastFrameAt = 0;
    let shooter: ShootingStar | null = null;
    let nextShooterAt = performance.now() / 1000 + 2.5;

    const build = () => {
      // A hidden or not-yet-laid-out window reports 0x0; the resize handler
      // builds the sky once it has a size.
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      if (viewportWidth < 1 || viewportHeight < 1) return;
      const pixelSize = pickPixelSize(viewportWidth, viewportHeight);
      const width = Math.ceil(viewportWidth / pixelSize);
      const height = Math.ceil(viewportHeight / pixelSize);
      galaxy = generatePixelGalaxy(width, height, seed);

      base = document.createElement('canvas');
      base.width = width;
      base.height = height;
      const baseContext = base.getContext('2d');
      if (!baseContext) return;
      const image = baseContext.createImageData(width, height);
      image.data.set(galaxy.pixels);
      baseContext.putImageData(image, 0, 0);

      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width * pixelSize}px`;
      canvas.style.height = `${height * pixelSize}px`;
    };

    const drawShootingStar = (seconds: number, width: number, height: number) => {
      if (!shooter && seconds >= nextShooterAt) {
        const direction = Math.random() < 0.5 ? -1 : 1;
        shooter = {
          x: width * (0.1 + Math.random() * 0.8),
          y: height * Math.random() * 0.4,
          vx: direction * (55 + Math.random() * 30),
          vy: 25 + Math.random() * 20,
          bornAt: seconds,
        };
      }
      if (!shooter) return;

      const age = seconds - shooter.bornAt;
      if (age > SHOOTING_STAR_LIFE_S) {
        shooter = null;
        nextShooterAt = seconds + 6 + Math.random() * 9;
        return;
      }
      for (let i = 0; i < SHOOTING_STAR_TRAIL; i += 1) {
        const trailAge = age - i * 0.035;
        if (trailAge < 0) continue;
        const alpha = (1 - i / SHOOTING_STAR_TRAIL) * (1 - age / SHOOTING_STAR_LIFE_S);
        context.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
        context.fillRect(
          Math.round(shooter.x + shooter.vx * trailAge),
          Math.round(shooter.y + shooter.vy * trailAge),
          1,
          1
        );
      }
    };

    const draw = (now: number) => {
      if (!galaxy || !base) return;
      context.drawImage(base, 0, 0);

      const seconds = now / 1000;
      for (const star of galaxy.twinklers) {
        const wave = 0.5 + 0.5 * Math.sin((seconds / star.period) * Math.PI * 2 + star.phase);
        // Stepped brightness keeps the twinkle pixel-y instead of a smooth fade.
        const alpha = reducedMotion ? 0.85 : Math.round((0.15 + 0.85 * wave * wave) * 5) / 5;
        context.fillStyle = `rgba(${star.color[0]},${star.color[1]},${star.color[2]},${alpha})`;
        context.fillRect(star.x, star.y, 1, 1);
      }

      if (!reducedMotion) drawShootingStar(seconds, galaxy.width, galaxy.height);
    };

    const tick = (now: number) => {
      frameHandle = window.requestAnimationFrame(tick);
      if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
      lastFrameAt = now;
      draw(now);
    };

    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        build();
        draw(performance.now());
      }, RESIZE_DEBOUNCE_MS);
    };

    build();
    draw(performance.now());
    if (!reducedMotion) frameHandle = window.requestAnimationFrame(tick);
    window.addEventListener('resize', handleResize);

    return () => {
      window.cancelAnimationFrame(frameHandle);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [seed, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="pixel-galaxy"
      style={{ position: 'absolute', top: 0, left: 0, imageRendering: 'pixelated', pointerEvents: 'none' }}
    />
  );
}
