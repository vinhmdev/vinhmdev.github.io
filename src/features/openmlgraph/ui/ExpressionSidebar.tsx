/**
 * Expression Algebra Sidebar: MathLive / LaTeX Bi-Directional Input,
 * Real-Time Syntax Validation, f'(x) & f''(x) Symbolic Formula Display,
 * Interactive Role-Swapping Badges [FR-1.4], and Parameter Sliders [FR-1.3].
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { classifyLatexExpression } from '../core/parser/ast-classifier';
import type { GraphStoreState } from '../state/store';
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

export function ExpressionSidebar({ storeState }: SidebarProps): JSX.Element {
  const { graph, curves } = storeState;
  const sliderList = Object.values(graph.sliders);

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
  useEffect(() => {
    const playingSliders = sliderList.filter((s) => s.playing);
    if (playingSliders.length === 0) return;

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number): void => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      for (const s of playingSliders) {
        const span = s.max - s.min;
        const delta = span * 0.25 * s.speed * dt * s.direction;
        let nextVal = s.value + delta;
        let nextDir = s.direction;

        if (nextVal >= s.max) {
          if (s.loopMode === 'bounce') {
            nextVal = s.max;
            nextDir = -1;
          } else {
            nextVal = s.min;
          }
        } else if (nextVal <= s.min) {
          if (s.loopMode === 'bounce') {
            nextVal = s.min;
            nextDir = 1;
          } else {
            nextVal = s.max;
          }
        }

        storeState.updateSliderBounds(s.name, { value: nextVal, direction: nextDir });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [sliderList.map((s) => `${s.name}:${s.playing}:${s.speed}:${s.loopMode}`).join(',')]);

  return (
    <div class="flex flex-col gap-3 p-3 text-xs">
      {/* Section 1: Algebra & Expressions */}
      <div class="flex items-center justify-between">
        <h2 class="font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 text-[11px]">
          {t('expressions_title')}
        </h2>
        <button
          type="button"
          onClick={() => storeState.addExpression()}
          class="px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-500/25 transition-colors"
        >
          {t('add_expression')}
        </button>
      </div>

      <div class="flex flex-col gap-2.5">
        {graph.expressions.map((expr) => {
          const classified = classifyLatexExpression(expr.latex, graph.symbolOverrides);
          const curvePacket = curves.find((c) => c.exprId === expr.id);

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
                    {expr.label || `f(${classified.primaryVar})`}
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
                  {graph.expressions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => storeState.removeExpression(expr.id)}
                      class="p-1 rounded text-neutral-400 hover:text-red-500"
                      title="Delete expression"
                    >
                      <IconTrash />
                    </button>
                  )}
                </div>
              </div>

              {/* Bi-directional LaTeX / ASCII Formula Input [FR-1.1] */}
              <input
                type="text"
                value={expr.latex}
                onInput={(e) =>
                  storeState.updateExpressionLatex(expr.id, (e.target as HTMLInputElement).value)
                }
                placeholder="e.g. \sigma(w \cdot x + b) or relu(x)"
                class={`w-full px-2.5 py-1.5 rounded border font-mono text-xs bg-neutral-50 dark:bg-neutral-950 ${
                  classified.valid
                    ? 'border-neutral-300 dark:border-neutral-700 focus:border-orange-500'
                    : 'border-red-500 text-red-600 dark:text-red-400'
                } focus:outline-none`}
              />

              {!classified.valid && (
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

              {/* Role-Swapping Interactive Badges [FR-1.4] */}
              {classified.symbols.length > 0 && (
                <div class="flex flex-wrap gap-1 pt-0.5">
                  {classified.symbols.map((sym) => (
                    <button
                      key={sym.name}
                      type="button"
                      onClick={() => storeState.cycleSymbolRole(sym.name)}
                      class={`px-1.5 py-0.5 rounded border text-[10px] font-semibold transition-transform active:scale-95 ${
                        ROLE_BADGE_STYLE[sym.role]
                      }`}
                      title="Click to swap symbol role (Data <-> Param <-> Hyperparam)"
                    >
                      [{sym.role === 'data_var' ? 'Data' : sym.role === 'param' ? 'Param' : 'Hyper'}:{' '}
                      {sym.name}]
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Section 2: Dynamic Parameter & Hyperparameter Sliders [FR-1.3] */}
      <div class="pt-2 border-t border-neutral-200 dark:border-neutral-800">
        <h2 class="font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 text-[11px] mb-2">
          {t('sliders_title')}
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
                <span
                  class={`px-1.5 py-0.2 rounded text-[10px] border ${ROLE_BADGE_STYLE[sl.role]}`}
                >
                  {sl.role === 'param' ? 'Param' : 'Hyper'}
                </span>
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
