'use client';

/**
 * Opens the account details card from a trigger element: on hover (after a
 * short delay), on keyboard focus, and on click / tap / Enter / Space, which
 * pins it until a press elsewhere, a second click or Escape. A card closed by
 * a second click or Escape stays closed while the pointer rests on the trigger.
 *
 * A tooltip rather than a popover: no backdrop and no focus trap, so it is
 * safe inside a grid cell or a dialog. The card is the trigger's description
 * (`describeChild`), so the trigger keeps its own accessible name.
 */

import React, { cloneElement, useEffect, useRef, useState } from 'react';
import { Tooltip, type TooltipProps } from '@mui/material';

import type { AccountLabelSource } from '@/lib/accountLabels';
import type { User } from '@/types/database';

import AccountDetailsCard from './AccountDetailsCard';

/** A touch held this long is a long-press (the grids open their row menu on it), not a tap on the label. */
const LONG_TOUCH_MS = 450;
const HOVER_DELAY_MS = 400;

interface TriggerProps {
  ref?: React.Ref<HTMLElement>;
  onClick?: React.MouseEventHandler<HTMLElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLElement>;
  onBlur?: React.FocusEventHandler<HTMLElement>;
  onTouchStart?: React.TouchEventHandler<HTMLElement>;
  onTouchEnd?: React.TouchEventHandler<HTMLElement>;
}

export interface AccountDetailsTooltipProps {
  account: AccountLabelSource;
  users?: readonly Pick<User, 'id' | 'display_name'>[];
  placement?: TooltipProps['placement'];
  /** A focusable element (a button): it receives the click, key and touch handlers. */
  children: React.ReactElement<TriggerProps>;
}

export default function AccountDetailsTooltip({
  account,
  users,
  placement = 'bottom-start',
  children,
}: AccountDetailsTooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const touchStartedAt = useRef<number | null>(null);
  const skipNextClick = useRef(false);
  // Closed on purpose (Escape, a second click): the pointer still resting on the trigger does not
  // bring the card back; hovering opens it again once the pointer or the focus has left.
  const dismissed = useRef(false);
  const open = hovered || pinned;

  const close = () => {
    dismissed.current = true;
    setPinned(false);
    setHovered(false);
  };

  // A pinned card closes on a press anywhere but the trigger and the card itself (its text can be selected).
  useEffect(() => {
    if (!pinned) return undefined;
    const handlePress = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (triggerRef.current?.contains(target) || target.closest('[role="tooltip"]')) return;
      setPinned(false);
    };
    document.addEventListener('mousedown', handlePress);
    document.addEventListener('touchstart', handlePress);
    return () => {
      document.removeEventListener('mousedown', handlePress);
      document.removeEventListener('touchstart', handlePress);
    };
  }, [pinned]);

  const trigger = cloneElement(children, {
    ref: triggerRef,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      children.props.onClick?.(event);
      if (skipNextClick.current) {
        skipNextClick.current = false;
        return;
      }
      if (pinned) {
        close();
      } else {
        dismissed.current = false;
        setPinned(true);
      }
    },
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
      children.props.onMouseLeave?.(event);
      dismissed.current = false;
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(event);
      dismissed.current = false;
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      children.props.onKeyDown?.(event);
      if (event.key === 'Escape') {
        if (!open) return;
        // The card closes; a dialog around the label stays open.
        event.stopPropagation();
        close();
        return;
      }
      // A data grid treats Space and Enter on a cell as its own keys.
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    },
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
      children.props.onTouchStart?.(event);
      touchStartedAt.current = Date.now();
      skipNextClick.current = false;
    },
    onTouchEnd: (event: React.TouchEvent<HTMLElement>) => {
      children.props.onTouchEnd?.(event);
      const startedAt = touchStartedAt.current;
      touchStartedAt.current = null;
      if (startedAt != null && Date.now() - startedAt >= LONG_TOUCH_MS) skipNextClick.current = true;
    },
  });

  return (
    <Tooltip
      open={open}
      onOpen={() => {
        if (!dismissed.current) setHovered(true);
      }}
      onClose={(event) => {
        setHovered(false);
        // The tooltip's own Escape listener is on the document: it also closes a pinned card.
        if (event.type === 'keydown') {
          dismissed.current = true;
          setPinned(false);
        }
      }}
      title={<AccountDetailsCard account={account} users={users} />}
      placement={placement}
      describeChild
      // A tap pins the card through the click; the tooltip's own long-press would fight the grids' row menu.
      disableTouchListener
      enterDelay={HOVER_DELAY_MS}
      enterNextDelay={HOVER_DELAY_MS}
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: 'background.paper',
            color: 'text.primary',
            border: 1,
            borderColor: 'divider',
            boxShadow: 6,
            p: 1.5,
            maxWidth: 340,
            fontWeight: 'normal',
          },
        },
      }}
    >
      {trigger}
    </Tooltip>
  );
}
