'use client';

import React, { useEffect, useMemo, useState } from 'react';

import WingedMoneySprite from '@/components/common/WingedMoneySprite';
import { planFlyingBills, type PlannedBill } from '@/lib/flyingMoneyPaths';
import { MONEY_SPRITE_HEIGHT, MONEY_SPRITE_WIDTH } from '@/lib/pixelMoneySprite';

interface FlyingMoneyLayerProps {
  seed: number;
  reducedMotion: boolean;
}

interface ViewportSize {
  width: number;
  height: number;
}

const RESIZE_DEBOUNCE_MS = 200;
// Mobile browsers resize the viewport as the URL bar slides away; ignore
// that jitter so the flock does not restart mid-flight.
const HEIGHT_JITTER_PX = 120;
const WIDTH_JITTER_PX = 48;

function useViewportSize(): ViewportSize | null {
  const [size, setSize] = useState<ViewportSize | null>(null);

  useEffect(() => {
    let timer = 0;
    const measure = () => {
      // clientWidth excludes the vertical scrollbar, so the fixed layer never
      // causes horizontal scrolling.
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      if (width < 1 || height < 1) return;
      setSize((previous) =>
        previous &&
        Math.abs(previous.width - width) < WIDTH_JITTER_PX &&
        Math.abs(previous.height - height) < HEIGHT_JITTER_PX
          ? previous
          : { width, height }
      );
    };
    const handleResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, RESIZE_DEBOUNCE_MS);
    };

    measure();
    window.addEventListener('resize', handleResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return size;
}

// Visitors who prefer reduced motion still get the flock, just calmer: the bills
// keep drifting and flapping (slowly, and without the bob and rock), instead
// of freezing into a still picture.
const REDUCED_MOTION_SLOWDOWN = 1.5;

function WingedBill({ bill, reducedMotion }: { bill: PlannedBill; reducedMotion: boolean }) {
  const bob = bill.bobAmplitude;
  const rock = bill.rockDegrees;
  const lapSeconds = bill.duration * (reducedMotion ? REDUCED_MOTION_SLOWDOWN : 1);

  return (
    <g opacity={bill.opacity} data-testid="flying-bill">
      {/* Lap around the screen: one closed loop, constant speed. */}
      <animateMotion
        path={bill.path}
        dur={`${lapSeconds}s`}
        begin={`${-bill.lapOffset}s`}
        repeatCount="indefinite"
      />
      <g>
        <g>
          {!reducedMotion && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values={`0 ${-bob};0 ${bob};0 ${-bob}`}
              dur={`${bill.bobPeriod}s`}
              repeatCount="indefinite"
              calcMode="spline"
              keyTimes="0;0.5;1"
              keySplines=".45 0 .55 1;.45 0 .55 1"
            />
          )}
          <g transform={`scale(${bill.scale})`}>
            <g>
              {!reducedMotion && (
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  values={`${-rock};${rock};${-rock}`}
                  dur={`${bill.rockPeriod}s`}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keyTimes="0;0.5;1"
                  keySplines=".45 0 .55 1;.45 0 .55 1"
                />
              )}
              <g transform={`translate(${-MONEY_SPRITE_WIDTH / 2} ${-MONEY_SPRITE_HEIGHT / 2})`}>
                <WingedMoneySprite animated flapPeriod={bill.flapPeriod} flapOffset={bill.flapOffset} />
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

/**
 * A flock of pixel-art 💸 drifting around the viewport as a pure SVG/SMIL
 * animation: `animateMotion` carries each bill along its loop and the shared
 * sprite flips its wing frames, so there is no per-frame JavaScript. Rendered only
 * once the viewport is measured (client side), which keeps the prerendered
 * 404.html free of random content.
 */
export default function FlyingMoneyLayer({ seed, reducedMotion }: FlyingMoneyLayerProps) {
  const size = useViewportSize();
  const bills = useMemo(
    () => (size ? planFlyingBills(size.width, size.height, seed) : []),
    [size, seed]
  );

  if (!size) return null;

  return (
    <svg
      aria-hidden="true"
      data-testid="flying-money"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      shapeRendering="crispEdges"
      style={{ position: 'fixed', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}
    >
      {bills.map((bill) => (
        <WingedBill key={bill.id} bill={bill} reducedMotion={reducedMotion} />
      ))}
    </svg>
  );
}
