import React from 'react';

// 5x7 "4" and a 7x7 coin standing in for the zero, drawn one rect per pixel.
const FOUR = ['X...X', 'X...X', 'X...X', 'XXXXX', '....X', '....X', '....X'];
// o = rim, y = face, s = the "$" (an S with its stem poking through the rim).
const COIN = ['..oso..', '.ossso.', 'oysyyyo', 'oysssyo', 'oyyysyo', '.ossso.', '..oso..'];

const GOLD = '#ffd84a';
const GOLD_HIGHLIGHT = '#fff2a8';
const COIN_RIM = '#e0a000';
const COIN_SYMBOL = '#8a4f00';
const SHADOW = '#2a1840';

const GLYPH_GAP = 1;
const COIN_X = FOUR[0].length + GLYPH_GAP;
const SECOND_FOUR_X = COIN_X + COIN[0].length + GLYPH_GAP;
const VIEWBOX_WIDTH = SECOND_FOUR_X + FOUR[0].length + 1;
const VIEWBOX_HEIGHT = FOUR.length + 1;

function fourPixels(offsetX: number, fill: (row: number) => string, offsetY = 0) {
  return FOUR.flatMap((row, y) =>
    [...row].flatMap((cell, x) =>
      cell === 'X'
        ? [<rect key={`${offsetX}-${x}-${y}`} x={offsetX + x} y={offsetY + y} width={1} height={1} fill={fill(y)} />]
        : []
    )
  );
}

function coinPixels(offsetX: number, fillFor: (cell: string) => string | null, offsetY = 0) {
  return COIN.flatMap((row, y) =>
    [...row].flatMap((cell, x) => {
      const fill = cell === '.' ? null : fillFor(cell);
      return fill ? [<rect key={`c-${x}-${y}`} x={offsetX + x} y={offsetY + y} width={1} height={1} fill={fill} />] : [];
    })
  );
}

/** The "404" headline as pixel art, with a coin for the zero. Decorative and deliberately still. */
export default function PixelFourOhFour() {
  return (
    <svg
      aria-hidden="true"
      data-testid="pixel-404"
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      shapeRendering="crispEdges"
      style={{ width: 'min(72vw, 440px)', height: 'auto', overflow: 'visible' }}
    >
      <g opacity={0.9}>
        {fourPixels(1, () => SHADOW, 1)}
        {coinPixels(COIN_X + 1, () => SHADOW, 1)}
        {fourPixels(SECOND_FOUR_X + 1, () => SHADOW, 1)}
      </g>
      {fourPixels(0, (row) => (row === 0 ? GOLD_HIGHLIGHT : GOLD))}
      {coinPixels(COIN_X, (cell) => (cell === 'y' ? GOLD : cell === 's' ? COIN_SYMBOL : COIN_RIM))}
      {fourPixels(SECOND_FOUR_X, (row) => (row === 0 ? GOLD_HIGHLIGHT : GOLD))}
    </svg>
  );
}
