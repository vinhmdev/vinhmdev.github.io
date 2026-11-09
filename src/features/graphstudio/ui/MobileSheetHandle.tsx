/**
 * Bottom-sheet handle + peek summary for the compact layout (< 1024px).
 *
 * One full-width control: tap toggles the sheet, swipe down closes it, swipe up opens it.
 * The centered bar bends into a shallow chevron pointing the way the sheet will move
 * (down while open, up while collapsed). No separate Hide/Show text.
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { t } from '../scripts/i18n-client';
import { resolveSheetGesture } from './mobile-sheet-gesture';

interface MobileSheetHandleProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  summary: string;
}

const BEND_DEG = 12;

export function MobileSheetHandle({
  isOpen,
  onOpenChange,
  summary,
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

  // Open: "\/" points down (swipe down to close). Collapsed: "/\" points up (swipe up to open).
  const leftDeg = isOpen ? BEND_DEG : -BEND_DEG;
  const segment =
    'block w-5 h-[5px] rounded-full bg-slate-300 dark:bg-neutral-600 transition-[transform,background-color] duration-200 group-hover:bg-slate-400 group-active:bg-slate-400 dark:group-hover:bg-neutral-500 dark:group-active:bg-neutral-500 motion-reduce:transition-none';

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
      class="group w-full flex flex-col items-center gap-1 pt-2 pb-1.5 touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500/60"
    >
      <span class="flex items-center h-3" aria-hidden="true">
        <span class={`${segment} origin-right`} style={{ transform: `rotate(${leftDeg}deg)` }} />
        <span class={`${segment} origin-left`} style={{ transform: `rotate(${-leftDeg}deg)` }} />
      </span>
      <span class="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">{summary}</span>
    </button>
  );
}
