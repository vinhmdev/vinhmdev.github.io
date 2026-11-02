/**
 * Expression Algebra Sidebar: MathLive / LaTeX Bi-Directional Input,
 * Real-Time Syntax Validation, f'(x) & f''(x) Symbolic Formula Display,
 * Interactive Role-Swapping Badges [FR-1.4], and Parameter Sliders [FR-1.3].
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { classifyLatexExpression } from '../core/parser/ast-classifier';
import { graphStore, type GraphStoreState } from '../state/store';
import type { SymbolRole } from '../types/math';
import { t } from '../scripts/i18n-client';
import { IconEye, IconPause, IconPlay, IconTrash } from './icons';

function renderLatexPreview(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: false });
  } catch {
    return latex;
  }
}

interface SidebarProps {
  storeState: GraphStoreState;
}

const ROLE_BADGE_STYLE = {
  data_var: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40',
  param: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40',
  hyperparam: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/40',
  constant: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30',
  primitive: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 border-neutral-500/30',
} as const;

const MATH_QUICK_PRESETS: { label: string; latex: string }[] = [
  { label: 'a·sin(bx)+c', latex: 'a \\cdot \\sin(b \\cdot x) + c' },
  { label: 'x³ - 3x', latex: 'x^3 - 3 \\cdot x' },
  { label: 'x² - 4', latex: 'x^2 - 4' },
  { label: 'e^(-x²)', latex: 'e^{-x^2}' },
  { label: 'ln(x)', latex: '\\ln(x)' },
  { label: 'sinc(x)', latex: '\\frac{\\sin(x)}{x}' },
];

const ML_QUICK_PRESETS: { label: string; latex: string }[] = [
  { label: 'σ(wx+b)', latex: '\\sigma(w \\cdot x + b)' },
  { label: 'ReLU(wx+b)', latex: '\\operatorname{relu}(w \\cdot x + b)' },
  { label: 'GELU(x)', latex: '\\operatorname{gelu}(x)' },
  { label: 'tanh(wx+b)', latex: '\\tanh(w \\cdot x + b)' },
  { label: 'Softplus', latex: '\\operatorname{softplus}(w \\cdot x + b)' },
  { label: 'wx + b', latex: 'w \\cdot x + b' },
];

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

export function ExpressionSidebar({ storeState }: SidebarProps): JSX.Element {
  const { graph, curves, workspaceMode } = storeState;
  const isMlMode = workspaceMode === 'ml';
  const quickPresets = isMlMode ? ML_QUICK_PRESETS : MATH_QUICK_PRESETS;
  const sliderList = Object.values(graph.sliders);
  const [openRoleMenuKey, setOpenRoleMenuKey] = useState<string | null>(null);

  useEffect(() => {
    if (!openRoleMenuKey || typeof window === 'undefined') return;
    const closeMenu = (): void => setOpenRoleMenuKey(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [openRoleMenuKey]);

  // Configure MathLive custom element offline (disable external audio requests) [FR-1.1]
  useEffect(() => {
    if (typeof window === 'undefined') return;
    void import('mathlive').then((mod) => {
      if (mod.MathfieldElement) {
        mod.MathfieldElement.soundsDirectory = null;
      }
    }).catch(() => {
      /* ignore in headless test environments */
    });
  }, []);

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

  const handleInsertPreset = (latex: string): void => {
    const emptyExpr = graph.expressions.find((e) => e.latex.trim().length === 0);
    if (emptyExpr) {
      storeState.updateExpressionLatex(emptyExpr.id, latex);
    } else {
      storeState.addExpression(latex);
    }
  };

  const handleClearAllExpressions = (): void => {
    storeState.loadFullState(
      {
        ...graph,
        activeTemplateId: isMlMode ? graph.activeTemplateId : 'T-00',
        viewMode: isMlMode ? graph.viewMode : 'inference',
        sliders: {},
        expressions: [
          {
            id: 'expr-1',
            latex: '',
            color: '#f97316',
            visible: true,
            showFirstDerivative: false,
            showSecondDerivative: false,
            label: 'f(x)',
          },
        ],
      },
      true
    );
  };

  return (
    <div class="flex flex-col gap-3 p-3 text-xs">
      {/* Section 1: Algebra & Expressions */}
      <div class="flex items-center justify-between gap-1">
        <h2 class="font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 text-[11px]">
          {t('expressions_title')}
        </h2>
        <div class="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClearAllExpressions}
            class="px-2 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-orange-500 transition-colors"
            title="Clear all expressions to a blank input"
          >
            {t('clear_expr_btn')}
          </button>
          <button
            type="button"
            onClick={() => storeState.addExpression()}
            class="px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-500/25 transition-colors"
          >
            {t('add_expression')}
          </button>
        </div>
      </div>

      {/* Quick Formula Presets Bar (Desmos / GeoGebra style) */}
      <div class="flex flex-wrap items-center gap-1">
        <span class="text-[10px] font-semibold text-neutral-400 mr-0.5">
          {t('quick_presets_label')}:
        </span>
        {quickPresets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => handleInsertPreset(p.latex)}
            class="px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-orange-500 text-[10px] font-mono text-neutral-700 dark:text-neutral-300 transition-colors"
            title={`Insert ${p.latex}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div class="flex flex-col gap-2.5">
        {graph.expressions.map((expr, idx) => {
          const isEmpty = expr.latex.trim().length === 0;
          const classified = classifyLatexExpression(expr.latex, graph.symbolOverrides);
          const curvePacket = curves.find((c) => c.exprId === expr.id);
          const sliderSyms = classified.symbols.filter((s) => s.role !== 'data_var');

          return (
            <div
              key={expr.id}
              class="p-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xs flex flex-col gap-2"
            >
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex items-center gap-1.5">
                  <span
                    class="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: expr.color }}
                  />
                  <span class="font-semibold text-neutral-700 dark:text-neutral-200 truncate">
                    {expr.label || `f_${idx + 1}(${classified.primaryVar})`}
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => storeState.toggleExpressionProp(expr.id, 'showFirstDerivative')}
                    class={`px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                      expr.showFirstDerivative
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'
                    }`}
                    title="Toggle 1st Derivative f'(x) (dashed)"
                  >
                    f&apos;({classified.primaryVar})
                  </button>
                  <button
                    type="button"
                    onClick={() => storeState.toggleExpressionProp(expr.id, 'showSecondDerivative')}
                    class={`px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                      expr.showSecondDerivative
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'border-neutral-300 dark:border-neutral-700 text-neutral-500'
                    }`}
                    title="Toggle 2nd Derivative f''(x) (dash-dot, Dirac mollifier)"
                  >
                    f&apos;&apos;({classified.primaryVar})
                  </button>
                  <button
                    type="button"
                    onClick={() => storeState.toggleExpressionProp(expr.id, 'visible')}
                    class={`p-1 rounded ${expr.visible ? 'text-orange-500' : 'text-neutral-400'}`}
                    title="Toggle curve visibility"
                  >
                    <IconEye />
                  </button>
                  <button
                    type="button"
                    onClick={() => storeState.removeExpression(expr.id)}
                    class="p-1 rounded text-neutral-400 hover:text-red-500"
                    title={graph.expressions.length > 1 ? 'Delete expression' : 'Clear expression'}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>

              {/* Bi-directional LaTeX / ASCII Formula Input [FR-1.1] */}
              <input
                type="text"
                value={expr.latex}
                onInput={(e) =>
                  storeState.updateExpressionLatex(expr.id, (e.target as HTMLInputElement).value)
                }
                placeholder={
                  isMlMode
                    ? 'Type model or activation: \\sigma(w*x+b), relu(w*x+b), gelu(x)...'
                    : 'Type any function: sin(x), x^3 - 3x, a*sin(b*x)+c, ln(x)...'
                }
                class={`w-full px-2.5 py-1.5 rounded border font-mono text-xs bg-neutral-50 dark:bg-neutral-950 ${
                  isEmpty || classified.valid
                    ? 'border-neutral-300 dark:border-neutral-700 focus:border-orange-500'
                    : 'border-red-500 text-red-600 dark:text-red-400'
                } focus:outline-none`}
              />

              {!isEmpty && !classified.valid && (
                <p class="text-[11px] text-red-500 font-medium">{classified.errorMessage}</p>
              )}

              {/* Symbolic Derivative Readouts with KaTeX rendering [FR-2.1] */}
              {classified.valid && expr.showFirstDerivative && curvePacket?.firstDerivFormulaLatex && (
                <div
                  class="text-[11px] text-neutral-600 dark:text-neutral-300 bg-neutral-100/70 dark:bg-neutral-800/60 px-2 py-1 rounded overflow-x-auto"
                  dangerouslySetInnerHTML={{
                    __html: renderLatexPreview(
                      `f'(${classified.primaryVar}) = ${curvePacket.firstDerivFormulaLatex}`
                    ),
                  }}
                />
              )}
              {classified.valid && expr.showSecondDerivative && curvePacket?.secondDerivFormulaLatex && (
                <div
                  class="text-[11px] text-neutral-600 dark:text-neutral-300 bg-neutral-100/70 dark:bg-neutral-800/60 px-2 py-1 rounded overflow-x-auto"
                  dangerouslySetInnerHTML={{
                    __html: renderLatexPreview(
                      `f''(${classified.primaryVar}) = ${curvePacket.secondDerivFormulaLatex}`
                    ),
                  }}
                />
              )}

              {/* Standard Math Mode: Clean Axis Selector & Slider Summary (No ML Jargon) */}
              {!isMlMode && classified.symbols.length > 1 && (
                <div class="flex flex-wrap items-center justify-between gap-1.5 pt-0.5 text-[10px]">
                  <div class="relative inline-block">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `axis:${expr.id}`;
                        setOpenRoleMenuKey(openRoleMenuKey === key ? null : key);
                      }}
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-semibold"
                      title="Chọn biến làm trục hoành (các ký hiệu còn lại tự động thành thanh trượt)"
                    >
                      <span>
                        {t('axis_var_label')}: <b class="font-mono">{classified.primaryVar}</b>
                      </span>
                      <span class="opacity-70 text-[9px]">▾</span>
                    </button>

                    {openRoleMenuKey === `axis:${expr.id}` && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        class="absolute left-0 top-full mt-1 z-30 w-36 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg flex flex-col text-[11px]"
                      >
                        {classified.symbols.map((sym) => {
                          const active = sym.name === classified.primaryVar;
                          return (
                            <button
                              key={sym.name}
                              type="button"
                              onClick={() => {
                                storeState.setSymbolRole(sym.name, 'data_var');
                                setOpenRoleMenuKey(null);
                              }}
                              class={`flex items-center justify-between px-2.5 py-1 text-left font-mono hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                                active ? 'font-bold text-orange-600 dark:text-orange-400' : ''
                              }`}
                            >
                              <span>{sym.name}</span>
                              {active && <span>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {sliderSyms.length > 0 && (
                    <span class="text-neutral-500 dark:text-neutral-400">
                      {t('sliders_summary_label')}:{' '}
                      <b class="font-mono text-neutral-700 dark:text-neutral-200">
                        {sliderSyms.map((s) => s.name).join(', ')}
                      </b>
                    </span>
                  )}
                </div>
              )}

              {/* ML & Optimization Mode: Full Role-Selection Badges (Data / Param / Hyper) [FR-1.4] */}
              {isMlMode && classified.symbols.length > 0 && (
                <div class="flex flex-wrap gap-1 pt-0.5">
                  {classified.symbols.map((sym) => {
                    const menuKey = `expr:${expr.id}:${sym.name}`;
                    const isOpen = openRoleMenuKey === menuKey;
                    const roleLabel =
                      sym.role === 'data_var' ? 'Data' : sym.role === 'param' ? 'Param' : 'Hyper';

                    return (
                      <div key={sym.name} class="relative inline-block">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenRoleMenuKey(isOpen ? null : menuKey);
                          }}
                          class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold transition-transform active:scale-95 ${
                            ROLE_BADGE_STYLE[sym.role]
                          }`}
                          title="Choose symbol role: Data (Axis), Param, or Hyper"
                        >
                          <span>
                            {roleLabel}: {sym.name}
                          </span>
                          <span class="opacity-70 text-[9px]">▾</span>
                        </button>

                        {isOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            class="absolute left-0 top-full mt-1 z-30 w-36 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg flex flex-col text-[11px]"
                          >
                            {ROLE_OPTIONS.map((opt) => {
                              const active = sym.role === opt.role;
                              return (
                                <button
                                  key={opt.role}
                                  type="button"
                                  onClick={() => {
                                    storeState.setSymbolRole(sym.name, opt.role as SymbolRole);
                                    setOpenRoleMenuKey(null);
                                  }}
                                  class={`flex items-center justify-between px-2.5 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                                    active ? 'font-bold text-orange-600 dark:text-orange-400' : ''
                                  }`}
                                >
                                  <span class="flex items-center gap-1.5">
                                    <span class={`w-2 h-2 rounded-full ${opt.dotClass}`} />
                                    <span>{opt.shortLabel}</span>
                                    <span class="text-[9px] text-neutral-400">({opt.desc})</span>
                                  </span>
                                  {active && <span>✓</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Section 2: Dynamic Parameter Sliders [FR-1.3] */}
      <div class="pt-2 border-t border-neutral-200 dark:border-neutral-800">
        <h2 class="font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 text-[11px] mb-2">
          {isMlMode ? t('sliders_title') : t('math_sliders_title')}
        </h2>

        <div class="flex flex-col gap-2">
          {sliderList.map((sl) => (
            <div
              key={sl.name}
              class="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col gap-1.5"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => storeState.updateSliderBounds(sl.name, { playing: !sl.playing })}
                    class="w-5 h-5 rounded flex items-center justify-center bg-orange-500/15 text-orange-600 dark:text-orange-400 hover:bg-orange-500/25"
                    title={sl.playing ? 'Pause animation' : 'Play slider animation'}
                  >
                    {sl.playing ? <IconPause /> : <IconPlay />}
                  </button>
                  <span class="font-mono font-bold text-neutral-800 dark:text-neutral-100">
                    {sl.name} = {sl.value.toFixed(3)}
                  </span>
                </div>
                {isMlMode && (
                  <div class="relative inline-block">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `slider:${sl.name}`;
                        setOpenRoleMenuKey(openRoleMenuKey === key ? null : key);
                      }}
                      class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${ROLE_BADGE_STYLE[sl.role]}`}
                      title="Change slider role"
                    >
                      <span>{sl.role === 'param' ? 'Param' : 'Hyper'}</span>
                      <span class="opacity-70 text-[9px]">▾</span>
                    </button>

                    {openRoleMenuKey === `slider:${sl.name}` && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        class="absolute right-0 top-full mt-1 z-30 w-36 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg flex flex-col text-[11px]"
                      >
                        {ROLE_OPTIONS.map((opt) => {
                          const active = sl.role === opt.role;
                          return (
                            <button
                              key={opt.role}
                              type="button"
                              onClick={() => {
                                storeState.setSymbolRole(sl.name, opt.role as SymbolRole);
                                setOpenRoleMenuKey(null);
                              }}
                              class={`flex items-center justify-between px-2.5 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                                active ? 'font-bold text-orange-600 dark:text-orange-400' : ''
                              }`}
                            >
                              <span class="flex items-center gap-1.5">
                                <span class={`w-2 h-2 rounded-full ${opt.dotClass}`} />
                                <span>{opt.shortLabel}</span>
                                <span class="text-[9px] text-neutral-400">({opt.desc})</span>
                              </span>
                              {active && <span>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <input
                type="range"
                min={sl.min}
                max={sl.max}
                step={sl.step}
                value={sl.value}
                onInput={(e) =>
                  storeState.setSliderValue(
                    sl.name,
                    Number((e.target as HTMLInputElement).value),
                    false
                  )
                }
                onPointerUp={(e) =>
                  storeState.setSliderValue(
                    sl.name,
                    Number((e.target as HTMLInputElement).value),
                    true
                  )
                }
                class="omlg-slider"
              />

              {/* Editable Min / Max / Step / Speed / Loop Controls */}
              <div class="flex flex-wrap items-center justify-between gap-1 text-[10px] text-neutral-500">
                <label class="flex items-center gap-0.5">
                  min:
                  <input
                    type="number"
                    step="0.1"
                    value={sl.min}
                    onChange={(e) =>
                      storeState.updateSliderBounds(sl.name, {
                        min: Number((e.target as HTMLInputElement).value),
                      })
                    }
                    class="w-11 px-1 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent font-mono"
                  />
                </label>
                <label class="flex items-center gap-0.5">
                  max:
                  <input
                    type="number"
                    step="0.1"
                    value={sl.max}
                    onChange={(e) =>
                      storeState.updateSliderBounds(sl.name, {
                        max: Number((e.target as HTMLInputElement).value),
                      })
                    }
                    class="w-11 px-1 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent font-mono"
                  />
                </label>
                <label class="flex items-center gap-0.5">
                  Δ:
                  <input
                    type="number"
                    step="0.01"
                    value={sl.step}
                    onChange={(e) =>
                      storeState.updateSliderBounds(sl.name, {
                        step: Math.max(1e-4, Number((e.target as HTMLInputElement).value)),
                      })
                    }
                    class="w-11 px-1 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent font-mono"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const speeds: (0.5 | 1 | 2 | 4)[] = [0.5, 1, 2, 4];
                    const nextSpeed = speeds[(speeds.indexOf(sl.speed) + 1) % speeds.length];
                    storeState.updateSliderBounds(sl.name, { speed: nextSpeed });
                  }}
                  class="px-1 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 font-mono"
                  title="Animation speed"
                >
                  {sl.speed}x
                </button>
                <button
                  type="button"
                  onClick={() =>
                    storeState.updateSliderBounds(sl.name, {
                      loopMode: sl.loopMode === 'bounce' ? 'wrap' : 'bounce',
                    })
                  }
                  class="px-1 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 font-mono"
                  title="Toggle Bounce vs Wrap loop mode"
                >
                  {sl.loopMode === 'bounce' ? '⇄' : '↻'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
