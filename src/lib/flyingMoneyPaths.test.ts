import { describe, expect, it } from 'vitest';

import { billCountFor, planFlyingBills } from './flyingMoneyPaths';
import {
  MONEY_BILL_LAYERS,
  MONEY_SPRITE_HEIGHT,
  MONEY_SPRITE_WIDTH,
  MONEY_WING_LAYERS,
  spriteRowsToLayers,
} from './pixelMoneySprite';
import spriteData from './pixelMoneySprite.json';

describe('planFlyingBills', () => {
  it('scales the flock with the screen, within sane bounds', () => {
    expect(billCountFor(390, 844)).toBe(4);
    expect(billCountFor(1280, 720)).toBe(5);
    expect(billCountFor(3840, 2160)).toBe(10);
  });

  it('is deterministic for a seed', () => {
    expect(planFlyingBills(1280, 720, 11)).toEqual(planFlyingBills(1280, 720, 11));
    expect(planFlyingBills(1280, 720, 11)).not.toEqual(planFlyingBills(1280, 720, 12));
  });

  it('plans closed loops with positive timings, far bills first', () => {
    const bills = planFlyingBills(1280, 720, 3);
    expect(bills).toHaveLength(billCountFor(1280, 720));
    bills.forEach((bill, index) => {
      expect(bill.path).toMatch(/^M-?[\d.]+ -?[\d.]+(C(-?[\d.]+ ?){6})+$/);
      expect(bill.duration).toBeGreaterThanOrEqual(30);
      expect(bill.lapOffset).toBeGreaterThanOrEqual(0);
      expect(bill.lapOffset).toBeLessThanOrEqual(bill.duration);
      expect(bill.flapPeriod).toBeGreaterThan(0);
      if (index > 0) expect(bill.scale).toBeGreaterThanOrEqual(bills[index - 1].scale);
    });
  });
});

describe('money sprite', () => {
  const frames = [
    ['bill', spriteData.bill],
    ['wings up', spriteData.wings.up],
    ['wings mid', spriteData.wings.mid],
    ['wings down', spriteData.wings.down],
  ] as const;

  it.each(frames)('%s is a full, left-right symmetric grid on the sprite palette', (_name, rows) => {
    expect(rows).toHaveLength(MONEY_SPRITE_HEIGHT);
    for (const row of rows) {
      expect(row).toHaveLength(MONEY_SPRITE_WIDTH);
      expect(row).toBe([...row].reverse().join(''));
      for (const char of row) {
        expect(char === '.' || char in spriteData.palette).toBe(true);
      }
    }
  });

  it('keeps wings and bill on separate pixels so they can animate independently', () => {
    for (const wings of Object.values(spriteData.wings)) {
      wings.forEach((row, y) => {
        [...row].forEach((char, x) => {
          if (char !== '.') expect(spriteData.bill[y][x]).toBe('.');
        });
      });
    }
  });

  it('turns rows into per-colour path layers', () => {
    expect(spriteRowsToLayers(['bbo', 'o..'])).toEqual([
      { color: spriteData.palette.b, d: 'M0 0h2v1h-2z' },
      { color: spriteData.palette.o, d: 'M2 0h1v1h-1zM0 1h1v1h-1z' },
    ]);
    expect(spriteRowsToLayers(['xx.'])).toEqual([]);
    expect(MONEY_BILL_LAYERS.length).toBeGreaterThan(0);
    expect(MONEY_WING_LAYERS.up.length).toBeGreaterThan(0);
    for (const layer of [...MONEY_BILL_LAYERS, ...MONEY_WING_LAYERS.down]) {
      expect(layer.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(layer.d).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
    }
  });
});
