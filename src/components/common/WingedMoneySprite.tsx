import React from 'react';

import {
  MONEY_BILL_LAYERS,
  MONEY_WING_LAYERS,
  WING_FLAP_SEQUENCE,
  type SpriteLayer,
  type WingFrame,
} from '@/lib/pixelMoneySprite';

interface WingedMoneySpriteProps {
  /** Flip through the wing frames; when false the wings hold `restingFrame`. */
  animated: boolean;
  /** Seconds per flap cycle. */
  flapPeriod: number;
  /** Seconds to shift the cycle by, so a flock does not flap in unison. */
  flapOffset?: number;
  restingFrame?: WingFrame;
}

const WING_FRAMES: WingFrame[] = ['up', 'mid', 'down'];
const FLAP_KEY_TIMES = WING_FLAP_SEQUENCE.map((_, index) => (index / WING_FLAP_SEQUENCE.length).toFixed(2)).join(';');

function Layers({ layers }: { layers: SpriteLayer[] }) {
  return (
    <>
      {layers.map((layer) => (
        <path key={layer.color} d={layer.d} fill={layer.color} />
      ))}
    </>
  );
}

/**
 * The pixel-art 💸 as SVG content in sprite coordinates (16 x 12 units), for
 * placing inside an `<svg>`. The flap is a stop-motion SMIL animation (up,
 * glide, down, glide) that shows one wing frame at a time, so there is no
 * JavaScript per frame. Shared by the 404 flock and the app logo.
 */
export default function WingedMoneySprite({
  animated,
  flapPeriod,
  flapOffset = 0,
  restingFrame = 'up',
}: WingedMoneySpriteProps) {
  return (
    <>
      {WING_FRAMES.map((frame) => (
        <g
          key={frame}
          visibility={frame === (animated ? WING_FLAP_SEQUENCE[0] : restingFrame) ? 'visible' : 'hidden'}
        >
          {animated && (
            <animate
              attributeName="visibility"
              calcMode="discrete"
              dur={`${flapPeriod}s`}
              begin={`${-flapOffset}s`}
              repeatCount="indefinite"
              keyTimes={FLAP_KEY_TIMES}
              values={WING_FLAP_SEQUENCE.map((step) => (step === frame ? 'visible' : 'hidden')).join(';')}
            />
          )}
          <Layers layers={MONEY_WING_LAYERS[frame]} />
        </g>
      ))}
      <Layers layers={MONEY_BILL_LAYERS} />
    </>
  );
}
