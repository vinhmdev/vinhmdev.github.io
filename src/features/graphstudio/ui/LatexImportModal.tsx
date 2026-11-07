/**
 * Paper LaTeX import review: shows how a pasted block is split, what was auto-fixed, what was
 * simplified, and which parts stay display-only notes — then inserts everything in one undo step.
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  analyzePastedLatex,
  type ImportNotice,
  type ImportSegment,
} from '../core/parser/latex-importer';
import { t } from '../scripts/i18n-client';
import { getPlottableExpressions } from '../state/expression-kind';
import type { GraphStoreState } from '../state/store';
import type { ExpressionKind } from '../types/state';
import { IconClose } from './icons';

export interface LatexImportDraft {
  text: string;
  /** Row to overwrite with the first imported segment (an empty row the user pasted into). */
  replaceId?: string;
}

interface LatexImportModalProps {
  draft: LatexImportDraft;
  storeState: GraphStoreState;
  onClose: () => void;
}

interface SegmentChoice {
  kind: ExpressionKind;
  skip: boolean;
}

const STATUS_STYLE: Record<ImportSegment['status'], string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  fixed: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  note: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};

const STATUS_ICON: Record<ImportSegment['status'], string> = { ok: '✅', fixed: '🔧', note: '📝' };

function renderDisplayKaTeX(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: true, strict: 'ignore' });
  } catch {
    return latex;
  }
}

function noticeText(n: ImportNotice): string {
  return n.detail ? `${t(n.code)}: ${n.detail}` : t(n.code);
}

function defaultChoices(segments: ImportSegment[]): SegmentChoice[] {
  return segments.map((s) => ({ kind: s.status === 'note' ? 'note' : 'plot', skip: false }));
}

export function LatexImportModal({ draft, storeState, onClose }: LatexImportModalProps): JSX.Element {
  const { graph } = storeState;
  const [text, setText] = useState(draft.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const segments = useMemo(
    () =>
      text.trim()
        ? analyzePastedLatex(text, {
            symbolOverrides: graph.symbolOverrides,
            existingExpressions: getPlottableExpressions(graph.expressions),
            functionLibrary: graph.functionLibrary,
          })
        : [],
    [text, graph.expressions, graph.symbolOverrides, graph.functionLibrary]
  );
  const [choices, setChoices] = useState<SegmentChoice[]>(() => defaultChoices(segments));

  // Re-derive defaults whenever the analysis changes (the user edited the source text).
  useEffect(() => {
    setChoices(defaultChoices(segments));
  }, [segments]);

  useEffect(() => {
    if (!draft.text) textareaRef.current?.focus();
  }, [draft.text]);

  const selectedCount = choices.filter((c) => !c.skip).length;

  const handleConfirm = (): void => {
    const items = segments
      .map((seg, i) => ({ seg, choice: choices[i] }))
      .filter(({ choice }) => choice && !choice.skip)
      .map(({ seg, choice }) => ({
        latex: choice.kind === 'plot' ? seg.latex : seg.original,
        kind: choice.kind,
      }));
    if (items.length > 0) storeState.addExpressionsBatch(items, draft.replaceId);
    onClose();
  };

  const updateChoice = (idx: number, patch: Partial<SegmentChoice>): void => {
    setChoices((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && selectedCount > 0) handleConfirm();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="latex-import-title"
        class="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl text-xs"
      >
        <div class="flex items-start justify-between gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <div class="min-w-0">
            <h2 id="latex-import-title" class="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              {t('latex_import_title')}
            </h2>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">{t('latex_import_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            class="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label={t('latex_import_cancel')}
          >
            <IconClose />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          <textarea
            ref={textareaRef}
            value={text}
            rows={Math.min(8, Math.max(3, text.split('\n').length))}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            placeholder={t('latex_import_placeholder')}
            class="w-full px-2.5 py-2 rounded border border-neutral-300 dark:border-neutral-700 font-mono text-[11px] bg-neutral-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-orange-500 resize-y"
          />

          {segments.length === 0 && (
            <p class="text-center text-neutral-400 py-4">{t('latex_import_empty')}</p>
          )}

          {segments.map((seg, idx) => {
            const choice = choices[idx] ?? { kind: 'plot' as const, skip: false };
            const shown = choice.kind === 'plot' ? seg.latex : seg.original;
            return (
              <div
                key={`${idx}-${seg.original}`}
                class={`rounded-lg border p-2.5 flex flex-col gap-1.5 transition-opacity ${
                  choice.skip
                    ? 'opacity-40 border-neutral-200 dark:border-neutral-800'
                    : 'border-neutral-200 dark:border-neutral-700'
                }`}
              >
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <span class={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_STYLE[seg.status]}`}>
                    {STATUS_ICON[seg.status]} {t(`latex_import_status_${seg.status}`)}
                  </span>
                  <div class="flex items-center gap-1">
                    <div class="inline-flex rounded border border-neutral-300 dark:border-neutral-700 overflow-hidden">
                      {(['plot', 'note'] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          aria-pressed={choice.kind === kind}
                          onClick={() => updateChoice(idx, { kind })}
                          class={`px-2 py-0.5 text-[10px] font-semibold ${
                            choice.kind === kind
                              ? kind === 'plot'
                                ? 'bg-orange-500 text-white'
                                : 'bg-sky-500 text-white'
                              : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                          }`}
                        >
                          {t(kind === 'plot' ? 'latex_import_as_plot' : 'latex_import_as_note')}
                        </button>
                      ))}
                    </div>
                    <label class="inline-flex items-center gap-1 text-[10px] text-neutral-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={choice.skip}
                        onChange={(e) => updateChoice(idx, { skip: (e.target as HTMLInputElement).checked })}
                      />
                      {t('latex_import_skip')}
                    </label>
                  </div>
                </div>

                <div
                  class="overflow-x-auto text-neutral-900 dark:text-neutral-100"
                  dangerouslySetInnerHTML={{ __html: renderDisplayKaTeX(shown) }}
                />

                {choice.kind === 'plot' && seg.latex !== seg.original && (
                  <div class="font-mono text-[10px] text-neutral-500 break-all">
                    <span class="line-through opacity-70">{seg.original}</span>
                    <span class="mx-1">→</span>
                    <span class="text-orange-600 dark:text-orange-400">{seg.latex}</span>
                  </div>
                )}

                {seg.reason && (
                  <p class="text-[10px] text-sky-700 dark:text-sky-300">ℹ️ {noticeText(seg.reason)}</p>
                )}
                {seg.fixes.length > 0 && (
                  <ul class="text-[10px] text-orange-700 dark:text-orange-300 list-none flex flex-col gap-0.5">
                    {seg.fixes.map((f, i) => (
                      <li key={`f${i}`}>🔧 {noticeText(f)}</li>
                    ))}
                  </ul>
                )}
                {seg.warnings.length > 0 && (
                  <ul class="text-[10px] text-amber-700 dark:text-amber-300 list-none flex flex-col gap-0.5">
                    {seg.warnings.map((w, i) => (
                      <li key={`w${i}`}>⚠️ {noticeText(w)}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            class="px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400"
          >
            {t('latex_import_cancel')}
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={handleConfirm}
            class="px-3 py-1.5 rounded bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('latex_import_confirm').replace('{n}', String(selectedCount))}
          </button>
        </div>
      </div>
    </div>
  );
}
