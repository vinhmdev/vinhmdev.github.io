/**
 * Display-only expression row: renders pasted paper LaTeX with KaTeX (display mode) without
 * parsing or plotting it. Users can edit the raw source or promote the row to a plottable function.
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../scripts/i18n-client';
import type { GraphStoreState } from '../state/store';
import type { ExpressionItem } from '../types/state';
import { IconChevronDown, IconChevronRight, IconFunction, IconTrash } from './icons';

interface NoteExpressionCardProps {
  expr: ExpressionItem;
  storeState: GraphStoreState;
  canDelete?: boolean;
}

function renderNoteKaTeX(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: true, strict: 'ignore' });
  } catch {
    return latex;
  }
}

export function NoteExpressionCard({
  expr,
  storeState,
}: NoteExpressionCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isEmpty = expr.latex.trim().length === 0;

  // Focus on the same click that opens the editor (autoFocus is ignored for inserted nodes).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!editing || !el || document.activeElement === el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  return (
    <div class="p-2.5 rounded-lg border border-dashed border-sky-500/50 bg-sky-500/5 dark:bg-sky-500/5 flex flex-col gap-2">
      <div class="flex items-center justify-between gap-1">
        <div class="flex items-center gap-1 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => storeState.toggleExpressionProp(expr.id, 'collapsed')}
            class="p-0.5 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0"
            title={expr.collapsed ? 'Expand' : 'Collapse'}
          >
            {expr.collapsed ? <IconChevronRight class="w-3 h-3" /> : <IconChevronDown class="w-3 h-3" />}
          </button>
          <span
            class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300"
            title={t('note_badge_tooltip')}
          >
            📝 {t('note_badge')}
          </span>
          <input
            type="text"
            value={expr.label ?? ''}
            placeholder={t('note_label_placeholder')}
            aria-label={t('note_label_placeholder')}
            onInput={(e) =>
              storeState.updateExpressionLabel(expr.id, (e.target as HTMLInputElement).value)
            }
            class="min-w-0 flex-1 max-w-[160px] px-1.5 py-0.5 rounded border border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-sky-500 bg-transparent font-semibold text-neutral-700 dark:text-neutral-200 placeholder:text-neutral-400 text-xs focus:outline-none"
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
            type="button"
            onClick={() => storeState.removeExpression(expr.id)}
            class="p-1 rounded text-neutral-400 hover:text-red-500"
            title={t('delete_note') || 'Delete note'}
          >
            <IconTrash />
          </button>
        </div>
      </div>

      {!expr.collapsed &&
        (editing || isEmpty ? (
          <textarea
            ref={textareaRef}
            value={expr.latex}
            rows={Math.min(8, Math.max(2, expr.latex.split('\n').length))}
            onInput={(e) =>
              storeState.updateExpressionLatex(expr.id, (e.target as HTMLTextAreaElement).value)
            }
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
            }}
            class="w-full px-2.5 py-1.5 rounded border border-sky-500 ring-1 ring-sky-500/30 font-mono text-xs bg-neutral-50 dark:bg-neutral-950 focus:outline-none resize-y"
          />
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
        ))}
    </div>
  );
}
