import spriteData from './pixelMoneySprite.json';

/**
 * The winged-money sprite (a pixel-art 💸) shared by the 404 page and the
 * favicon. The art lives in `pixelMoneySprite.json` as palette-keyed ASCII
 * rows so `scripts/generate-favicon.mjs` can read the very same data.
 */

export interface SpriteLayer {
  color: string;
  /** SVG path data made of one-pixel-high runs, in sprite pixel units. */
  d: string;
}

export type WingFrame = 'up' | 'mid' | 'down';

export const MONEY_SPRITE_WIDTH: number = spriteData.width;
export const MONEY_SPRITE_HEIGHT: number = spriteData.height;

const PALETTE: Record<string, string> = spriteData.palette;

/** Merges each row's horizontal runs per palette colour into path layers. */
export function spriteRowsToLayers(rows: readonly string[]): SpriteLayer[] {
  const pathByColor = new Map<string, string>();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === key) end += 1;
      const color = PALETTE[key];
      if (color) {
        pathByColor.set(color, `${pathByColor.get(color) ?? ''}M${x} ${y}h${end - x}v1h-${end - x}z`);
      }
      x = end;
    }
  });
  return [...pathByColor.entries()].map(([color, d]) => ({ color, d }));
}

export const MONEY_BILL_LAYERS: SpriteLayer[] = spriteRowsToLayers(spriteData.bill);

export const MONEY_WING_LAYERS: Record<WingFrame, SpriteLayer[]> = {
  up: spriteRowsToLayers(spriteData.wings.up),
  mid: spriteRowsToLayers(spriteData.wings.mid),
  down: spriteRowsToLayers(spriteData.wings.down),
};

/** Wing frames in one flap cycle: up, glide, down, glide. */
export const WING_FLAP_SEQUENCE: readonly WingFrame[] = ['up', 'mid', 'down', 'mid'];
