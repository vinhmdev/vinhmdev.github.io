/**
 * Display-only Note Expression Row with Unified 32px Left Gutter (Drag-to-Reorder + Tap-to-Collapse)
 * and Portal Overflow Menu `[⋯]` (Convert to Plot, Duplicate, Move Up/Down, Delete).
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../scripts/i18n-client';
import type { GraphStoreState } from '../state/store';
import type { ExpressionItem } from '../types/state';
import { FloatingPopover } from './FloatingPopover';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFunction,
  IconGripVertical,
  IconMore,
  IconTrash,
} from './icons';
import { MiniMathBar } from './MiniMathBar';
import type { SortableHandleBind, SortableItemBind } from './useSortableList';

interface NoteExpressionCardProps {
  expr: ExpressionItem;
  index: number;
  totalCount: number;
  storeState: GraphStoreState;
  itemBind: SortableItemBind;
  handleBind: SortableHandleBind;
}

function renderNoteKaTeX(latex: string, displayMode = true): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      strict: 'ignore',
    });
  } catch {
    return latex;
  }
}

export function NoteExpressionCard({
  expr,
  index,
  totalCount,
  storeState,
  itemBind,
  handleBind,
}: NoteExpressionCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const isEmpty = expr.latex.trim().length === 0;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!editing || !el || document.activeElement === el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  return (
    <div
      ref={itemBind.ref}
      style={itemBind.style}
      onKeyDown={itemBind.onKeyDown}
      class={`relative rounded-lg border border-dashed bg-sky-500/5 dark:bg-sky-500/5 flex items-stretch transition-shadow ${
        expr.collapsed ? 'min-h-[38px]' : 'min-h-[44px]'
      } ${
        itemBind.isDragging
          ? 'border-orange-500 ring-2 ring-orange-500/50 shadow-lg opacity-95'
          : 'border-sky-500/50'
      }`}
    >
      {itemBind.dropIndicator === 'above' && (
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -top-1.5 left-1 right-1 h-0.5 rounded-full bg-orange-500 shadow-xs"
        />
      )}
      {itemBind.dropIndicator === 'below' && (
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -bottom-1.5 left-1 right-1 h-0.5 rounded-full bg-orange-500 shadow-xs"
        />
      )}

      {/* 32px Unified Left Gutter: Drag to Reorder | Tap to Collapse/Expand */}
      <button
        type="button"
        aria-label={t('drag_reorder_tooltip')}
        title={t('drag_reorder_tooltip')}
        {...handleBind}
        class="w-8 shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-l-lg border-r border-sky-500/20 text-sky-600/80 dark:text-sky-400/80 hover:text-orange-500 hover:bg-sky-500/10 touch-none select-none cursor-grab active:cursor-grabbing transition-colors"
      >
        <span class="text-[10px] leading-none">📝</span>
        <IconGripVertical class="w-3 h-3 opacity-75" />
      </button>

      {/* Right Content Column */}
      {expr.collapsed ? (
        <div class="flex-1 min-w-0 flex items-center justify-between gap-1.5 px-2 py-1">
          <button
            type="button"
            onClick={() => storeState.toggleExpressionProp(expr.id, 'collapsed')}
            class="flex-1 min-w-0 flex items-center gap-1.5 text-left hover:opacity-80"
            title={t('expand_card')}
          >
            {expr.label && (
              <span class="shrink-0 font-semibold text-sky-700 dark:text-sky-300 text-xs truncate max-w-[110px]">
                {expr.label}:
              </span>
            )}
            <span
              class="gs-katex-line min-w-0 flex-1 text-xs text-neutral-700 dark:text-neutral-200"
              dangerouslySetInnerHTML={{
                __html: renderNoteKaTeX(expr.latex || t('note_badge'), false),
              }}
            />
          </button>

          <button
            ref={moreBtnRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label={t('card_more_actions')}
            title={t('card_more_actions')}
            onClick={(e) => {
              e.stopPropagation();
              setMoreOpen((prev) => !prev);
            }}
            class="w-6 h-6 shrink-0 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-sky-500/10"
          >
            <IconMore class="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div class="flex-1 min-w-0 flex flex-col gap-1.5 p-2">
          <div class="flex items-center justify-between gap-1 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300"
                title={t('note_badge_tooltip')}
              >
                {t('note_badge')}
              </span>
              <input
                type="text"
                value={expr.label ?? ''}
                placeholder={t('note_label_placeholder')}
                aria-label={t('note_label_placeholder')}
                onInput={(e) =>
                  storeState.updateExpressionLabel(
                    expr.id,
                    (e.target as HTMLInputElement).value
                  )
                }
                class="w-0 min-w-[3.5rem] flex-1 px-1.5 py-0.5 rounded border border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-sky-500 bg-transparent font-semibold text-neutral-700 dark:text-neutral-200 placeholder:text-neutral-400 text-xs focus:outline-none"
              />
            </div>

            <div class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => storeState.setExpressionKind(expr.id, 'plot')}
                class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:text-orange-600 hover:border-orange-500 transition-colors"
                title={t('note_to_plot_tooltip')}
              >
                <IconFunction class="w-2.5 h-2.5" />
                <span>{t('note_to_plot')}</span>
              </button>
              <button
                ref={moreBtnRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-label={t('card_more_actions')}
                title={t('card_more_actions')}
                onClick={(e) => {
                  e.stopPropagation();
                  setMoreOpen((prev) => !prev);
                }}
                class={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                  moreOpen
                    ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                    : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-sky-500/10'
                }`}
              >
                <IconMore class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {editing || isEmpty ? (
            <div class="flex flex-col gap-1">
              <textarea
                ref={textareaRef}
                value={expr.latex}
                rows={Math.min(8, Math.max(2, expr.latex.split('\n').length))}
                onFocus={() => setEditing(true)}
                onInput={(e) =>
                  storeState.updateExpressionLatex(
                    expr.id,
                    (e.target as HTMLTextAreaElement).value
                  )
                }
                onBlur={() => setEditing(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
                }}
                class="w-full px-2.5 py-1.5 rounded border border-sky-500 ring-1 ring-sky-500/30 font-mono text-xs bg-neutral-50 dark:bg-neutral-950 focus:outline-none resize-y"
              />
              {editing && (
                <MiniMathBar
                  getInputEl={() => textareaRef.current}
                  currentValue={expr.latex}
                  onInsert={(nextVal) => storeState.updateExpressionLatex(expr.id, nextVal)}
                />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title={t('note_edit_tooltip')}
              class="w-full px-2.5 py-1 rounded border border-transparent hover:border-sky-500/60 text-left overflow-x-auto cursor-text text-neutral-900 dark:text-neutral-100"
            >
              <span
                class="block text-xs"
                dangerouslySetInnerHTML={{ __html: renderNoteKaTeX(expr.latex) }}
              />
            </button>
          )}
        </div>
      )}

      {/* Portal Overflow Menu [⋯] */}
      <FloatingPopover
        open={moreOpen}
        anchorEl={moreBtnRef.current}
        onClose={() => setMoreOpen(false)}
        align="right"
        preferredWidthPx={200}
        class="w-48 py-1 text-xs flex flex-col"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            storeState.toggleExpressionProp(expr.id, 'collapsed');
            setMoreOpen(false);
          }}
          class="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {expr.collapsed ? (
            <IconChevronRight class="w-3.5 h-3.5 text-neutral-400" />
          ) : (
            <IconChevronDown class="w-3.5 h-3.5 text-neutral-400" />
          )}
          <span>{expr.collapsed ? t('expand_card') : t('collapse_card')}</span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            storeState.setExpressionKind(expr.id, 'plot');
            setMoreOpen(false);
          }}
          class="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <IconFunction class="w-3.5 h-3.5 text-orange-500" />
          <span>{t('note_to_plot')}</span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            storeState.duplicateExpression(expr.id);
            setMoreOpen(false);
          }}
          class="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <IconCopy class="w-3.5 h-3.5 text-neutral-400" />
          <span>{t('duplicate_note')}</span>
        </button>

        {totalCount > 1 && (
          <>
            <div class="my-1 border-t border-neutral-200 dark:border-neutral-800" />
            <button
              type="button"
              role="menuitem"
              disabled={index === 0}
              onClick={() => {
                storeState.moveExpression(expr.id, -1);
                setMoreOpen(false);
              }}
              class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:pointer-events-none"
            >
              <span class="flex items-center gap-2">
                <IconArrowUp class="w-3.5 h-3.5 text-neutral-400" />
                <span>{t('move_up')}</span>
              </span>
              <span class="text-[10px] font-mono text-neutral-400">Alt+↑</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={index === totalCount - 1}
              onClick={() => {
                storeState.moveExpression(expr.id, 1);
                setMoreOpen(false);
              }}
              class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:pointer-events-none"
            >
              <span class="flex items-center gap-2">
                <IconArrowDown class="w-3.5 h-3.5 text-neutral-400" />
                <span>{t('move_down')}</span>
              </span>
              <span class="text-[10px] font-mono text-neutral-400">Alt+↓</span>
            </button>
          </>
        )}

        <div class="my-1 border-t border-neutral-200 dark:border-neutral-800" />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            storeState.removeExpression(expr.id);
            setMoreOpen(false);
          }}
          class="flex items-center gap-2 px-3 py-1.5 text-left text-red-600 dark:text-red-400 hover:bg-red-500/10"
        >
          <IconTrash class="w-3.5 h-3.5" />
          <span>{t('delete_note')}</span>
        </button>
      </FloatingPopover>
    </div>
  );
}
