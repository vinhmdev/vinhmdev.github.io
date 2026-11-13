/**
 * 3-Tier Bottom-Sheet Handle for compact layouts (< 1024px).
 *
 * Supports three snap tiers:
 * - `collapsed` (~30px handle bar only)
 * - `half` (~40vh default split view)
 * - `full` (~78vh spacious formula editing & drag-reordering)
 *
 * Users can swipe up/down across tiers, tap the center grabber to toggle open/collapse,
 * or tap the right height pill (`40%` / `78%`) to jump directly between half and full height.
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { t } from '../scripts/i18n-client';
import { IconChevronDown, IconMaximize, IconMinimize } from './icons';
import {
  resolveSheetSnapGesture,
  SHEET_TAP_SLOP_PX,
  type SheetSnapTier,
} from './mobile-sheet-gesture';

interface MobileSheetHandleProps {
  tier: SheetSnapTier;
  onTierChange: (tier: SheetSnapTier) => void;
}

export function MobileSheetHandle({
  tier,
  onTierChange,
}: MobileSheetHandleProps): JSX.Element {
  const isOpen = tier !== 'collapsed';
  const pressYRef = useRef<number | null>(null);
  // When a swipe already decided the outcome, the click that follows must not toggle again.
  const swipeHandledRef = useRef<boolean>(false);

  const handlePointerDown = (e: PointerEvent): void => {
    pressYRef.current = e.clientY;
    swipeHandledRef.current = false;
    try {
      (e.currentTarget as HTMLButtonElement | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore synthetic pointerId in tests */
    }
  };

  const handlePointerUp = (e: PointerEvent): void => {
    if (pressYRef.current === null) return;
    const deltaY = e.clientY - pressYRef.current;
    pressYRef.current = null;
    // Taps fall through to onClick so mouse, touch and keyboard share one toggle path.
    if (Math.abs(deltaY) <= SHEET_TAP_SLOP_PX) return;
    swipeHandledRef.current = true;
    const nextTier = resolveSheetSnapGesture(deltaY, tier);
    if (nextTier !== tier) {
      onTierChange(nextTier);
    }
  };

  const handleClick = (): void => {
    if (swipeHandledRef.current) {
      swipeHandledRef.current = false;
      return;
    }
    onTierChange(resolveSheetSnapGesture(0, tier));
  };

  return (
    <div class="w-full h-[30px] flex items-center px-1.5 select-none">
      <div class="w-7 shrink-0" aria-hidden="true" />
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={isOpen ? t('sheet_collapse') : t('sheet_expand')}
        title={isOpen ? t('sheet_collapse') : t('sheet_expand')}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pressYRef.current = null;
        }}
        onClick={handleClick}
        class="group flex-1 h-full flex items-center justify-center gap-1.5 touch-none cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500/60"
      >
        <span
          aria-hidden="true"
          class="block w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-600 transition-colors duration-200 group-hover:bg-neutral-400 group-active:bg-neutral-400 dark:group-hover:bg-neutral-500 dark:group-active:bg-neutral-500 motion-reduce:transition-none"
        />
        <span
          aria-hidden="true"
          class={`text-neutral-400 dark:text-neutral-500 transition-[rotate,color] duration-200 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 motion-reduce:transition-none ${
            isOpen ? '' : 'rotate-180'
          }`}
        >
          <IconChevronDown class="w-3.5 h-3.5" />
        </span>
      </button>

      {isOpen ? (
        <button
          type="button"
          onClick={() => onTierChange(tier === 'full' ? 'half' : 'full')}
          aria-pressed={tier === 'full'}
          aria-label={tier === 'full' ? t('sheet_half') : t('sheet_full')}
          title={tier === 'full' ? t('sheet_half') : t('sheet_full')}
          class={`w-7 h-6 shrink-0 flex items-center justify-center rounded border transition-colors ${
            tier === 'full'
              ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/40'
              : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-orange-500'
          }`}
        >
          {tier === 'full' ? (
            <IconMinimize class="w-3 h-3" />
          ) : (
            <IconMaximize class="w-3 h-3" />
          )}
        </button>
      ) : (
        <div class="w-7 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}
