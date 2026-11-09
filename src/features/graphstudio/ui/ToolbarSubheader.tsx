/**
 * Subheader Toolbar (single row at every width): Sidebar Toggle, View Mode Switcher,
 * Examples Drawer Trigger, Undo/Redo, secondary PNG Export, and a "More" overflow menu
 * (New blank graph, Save to browser, Kink subgradient, frame-compute latency).
 * JSON export lives only in Share › Offline/JSON so each action has one home.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { saveStateToLocalStorage } from '../state/local-persistence';
import type { GraphStoreState } from '../state/store';
import { t } from '../scripts/i18n-client';
import {
  IconBoard,
  IconDownload,
  IconMore,
  IconRedo,
  IconSave,
  IconSidebarToggle,
  IconUndo,
} from './icons';

interface ToolbarProps {
  storeState: GraphStoreState;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onExportPng: () => void;
  onToast: (msg: string) => void;
}

export function ToolbarSubheader({
  storeState,
  sidebarOpen = true,
  onToggleSidebar,
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
      {/* Left Group: Sidebar Toggle, Blank Reset, View Modes, and Explore Examples Trigger */}
      <div class="flex items-center gap-1.5 min-w-0">
        {onToggleSidebar && (
          <button
            type="button"
            aria-expanded={sidebarOpen}
            aria-label={t('toggle_sidebar_btn')}
            onClick={onToggleSidebar}
            class={`hidden lg:flex items-center justify-center shrink-0 w-7 h-7 rounded-md border transition-colors ${
              sidebarOpen
                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/50'
                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-orange-500'
            }`}
            title={t('toggle_sidebar_btn')}
          >
            <IconSidebarToggle class="w-3.5 h-3.5" />
          </button>
        )}

        {/* View Mode Segmented Switcher (2D / 3D / Split) */}
        <div class="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden shrink-0">
          {(['inference', 'optimization', 'dual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => storeState.setViewMode(m)}
              aria-pressed={graph.viewMode === m}
              title={
                m === 'inference'
                  ? t('view_inference')
                  : m === 'optimization'
                    ? t('view_optimization')
                    : t('view_dual')
              }
              class={`px-2.5 h-7 text-xs font-medium whitespace-nowrap transition-colors ${
                graph.viewMode === m
                  ? 'bg-orange-500 text-white font-semibold'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
              }`}
            >
              <span class="lg:hidden">
                {m === 'inference'
                  ? t('view_inference_short')
                  : m === 'optimization'
                    ? t('view_optimization_short')
                    : t('view_dual_short')}
              </span>
              <span class="hidden lg:inline">
                {m === 'inference'
                  ? t('view_inference')
                  : m === 'optimization'
                    ? t('view_optimization')
                    : t('view_dual')}
              </span>
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
          <span class="hidden lg:inline">{t('explore_examples_btn')}</span>
        </button>
      </div>

      {/* Right Group: Undo/Redo, secondary PNG export, and the "More" overflow menu */}
      <div class="flex items-center gap-1 sm:gap-1.5 shrink-0">
        <button
          type="button"
          disabled={undoStack.length === 0}
          onClick={() => storeState.undo()}
          class="flex items-center justify-center w-7 h-7 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 disabled:opacity-40 hover:border-orange-500"
          title={t('undo_btn')}
          aria-label={t('undo_btn')}
        >
          <IconUndo />
        </button>
        <button
          type="button"
          disabled={redoStack.length === 0}
          onClick={() => storeState.redo()}
          class="flex items-center justify-center w-7 h-7 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 disabled:opacity-40 hover:border-orange-500"
          title={t('redo_btn')}
          aria-label={t('redo_btn')}
        >
          <IconRedo />
        </button>

        <button
          type="button"
          onClick={onExportPng}
          class="flex items-center gap-1 h-7 px-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:border-orange-500 font-medium transition-colors"
          title="Export 2x DPI PNG image"
          aria-label={t('export_png_btn')}
        >
          <IconDownload class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">PNG</span>
        </button>

        {/* "More" overflow menu: occasional actions only */}
        <div class="relative inline-block">
          <button
            type="button"
            aria-expanded={toolsMenuOpen}
            aria-haspopup="menu"
            aria-label={t('more_menu_btn')}
            onClick={(e) => {
              e.stopPropagation();
              setToolsMenuOpen((prev) => !prev);
            }}
            class={`flex items-center justify-center w-7 h-7 rounded-md border transition-colors ${
              toolsMenuOpen
                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/50'
                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:border-orange-500'
            }`}
            title={t('more_menu_btn')}
          >
            <IconMore />
          </button>

          {toolsMenuOpen && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              class="absolute right-0 top-full mt-1.5 z-40 w-60 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl flex flex-col text-xs"
            >
              <button
                id="blank-graph-btn"
                type="button"
                role="menuitem"
                onClick={() => {
                  storeState.resetToBlankCanvas();
                  onToast(t('blank_mode_toast'));
                  setToolsMenuOpen(false);
                }}
                class="flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title={t('t00_title')}
              >
                <IconBoard class="w-3.5 h-3.5 text-orange-500" />
                <span>{t('new_blank_graph')}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={handleSaveLocal}
                class="flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <IconSave class="w-3.5 h-3.5 text-orange-500" />
                <span>{t('save_browser')}</span>
              </button>

              <div class="my-1 border-t border-neutral-200 dark:border-neutral-800" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  storeState.setSubgradConvention(
                    graph.subgradConvention === 'zero' ? 'symmetric' : 'zero'
                  );
                }}
                class="flex items-center justify-between px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title="Toggle Clarke Subdifferential at kink u = 0"
              >
                <span>Kink Subgradient</span>
                <span class="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-mono text-[10px] font-bold">
                  {graph.subgradConvention === 'zero' ? 'H(0)=0' : 'H(0)=0.5'}
                </span>
              </button>

              <div
                class="mt-1 px-3 pt-1.5 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400"
                title="Worker frame recalculation latency (Budget < 4.0ms)"
              >
                <span>{t('latency_label')}</span>
                <span class="font-mono">{storeState.computeDurationMs.toFixed(2)} ms</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
