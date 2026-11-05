/**
 * Subheader Toolbar: Streamlined Studio Header with Blank Reset, View Mode Switcher,
 * Examples Drawer Trigger, Undo/Redo, Compact Tools Dropdown Menu, and 2x DPI PNG Export.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
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
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);

  useEffect(() => {
    if (!toolsMenuOpen || typeof window === 'undefined') return;
    const close = (): void => setToolsMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [toolsMenuOpen]);

  const handleSaveLocal = (): void => {
    const ok = saveStateToLocalStorage(graph);
    onToast(ok ? t('status_saved') : 'Failed to save to localStorage');
    setToolsMenuOpen(false);
  };

  return (
    <div class="flex items-center justify-between gap-1.5 px-2.5 sm:px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/90 dark:bg-neutral-900/90 text-xs">
      {/* Left Group: Blank Reset, View Modes, and Explore Examples Trigger */}
      <div class="flex items-center gap-1.5 min-w-0">
        <button
          id="blank-graph-btn"
          type="button"
          onClick={() => {
            storeState.resetToBlankCanvas();
            onToast(t('blank_mode_toast'));
          }}
          class="flex items-center gap-1 shrink-0 h-7 px-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:border-orange-500 font-semibold transition-colors"
          title={t('t00_title')}
        >
          <IconBoard class="w-3.5 h-3.5 text-orange-500" />
          <span class="hidden sm:inline">{t('blank_mode_btn')}</span>
        </button>

        {/* View Mode Segmented Switcher (2D / 3D / Split) */}
        <div class="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden shrink-0">
          {(['inference', 'optimization', 'dual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => storeState.setViewMode(m)}
              class={`px-2 sm:px-2.5 h-7 text-[11px] sm:text-xs font-medium transition-colors ${
                graph.viewMode === m
                  ? 'bg-orange-500 text-white font-semibold'
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

        {/* Explore Examples Drawer Trigger (replaces bulky <select> dropdown) */}
        <button
          type="button"
          onClick={() => storeState.setGalleryDrawerOpen(true, 'examples')}
          class="inline-flex items-center gap-1 shrink-0 h-7 px-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:border-orange-500 font-medium transition-colors"
          title={t('explore_examples_btn')}
        >
          <span>📚</span>
          <span class="hidden md:inline">{t('explore_examples_btn')}</span>
        </button>
      </div>

      {/* Right Group: Latency Badge, Undo/Redo, Compact Tools Menu, and Export PNG */}
      <div class="flex items-center gap-1 sm:gap-1.5 shrink-0">
        <span
          class="hidden xl:inline-block px-2 py-0.5 rounded bg-neutral-200/70 dark:bg-neutral-800 text-[11px] font-mono text-neutral-600 dark:text-neutral-400"
          title="Worker frame recalculation latency (Budget < 4.0ms)"
        >
          {storeState.computeDurationMs.toFixed(2)} ms
        </span>

        <button
          type="button"
          disabled={undoStack.length === 0}
          onClick={() => storeState.undo()}
          class="flex items-center justify-center w-7 h-7 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 disabled:opacity-40 hover:border-orange-500"
          title={t('undo_btn')}
        >
          <IconUndo />
        </button>
        <button
          type="button"
          disabled={redoStack.length === 0}
          onClick={() => storeState.redo()}
          class="flex items-center justify-center w-7 h-7 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 disabled:opacity-40 hover:border-orange-500"
          title={t('redo_btn')}
        >
          <IconRedo />
        </button>

        {/* Consolidated Studio Tools Dropdown Menu */}
        <div class="relative inline-block">
          <button
            type="button"
            aria-expanded={toolsMenuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setToolsMenuOpen((prev) => !prev);
            }}
            class={`inline-flex items-center gap-1 h-7 px-2 rounded-md border font-medium transition-colors ${
              toolsMenuOpen
                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/50'
                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:border-orange-500'
            }`}
            title={t('tools_menu_btn')}
          >
            <span>⚙️</span>
            <span class="hidden sm:inline">{t('tools_menu_btn')}</span>
            <span class="text-[10px] opacity-75">▾</span>
          </button>

          {toolsMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              class="absolute right-0 top-full mt-1.5 z-40 w-56 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl flex flex-col text-xs"
            >
              <button
                type="button"
                onClick={handleSaveLocal}
                class="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <IconSave class="w-3.5 h-3.5 text-orange-500" />
                <span>{t('save_btn')} (LocalStorage)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  downloadStateJsonFile(graph);
                  setToolsMenuOpen(false);
                }}
                class="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <IconDownload class="w-3.5 h-3.5 text-blue-500" />
                <span>Export Session (.JSON)</span>
              </button>

              <div class="my-1 border-t border-neutral-200 dark:border-neutral-800" />

              <button
                type="button"
                onClick={() => {
                  storeState.setSubgradConvention(
                    graph.subgradConvention === 'zero' ? 'symmetric' : 'zero'
                  );
                }}
                class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title="Toggle Clarke Subdifferential at kink u = 0"
              >
                <span>Kink Subgradient</span>
                <span class="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-mono text-[10px] font-bold">
                  {graph.subgradConvention === 'zero' ? 'H(0)=0' : 'H(0)=0.5'}
                </span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onExportPng}
          class="flex items-center gap-1 h-7 px-2 sm:px-2.5 rounded-md bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors"
          title="Export 2x DPI PNG image"
        >
          <IconDownload class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">{t('export_png_btn')}</span>
        </button>
      </div>
    </div>
  );
}
