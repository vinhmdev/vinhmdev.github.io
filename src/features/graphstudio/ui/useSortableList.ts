/**
 * 60fps Pointer-Events Sortable List Hook with Tap-vs-Drag Disambiguation (6px threshold),
 * Edge Auto-Scroll inside scrollable `<aside>`, and Alt+ArrowUp / Alt+ArrowDown Accessibility.
 */
import type { CSSProperties } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/** Travel <= 6px is treated as a Tap/Click; > 6px activates 60fps Drag Reordering */
export const TAP_DRAG_THRESHOLD_PX = 6;
/** Distance from top/bottom of scroll container that triggers continuous edge auto-scroll */
export const EDGE_AUTOSCROLL_ZONE_PX = 36;
/** Peak auto-scroll speed per animation frame */
export const MAX_AUTOSCROLL_PX_PER_FRAME = 10;

export interface ItemBoxSnapshot {
  top: number;
  height: number;
}

export function isDragExceeded(deltaY: number): boolean {
  return Number.isFinite(deltaY) && Math.abs(deltaY) > TAP_DRAG_THRESHOLD_PX;
}

export function computeAutoScrollDelta(
  pointerY: number,
  containerTop: number,
  containerBottom: number
): number {
  if (!Number.isFinite(pointerY) || containerBottom - containerTop < EDGE_AUTOSCROLL_ZONE_PX * 2) {
    return 0;
  }
  const distFromTop = pointerY - containerTop;
  if (distFromTop >= 0 && distFromTop < EDGE_AUTOSCROLL_ZONE_PX) {
    const ratio = 1 - distFromTop / EDGE_AUTOSCROLL_ZONE_PX;
    return -Math.max(1.5, ratio * MAX_AUTOSCROLL_PX_PER_FRAME);
  }
  const distFromBottom = containerBottom - pointerY;
  if (distFromBottom >= 0 && distFromBottom < EDGE_AUTOSCROLL_ZONE_PX) {
    const ratio = 1 - distFromBottom / EDGE_AUTOSCROLL_ZONE_PX;
    return Math.max(1.5, ratio * MAX_AUTOSCROLL_PX_PER_FRAME);
  }
  return 0;
}

export function computeDropTargetIndex(
  draggedCenterY: number,
  fromIndex: number,
  itemBoxes: readonly ItemBoxSnapshot[]
): number {
  const len = itemBoxes.length;
  if (len <= 1 || fromIndex < 0 || fromIndex >= len) return Math.max(0, fromIndex);

  const fromBox = itemBoxes[fromIndex];
  const fromCenterY = fromBox.top + fromBox.height * 0.5;
  let target = fromIndex;
  if (draggedCenterY > fromCenterY) {
    const draggedBottomY = draggedCenterY + fromBox.height * 0.5;
    for (let i = fromIndex + 1; i < len; i++) {
      const mid = itemBoxes[i].top + itemBoxes[i].height * 0.5;
      if (draggedBottomY >= mid) {
        target = i;
      } else {
        break;
      }
    }
  } else if (draggedCenterY < fromCenterY) {
    const draggedTopY = draggedCenterY - fromBox.height * 0.5;
    for (let i = fromIndex - 1; i >= 0; i--) {
      const mid = itemBoxes[i].top + itemBoxes[i].height * 0.5;
      if (draggedTopY <= mid) {
        target = i;
      } else {
        break;
      }
    }
  }
  return target;
}

export function computeSiblingShiftPx(
  index: number,
  fromIndex: number,
  targetIndex: number,
  draggedSpanPx: number
): number {
  if (index === fromIndex || fromIndex === targetIndex) return 0;
  if (fromIndex < targetIndex && index > fromIndex && index <= targetIndex) {
    return -draggedSpanPx;
  }
  if (fromIndex > targetIndex && index >= targetIndex && index < fromIndex) {
    return draggedSpanPx;
  }
  return 0;
}

export interface SortableDragVisualState {
  activeId: string;
  fromIndex: number;
  targetIndex: number;
  translateY: number;
  draggedSpanPx: number;
}

interface ActivePointerSession {
  pointerId: number;
  id: string;
  fromIndex: number;
  startClientY: number;
  latestClientY: number;
  startScrollTop: number;
  scrollContainer: HTMLElement | null;
  initialBoxes: ItemBoxSnapshot[];
  draggedSpanPx: number;
  dragging: boolean;
  targetIndex: number;
}

