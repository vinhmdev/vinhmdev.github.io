/**
 * Pure gesture resolver for the mobile bottom-sheet handle (kept DOM-free for unit tests).
 *
 * A press that barely moves is a tap and toggles the sheet. A vertical drag past the swipe
 * threshold opens (upward) or closes (downward) it. A short drag in between is ignored so a
 * hesitant thumb does not flip the sheet by accident.
 */

export type SheetGestureAction = 'toggle' | 'open' | 'close' | 'none';

/** Max travel (px) still treated as a tap */
export const SHEET_TAP_SLOP_PX = 8;
/** Min travel (px) treated as a deliberate swipe */
export const SHEET_SWIPE_PX = 24;

export function resolveSheetGesture(deltaY: number, isOpen: boolean): SheetGestureAction {
  if (!Number.isFinite(deltaY)) return 'none';
  const travel = Math.abs(deltaY);
  if (travel <= SHEET_TAP_SLOP_PX) return 'toggle';
  if (travel < SHEET_SWIPE_PX) return 'none';
  if (deltaY > 0) return isOpen ? 'close' : 'none';
  return isOpen ? 'none' : 'open';
}
