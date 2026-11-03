/**
 * Interactive Data Points Table, Data Brush Toggle, Bayesian Coin Flipper (T-09),
 * and CSV Paste/Import Panel [FR-4.3].
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { DataPoint2D } from '../types/state';
import type { GraphStoreState } from '../state/store';
import { t } from '../scripts/i18n-client';
import { IconTrash } from './icons';

interface DataTableProps {
  storeState: GraphStoreState;
}

export function DataTablePanel({ storeState }: DataTableProps): JSX.Element {
  const { graph, brushActive, workspaceMode } = storeState;
  const isMlMode = workspaceMode === 'ml';
  const [csvText, setCsvText] = useState('');
  const [showCsvBox, setShowCsvBox] = useState(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(() => graph.dataPoints.length > 0);

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
    }
  };

  return (
    <div class="flex flex-col gap-2 p-3 border-t border-neutral-200 dark:border-neutral-800 text-xs">
      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          class="flex items-center gap-1.5 font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 text-[11px] hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors whitespace-nowrap"
        >
          <span>{isExpanded ? '▾' : '▸'}</span>
          <span>
            {isMlMode ? t('data_table_title') : t('math_points_title')} ({graph.dataPoints.length})
          </span>
        </button>
        <div class="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => storeState.setBrushActive(!brushActive)}
            class={`px-2 py-0.5 rounded font-semibold border transition-colors whitespace-nowrap ${
              brushActive
                ? 'bg-orange-500 text-white border-orange-500'
                : 'border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300'
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
            class="px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold whitespace-nowrap"
          >
            {t('add_point')}
          </button>
          {isExpanded && (
            <button
              type="button"
              onClick={() => setShowCsvBox(!showCsvBox)}
              class="px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 whitespace-nowrap"
            >
              {t('paste_csv')}
            </button>
          )}
          {graph.dataPoints.length > 0 && (
            <button
              type="button"
              onClick={() => storeState.setDataPoints([])}
              class="p-1 rounded text-neutral-400 hover:text-red-500"
              title="Clear all data points"
            >
              <IconTrash class="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Bayesian Beta-Bernoulli Coin Flipper (T-09) */}
      {graph.activeTemplateId === 'T-09' && (
        <div class="flex items-center gap-2 p-2 rounded bg-orange-500/10 border border-orange-500/30">
          <span class="font-semibold text-orange-600 dark:text-orange-400">Bernoulli Trials:</span>
          <button
            type="button"
            onClick={() => storeState.flipBayesianCoins(1)}
            class="px-2 py-0.5 rounded bg-orange-500 text-white font-semibold"
          >
            {t('coin_flip_1')}
          </button>
          <button
            type="button"
            onClick={() => storeState.flipBayesianCoins(10)}
            class="px-2 py-0.5 rounded bg-orange-500 text-white font-semibold"
          >
            {t('coin_flip_10')}
          </button>
        </div>
      )}

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
            Import Rows
          </button>
        </div>
      )}

      {isExpanded && graph.dataPoints.length > 0 && (
        <div class="max-h-40 overflow-y-auto flex flex-col gap-1 pr-1">
          {graph.dataPoints.slice(0, 40).map((pt) => (
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
              <div class="flex items-center gap-1.5">
                {isMlMode && (
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
                )}
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
        </div>
      )}
    </div>
  );
}
