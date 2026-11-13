/**
 * Pure gesture resolver for the mobile bottom-sheet handle (kept DOM-free for unit tests).
 *
 * A press that barely moves is a tap and toggles the sheet. A vertical drag past the swipe
 * threshold opens (upward) or closes (downward) it. A short drag in between is ignored so a
 * hesitant thumb does not flip the sheet by accident.
 */

export type SheetGestureAction = 'toggle' | 'open' | 'close' | 'none';
export type SheetSnapTier = 'collapsed' | 'half' | 'full';

/** Max travel (px) still treated as a tap */
export const SHEET_TAP_SLOP_PX = 8;
/** Min travel (px) treated as a deliberate swipe */
export const SHEET_SWIPE_PX = 24;
/** Fast/long vertical swipe threshold (px) to jump straight between collapsed and full */
export const SHEET_LARGE_SWIPE_PX = 140;

export function resolveSheetGesture(deltaY: number, isOpen: boolean): SheetGestureAction {
  if (!Number.isFinite(deltaY)) return 'none';
  const travel = Math.abs(deltaY);
  if (travel <= SHEET_TAP_SLOP_PX) return 'toggle';
  if (travel < SHEET_SWIPE_PX) return 'none';
  if (deltaY > 0) return isOpen ? 'close' : 'none';
  return isOpen ? 'none' : 'open';
}

/**
 * 3-tier snap resolver (`collapsed` 30px <-> `half` 40vh <-> `full` 78vh).
 * - Tap (`|deltaY| <= 8px`): toggles `collapsed -> half`, `half -> collapsed`, `full -> half`.
 * - Short drag (`8px < |deltaY| < 24px`): stays on `currentTier`.
 * - Upward swipe (`deltaY <= -24px`): steps up one tier (`collapsed -> half -> full`), or jumps straight to `full` if `<= -140px`.
 * - Downward swipe (`deltaY >= 24px`): steps down one tier (`full -> half -> collapsed`), or collapses straight if `>= 140px`.
 */
export function resolveSheetSnapGesture(
  deltaY: number,
  currentTier: SheetSnapTier
): SheetSnapTier {
  if (!Number.isFinite(deltaY)) return currentTier;
  const travel = Math.abs(deltaY);
  if (travel <= SHEET_TAP_SLOP_PX) {
    if (currentTier === 'collapsed') return 'half';
    if (currentTier === 'full') return 'half';
    return 'collapsed';
  }
  if (travel < SHEET_SWIPE_PX) return currentTier;

  if (deltaY < 0) {
    if (deltaY <= -SHEET_LARGE_SWIPE_PX) return 'full';
    return currentTier === 'collapsed' ? 'half' : 'full';
  }

  if (deltaY >= SHEET_LARGE_SWIPE_PX) return 'collapsed';
  return currentTier === 'full' ? 'half' : 'collapsed';
}
