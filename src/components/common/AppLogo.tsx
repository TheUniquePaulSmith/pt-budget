'use client';

import React from 'react';
import { useMediaQuery } from '@mui/material';

import { MONEY_SPRITE_HEIGHT, MONEY_SPRITE_WIDTH } from '@/lib/pixelMoneySprite';

import WingedMoneySprite from './WingedMoneySprite';

interface AppLogoProps {
  /** Screen pixels per sprite pixel; whole numbers keep the pixel art crisp. */
  scale?: number;
  /** Accessible name. Leave out when text next to the logo already says it. */
  title?: string;
  /** Flap and bob. Visitors who prefer reduced motion keep the flap but lose the bob. */
  animated?: boolean;
  style?: React.CSSProperties;
}

// One sprite pixel of headroom above and below so the bob never clips.
const HEADROOM = 1;
const BOB = 0.5;

/** The winged-money (💸) app logo: the favicon art, gently flapping and bobbing. */
export default function AppLogo({ scale = 2, title, animated = true, style }: AppLogoProps) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const bobbing = animated && !prefersReducedMotion;
  const viewHeight = MONEY_SPRITE_HEIGHT + HEADROOM * 2;

  return (
    <svg
      data-testid="app-logo"
      data-animated={String(animated)}
      viewBox={`0 ${-HEADROOM} ${MONEY_SPRITE_WIDTH} ${viewHeight}`}
      width={MONEY_SPRITE_WIDTH * scale}
      height={viewHeight * scale}
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <g>
        {bobbing && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`0 ${BOB};0 ${-BOB};0 ${BOB}`}
            dur="2.4s"
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.5;1"
            keySplines=".45 0 .55 1;.45 0 .55 1"
          />
        )}
        <WingedMoneySprite animated={animated} flapPeriod={1.1} />
      </g>
    </svg>
  );
}
