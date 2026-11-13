/**
 * Expression Algebra Sidebar:
 * - Unified 32px Left Gutter (`Tap <= 6px` opens Line Color/Style Popover; `Drag > 6px` reorders 60fps + Auto-Scroll)
 * - Spacious Function Label + KaTeX Bi-Directional Formula Input + 0KB Mini Math Bar
 * - Portal Floating Popovers (`Style`, `Card ⋯`, `Role`, `Add +`, `Quick Presets`) — zero clipping
 * - Compact Slider Scrubbers (~52px) with 28px Drag Gutter & preserved 3D Surface Axes
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  mathJsonToLatex,
  symbolicDiff,
  symbolicSecondDiff,
} from '../core/calculus/symbolic-diff';
import {
  buildUserFunctionRegistry,
  classifyLatexExpression,
} from '../core/parser/ast-classifier';
import {
  DEFAULT_FUNCTION_LIBRARY,
  extractFunctionSignature,
  formatExpressionForKatex,
  resolveDerivSymbol,
} from '../core/parser/cortex-setup';
import { analyzePastedLatex, shouldInterceptPaste } from '../core/parser/latex-importer';
import { resolveSurfaceParamPair } from '../core/simulation/loss-evaluator';
import { QUICK_FORMULA_GROUPS } from '../extensions/templates';
import { t } from '../scripts/i18n-client';
import { getPlottableExpressions, isNoteExpression } from '../state/expression-kind';
import { EXPRESSION_COLORS, graphStore, type GraphStoreState } from '../state/store';
import type { SymbolRole } from '../types/math';
import type { CurveLineStyle } from '../types/state';
import { CompactSliderCard } from './CompactSliderCard';
import { FloatingPopover } from './FloatingPopover';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFunction,
  IconGripVertical,
  IconMore,
  IconPause,
  IconPlay,
  IconPlus,
  IconTarget,
  IconTrash,
} from './icons';
import { LatexImportModal, type LatexImportDraft } from './LatexImportModal';
import { MiniMathBar } from './MiniMathBar';
import { NoteExpressionCard } from './NoteExpressionCard';
import { useSortableList } from './useSortableList';

export { resolveDerivSymbol };

function renderLatexPreview(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: false });
  } catch {
    return latex;
  }
}

export interface SidebarProps {
  storeState: GraphStoreState;
  visibleSection?: 'all' | 'fx' | 'sliders';
}

const ROLE_BADGE_STYLE = {
  data_var: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40',
  param: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40',
  hyperparam: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/40',
  constant: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30',
  primitive: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30',
} as const;

const ROLE_OPTIONS: {
  role: 'data_var' | 'param' | 'hyperparam';
  shortLabel: string;
  desc: string;
  dotClass: string;
}[] = [
  {
    role: 'data_var',
    shortLabel: 'Data',
    desc: 'Axis / d/dx',
    dotClass: 'bg-cyan-500',
  },
  {
    role: 'param',
    shortLabel: 'Param',
    desc: 'Weight',
    dotClass: 'bg-blue-500',
  },
  {
    role: 'hyperparam',
    shortLabel: 'Hyper',
    desc: 'Config',
    dotClass: 'bg-purple-500',
  },
];

export function ExpressionSidebar({
  storeState,
  visibleSection = 'all',
}: SidebarProps): JSX.Element {
  const { graph, curves } = storeState;
  const sliderList = Object.values(graph.sliders);
  const [openRoleMenuKey, setOpenRoleMenuKey] = useState<string | null>(null);
  const [openStyleMenuExprId, setOpenStyleMenuExprId] = useState<string | null>(null);
  const [openMoreMenuExprId, setOpenMoreMenuExprId] = useState<string | null>(null);
  const [showQuickPresets, setShowQuickPresets] = useState<boolean>(false);
  const [addMenuOpen, setAddMenuOpen] = useState<boolean>(false);
  const [slidersCollapsed, setSlidersCollapsed] = useState<boolean>(false);
  const [expandedSliderConfig, setExpandedSliderConfig] = useState<Record<string, boolean>>({});
  const [editingExprId, setEditingExprId] = useState<string | null>(null);
  const [desktopMathBarOpen, setDesktopMathBarOpen] = useState<boolean>(false);
  const [isTouchOrCompact, setIsTouchOrCompact] = useState<boolean>(false);
  const [importDraft, setImportDraft] = useState<LatexImportDraft | null>(null);

  const editInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const styleBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const moreBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const roleBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const addSplitGroupRef = useRef<HTMLDivElement>(null);
  const topToolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse), (max-width: 1023px)');
    const sync = (): void => setIsTouchOrCompact(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  useLayoutEffect(() => {
    if (!editingExprId) return;
    const input = editInputRefs.current.get(editingExprId);
    if (!input || document.activeElement === input) return;
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }, [editingExprId]);

  const plottableExprs = getPlottableExpressions(graph.expressions);
  const userFunctions = buildUserFunctionRegistry(plottableExprs, graph.functionLibrary);
  const activeLibCount = (graph.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY).filter(
    (f) => f.enabled
  ).length;
  const anyExprVisible = graph.expressions.some((e) => e.visible);
  const activeFitExprId =
    plottableExprs.find((e) => e.fitLoss)?.id ?? plottableExprs[0]?.id;
  const showFitButton = !(graph.viewMode === 'inference' && graph.dataPoints.length === 0);

  // Detect duplicate formal function names (`Last-Row-Wins` shadowing warning)
  const shadowedExprIds = useMemo(() => {
    const byLowerName = new Map<string, string[]>();
    for (const item of plottableExprs) {
      const sig = extractFunctionSignature(item.latex);
      if (!sig || sig.formalParams.length === 0) continue;
      const lower = sig.name.toLowerCase();
      const arr = byLowerName.get(lower) ?? [];
      arr.push(item.id);
      byLowerName.set(lower, arr);
    }
    const shadowed = new Set<string>();
    for (const ids of byLowerName.values()) {
      if (ids.length > 1) {
        for (let i = 0; i < ids.length - 1; i++) {
          shadowed.add(ids[i]);
        }
      }
    }
    return shadowed;
  }, [plottableExprs]);

  // 3D Surface Axis badges (`X` / `Y`) for sliders
  const show3DAxisBadges =
    graph.viewMode !== 'inference' &&
    graph.rightViewportMode === 'loss_surface' &&
    sliderList.length >= 2;
  const { w1Key, w2Key } = resolveSurfaceParamPair(
    graph.sliders,
    graph.surfaceParamW1,
    graph.surfaceParamW2
  );

  const closeAllPopovers = (): void => {
    setOpenRoleMenuKey(null);
    setOpenStyleMenuExprId(null);
    setOpenMoreMenuExprId(null);
    setShowQuickPresets(false);
    setAddMenuOpen(false);
  };

  // Sortable lists for Expressions (Plot + Note) and Parameter Sliders
  const exprIds = useMemo(() => graph.expressions.map((e) => e.id), [graph.expressions]);
  const exprSortable = useSortableList({
    ids: exprIds,
    onReorder: (from, to) => storeState.reorderExpressions(from, to),
    onMoveByDelta: (id, dir) => storeState.moveExpression(id, dir),
    onDragStart: () => closeAllPopovers(),
  });

  const sliderNames = useMemo(() => sliderList.map((s) => s.name), [sliderList]);
  const sliderSortable = useSortableList({
    ids: sliderNames,
    onReorder: (from, to) => storeState.reorderSliders(from, to),
    onMoveByDelta: (name, dir) => storeState.moveSlider(name, dir),
    onDragStart: () => closeAllPopovers(),
  });

  // Parameter Slider Animation Loop (requestAnimationFrame) [FR-1.3]
  const anySliderPlaying = sliderList.some((s) => s.playing);
  useEffect(() => {
    if (!anySliderPlaying) return;

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number): void => {
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0.001), 0.1);
      lastTime = now;

      if (graphStore.getState().stepPlayingSliders(dt)) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [anySliderPlaying]);

  const showExpressionsSection = visibleSection === 'all' || visibleSection === 'fx';
  const showSlidersSection = visibleSection === 'all' || visibleSection === 'sliders';

  const activeStyleExpr = openStyleMenuExprId
    ? graph.expressions.find((e) => e.id === openStyleMenuExprId)
    : undefined;
  const activeMoreExprIdx = openMoreMenuExprId
    ? graph.expressions.findIndex((e) => e.id === openMoreMenuExprId)
    : -1;
  const activeMoreExpr =
    activeMoreExprIdx >= 0 ? graph.expressions[activeMoreExprIdx] : undefined;

  return (
    <div class="flex flex-col gap-3 px-2 py-2.5 sm:p-3 text-xs">
      {/* Section 1: Expressions Toolbar + Sortable Expression/Note Cards */}
      {showExpressionsSection && (
        <>
          <div ref={topToolbarRef} class="relative flex items-center justify-between gap-2">
            <div ref={addSplitGroupRef} class="inline-flex rounded-md shadow-2xs">
              <button
                type="button"
                onClick={() => storeState.addExpression()}
                class="inline-flex items-center gap-1 h-7 pl-2 pr-2.5 rounded-l-md bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors"
              >
                <IconPlus class="w-3 h-3" />
                <span>{t('add_function_short')}</span>
              </button>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
                aria-label={t('add_menu_more')}
                title={t('add_menu_more')}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = !addMenuOpen;
                  closeAllPopovers();
                  setAddMenuOpen(next);
                }}
                class="inline-flex items-center justify-center h-7 w-7 rounded-r-md border-l border-orange-600/60 bg-orange-500 text-white hover:bg-orange-600 transition-colors"
              >
                <IconChevronDown class="w-3 h-3" />
              </button>
            </div>

            <div class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => storeState.toggleAllExpressionsVisible()}
                disabled={graph.expressions.length === 0}
                class="flex items-center justify-center w-7 h-7 rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-orange-500 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                title={anyExprVisible ? 'Hide all curves' : 'Show all curves'}
                aria-label={anyExprVisible ? 'Hide all curves' : 'Show all curves'}
              >
                {anyExprVisible ? (
                  <IconEye class="w-3.5 h-3.5" />
                ) : (
                  <IconEyeOff class="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => storeState.clearAllExpressions()}
                disabled={graph.expressions.length === 0}
                class="flex items-center gap-1 h-7 px-2 rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-red-500 hover:text-red-500 transition-colors text-[11px] disabled:opacity-40 disabled:pointer-events-none"
                title={t('clear_expr_btn_tooltip')}
              >
                <IconTrash class="w-3.5 h-3.5" />
                <span>{t('clear_expr_btn')}</span>
              </button>
            </div>

            {/* Portal: Add + Caret Menu */}
            <FloatingPopover
              open={addMenuOpen}
              anchorEl={addSplitGroupRef.current}
              onClose={() => setAddMenuOpen(false)}
              align="left"
              preferredWidthPx={236}
              class="w-60 py-1.5 flex flex-col text-xs"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  setShowQuickPresets(true);
                }}
                class="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title={t('quick_presets_label')}
              >
                <span class="w-3.5 text-center">⚡</span>
                <span>{t('quick_presets_label')}…</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  storeState.setFunctionLibraryDrawerOpen(true);
                }}
                class="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title={t('fn_lib_btn_tooltip')}
              >
                <IconFunction class="w-3.5 h-3.5 text-orange-500" />
                <span class="flex-1">{t('fn_lib_btn')}</span>
                <span class="text-[10px] px-1.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-mono">
                  {activeLibCount}
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddMenuOpen(false);
                  setImportDraft({ text: '' });
                }}
                class="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                title={t('latex_import_btn_tooltip')}
              >
                <span>{t('latex_import_btn')}…</span>
              </button>
            </FloatingPopover>

            {/* Portal: Quick Presets Menu */}
            <FloatingPopover
              open={showQuickPresets}
              anchorEl={topToolbarRef.current}
              onClose={() => setShowQuickPresets(false)}
              align="left"
              matchAnchorWidth
              class="p-1.5 flex flex-col gap-2 text-xs"
            >
              {QUICK_FORMULA_GROUPS.map((grp) => (
                <div key={grp.groupKey} class="flex flex-col gap-0.5">
                  <div class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                    {t(grp.groupKey)}
                  </div>
                  {grp.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        storeState.addExpression(item.latex, item.label);
                        setShowQuickPresets(false);
                      }}
                      class="flex items-center justify-between gap-2 px-2 py-1 rounded text-left hover:bg-orange-500/10 dark:hover:bg-neutral-800 transition-colors min-w-0"
                    >
                      <span class="font-mono font-semibold text-neutral-800 dark:text-neutral-100 text-[11px] shrink-0">
                        {item.label}
                      </span>
                      <span class="text-[10px] text-neutral-400 truncate">{item.desc}</span>
                    </button>
                  ))}
                </div>
              ))}
            </FloatingPopover>
          </div>

          <div class="flex flex-col gap-2">
            {graph.expressions.length === 0 && (
              <div class="flex flex-col items-center justify-center p-6 text-center border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg text-neutral-400 dark:text-neutral-500">
                <p class="text-xs">{t('no_expressions')}</p>
                <button
                  type="button"
                  onClick={() => storeState.addExpression()}
                  class="mt-2 inline-flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"
                >
                  <IconPlus class="w-3 h-3" />
                  <span>{t('add_function_short')}</span>
                </button>
              </div>
            )}

            {graph.expressions.map((expr, idx) => {
              const itemBind = exprSortable.getItemBind(expr.id, idx);

              if (isNoteExpression(expr)) {
                const noteHandleBind = exprSortable.getHandleBind(expr.id, idx, () => {
                  storeState.toggleExpressionProp(expr.id, 'collapsed');
                });
                return (
                  <NoteExpressionCard
                    key={expr.id}
                    expr={expr}
                    index={idx}
                    totalCount={graph.expressions.length}
                    storeState={storeState}
                    itemBind={itemBind}
                    handleBind={noteHandleBind}
                  />
                );
              }

              const isEmpty = expr.latex.trim().length === 0;
              const classified = classifyLatexExpression(
                expr.latex,
                graph.symbolOverrides,
                userFunctions
              );
              const curvePacket = curves.find((c) => c.exprId === expr.id);
              const derivSymbol = resolveDerivSymbol(
                classified.signature?.rawHeader ?? expr.label
              );
              const shortDerivSymbol = derivSymbol.length <= 2 ? derivSymbol : 'f';
              const isFitTarget = expr.id === activeFitExprId;
              const activeLineStyle: CurveLineStyle = expr.lineStyle ?? 'solid';
              const activeLineWidth = expr.lineWidth ?? 2.6;
              const isStyleMenuOpen = openStyleMenuExprId === expr.id;
              const isMoreMenuOpen = openMoreMenuExprId === expr.id;
              const isShadowed = shadowedExprIds.has(expr.id);

              const firstDerivLatex =
                classified.valid && expr.showFirstDerivative
                  ? curvePacket?.firstDerivFormulaLatex ||
                    mathJsonToLatex(symbolicDiff(classified.stabilizedExpr, classified.primaryVar))
                  : undefined;
              const secondDerivLatex =
                classified.valid && expr.showSecondDerivative
                  ? curvePacket?.secondDerivFormulaLatex ||
                    mathJsonToLatex(
                      symbolicSecondDiff(classified.stabilizedExpr, classified.primaryVar)
                    )
                  : undefined;

              const exprHandleBind = exprSortable.getHandleBind(expr.id, idx, () => {
                const next = openStyleMenuExprId === expr.id ? null : expr.id;
                closeAllPopovers();
                setOpenStyleMenuExprId(next);
              });

              return (
                <div
                  key={expr.id}
                  ref={itemBind.ref}
                  style={itemBind.style}
                  onKeyDown={itemBind.onKeyDown}
                  class={`relative rounded-lg border bg-white dark:bg-neutral-900 shadow-2xs flex items-stretch transition-[opacity,box-shadow] ${
                    expr.collapsed ? 'min-h-[38px]' : 'min-h-[46px]'
                  } ${
                    itemBind.isDragging
                      ? 'border-orange-500 ring-2 ring-orange-500/50 shadow-lg opacity-95'
                      : expr.visible
                        ? 'border-neutral-200 dark:border-neutral-800'
                        : 'border-neutral-200/60 dark:border-neutral-800/60 opacity-75'
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

                  {/* 32px Unified Left Gutter: Tap (<= 6px) opens Color/Line Style | Drag (> 6px) Reorders */}
                  <button
                    ref={(el) => {
                      if (el) styleBtnRefs.current.set(expr.id, el);
                      else styleBtnRefs.current.delete(expr.id);
                    }}
                    type="button"
                    data-testid={`expr-style-btn-${expr.id}`}
                    aria-haspopup="menu"
                    aria-expanded={isStyleMenuOpen}
                    aria-label={t('line_style_btn')}
                    title={t('drag_or_style_tooltip')}
                    {...exprHandleBind}
                    class={`w-8 shrink-0 flex flex-col items-center justify-center gap-1 rounded-l-lg border-r transition-colors touch-none select-none cursor-grab active:cursor-grabbing ${
                      isStyleMenuOpen
                        ? 'border-orange-500/50 bg-orange-500/10'
                        : 'border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/60 dark:bg-neutral-950/40 hover:bg-orange-500/5'
                    }`}
                  >
                    {expr.collapsed ? (
                      <span class="flex items-center gap-0.5">
                        <span
                          class="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: expr.color }}
                        />
                        <IconGripVertical class="w-3 h-3 text-neutral-400" />
                      </span>
                    ) : (
                      <>
                        <span class="flex flex-col items-center gap-0.5">
                          <span
                            class="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: expr.color }}
                          />
                          <svg class="w-4 h-2 overflow-visible" viewBox="0 0 18 6">
                            <line
                              x1="1"
                              y1="3"
                              x2="17"
                              y2="3"
                              stroke={expr.color}
                              stroke-width={
                                activeLineWidth > 3.2 ? 3.2 : activeLineWidth < 2 ? 1.5 : 2.3
                              }
                              stroke-linecap="round"
                              stroke-dasharray={
                                activeLineStyle === 'dashed'
                                  ? '4 3'
                                  : activeLineStyle === 'dotted'
                                    ? '1 3.5'
                                    : undefined
                              }
                            />
                          </svg>
                        </span>
                        <IconGripVertical class="w-3 h-3 text-neutral-400/80" />
                      </>
                    )}
                  </button>

                  {/* Right Content Column */}
                  {expr.collapsed ? (
                    <div class="flex-1 min-w-0 flex items-center justify-between gap-1 px-2 py-1">
                      <button
                        type="button"
                        onClick={() => storeState.toggleExpressionProp(expr.id, 'collapsed')}
                        class="flex-1 min-w-0 flex items-center gap-1.5 text-left hover:opacity-80"
                        title={t('expand_card')}
                      >
                        <span class="shrink-0 font-semibold text-neutral-700 dark:text-neutral-200 text-xs truncate max-w-[96px]">
                          {expr.label || `f_${idx + 1}(${classified.primaryVar})`}:
                        </span>
                        <span
                          class="gs-katex-line min-w-0 flex-1 text-xs text-neutral-800 dark:text-neutral-100"
                          dangerouslySetInnerHTML={{
                            __html: renderLatexPreview(
                              formatExpressionForKatex(expr.latex || '…')
                            ),
                          }}
                        />
                      </button>

                      <div class="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => storeState.toggleExpressionProp(expr.id, 'visible')}
                          class={`w-6 h-6 flex items-center justify-center rounded ${
                            expr.visible ? 'text-orange-500' : 'text-neutral-400'
                          }`}
                          title={expr.visible ? 'Hide curve' : 'Show curve'}
                        >
                          {expr.visible ? <IconEye /> : <IconEyeOff />}
                        </button>
                        <button
                          ref={(el) => {
                            if (el) moreBtnRefs.current.set(expr.id, el);
                            else moreBtnRefs.current.delete(expr.id);
                          }}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={isMoreMenuOpen}
                          aria-label={t('card_more_actions')}
                          title={t('card_more_actions')}
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = isMoreMenuOpen ? null : expr.id;
                            closeAllPopovers();
                            setOpenMoreMenuExprId(next);
                          }}
                          class={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                            isMoreMenuOpen
                              ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                              : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                          }`}
                        >
                          <IconMore class="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div class="flex-1 min-w-0 flex flex-col gap-1.5 px-1.5 py-2 sm:p-2">
                      {/* Row 1: Spacious Function Name Input + Essential Action Cluster */}
                      <div class="flex items-center justify-between gap-1 min-w-0">
                        <div class="flex items-center gap-1 min-w-0 flex-1">
                          <input
                            type="text"
                            value={expr.label ?? ''}
                            placeholder={`f_${idx + 1}(${classified.primaryVar})`}
                            aria-label={t('expr_name_placeholder')}
                            title={t('expr_name_tooltip')}
                            onInput={(e) =>
                              storeState.updateExpressionLabel(
                                expr.id,
                                (e.target as HTMLInputElement).value
                              )
                            }
                            class="w-0 min-w-[3.5rem] flex-1 text-ellipsis px-1.5 py-0.5 rounded border border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-orange-500 focus:bg-neutral-50 dark:focus:bg-neutral-950 bg-transparent font-semibold text-neutral-700 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 text-xs focus:outline-none transition-colors"
                          />
                        </div>

                        <div class="flex items-center gap-0.5 shrink-0">
                          {showFitButton && (
                            <button
                              type="button"
                              onClick={() => storeState.setExpressionFitLoss(expr.id)}
                              class={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                                isFitTarget
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/50'
                                  : 'border-neutral-300 dark:border-neutral-700 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200'
                              }`}
                              title="Use this function for empirical loss & 3D surface optimization"
                            >
                              <IconTarget class="w-2.5 h-2.5" />
                              <span>Fit</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              storeState.toggleExpressionProp(expr.id, 'showFirstDerivative')
                            }
                            class={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-mono border transition-colors ${
                              expr.showFirstDerivative
                                ? 'bg-orange-500 text-white border-orange-500'
                                : 'border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:border-orange-500'
                            }`}
                            title={`Toggle 1st Derivative ${derivSymbol}'(${classified.primaryVar}) (dashed)`}
                          >
                            <span>{shortDerivSymbol}&apos;</span>
                          </button>

                          {/* Active 2nd Derivative chip surfaced inline when enabled for 1-tap turn-off */}
                          {expr.showSecondDerivative && (
                            <button
                              type="button"
                              onClick={() =>
                                storeState.toggleExpressionProp(expr.id, 'showSecondDerivative')
                              }
                              class="inline-flex items-center justify-center px-1 py-0.5 rounded text-[10px] font-mono bg-orange-500 text-white border border-orange-500 transition-colors"
                              title={`Disable 2nd Derivative ${derivSymbol}''(${classified.primaryVar})`}
                            >
                              <span>{shortDerivSymbol}&apos;&apos;</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => storeState.toggleExpressionProp(expr.id, 'visible')}
                            class={`w-6 h-6 flex items-center justify-center rounded ${
                              expr.visible ? 'text-orange-500' : 'text-neutral-400'
                            }`}
                            title={expr.visible ? 'Hide curve' : 'Show curve'}
                          >
                            {expr.visible ? <IconEye /> : <IconEyeOff />}
                          </button>

                          <button
                            ref={(el) => {
                              if (el) moreBtnRefs.current.set(expr.id, el);
                              else moreBtnRefs.current.delete(expr.id);
                            }}
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={isMoreMenuOpen}
                            aria-label={t('card_more_actions')}
                            title={t('card_more_actions')}
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = isMoreMenuOpen ? null : expr.id;
                              closeAllPopovers();
                              setOpenMoreMenuExprId(next);
                            }}
                            class={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                              isMoreMenuOpen
                                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                                : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                            }`}
                          >
                            <IconMore class="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Row 2: Full-width Formula Input + Mini Math Bar (0KB) or KaTeX Display */}
                      {editingExprId === expr.id || isEmpty || !classified.valid ? (
                        <div class="flex flex-col gap-1">
                          <div class="relative flex items-center">
                            <input
                              type="text"
                              value={expr.latex}
                              ref={(el) => {
                                if (el) editInputRefs.current.set(expr.id, el);
                                else editInputRefs.current.delete(expr.id);
                              }}
                              onFocus={() => setEditingExprId(expr.id)}
                              onPaste={(e) => {
                                const text = e.clipboardData?.getData('text/plain') ?? '';
                                if (!text.trim()) return;
                                const LATEX_MARKER_RE = /\\(?:[a-zA-Z]+|\[|\()|_\{|\^\{/;
                                const importCtx = {
                                  symbolOverrides: graph.symbolOverrides,
                                  existingExpressions: plottableExprs,
                                  functionLibrary: graph.functionLibrary,
                                };

                                if (LATEX_MARKER_RE.test(text)) {
                                  const segments = analyzePastedLatex(text, importCtx);
                                  if (segments.length === 1 && segments[0].status !== 'note') {
                                    e.preventDefault();
                                    const input = e.currentTarget;
                                    const start = input.selectionStart ?? 0;
                                    const end = input.selectionEnd ?? input.value.length;
                                    const isWhole =
                                      (start === 0 && end === input.value.length) || isEmpty;
                                    const updatedLatex = isWhole
                                      ? segments[0].latex
                                      : input.value.slice(0, start) +
                                        segments[0].latex +
                                        input.value.slice(end);
                                    storeState.updateExpressionLatex(expr.id, updatedLatex);
                                    return;
                                  }
                                  e.preventDefault();
                                  setImportDraft({
                                    text,
                                    replaceId: isEmpty ? expr.id : undefined,
                                  });
                                  return;
                                }

                                const intercept = shouldInterceptPaste(text, isEmpty, importCtx);
                                if (!intercept) return;
                                e.preventDefault();
                                setImportDraft({ text, replaceId: isEmpty ? expr.id : undefined });
                              }}
                              onBlur={() =>
                                setEditingExprId((prev) => (prev === expr.id ? null : prev))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  setEditingExprId(null);
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              onInput={(e) =>
                                storeState.updateExpressionLatex(
                                  expr.id,
                                  (e.target as HTMLInputElement).value
                                )
                              }
                              placeholder="f(t)=sin(t), x^2 {x<3}, {x<0: -x, x>=0: x^2}..."
                              class={`w-full pl-2.5 pr-7 py-1.5 rounded border font-mono text-xs bg-neutral-50 dark:bg-neutral-950 ${
                                isEmpty || classified.valid
                                  ? 'border-orange-500 ring-1 ring-orange-500/30'
                                  : 'border-red-500 text-red-600 dark:text-red-400'
                              } focus:outline-none`}
                            />
                            {!isTouchOrCompact && (
                              <button
                                type="button"
                                tabIndex={-1}
                                title={t('math_kb_toggle')}
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  setDesktopMathBarOpen((prev) => !prev);
                                }}
                                class={`absolute right-1.5 px-1 py-0.5 rounded text-[10px] font-mono transition-colors ${
                                  desktopMathBarOpen
                                    ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400 font-bold'
                                    : 'text-neutral-400 hover:text-orange-500'
                                }`}
                              >
                                ∑
                              </button>
                            )}
                          </div>

                          {editingExprId === expr.id &&
                            (isTouchOrCompact || desktopMathBarOpen) && (
                              <MiniMathBar
                                getInputEl={() => editInputRefs.current.get(expr.id) ?? null}
                                currentValue={expr.latex}
                                onInsert={(nextVal) =>
                                  storeState.updateExpressionLatex(expr.id, nextVal)
                                }
                              />
                            )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingExprId(expr.id)}
                          title="Click to edit raw LaTeX / mathematical formula"
                          class="group w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-neutral-200 dark:border-neutral-800 hover:border-orange-500/60 bg-neutral-50/70 dark:bg-neutral-950/70 text-left min-w-0 overflow-hidden transition-colors cursor-text"
                        >
                          <span
                            class="gs-katex-line min-w-0 flex-1 text-xs text-neutral-900 dark:text-neutral-100"
                            dangerouslySetInnerHTML={{
                              __html: renderLatexPreview(formatExpressionForKatex(expr.latex)),
                            }}
                          />
                          <span class="shrink-0 text-[10px] font-mono text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            ✎ LaTeX
                          </span>
                        </button>
                      )}

                      {/* Reusable Function Signature Pill (+ Last-Row-Wins Shadowed Badge) */}
                      {classified.valid &&
                        classified.signature &&
                        classified.signature.formalParams.length > 0 && (
                          <div class="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-sky-500/10 border border-sky-500/30 text-[10px] min-w-0">
                            <div class="flex items-center gap-1.5 min-w-0">
                              <span class="font-mono text-sky-700 dark:text-sky-300 truncate">
                                fn:{' '}
                                <strong>
                                  {classified.signature.name}(
                                  {classified.signature.formalParams.join(', ')})
                                </strong>
                              </span>
                              {isShadowed && (
                                <span
                                  class="shrink-0 px-1 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-[9px] font-semibold"
                                  title={t('fn_overridden_tooltip')}
                                >
                                  ⚠ {t('fn_overridden_badge')}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const sig = classified.signature!;
                                const callArgs = ['x', ...sig.formalParams.slice(1)].join(', ');
                                storeState.addExpression(
                                  `${sig.name}(${callArgs})`,
                                  `${sig.name}(x)`
                                );
                              }}
                              class="shrink-0 px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-700 dark:text-sky-200 font-semibold hover:bg-sky-500/30"
                            >
                              + Reuse
                            </button>
                          </div>
                        )}

                      {isShadowed &&
                        !(
                          classified.valid &&
                          classified.signature &&
                          classified.signature.formalParams.length > 0
                        ) && (
                          <div
                            class="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-[10px] font-semibold"
                            title={t('fn_overridden_tooltip')}
                          >
                            ⚠ {t('fn_overridden_badge')}
                          </div>
                        )}

                      {!isEmpty &&
                        !classified.valid &&
                        (() => {
                          const unknownFnMatch =
                            classified.errorMessage?.match(/Unknown function '([^']+)'/);
                          const unknownFn = unknownFnMatch?.[1];
                          const pVar = classified.primaryVar || 'x';
                          return (
                            <div class="space-y-1">
                              <p class="text-[11px] text-red-500 font-medium">
                                {classified.errorMessage}
                              </p>
                              {unknownFn && (
                                <div class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-300">
                                  <span>
                                    {t('undefined_subfunction_hint')}:{' '}
                                    <code class="font-mono font-bold">
                                      {unknownFn}({pVar})
                                    </code>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      storeState.addExpression(`${unknownFn}(${pVar}) = ${pVar}`);
                                    }}
                                    class="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-100 font-semibold text-[10px] transition-colors"
                                  >
                                    + {t('create_subfunction_btn')} {unknownFn}({pVar}) = {pVar}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                      {/* Symbolic Derivative Readouts [FR-2.1] */}
                      {classified.valid && expr.showFirstDerivative && firstDerivLatex && (
                        <div class="flex items-center justify-between gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300 bg-neutral-100/70 dark:bg-neutral-800/60 px-2 py-1 rounded">
                          <div
                            class="gs-katex-line min-w-0 flex-1 overflow-x-auto"
                            dangerouslySetInnerHTML={{
                              __html: renderLatexPreview(
                                `${derivSymbol}'(${classified.primaryVar}) = ${firstDerivLatex}`
                              ),
                            }}
                          />
                          <button
                            type="button"
                            data-testid={`clone-deriv-1-${expr.id}`}
                            onClick={() =>
                              storeState.cloneDerivativeAsExpression(expr.id, 1, firstDerivLatex)
                            }
                            class="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-500/15 hover:bg-orange-500/25 text-orange-700 dark:text-orange-300 border border-orange-500/30 font-semibold text-[10px] transition-colors"
                            title={t('clone_deriv_tooltip')}
                            aria-label={t('clone_deriv_tooltip')}
                          >
                            <IconPlus class="w-2.5 h-2.5" />
                            <span>
                              {t('clone_deriv_btn')} {derivSymbol}&apos;({classified.primaryVar})
                            </span>
                          </button>
                        </div>
                      )}
                      {classified.valid && expr.showSecondDerivative && secondDerivLatex && (
                        <div class="flex items-center justify-between gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300 bg-neutral-100/70 dark:bg-neutral-800/60 px-2 py-1 rounded">
                          <div
                            class="gs-katex-line min-w-0 flex-1 overflow-x-auto"
                            dangerouslySetInnerHTML={{
                              __html: renderLatexPreview(
                                `${derivSymbol}''(${classified.primaryVar}) = ${secondDerivLatex}`
                              ),
                            }}
                          />
                          <button
                            type="button"
                            data-testid={`clone-deriv-2-${expr.id}`}
                            onClick={() =>
                              storeState.cloneDerivativeAsExpression(expr.id, 2, secondDerivLatex)
                            }
                            class="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-500/15 hover:bg-orange-500/25 text-orange-700 dark:text-orange-300 border border-orange-500/30 font-semibold text-[10px] transition-colors"
                            title={t('clone_deriv_tooltip')}
                            aria-label={t('clone_deriv_tooltip')}
                          >
                            <IconPlus class="w-2.5 h-2.5" />
                            <span>
                              {t('clone_deriv_btn')} {derivSymbol}&apos;&apos;(
                              {classified.primaryVar})
                            </span>
                          </button>
                        </div>
                      )}

                      {/* Role-Selection Chips (Data / Param / Hyper) via Portal [FR-1.4] */}
                      {classified.symbols.length > 0 && (
                        <div class="flex flex-wrap gap-1 pt-0.5">
                          {classified.symbols.map((sym) => {
                            const menuKey = `expr:${expr.id}:${sym.name}`;
                            const isOpen = openRoleMenuKey === menuKey;
                            const roleLabel =
                              sym.role === 'data_var'
                                ? 'Data'
                                : sym.role === 'param'
                                  ? 'Param'
                                  : 'Hyper';

                            return (
                              <div key={sym.name} class="inline-block">
                                <button
                                  ref={(el) => {
                                    if (el) roleBtnRefs.current.set(menuKey, el);
                                    else roleBtnRefs.current.delete(menuKey);
                                  }}
                                  type="button"
                                  aria-haspopup="menu"
                                  aria-expanded={isOpen}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const next = isOpen ? null : menuKey;
                                    closeAllPopovers();
                                    setOpenRoleMenuKey(next);
                                  }}
                                  class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold transition-transform active:scale-95 ${
                                    ROLE_BADGE_STYLE[sym.role]
                                  }`}
                                  title="Choose symbol role: Data (Axis), Param, or Hyper"
                                >
                                  <span>{roleLabel}: </span>
                                  <span
                                    class="inline-block"
                                    dangerouslySetInnerHTML={{
                                      __html: renderLatexPreview(sym.latex || sym.name),
                                    }}
                                  />
                                  <span class="opacity-70 text-[9px]">▾</span>
                                </button>

                                <FloatingPopover
                                  open={isOpen}
                                  anchorEl={roleBtnRefs.current.get(menuKey) ?? null}
                                  onClose={() => setOpenRoleMenuKey(null)}
                                  align="left"
                                  preferredWidthPx={152}
                                  class="w-38 py-1 flex flex-col text-[11px]"
                                >
                                  {ROLE_OPTIONS.map((opt) => {
                                    const active = sym.role === opt.role;
                                    return (
                                      <button
                                        key={opt.role}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          storeState.setSymbolRole(
                                            sym.name,
                                            opt.role as SymbolRole
                                          );
                                          setOpenRoleMenuKey(null);
                                        }}
                                        class={`flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                                          active
                                            ? 'font-bold text-orange-600 dark:text-orange-400'
                                            : ''
                                        }`}
                                      >
                                        <span class="flex items-center gap-1.5">
                                          <span class={`w-2 h-2 rounded-full ${opt.dotClass}`} />
                                          <span>{opt.shortLabel}</span>
                                          <span class="text-[9px] text-neutral-400">
                                            ({opt.desc})
                                          </span>
                                        </span>
                                        {active && <span>✓</span>}
                                      </button>
                                    );
                                  })}
                                </FloatingPopover>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Portal: Line Color, Dash Style & Weight Popover (●─) */}
      {activeStyleExpr && (
        <FloatingPopover
          open={Boolean(activeStyleExpr)}
          anchorEl={styleBtnRefs.current.get(activeStyleExpr.id) ?? null}
          onClose={() => setOpenStyleMenuExprId(null)}
          align="left"
          preferredWidthPx={240}
          testId={`expr-style-popover-${activeStyleExpr.id}`}
          class="w-60 p-2.5 flex flex-col gap-2 text-[11px]"
        >
          <div class="flex flex-col gap-1">
            <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              {t('style_color_label')}
            </span>
            <div class="flex flex-wrap items-center gap-1.5">
              {EXPRESSION_COLORS.map((swatch) => {
                const isSelected =
                  activeStyleExpr.color.toLowerCase() === swatch.toLowerCase();
                return (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() =>
                      storeState.updateExpressionStyle(activeStyleExpr.id, { color: swatch })
                    }
                    class={`w-4.5 h-4.5 rounded-full border transition-transform ${
                      isSelected
                        ? 'scale-110 ring-2 ring-orange-500 border-white dark:border-neutral-900'
                        : 'border-neutral-300 dark:border-neutral-700 hover:scale-105'
                    }`}
                    style={{ backgroundColor: swatch }}
                    title={swatch}
                    aria-label={`Select color ${swatch}`}
                  />
                );
              })}
              <label
                class="relative inline-flex items-center justify-center w-4.5 h-4.5 rounded-full border border-dashed border-neutral-400 dark:border-neutral-600 cursor-pointer hover:border-orange-500 overflow-hidden"
                title="Custom color"
              >
                <span class="text-[9px] font-bold text-neutral-500">+</span>
                <input
                  type="color"
                  value={activeStyleExpr.color}
                  onInput={(e) =>
                    storeState.updateExpressionStyle(activeStyleExpr.id, {
                      color: (e.target as HTMLInputElement).value,
                    })
                  }
                  class="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  aria-label="Custom line color"
                />
              </label>
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              {t('style_dash_label')}
            </span>
            <div class="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'solid' as const, label: t('style_solid'), dash: undefined },
                  { id: 'dashed' as const, label: t('style_dashed'), dash: '5 3.5' },
                  { id: 'dotted' as const, label: t('style_dotted'), dash: '1.5 4' },
                ] as const
              ).map((opt) => {
                const active = (activeStyleExpr.lineStyle ?? 'solid') === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      storeState.updateExpressionStyle(activeStyleExpr.id, {
                        lineStyle: opt.id,
                      })
                    }
                    class={`flex items-center justify-center gap-1 py-1 px-1 rounded border text-[10px] font-medium transition-colors ${
                      active
                        ? 'border-orange-500 bg-orange-500/15 text-orange-700 dark:text-orange-300 font-semibold'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    <svg class="w-4 h-2 overflow-visible shrink-0" viewBox="0 0 18 6">
                      <line
                        x1="1"
                        y1="3"
                        x2="17"
                        y2="3"
                        stroke={activeStyleExpr.color}
                        stroke-width="2.2"
                        stroke-linecap="round"
                        stroke-dasharray={opt.dash}
                      />
                    </svg>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              {t('style_weight_label')}
            </span>
            <div class="grid grid-cols-3 gap-1">
              {(
                [
                  { width: 1.6, label: t('style_thin') },
                  { width: 2.6, label: t('style_normal') },
                  { width: 4.2, label: t('style_bold') },
                ] as const
              ).map((wOpt) => {
                const active =
                  Math.abs((activeStyleExpr.lineWidth ?? 2.6) - wOpt.width) < 0.3;
                return (
                  <button
                    key={wOpt.width}
                    type="button"
                    onClick={() =>
                      storeState.updateExpressionStyle(activeStyleExpr.id, {
                        lineWidth: wOpt.width,
                      })
                    }
                    class={`flex items-center justify-center gap-1 py-1 px-1 rounded border text-[10px] font-medium transition-colors ${
                      active
                        ? 'border-orange-500 bg-orange-500/15 text-orange-700 dark:text-orange-300 font-semibold'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    <svg class="w-4 h-2.5 overflow-visible shrink-0" viewBox="0 0 18 8">
                      <line
                        x1="1"
                        y1="4"
                        x2="17"
                        y2="4"
                        stroke={activeStyleExpr.color}
                        stroke-width={wOpt.width}
                        stroke-linecap="round"
                      />
                    </svg>
                    <span>{wOpt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </FloatingPopover>
      )}

      {/* Portal: Expression Card Overflow Menu [⋯] */}
      {activeMoreExpr && !isNoteExpression(activeMoreExpr) && (
        <FloatingPopover
          open={Boolean(activeMoreExpr)}
          anchorEl={moreBtnRefs.current.get(activeMoreExpr.id) ?? null}
          onClose={() => setOpenMoreMenuExprId(null)}
          align="right"
          preferredWidthPx={216}
          class="w-52 py-1 flex flex-col text-xs"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              storeState.toggleExpressionProp(activeMoreExpr.id, 'collapsed');
              setOpenMoreMenuExprId(null);
            }}
            class="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {activeMoreExpr.collapsed ? (
              <IconChevronRight class="w-3.5 h-3.5 text-neutral-400" />
            ) : (
              <IconChevronDown class="w-3.5 h-3.5 text-neutral-400" />
            )}
            <span>
              {activeMoreExpr.collapsed ? t('expand_card') : t('collapse_card')}
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              storeState.toggleExpressionProp(activeMoreExpr.id, 'showSecondDerivative');
              setOpenMoreMenuExprId(null);
            }}
            class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span class="flex items-center gap-2">
              <span class="w-3.5 text-center font-mono font-bold text-orange-500">
                f&apos;&apos;
              </span>
              <span>{t('toggle_second_deriv')}</span>
            </span>
            {activeMoreExpr.showSecondDerivative && (
              <span class="text-orange-500 font-bold">✓</span>
            )}
          </button>

          {!showFitButton && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                storeState.setExpressionFitLoss(activeMoreExpr.id);
                setOpenMoreMenuExprId(null);
              }}
              class="flex items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span class="flex items-center gap-2">
                <IconTarget class="w-3.5 h-3.5 text-emerald-500" />
                <span>Fit Target</span>
              </span>
              {activeMoreExpr.id === activeFitExprId && (
                <span class="text-emerald-500 font-bold">✓</span>
              )}
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              storeState.duplicateExpression(activeMoreExpr.id);
              setOpenMoreMenuExprId(null);
            }}
            class="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <IconCopy class="w-3.5 h-3.5 text-neutral-400" />
            <span>{t('duplicate_expr')}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              storeState.setExpressionKind(activeMoreExpr.id, 'note');
              setOpenMoreMenuExprId(null);
            }}
            class="flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span class="w-3.5 text-center text-[11px]">📝</span>
            <span>{t('expr_to_note')}</span>
          </button>

          {graph.expressions.length > 1 && (
            <>
              <div class="my-1 border-t border-neutral-200 dark:border-neutral-800" />
              <button
                type="button"
                role="menuitem"
                disabled={activeMoreExprIdx === 0}
                onClick={() => {
                  storeState.moveExpression(activeMoreExpr.id, -1);
                  setOpenMoreMenuExprId(null);
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
                disabled={activeMoreExprIdx === graph.expressions.length - 1}
                onClick={() => {
                  storeState.moveExpression(activeMoreExpr.id, 1);
                  setOpenMoreMenuExprId(null);
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
              storeState.removeExpression(activeMoreExpr.id);
              setOpenMoreMenuExprId(null);
            }}
            class="flex items-center gap-2 px-3 py-1.5 text-left text-red-600 dark:text-red-400 hover:bg-red-500/10"
          >
            <IconTrash class="w-3.5 h-3.5" />
            <span>{t('delete_expression')}</span>
          </button>
        </FloatingPopover>
      )}

      {/* Section 2: Compact Sortable Parameter Sliders */}
      {showSlidersSection && (
        <>
          {sliderList.length === 0 ? (
            visibleSection === 'sliders' && (
              <div class="p-4 text-center border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg text-neutral-500 dark:text-neutral-400 text-[11px]">
                {t('no_sliders_hint')}
              </div>
            )
          ) : (
            <div
              class={
                visibleSection === 'all'
                  ? 'pt-2 border-t border-neutral-200 dark:border-neutral-800'
                  : ''
              }
            >
              <div class="flex items-center justify-between gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setSlidersCollapsed((prev) => !prev)}
                  aria-expanded={!slidersCollapsed}
                  class="flex items-center gap-1.5 font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 text-[11px] hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
                >
                  <span>{slidersCollapsed ? '▸' : '▾'}</span>
                  <span>
                    {t('sliders_title')} ({sliderList.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => storeState.toggleAllSlidersPlay()}
                  class={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                    anySliderPlaying
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30 hover:bg-orange-500/20'
                  }`}
                  title={anySliderPlaying ? t('pause_all_btn') : t('play_all_btn')}
                >
                  {anySliderPlaying ? (
                    <IconPause class="w-2.5 h-2.5" />
                  ) : (
                    <IconPlay class="w-2.5 h-2.5" />
                  )}
                  <span>{anySliderPlaying ? t('pause_all_btn') : t('play_all_btn')}</span>
                </button>
              </div>

              {!slidersCollapsed && (
                <div class="flex flex-col gap-1.5">
                  {sliderList.map((sl, slIdx) => {
                    const itemBind = sliderSortable.getItemBind(sl.name, slIdx);
                    const handleBind = sliderSortable.getHandleBind(sl.name, slIdx, () => {
                      setExpandedSliderConfig((prev) => ({
                        ...prev,
                        [sl.name]: !prev[sl.name],
                      }));
                    });
                    const axisBadge: 'X' | 'Y' | null = show3DAxisBadges
                      ? sl.name === w1Key
                        ? 'X'
                        : sl.name === w2Key && w2Key !== w1Key
                          ? 'Y'
                          : null
                      : null;

                    return (
                      <CompactSliderCard
                        key={sl.name}
                        slider={sl}
                        index={slIdx}
                        totalCount={sliderList.length}
                        axisBadge={axisBadge}
                        configOpen={Boolean(expandedSliderConfig[sl.name])}
                        onToggleConfig={() =>
                          setExpandedSliderConfig((prev) => ({
                            ...prev,
                            [sl.name]: !prev[sl.name],
                          }))
                        }
                        storeState={storeState}
                        itemBind={itemBind}
                        handleBind={handleBind}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {importDraft && (
        <LatexImportModal
          draft={importDraft}
          storeState={storeState}
          onClose={() => setImportDraft(null)}
        />
      )}
    </div>
  );
}
