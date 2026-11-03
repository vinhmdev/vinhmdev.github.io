/**
 * Subheader Toolbar: View Mode Switcher, 15 ML Template Picker, Clarke H(0) Toggle,
 * Undo/Redo, Local Save, JSON Import/Export, and 2x DPI PNG Export.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  ALL_ML_TEMPLATES,
  BLANK_CANVAS_TEMPLATE,
  MATH_TEMPLATES,
} from '../extensions/templates';
import { downloadStateJsonFile, saveStateToLocalStorage } from '../state/local-persistence';
import type { GraphStoreState } from '../state/store';
import { t } from '../scripts/i18n-client';
import { IconBoard, IconDownload, IconRedo, IconSave, IconUndo } from './icons';

interface ToolbarProps {
  storeState: GraphStoreState;
  onExportPng: () => void;
  onToast: (msg: string) => void;
}

export function ToolbarSubheader({
  storeState,
  onExportPng,
  onToast,
}: ToolbarProps): JSX.Element {
  const { graph, undoStack, redoStack } = storeState;
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  const handleSaveLocal = (): void => {
    const ok = saveStateToLocalStorage(graph);
    onToast(ok ? t('status_saved') : 'Failed to save to localStorage');
  };

  const isBlankMode = graph.activeTemplateId === 'T-00';

  return (
    <div class="flex flex-col md:flex-row md:flex-wrap md:items-center md:justify-between gap-1.5 px-2.5 sm:px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/90 dark:bg-neutral-900/90 text-xs">
      {/* Primary Row: Blank Graph, Template Select, View Modes & Mobile Tools Toggle */}
      <div class="flex items-center justify-between md:justify-start gap-1.5 w-full md:w-auto">
        <div class="flex items-center gap-1.5 min-w-0 flex-1 md:flex-initial">
          <button
            id="blank-graph-btn"
            type="button"
            onClick={() => {
              storeState.resetToBlankCanvas();
              onToast(t('blank_mode_toast'));
            }}
            class={`flex items-center gap-1 shrink-0 h-7 px-2 rounded-md border font-semibold transition-colors ${
              isBlankMode
                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/50'
                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:border-orange-500'
            }`}
            title={t('t00_title')}
          >
            <IconBoard class="w-3.5 h-3.5 text-orange-500" />
            <span class="hidden sm:inline">{t('blank_mode_btn')}</span>
          </button>

          <label class="hidden xl:inline font-semibold text-neutral-500 dark:text-neutral-400">
            {t('templates_label')}:
          </label>
          <select
            aria-label="Select Graph Template"
            value={graph.activeTemplateId}
            onChange={(e) => storeState.selectTemplate((e.target as HTMLSelectElement).value)}
            class="h-7 flex-1 min-w-[95px] max-w-[235px] px-1.5 sm:px-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-medium focus:outline-none focus:border-orange-500 truncate"
          >
            <option value={BLANK_CANVAS_TEMPLATE.id}>
              {t(BLANK_CANVAS_TEMPLATE.titleKey)}
            </option>
            <hr class="border-neutral-200 dark:border-neutral-700 my-1" />
            <optgroup label={t('tpl_group_math')}>
              {MATH_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {t(tpl.titleKey)}
                </option>
              ))}
            </optgroup>
            <hr class="border-neutral-200 dark:border-neutral-700 my-1" />
            <optgroup label={t('tpl_group_ml')}>
              {ALL_ML_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {t(tpl.titleKey)}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Mobile Collapsible Tools Button (< 768px) */}
        <button
          type="button"
          onClick={() => setMobileToolsOpen((prev) => !prev)}
          aria-expanded={mobileToolsOpen}
          class={`md:hidden shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md border font-semibold transition-colors ${
            mobileToolsOpen
              ? 'bg-orange-500 text-white border-orange-500'
              : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200'
          }`}
          title="Toggle extra toolbar actions"
        >
          <span>⚙️</span>
          <span class="text-[10px]">{mobileToolsOpen ? '▴' : '▾'}</span>
        </button>

        {/* Desktop View Modes & Clarke Subgradient (hidden on mobile unless Tools drawer is expanded) */}
        <div class="hidden md:flex items-center gap-1.5">
          <div class="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden">
            {(['inference', 'optimization', 'dual'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => storeState.setViewMode(m)}
                class={`px-2.5 py-1 font-medium transition-colors ${
                  graph.viewMode === m
                    ? 'bg-orange-500 text-white'
                    : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                }`}
              >
                {m === 'inference'
                  ? t('view_inference')
                  : m === 'optimization'
                    ? t('view_optimization')
                    : t('view_dual')}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              storeState.setSubgradConvention(
                graph.subgradConvention === 'zero' ? 'symmetric' : 'zero'
              )
            }
            class="h-7 px-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:border-orange-500 transition-colors"
            title="Toggle Clarke Subdifferential at kink u = 0"
          >
            {graph.subgradConvention === 'zero' ? t('subgrad_zero') : t('subgrad_sym')}
          </button>
        </div>
      </div>

      {/* Secondary Row / Right Actions: Collapsible on Mobile, Always Visible on Desktop */}
      <div
        class={`${
          mobileToolsOpen ? 'flex' : 'hidden md:flex'
        } flex-wrap items-center justify-between md:justify-end gap-1.5 pt-1 md:pt-0 border-t md:border-t-0 border-neutral-200/70 dark:border-neutral-800/70`}
      >
        {/* Mobile-only View Modes & Clarke Subgradient inside collapsible drawer */}
        <div class="flex md:hidden flex-wrap items-center gap-1.5">
          <div class="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden">
            {(['inference', 'optimization', 'dual'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => storeState.setViewMode(m)}
                class={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  graph.viewMode === m
                    ? 'bg-orange-500 text-white'
                    : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                }`}
              >
                {m === 'inference'
                  ? t('view_inference')
                  : m === 'optimization'
                    ? t('view_optimization')
                    : t('view_dual')}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              storeState.setSubgradConvention(
                graph.subgradConvention === 'zero' ? 'symmetric' : 'zero'
              )
            }
            class="h-6 px-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-[11px] text-neutral-700 dark:text-neutral-300"
          >
            {graph.subgradConvention === 'zero' ? 'H(0)=0' : 'H(0)=0.5'}
          </button>
        </div>

        <div class="flex items-center gap-1.5 ml-auto md:ml-0">
          <span
            class="hidden lg:inline-block px-2 py-0.5 rounded bg-neutral-200/70 dark:bg-neutral-800 text-[11px] font-mono text-neutral-600 dark:text-neutral-400"
            title="Worker frame recalculation latency (Budget < 4.0ms)"
          >
            {storeState.computeDurationMs.toFixed(2)} ms
          </span>

          <button
            type="button"
            disabled={undoStack.length === 0}
            onClick={() => storeState.undo()}
            class="flex items-center justify-center w-7 h-7 rounded border border-neutral-300 dark:border-neutral-700 disabled:opacity-40 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title={t('undo_btn')}
          >
            <IconUndo />
          </button>
          <button
            type="button"
            disabled={redoStack.length === 0}
            onClick={() => storeState.redo()}
            class="flex items-center justify-center w-7 h-7 rounded border border-neutral-300 dark:border-neutral-700 disabled:opacity-40 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title={t('redo_btn')}
          >
            <IconRedo />
          </button>

          <button
            type="button"
            onClick={handleSaveLocal}
            class="flex items-center gap-1 h-7 px-2 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-orange-500 font-medium"
            title="Save state to localStorage (openmlgraph_requirements_v1)"
          >
            <IconSave class="w-3.5 h-3.5 text-orange-500" />
            <span>{t('save_btn')}</span>
          </button>

          <button
            type="button"
            onClick={() => downloadStateJsonFile(graph)}
            class="flex items-center gap-1 h-7 px-2 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-orange-500"
            title="Download .json session backup"
          >
            <IconDownload class="w-3.5 h-3.5" />
            <span>JSON</span>
          </button>

          <button
            type="button"
            onClick={onExportPng}
            class="flex items-center gap-1 h-7 px-2.5 rounded bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors"
            title="Export 2x DPI PNG image"
          >
            <IconDownload class="w-3.5 h-3.5" />
            <span>{t('export_png_btn')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
