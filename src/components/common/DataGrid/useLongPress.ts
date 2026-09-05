'use client';

import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

export interface LongPressPoint {
  clientX: number;
  clientY: number;
  target: HTMLElement;
}

/**
 * Touch handlers that fire `onLongPress` when a finger rests on an element for
 * `delayMs` without moving more than `moveTolerancePx`. The phone equivalent of
 * right-click for opening a row's context menu; spread the returned handlers
 * onto the element (works alongside a separate onContextMenu for mice).
 */
export function useLongPress(
  onLongPress: (point: LongPressPoint) => void,
  { delayMs = 500, moveTolerancePx = 10 }: { delayMs?: number; moveTolerancePx?: number } = {}
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const onTouchStart = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      const target = event.currentTarget;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      clear();
      startRef.current = { x: touch.clientX, y: touch.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onLongPress({ clientX: touch.clientX, clientY: touch.clientY, target });
      }, delayMs);
    },
    [clear, delayMs, onLongPress]
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      const start = startRef.current;
      if (!touch || !start) return;
      if (Math.abs(touch.clientX - start.x) > moveTolerancePx || Math.abs(touch.clientY - start.y) > moveTolerancePx) {
        clear(); // the finger is scrolling, not pressing
      }
    },
    [clear, moveTolerancePx]
  );

  return { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear };
}
