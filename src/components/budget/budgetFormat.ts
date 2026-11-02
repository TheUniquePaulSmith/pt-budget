import type { BudgetCarryMode } from '@/types/database';

// Money and month formatting for the Budget page goes through
// `useFormatters()`; the carry-mode labels live in `budget:carryMode.*` /
// `budget:carryBadge.*`. Only the chip colours stay here.

export const CARRY_MODE_CHIP_COLORS: Record<BudgetCarryMode, 'default' | 'success' | 'warning' | 'info'> = {
  none: 'default',
  surplus: 'success',
  deficit: 'warning',
  both: 'info',
};
