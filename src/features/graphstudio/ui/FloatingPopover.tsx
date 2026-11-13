/**
 * Viewport-aware Portal Popover for Sidebar & Toolbar Menus.
 *
 * Renders into `document.body` via `createPortal` so menus inside scrollable containers
 * (`<aside class="overflow-y-auto">`) are never clipped, automatically flipping above or
 * below the anchor element and clamping within 320px+ viewports and mobile virtual keyboards.
 */
import type { AriaRole, ComponentChildren, CSSProperties, JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface FloatingPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  align?: 'left' | 'right';
  preferredWidthPx?: number;
  matchAnchorWidth?: boolean;
  role?: AriaRole;
  ariaLabel?: string;
  testId?: string;
  class?: string;
  children: ComponentChildren;
}

interface PopoverCoords {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
  width?: number;
}

export function computePopoverPosition(params: {
  anchorRect: { top: number; bottom: number; left: number; right: number; width: number };
  viewportWidth: number;
  viewportHeight: number;
  viewportOffsetTop?: number;
  viewportOffsetLeft?: number;
  layoutViewportHeight?: number;
  align: 'left' | 'right';
  menuWidth: number;
  matchAnchorWidth?: boolean;
}): PopoverCoords {
  const {
    anchorRect,
    viewportWidth,
    viewportHeight,
    viewportOffsetTop = 0,
    viewportOffsetLeft = 0,
    layoutViewportHeight = viewportOffsetTop + viewportHeight,
    align,
    menuWidth,
    matchAnchorWidth = false,
  } = params;

  const margin = 8;
  const gap = 4;
  const effectiveWidth = Math.min(
    matchAnchorWidth ? Math.max(anchorRect.width, 180) : menuWidth,
    Math.max(160, viewportWidth - margin * 2)
  );

  const minLeft = viewportOffsetLeft + margin;
  const maxLeft = Math.max(minLeft, viewportOffsetLeft + viewportWidth - effectiveWidth - margin);

  const rawLeft =
    align === 'right' ? anchorRect.right - effectiveWidth : anchorRect.left;
  const left = Math.min(Math.max(rawLeft, minLeft), maxLeft);

  const vpTop = viewportOffsetTop + margin;
  const vpBottom = viewportOffsetTop + viewportHeight - margin;
  const spaceBelow = vpBottom - (anchorRect.bottom + gap);
  const spaceAbove = anchorRect.top - gap - vpTop;

  const shouldFlipUp = spaceBelow < 210 && spaceAbove > spaceBelow;

  if (shouldFlipUp) {
    const rawAbove = Math.floor(spaceAbove);
    return {
      bottom: Math.max(margin, layoutViewportHeight - anchorRect.top + gap),
      left,
      maxHeight: rawAbove >= 120 ? rawAbove : Math.max(64, rawAbove),
      width: matchAnchorWidth ? effectiveWidth : undefined,
    };
  }

  const rawBelow = Math.floor(spaceBelow);
  return {
    top: Math.max(vpTop, anchorRect.bottom + gap),
    left,
    maxHeight: rawBelow >= 120 ? rawBelow : Math.max(64, rawBelow),
    width: matchAnchorWidth ? effectiveWidth : undefined,
  };
}

export function FloatingPopover({
  open,
  anchorEl,
  onClose,
  align = 'left',
  preferredWidthPx = 240,
  matchAnchorWidth = false,
  role = 'menu',
  ariaLabel,
  testId,
  class: className = '',
  children,
}: FloatingPopoverProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorEl || typeof window === 'undefined') {
      setCoords(null);
      return;
    }

    const update = (): void => {
      if (!anchorEl.isConnected) {
        onClose();
        return;
      }
      const anchorRect = anchorEl.getBoundingClientRect();
      const vv = window.visualViewport;
      const measuredWidth = menuRef.current?.offsetWidth || preferredWidthPx;

      setCoords(
        computePopoverPosition({
          anchorRect,
          viewportWidth: vv ? vv.width : window.innerWidth,
          viewportHeight: vv ? vv.height : window.innerHeight,
          viewportOffsetTop: vv ? vv.offsetTop : 0,
          viewportOffsetLeft: vv ? vv.offsetLeft : 0,
          layoutViewportHeight: window.innerHeight,
          align,
          menuWidth: measuredWidth,
          matchAnchorWidth,
        })
      );
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, anchorEl, align, preferredWidthPx, matchAnchorWidth, onClose]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const handlePointerDown = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || anchorEl?.contains(target)) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchorEl?.focus();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, anchorEl, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const style: CSSProperties = coords
    ? {
        position: 'fixed',
        top: coords.top !== undefined ? `${coords.top}px` : undefined,
        bottom: coords.bottom !== undefined ? `${coords.bottom}px` : undefined,
        left: `${coords.left}px`,
        maxHeight: `${coords.maxHeight}px`,
        width: coords.width !== undefined ? `${coords.width}px` : undefined,
        maxWidth: 'calc(100vw - 16px)',
      }
    : {
        position: 'fixed',
        top: '-9999px',
        left: '-9999px',
      };

  return createPortal(
    <div
      ref={menuRef}
      role={role}
      aria-label={ariaLabel}
      data-testid={testId}
      style={style}
      onClick={(e) => e.stopPropagation()}
      class={`z-50 overflow-y-auto overscroll-contain rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-2xl ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}
