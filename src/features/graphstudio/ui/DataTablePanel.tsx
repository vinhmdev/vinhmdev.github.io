/**
 * Interactive Data Points Table, Data Brush Toggle, and Consolidated Data Actions Menu
 * (CSV Paste/Import, Sample Datasets, and Bayesian Coin Flipper) [FR-4.3].
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { DataPoint2D } from '../types/state';
import type { GraphStoreState } from '../state/store';
import { t } from '../scripts/i18n-client';
import { FloatingPopover } from './FloatingPopover';
import { IconTrash } from './icons';

const INITIAL_VISIBLE_POINTS = 40;

interface DataTableProps {
  storeState: GraphStoreState;
}

export function DataTablePanel({ storeState }: DataTableProps): JSX.Element {
  const { graph, brushActive } = storeState;
  const [csvText, setCsvText] = useState('');
  const [showCsvBox, setShowCsvBox] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showAllPoints, setShowAllPoints] = useState<boolean>(false);
  const actionsBtnRef = useRef<HTMLButtonElement | null>(null);

  const handleImportCsv = (): void => {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: DataPoint2D[] = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split(/[,\t;]+/).map((s) => Number(s.trim()));
      if (cols.length >= 2 && Number.isFinite(cols[0]) && Number.isFinite(cols[1])) {
        parsed.push({
          id: `csv-${i}-${Date.now()}`,
          x: cols[0],
          y: cols[1],
          x2: cols[1],
          label: cols[2] !== undefined && Number.isFinite(cols[2]) ? cols[2] : undefined,
          split: 'train',
        });
      }
    }
    if (parsed.length > 0) {
      storeState.setDataPoints(parsed);
      setShowCsvBox(false);
      setCsvText('');
      setIsExpanded(true);
    }
  };

  return (
    <div class="flex flex-col gap-2 p-3 border-t border-neutral-200 dark:border-neutral-800 text-xs">
      <div class="relative flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          class="flex items-center gap-1.5 min-w-0 flex-1 font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 text-[11px] hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors truncate"
        >
          <span>{isExpanded ? '▾' : '▸'}</span>
          <span class="truncate">
            {t('data_table_title')} ({graph.dataPoints.length})
          </span>
        </button>

        <div class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => storeState.setBrushActive(!brushActive)}
            class={`px-2 py-0.5 rounded font-semibold border transition-colors text-[11px] ${
              brushActive
                ? 'bg-orange-500 text-white border-orange-500'
                : 'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-orange-500'
            }`}
            title="Spray multiple data points by dragging on the 2D canvas"
          >
            {t('brush_mode')}
          </button>

          <button
            type="button"
            onClick={() => {
              storeState.addDataPoint({
                x: Number((Math.random() * 4 - 2).toFixed(2)),
                y: Number((Math.random() * 3 - 1.5).toFixed(2)),
                split: 'train',
              });
              setIsExpanded(true);
            }}
            class="px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-500/25 transition-colors text-[11px]"
          >
            {t('add_point')}
          </button>

          {/* Consolidated Data Actions Portal Menu */}
          <button
            ref={(el) => {
              actionsBtnRef.current = el;
            }}
            type="button"
            aria-expanded={actionsMenuOpen}
            aria-haspopup="menu"
            onClick={() => setActionsMenuOpen((prev) => !prev)}
            class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium transition-colors ${
              actionsMenuOpen
                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/50'
                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 hover:border-orange-500'
            }`}
            title={t('data_actions_btn')}
          >
            <span>{t('data_actions_btn')}</span>
            <span class="text-[9px] opacity-75">▾</span>
          </button>

          <FloatingPopover
            open={actionsMenuOpen}
            anchorEl={actionsBtnRef.current}
            onClose={() => setActionsMenuOpen(false)}
            align="right"
            preferredWidthPx={228}
            class="w-56 py-1 flex flex-col text-[11px]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setShowCsvBox((prev) => !prev);
                setIsExpanded(true);
                setActionsMenuOpen(false);
              }}
              class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span>📋 {t('paste_csv')}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                storeState.setDataPoints([
                  { id: 's1', x: -2.0, y: -1.4, split: 'train' },
                  { id: 's2', x: -1.0, y: -0.6, split: 'train' },
                  { id: 's3', x: 0.0, y: 0.1, split: 'train' },
                  { id: 's4', x: 1.0, y: 0.9, split: 'train' },
                  { id: 's5', x: 2.0, y: 1.8, split: 'train' },
                ]);
                setIsExpanded(true);
                setActionsMenuOpen(false);
              }}
              class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span>📈 Sample Linear Points (5)</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                storeState.setDataPoints([
                  { id: 'xor1', x: -1.0, y: -1.0, x2: -1.0, label: 0, split: 'train' },
                  { id: 'xor2', x: 1.0, y: 1.0, x2: 1.0, label: 0, split: 'train' },
                  { id: 'xor3', x: -1.0, y: 1.0, x2: 1.0, label: 1, split: 'train' },
                  { id: 'xor4', x: 1.0, y: -1.0, x2: -1.0, label: 1, split: 'train' },
                ]);
                setIsExpanded(true);
                setActionsMenuOpen(false);
              }}
              class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span>🔀 Sample XOR Points (4)</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                storeState.setDataPoints([
                  { id: 'r1', x: 0.4, y: 0.3, x2: 0.3, label: 1, split: 'train' },
                  { id: 'r2', x: -0.5, y: 0.4, x2: 0.4, label: 1, split: 'train' },
                  { id: 'r3', x: 0.3, y: -0.5, x2: -0.5, label: 1, split: 'train' },
                  { id: 'r4', x: -0.4, y: -0.4, x2: -0.4, label: 1, split: 'train' },
                  { id: 'r5', x: 2.1, y: 0.8, x2: 0.8, label: 0, split: 'train' },
                  { id: 'r6', x: -2.0, y: 1.1, x2: 1.1, label: 0, split: 'train' },
                  { id: 'r7', x: 1.1, y: -2.1, x2: -2.1, label: 0, split: 'train' },
                  { id: 'r8', x: -1.5, y: -1.8, x2: -1.8, label: 0, split: 'train' },
                ]);
                setIsExpanded(true);
                setActionsMenuOpen(false);
              }}
              class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span>⭕ Sample Ring Points (8)</span>
            </button>

            <div class="my-1 border-t border-neutral-200 dark:border-neutral-800" />

            <div class="px-3 py-1 flex items-center justify-between gap-1">
              <span class="text-neutral-500">🪙 Bayes Coins:</span>
              <div class="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => storeState.flipBayesianCoins(1)}
                  class="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-500/25"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => storeState.flipBayesianCoins(10)}
                  class="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-500/25"
                >
                  +10
                </button>
              </div>
            </div>

            {graph.dataPoints.length > 0 && (
              <>
                <div class="my-1 border-t border-neutral-200 dark:border-neutral-800" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    storeState.setDataPoints([]);
                    setShowAllPoints(false);
                    setActionsMenuOpen(false);
                  }}
                  class="flex items-center gap-1.5 px-3 py-1.5 text-left text-red-600 dark:text-red-400 hover:bg-red-500/10"
                >
                  <IconTrash class="w-3.5 h-3.5" />
                  <span>{t('data_clear_all')}</span>
                </button>
              </>
            )}
          </FloatingPopover>
        </div>
      </div>

      {isExpanded && showCsvBox && (
        <div class="flex flex-col gap-1.5 p-2 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950">
          <textarea
            rows={3}
            value={csvText}
            onInput={(e) => setCsvText((e.target as HTMLTextAreaElement).value)}
            placeholder="Paste x, y rows (e.g. -1.5, -1.2)"
            class="w-full p-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent font-mono text-[11px]"
          />
          <button
            type="button"
            onClick={handleImportCsv}
            class="self-end px-2.5 py-1 rounded bg-orange-500 text-white font-semibold"
          >
            {t('data_import_rows')}
          </button>
        </div>
      )}

      {isExpanded && graph.dataPoints.length === 0 && !showCsvBox && (
        <p class="px-1.5 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">{t('data_table_empty')}</p>
      )}

      {isExpanded && graph.dataPoints.length > 0 && (
        <div
          class={`${
            showAllPoints ? 'max-h-72' : 'max-h-44'
          } overflow-y-auto flex flex-col gap-1 pr-1`}
        >
          {(showAllPoints
            ? graph.dataPoints
            : graph.dataPoints.slice(0, INITIAL_VISIBLE_POINTS)
          ).map((pt) => (
            <div
              key={pt.id}
              onMouseEnter={() => storeState.setHoveredDataPoint(pt.id)}
              onMouseLeave={() => storeState.setHoveredDataPoint(null)}
              class="flex items-center justify-between gap-1 px-1.5 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800/70 font-mono text-[11px]"
            >
              <div class="flex items-center gap-1">
                <span class="text-neutral-400">(</span>
                <input
                  type="number"
                  step="0.1"
                  aria-label="Point X coordinate"
                  value={Number(pt.x.toFixed(2))}
                  onChange={(e) => {
                    const nx = Number((e.target as HTMLInputElement).value);
                    const sib = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll('input')[1] as HTMLInputElement | undefined;
                    const ny = sib ? Number(sib.value) : pt.y;
                    if (Number.isFinite(nx)) {
                      storeState.updateDataPoint(pt.id, nx, Number.isFinite(ny) ? ny : pt.y);
                    }
                  }}
                  class="w-14 px-1 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-transparent text-center focus:border-orange-500 focus:outline-none"
                />
                <span class="text-neutral-400">,</span>
                <input
                  type="number"
                  step="0.1"
                  aria-label="Point Y coordinate"
                  value={Number(pt.y.toFixed(2))}
                  onChange={(e) => {
                    const ny = Number((e.target as HTMLInputElement).value);
                    const sib = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll('input')[0] as HTMLInputElement | undefined;
                    const nx = sib ? Number(sib.value) : pt.x;
                    if (Number.isFinite(ny)) {
                      storeState.updateDataPoint(pt.id, Number.isFinite(nx) ? nx : pt.x, ny);
                    }
                  }}
                  class="w-14 px-1 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-transparent text-center focus:border-orange-500 focus:outline-none"
                />
                <span class="text-neutral-400">)</span>
              </div>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const nextLabel =
                      pt.label === undefined ? 1 : pt.label > 0 ? 0 : undefined;
                    const updated = graph.dataPoints.map((d) =>
                      d.id === pt.id ? { ...d, label: nextLabel, x2: d.y } : d
                    );
                    storeState.setDataPoints(updated);
                  }}
                  class={`px-1 rounded text-[10px] font-bold border ${
                    pt.label === undefined
                      ? 'border-neutral-200 dark:border-neutral-700 text-neutral-400'
                      : pt.label > 0
                        ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30'
                        : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30'
                  }`}
                  title="Cycle point class label (None → Class 1 [Orange] → Class 0 [Blue]) for ROC / RBF / MLP"
                >
                  {pt.label === undefined ? '•' : `c${pt.label}`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const updated = graph.dataPoints.map((d) =>
                      d.id === pt.id
                        ? { ...d, split: (d.split === 'train' ? 'test' : 'train') as 'train' | 'test' }
                        : d
                    );
                    storeState.setDataPoints(updated);
                  }}
                  class={`px-1.5 rounded text-[10px] ${
                    pt.split === 'train'
                      ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                      : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {pt.split}
                </button>
                <button
                  type="button"
                  onClick={() => storeState.removeDataPoint(pt.id)}
                  class="text-neutral-400 hover:text-red-500"
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          ))}

          {graph.dataPoints.length > INITIAL_VISIBLE_POINTS && (
            <button
              type="button"
              onClick={() => setShowAllPoints((prev) => !prev)}
              class="mt-1 py-1 px-2 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/80 hover:border-orange-500 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 transition-colors"
            >
              {showAllPoints
                ? t('data_show_less')
                : t('data_show_all').replace('{n}', String(graph.dataPoints.length))}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
