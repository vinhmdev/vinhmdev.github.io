import { describe, expect, it } from 'vitest';
import {
  SHEET_SWIPE_PX,
  SHEET_TAP_SLOP_PX,
  resolveSheetGesture,
} from '../ui/mobile-sheet-gesture';

describe('mobile bottom-sheet handle gesture', () => {
  it('treats a press within the tap slop as a toggle in both states', () => {
    expect(resolveSheetGesture(0, true)).toBe('toggle');
    expect(resolveSheetGesture(SHEET_TAP_SLOP_PX, false)).toBe('toggle');
    expect(resolveSheetGesture(-SHEET_TAP_SLOP_PX, true)).toBe('toggle');
  });

  it('closes an open sheet on a downward swipe and opens a closed one on an upward swipe', () => {
    expect(resolveSheetGesture(SHEET_SWIPE_PX, true)).toBe('close');
    expect(resolveSheetGesture(-SHEET_SWIPE_PX, false)).toBe('open');
    expect(resolveSheetGesture(180, true)).toBe('close');
  });

  it('ignores swipes toward the state the sheet is already in', () => {
    expect(resolveSheetGesture(SHEET_SWIPE_PX + 10, false)).toBe('none');
    expect(resolveSheetGesture(-(SHEET_SWIPE_PX + 10), true)).toBe('none');
  });

  it('ignores hesitant drags between the tap slop and the swipe threshold', () => {
    expect(resolveSheetGesture(SHEET_TAP_SLOP_PX + 1, true)).toBe('none');
    expect(resolveSheetGesture(-(SHEET_SWIPE_PX - 1), false)).toBe('none');
  });

  it('ignores non-finite input', () => {
    expect(resolveSheetGesture(Number.NaN, true)).toBe('none');
  });
});
