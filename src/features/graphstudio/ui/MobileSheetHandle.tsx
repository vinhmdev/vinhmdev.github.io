/**
 * Bottom-sheet handle for the compact layout (< 1024px).
 *
 * One full-width control: tap toggles the sheet, swipe down closes it, swipe up opens it.
 * A centered grabber bar with a small chevron beside it pointing the way the sheet will
 * move (down while open, up while collapsed). No text; state is exposed via aria-expanded.
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { t } from '../scripts/i18n-client';
import { IconChevronDown } from './icons';
import { resolveSheetGesture } from './mobile-sheet-gesture';

interface MobileSheetHandleProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function MobileSheetHandle({
  isOpen,
  onOpenChange,
}: MobileSheetHandleProps): JSX.Element {
  const pressYRef = useRef<number | null>(null);
  // When a swipe already decided the outcome, the click that follows must not toggle again.
  const swipeHandledRef = useRef<boolean>(false);

  const handlePointerDown = (e: PointerEvent): void => {
    pressYRef.current = e.clientY;
    swipeHandledRef.current = false;
    (e.currentTarget as HTMLButtonElement | null)?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerUp = (e: PointerEvent): void => {
    if (pressYRef.current === null) return;
    const action = resolveSheetGesture(e.clientY - pressYRef.current, isOpen);
    pressYRef.current = null;
    // Taps fall through to onClick so mouse, touch and keyboard share one toggle path.
    if (action === 'toggle') return;
    swipeHandledRef.current = true;
    if (action === 'open') onOpenChange(true);
    if (action === 'close') onOpenChange(false);
  };

  const handleClick = (): void => {
    if (swipeHandledRef.current) {
      swipeHandledRef.current = false;
      return;
    }
    onOpenChange(!isOpen);
  };

  return (
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
      class="group w-full grid grid-cols-[1fr_auto_1fr] items-center py-1.5 touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500/60"
    >
      {/* Bar sits in the middle column so it stays exactly centered; the chevron hangs off its right. */}
      <span
        aria-hidden="true"
        class="col-start-2 block w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-600 transition-colors duration-200 group-hover:bg-neutral-400 group-active:bg-neutral-400 dark:group-hover:bg-neutral-500 dark:group-active:bg-neutral-500 motion-reduce:transition-none"
      />
      <span
        aria-hidden="true"
        class={`col-start-3 justify-self-start ml-1.5 text-neutral-400 dark:text-neutral-500 transition-[rotate,color] duration-200 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 motion-reduce:transition-none ${
          isOpen ? '' : 'rotate-180'
        }`}
      >
        <IconChevronDown class="w-3.5 h-3.5" />
      </span>
    </button>
  );
}