export interface UseSortableListOptions {
  ids: readonly string[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onMoveByDelta: (id: string, dir: -1 | 1) => void;
  onDragStart?: (id: string) => void;
}

export interface SortableItemBind {
  ref: (el: HTMLElement | null) => void;
  style: CSSProperties | undefined;
  isDragging: boolean;
  dropIndicator: 'above' | 'below' | null;
  onKeyDown: (e: KeyboardEvent) => void;
}

export interface SortableHandleBind {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  onClick: (e: MouseEvent) => void;
}

export function useSortableList({
  ids,
  onReorder,
  onMoveByDelta,
  onDragStart,
}: UseSortableListOptions): {
  dragState: SortableDragVisualState | null;
  getItemBind: (id: string, index: number) => SortableItemBind;
  getHandleBind: (
    id: string,
    index: number,
    onTap?: (e: MouseEvent) => void
  ) => SortableHandleBind;
} {
  const itemElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const sessionRef = useRef<ActivePointerSession | null>(null);
  const rafRef = useRef<number>(0);
  const suppressNextClickIdRef = useRef<string | null>(null);
  const [dragState, setDragState] = useState<SortableDragVisualState | null>(null);

  const stopAutoScroll = useCallback((): void => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  useEffect(() => {
    return () => stopAutoScroll();
  }, [stopAutoScroll]);

  const updateDragGeometry = useCallback((sess: ActivePointerSession): void => {
    const baseBox = sess.initialBoxes[sess.fromIndex];
    if (!baseBox) return;
    const currentScrollTop = sess.scrollContainer ? sess.scrollContainer.scrollTop : 0;
    const scrollDelta = currentScrollTop - sess.startScrollTop;
    const translateY = sess.latestClientY - sess.startClientY + scrollDelta;
    const draggedCenterInInitialSpace =
      baseBox.top + baseBox.height * 0.5 + translateY;
    const targetIndex = computeDropTargetIndex(
      draggedCenterInInitialSpace,
      sess.fromIndex,
      sess.initialBoxes
    );
    sess.targetIndex = targetIndex;
    setDragState({
      activeId: sess.id,
      fromIndex: sess.fromIndex,
      targetIndex,
      translateY,
      draggedSpanPx: sess.draggedSpanPx,
    });
  }, []);

  const startAutoScrollLoop = useCallback((): void => {
    if (rafRef.current) return;
    const step = (): void => {
      const sess = sessionRef.current;
      if (!sess || !sess.dragging) {
        rafRef.current = 0;
        return;
      }
      const sc = sess.scrollContainer;
      if (sc) {
        const scRect = sc.getBoundingClientRect();
        const delta = computeAutoScrollDelta(sess.latestClientY, scRect.top, scRect.bottom);
        if (delta !== 0) {
          const prevScroll = sc.scrollTop;
          sc.scrollTop = Math.max(
            0,
            Math.min(sc.scrollHeight - sc.clientHeight, prevScroll + delta)
          );
          if (sc.scrollTop !== prevScroll) {
            updateDragGeometry(sess);
          }
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [updateDragGeometry]);

  const getItemBind = useCallback(
    (id: string, index: number): SortableItemBind => {
      const isDragging = dragState?.activeId === id;
      let style: CSSProperties | undefined;
      let dropIndicator: 'above' | 'below' | null = null;

      if (dragState) {
        if (isDragging) {
          style = {
            transform: `translate3d(0, ${Math.round(dragState.translateY)}px, 0)`,
            zIndex: 30,
            position: 'relative',
          };
        } else {
          const shift = computeSiblingShiftPx(
            index,
            dragState.fromIndex,
            dragState.targetIndex,
            dragState.draggedSpanPx
          );
          style = {
            transform: shift !== 0 ? `translate3d(0, ${Math.round(shift)}px, 0)` : undefined,
            transition: 'transform 140ms cubic-bezier(0.2, 0, 0, 1)',
          };
          if (dragState.targetIndex !== dragState.fromIndex && index === dragState.targetIndex) {
            dropIndicator = dragState.fromIndex < dragState.targetIndex ? 'below' : 'above';
          }
        }
      }

      return {
        ref: (el: HTMLElement | null) => {
          if (el) itemElsRef.current.set(id, el);
          else itemElsRef.current.delete(id);
        },
        style,
        isDragging,
        dropIndicator,
        onKeyDown: (e: KeyboardEvent) => {
          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
          e.preventDefault();
          e.stopPropagation();
          const dir: -1 | 1 = e.key === 'ArrowUp' ? -1 : 1;
          const activeEl = document.activeElement as HTMLElement | null;
          onMoveByDelta(id, dir);
          requestAnimationFrame(() => {
            if (activeEl && activeEl.isConnected) {
              activeEl.focus({ preventScroll: false });
            } else {
              itemElsRef.current.get(id)?.focus();
            }
          });
        },
      };
    },
    [dragState, onMoveByDelta]
  );

  const getHandleBind = useCallback(
    (id: string, index: number, onTap?: (e: MouseEvent) => void): SortableHandleBind => {
      return {
        onPointerDown: (e: PointerEvent) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          const handleEl = e.currentTarget as HTMLElement | null;
          const scrollContainer = handleEl?.closest('aside') as HTMLElement | null;
          const startScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

          const initialBoxes: ItemBoxSnapshot[] = ids.map((itemId) => {
            const el = itemElsRef.current.get(itemId);
            if (!el) return { top: 0, height: 48 };
            const r = el.getBoundingClientRect();
            return { top: r.top + startScrollTop, height: r.height };
          });

          const currBox = initialBoxes[index] ?? { top: 0, height: 48 };
          let gapPx = 8;
          if (index + 1 < initialBoxes.length) {
            gapPx = Math.max(
              0,
              initialBoxes[index + 1].top - (currBox.top + currBox.height)
            );
          } else if (index > 0) {
            const prev = initialBoxes[index - 1];
            gapPx = Math.max(0, currBox.top - (prev.top + prev.height));
          }

          sessionRef.current = {
            pointerId: e.pointerId,
            id,
            fromIndex: index,
            startClientY: e.clientY,
            latestClientY: e.clientY,
            startScrollTop,
            scrollContainer,
            initialBoxes,
            draggedSpanPx: currBox.height + gapPx,
            dragging: false,
            targetIndex: index,
          };

          try {
            handleEl?.setPointerCapture?.(e.pointerId);
          } catch {
            /* ignore synthetic events in unit tests */
          }
        },

        onPointerMove: (e: PointerEvent) => {
          const sess = sessionRef.current;
          if (!sess || sess.pointerId !== e.pointerId) return;
          sess.latestClientY = e.clientY;
          const currentScrollTop = sess.scrollContainer ? sess.scrollContainer.scrollTop : 0;
          const totalDeltaY =
            e.clientY - sess.startClientY + (currentScrollTop - sess.startScrollTop);

          if (!sess.dragging) {
            if (!isDragExceeded(totalDeltaY)) return;
            sess.dragging = true;
            suppressNextClickIdRef.current = id;
            onDragStart?.(id);
            startAutoScrollLoop();
          }

          e.preventDefault();
          updateDragGeometry(sess);
        },

        onPointerUp: (e: PointerEvent) => {
          const sess = sessionRef.current;
          if (!sess || sess.pointerId !== e.pointerId) return;
          sessionRef.current = null;
          stopAutoScroll();

          if (sess.dragging) {
            setDragState(null);
            if (sess.targetIndex !== sess.fromIndex) {
              onReorder(sess.fromIndex, sess.targetIndex);
            }
          }
        },

        onPointerCancel: (e: PointerEvent) => {
          const sess = sessionRef.current;
          if (!sess || sess.pointerId !== e.pointerId) return;
          sessionRef.current = null;
          stopAutoScroll();
          setDragState(null);
        },

        onClick: (e: MouseEvent) => {
          e.stopPropagation();
          if (suppressNextClickIdRef.current === id) {
            suppressNextClickIdRef.current = null;
            e.preventDefault();
            return;
          }
          onTap?.(e);
        },
      };
    },
    [ids, onDragStart, onReorder, startAutoScrollLoop, stopAutoScroll, updateDragGeometry]
  );

  return {
    dragState,
    getItemBind,
    getHandleBind,
  };
}
