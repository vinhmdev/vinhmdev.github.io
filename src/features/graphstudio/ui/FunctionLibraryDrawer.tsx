/**
 * Pure Mathematical Function Library Drawer.
 *
 * Allows users to inspect, toggle ON/OFF, edit, insert, and define reusable
 * mathematical functions (including Transformer / ML functions like Attention,
 * SwiGLU, GeGLU, RMSNorm, LayerNorm, RoPE) as pure mathematical definitions
 * rather than hardcoded AST syntax.
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  classifySymbolRole,
  getDefaultSliderBounds,
} from '../core/parser/ast-classifier';
import {
  DEFAULT_FUNCTION_LIBRARY,
  extractFunctionSignature,
  formatExpressionForKatex,
  parseLatexToMathJson,
} from '../core/parser/cortex-setup';
import { t } from '../scripts/i18n-client';
import { graphStore, type GraphStoreState } from '../state/store';
import type {
  LibraryFunctionEntry,
  LibraryParamConfig,
  ParamDomainMode,
} from '../types/math';
import { IconClose, IconFunction, IconTrash } from './icons';
import { getPlottableExpressions } from '../state/expression-kind';

function resolveEffectiveParamCfg(
  paramName: string,
  cfg?: LibraryParamConfig
): Required<LibraryParamConfig> {
  const rawRole = classifySymbolRole(paramName);
  const baseRole: 'param' | 'hyperparam' =
    cfg?.role ?? (rawRole === 'hyperparam' ? 'hyperparam' : 'param');
  const baseBounds = getDefaultSliderBounds(paramName, baseRole);
  const domainMode: ParamDomainMode = cfg?.domainMode ?? 'free';
  let min = cfg?.min ?? baseBounds.min;
  if (domainMode === 'positive' && min <= 0) min = 0.01;
  if (domainMode === 'non_negative' && min < 0) min = 0;
  const step = Math.max(1e-4, cfg?.step ?? baseBounds.step);
  const max = Math.max(min + step, cfg?.max ?? baseBounds.max);
  const defaultValue = Math.min(
    Math.max(cfg?.defaultValue ?? baseBounds.defaultValue, min),
    max
  );
  return {
    role: baseRole,
    domainMode,
    min,
    max,
    step,
    defaultValue,
  };
}

function getConfigurableParamsForEntry(
  formalParams: string[],
  paramConfigs?: Record<string, LibraryParamConfig>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of formalParams.slice(1)) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  if (paramConfigs) {
    for (const k of Object.keys(paramConfigs)) {
      if (k !== formalParams[0] && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

export function renderLibraryLatexPreview(latex: string): string {
  try {
    return katex.renderToString(formatExpressionForKatex(latex), {
      throwOnError: false,
      displayMode: false,
    });
  } catch {
    return latex;
  }
}

interface FunctionLibraryDrawerProps {
  storeState: GraphStoreState;
  onToast: (msg: string) => void;
}

export function FunctionLibraryDrawer({
  storeState,
  onToast,
}: FunctionLibraryDrawerProps): JSX.Element | null {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormula, setEditFormula] = useState('');
  const [paramSetupOpenId, setParamSetupOpenId] = useState<string | null>(() => {
    if (!storeState.functionLibraryFocusName) return null;
    const targetLower = storeState.functionLibraryFocusName.toLowerCase();
    const lib = storeState.graph.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY;
    return lib.find((f) => f.name.toLowerCase() === targetLower)?.id ?? null;
  });
  const [newDefLatex, setNewDefLatex] = useState('');
  const [isEditingNewLatex, setIsEditingNewLatex] = useState(false);
  const [newDesc, setNewDesc] = useState('');
  const [newParamConfigs, setNewParamConfigs] = useState<
    Record<string, LibraryParamConfig>
  >({});
  const editInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const newDefInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!storeState.functionLibraryDrawerOpen || !storeState.functionLibraryFocusName) {
      return;
    }
    const targetLower = storeState.functionLibraryFocusName.toLowerCase();
    const lib = storeState.graph.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY;
    const matched = lib.find((f) => f.name.toLowerCase() === targetLower);
    if (matched) {
      setParamSetupOpenId(matched.id);
      const el = cardRefs.current.get(matched.id);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }, [
    storeState.functionLibraryDrawerOpen,
    storeState.functionLibraryFocusName,
    storeState.graph.functionLibrary,
  ]);

  useLayoutEffect(() => {
    if (!editingId) return;
    const input = editInputRefs.current.get(editingId);
    if (!input || document.activeElement === input) return;
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }, [editingId]);

  useLayoutEffect(() => {
    if (!isEditingNewLatex) return;
    const input = newDefInputRef.current;
    if (!input || document.activeElement === input) return;
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  }, [isEditingNewLatex]);

  if (!storeState.functionLibraryDrawerOpen) return null;

  const library: LibraryFunctionEntry[] =
    storeState.graph.functionLibrary ?? DEFAULT_FUNCTION_LIBRARY;
  const allEnabled = library.length > 0 && library.every((f) => f.enabled);
  const defaultIds = new Set(DEFAULT_FUNCTION_LIBRARY.map((f) => f.id));

  // Detect any formal function definitions currently written in expression cards
  const cardDefinedFunctions = getPlottableExpressions(storeState.graph.expressions)
    .map((expr) => {
      const sig = extractFunctionSignature(expr.latex);
      if (!sig || sig.formalParams.length === 0) return null;
      return {
        exprId: expr.id,
        name: sig.name,
        formalParams: sig.formalParams,
        latex: expr.latex,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const handleSaveEdit = (entry: LibraryFunctionEntry): void => {
    const trimmed = editFormula.trim();
    const sig = extractFunctionSignature(trimmed);
    if (!sig || sig.formalParams.length === 0) {
      onToast('Formula must start with FunctionName(arg1, arg2, ...) = ...');
      return;
    }
    const nextParamConfigs: Record<string, LibraryParamConfig> = {};
    for (const p of sig.formalParams.slice(1)) {
      nextParamConfigs[p] = resolveEffectiveParamCfg(p, entry.paramConfigs?.[p]);
    }
    if (entry.paramConfigs) {
      const parsedBody = parseLatexToMathJson(trimmed, {
        extraAllowedSymbols: [
          ...sig.formalParams,
          ...Object.keys(entry.paramConfigs),
        ],
      });
      const bodyLeaves = new Set<string>();
      const collectLeaves = (node: unknown): void => {
        if (typeof node === 'string') {
          bodyLeaves.add(node);
        } else if (Array.isArray(node)) {
          for (let i = 1; i < node.length; i++) collectLeaves(node[i]);
        }
      };
      if (parsedBody.valid) collectLeaves(parsedBody.expr);
      for (const [k, existingCfg] of Object.entries(entry.paramConfigs)) {
        if (k !== sig.formalParams[0] && !(k in nextParamConfigs) && bodyLeaves.has(k)) {
          nextParamConfigs[k] = existingCfg;
        }
      }
    }
    graphStore.getState().upsertLibraryFunction({
      ...entry,
      name: sig.name,
      signature: sig.rawHeader,
      definitionLatex: trimmed,
      paramConfigs:
        Object.keys(nextParamConfigs).length > 0 ? nextParamConfigs : entry.paramConfigs,
    });
    setEditingId(null);
    onToast(`Updated ${sig.name}(${sig.formalParams.join(', ')})`);
  };

  const handleUpdateEntryParamConfig = (
    entry: LibraryFunctionEntry,
    formalParams: string[],
    paramName: string,
    patch: Partial<LibraryParamConfig>
  ): void => {
    const allParams = getConfigurableParamsForEntry(formalParams, entry.paramConfigs);
    const nextConfigs: Record<string, LibraryParamConfig> = {
      ...(entry.paramConfigs ?? {}),
    };
    for (const p of allParams) {
      nextConfigs[p] = resolveEffectiveParamCfg(p, nextConfigs[p]);
    }
    const base = resolveEffectiveParamCfg(paramName, nextConfigs[paramName]);
    const merged: LibraryParamConfig = { ...base, ...patch };
    const mode = merged.domainMode ?? 'free';
    let min = merged.min ?? base.min;
    let max = merged.max ?? base.max;
    const step = Math.max(1e-4, merged.step ?? base.step);
    if (mode === 'positive' && min <= 0) min = 0.01;
    if (mode === 'non_negative' && min < 0) min = 0;
    if (min > max) max = min + Math.max(step, 1);
    const defaultValue = Math.min(
      Math.max(merged.defaultValue ?? base.defaultValue, min),
      max
    );
    nextConfigs[paramName] = {
      role: merged.role ?? base.role,
      domainMode: mode,
      min,
      max,
      step,
      defaultValue,
    };
    graphStore.getState().upsertLibraryFunction({
      ...entry,
      paramConfigs: nextConfigs,
    });
  };

  const handleAddCustomFunction = (): void => {
    const trimmed = newDefLatex.trim();
    const sig = extractFunctionSignature(trimmed);
    if (!sig || sig.formalParams.length === 0) {
      onToast('Please enter a valid definition: Name(p1, p2) = expression');
      return;
    }
    const resolvedConfigs: Record<string, LibraryParamConfig> = {};
    for (const p of sig.formalParams.slice(1)) {
      resolvedConfigs[p] = resolveEffectiveParamCfg(p, newParamConfigs[p]);
    }
    const defaultArgs: Record<string, string> = {};
    for (const p of sig.formalParams.slice(1)) {
      defaultArgs[p] = p;
    }
    graphStore.getState().upsertLibraryFunction({
      name: sig.name,
      signature: sig.rawHeader,
      exampleCallLatex: `${sig.name}(x${sig.formalParams.length > 1 ? ', ' + sig.formalParams.slice(1).join(', ') : ''})`,
      defaultArgs: Object.keys(defaultArgs).length > 0 ? defaultArgs : undefined,
      paramConfigs:
        Object.keys(resolvedConfigs).length > 0 ? resolvedConfigs : undefined,
      category: 'custom',
      description:
        newDesc.trim() ||
        `Custom mathematical function ${sig.name}(${sig.formalParams.join(', ')})`,
      definitionLatex: trimmed,
      enabled: true,
    });
    setNewDefLatex('');
    setNewDesc('');
    setNewParamConfigs({});
    onToast(`Added ${sig.name}(${sig.formalParams.join(', ')}) to library`);
  };

  const newSigPreview = extractFunctionSignature(newDefLatex.trim());
  const newConfigurableParams = newSigPreview
    ? newSigPreview.formalParams.slice(1)
    : [];

  const domainChoices: { id: ParamDomainMode; label: string }[] = [
    { id: 'free', label: t('domain_free') },
    { id: 'non_negative', label: t('domain_non_neg') },
    { id: 'positive', label: t('domain_positive') },
  ];

  return (
    <div class="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div class="w-full max-w-xl h-full bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-800 flex flex-col shadow-2xl text-neutral-900 dark:text-neutral-100">
        {/* Header */}
        <div class="flex items-center justify-between px-3.5 sm:px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-7 h-7 shrink-0 rounded-lg bg-orange-500/15 border border-orange-500/40 text-orange-600 dark:text-orange-300 flex items-center justify-center">
              <IconFunction class="w-4 h-4" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                {t('fn_lib_title') || 'Pure Math & ML Function Library'}
              </h3>
              <p class="text-[11px] text-neutral-500 dark:text-neutral-400 line-clamp-2">
                {t('fn_lib_subtitle') ||
                  'All functions below are pure mathematical definitions expanded via AST Beta-Reduction.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => graphStore.getState().setFunctionLibraryDrawerOpen(false)}
            class="p-1.5 shrink-0 rounded-lg text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <IconClose class="w-4 h-4" />
          </button>
        </div>

        {/* Master Toggle Bar */}
        <div class="flex flex-wrap items-center justify-between gap-2 px-3.5 sm:px-5 py-2.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-900/60">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
              {t('fn_lib_active_count')} ({library.filter((f) => f.enabled).length}/{library.length})
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={() => graphStore.getState().toggleAllLibraryFunctions(!allEnabled)}
              class={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                allEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-orange-500'
              }`}
            >
              {allEnabled ? t('fn_lib_disable_all') : t('fn_lib_enable_all')}
            </button>
            <button
              type="button"
              onClick={() => {
                graphStore.getState().resetFunctionLibrary();
                onToast('Reset function library to defaults');
              }}
              class="px-2.5 py-1 rounded text-[11px] font-medium bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-orange-500"
            >
              {t('fn_lib_reset')}
            </button>
          </div>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-5">
          {/* Card-defined functions in the current worksheet */}
          {cardDefinedFunctions.length > 0 && (
            <div class="space-y-2">
              <div class="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                {t('fn_lib_worksheet_header')}
              </div>
              <div class="space-y-1.5">
                {cardDefinedFunctions.map((fn) => (
                  <div
                    key={fn.exprId}
                    class="p-2.5 rounded-lg border border-sky-500/30 bg-sky-500/5 flex items-center justify-between gap-2"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-mono font-bold text-sky-700 dark:text-sky-300">
                        {fn.name}({fn.formalParams.join(', ')})
                      </div>
                      <div
                        class="mt-1 gs-katex-line text-xs text-neutral-800 dark:text-neutral-200 overflow-x-auto"
                        dangerouslySetInnerHTML={{
                          __html: renderLibraryLatexPreview(fn.latex),
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const callArgs = ['x', ...fn.formalParams.slice(1)].join(', ');
                        graphStore
                          .getState()
                          .addExpression(`${fn.name}(${callArgs})`, `${fn.name}(x)`);
                        onToast(`Inserted ${fn.name}(${callArgs})`);
                      }}
                      class="shrink-0 px-2.5 py-1 rounded text-[11px] font-semibold bg-sky-500/15 border border-sky-500/40 text-sky-700 dark:text-sky-200 hover:bg-sky-500/25"
                    >
                      {t('fn_lib_reuse_call')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new custom reusable function */}
          <div class="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/60 space-y-2.5">
            <div class="text-[11px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
              {t('fn_lib_define_new')}
            </div>
            {isEditingNewLatex || newDefLatex.trim().length === 0 ? (
              <div class="space-y-1.5">
                <input
                  type="text"
                  ref={(el) => {
                    newDefInputRef.current = el;
                  }}
                  value={newDefLatex}
                  onFocus={() => setIsEditingNewLatex(true)}
                  onBlur={() => setIsEditingNewLatex(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      setIsEditingNewLatex(false);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onInput={(e) => setNewDefLatex((e.target as HTMLInputElement).value)}
                  placeholder="e.g. Attention(Q, K, V) = \operatorname{softmax}(QK^T/\sqrt{d_k})V"
                  class="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-950 border border-orange-500/70 ring-1 ring-orange-500/20 text-xs font-mono text-neutral-900 dark:text-neutral-100 focus:outline-none"
                />
                {newDefLatex.trim().length > 0 && (
                  <div
                    class="px-2.5 py-1 rounded bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 gs-katex-line text-xs text-neutral-800 dark:text-neutral-200 overflow-x-auto"
                    dangerouslySetInnerHTML={{
                      __html: renderLibraryLatexPreview(newDefLatex),
                    }}
                  />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingNewLatex(true)}
                title="Click to edit raw LaTeX / mathematical formula"
                class="group w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 hover:border-orange-500/60 text-left min-w-0 overflow-hidden transition-colors cursor-text"
              >
                <span
                  class="gs-katex-line min-w-0 flex-1 text-xs text-neutral-900 dark:text-neutral-100"
                  dangerouslySetInnerHTML={{
                    __html: renderLibraryLatexPreview(newDefLatex),
                  }}
                />
                <span class="shrink-0 text-[10px] font-mono text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  ✎ LaTeX
                </span>
              </button>
            )}
            {newConfigurableParams.length > 0 && (
              <div class="p-2.5 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 space-y-2">
                <div class="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  {t('fn_param_setup_title')}
                </div>
                {newConfigurableParams.map((pName) => {
                  const cfg = resolveEffectiveParamCfg(pName, newParamConfigs[pName]);
                  return (
                    <div
                      key={pName}
                      class="flex flex-wrap items-center justify-between gap-1.5 text-[10px] py-1 border-t first:border-t-0 border-neutral-100 dark:border-neutral-800/80"
                    >
                      <div class="flex items-center gap-1.5">
                        <span class="font-mono font-bold text-xs text-neutral-800 dark:text-neutral-100">
                          {pName}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setNewParamConfigs((prev) => ({
                              ...prev,
                              [pName]: {
                                ...cfg,
                                role: cfg.role === 'param' ? 'hyperparam' : 'param',
                              },
                            }))
                          }
                          class={`px-1.5 py-0.5 rounded border font-semibold ${
                            cfg.role === 'param'
                              ? 'bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-300'
                              : 'bg-purple-500/15 border-purple-500/40 text-purple-700 dark:text-purple-300'
                          }`}
                        >
                          {cfg.role === 'param' ? 'Param' : 'Hyper'}
                        </button>
                        <div class="inline-flex items-center rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-0.5 gap-0.5">
                          {domainChoices.map((dc) => (
                            <button
                              key={dc.id}
                              type="button"
                              onClick={() =>
                                setNewParamConfigs((prev) => ({
                                  ...prev,
                                  [pName]: { ...cfg, domainMode: dc.id },
                                }))
                              }
                              class={`px-1.5 py-0.5 rounded font-mono font-semibold ${
                                cfg.domainMode === dc.id
                                  ? 'bg-orange-500 text-white'
                                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-800'
                              }`}
                            >
                              {dc.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div class="flex items-center gap-1 font-mono">
                        <span>min:</span>
                        <input
                          type="number"
                          step="0.1"
                          value={cfg.min}
                          onChange={(e) => {
                            const v = Number((e.target as HTMLInputElement).value);
                            if (Number.isFinite(v)) {
                              setNewParamConfigs((prev) => ({
                                ...prev,
                                [pName]: { ...cfg, min: v },
                              }));
                            }
                          }}
                          class="w-12 px-1 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900"
                        />
                        <span>max:</span>
                        <input
                          type="number"
                          step="0.1"
                          value={cfg.max}
                          onChange={(e) => {
                            const v = Number((e.target as HTMLInputElement).value);
                            if (Number.isFinite(v)) {
                              setNewParamConfigs((prev) => ({
                                ...prev,
                                [pName]: { ...cfg, max: v },
                              }));
                            }
                          }}
                          class="w-12 px-1 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div class="flex items-center gap-2">
              <input
                type="text"
                value={newDesc}
                onInput={(e) => setNewDesc((e.target as HTMLInputElement).value)}
                placeholder={t('fn_lib_desc_placeholder')}
                class="min-w-0 flex-1 px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-orange-500"
              />
              <button
                type="button"
                onClick={handleAddCustomFunction}
                class="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs transition-colors"
              >
                {t('fn_lib_save_btn')}
              </button>
            </div>
          </div>

          {/* Pre-defined & Custom Library Functions */}
          <div class="space-y-2.5">
            <div class="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              {t('fn_lib_pack_header')}
            </div>
            {library.map((entry) => {
              const sig = extractFunctionSignature(entry.definitionLatex);
              const paramList = sig?.formalParams ?? ['x'];
              const configurableParams = getConfigurableParamsForEntry(
                paramList,
                entry.paramConfigs
              );
              const isEditing = editingId === entry.id;
              const isParamSetupOpen = paramSetupOpenId === entry.id;
              const isFocusedCard =
                storeState.functionLibraryFocusName?.toLowerCase() ===
                entry.name.toLowerCase();

              return (
                <div
                  key={entry.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(entry.id, el);
                    else cardRefs.current.delete(entry.id);
                  }}
                  data-testid={`fn-lib-card-${entry.name}`}
                  class={`p-3.5 rounded-xl border transition-colors ${
                    isFocusedCard
                      ? 'border-orange-500 ring-1 ring-orange-500/30 bg-orange-500/5'
                      : entry.enabled
                        ? 'border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/50'
                        : 'border-neutral-200/70 dark:border-neutral-800/50 bg-neutral-50/30 dark:bg-neutral-950/20 opacity-65'
                  }`}
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-xs font-mono font-bold text-orange-600 dark:text-orange-400">
                          {entry.name}({paramList.join(', ')})
                        </span>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-300/80 dark:border-neutral-700/70">
                          {entry.category}
                        </span>
                      </div>
                      <p class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                        {entry.description}
                      </p>
                    </div>

                    {/* Toggle ON/OFF Switch */}
                    <div class="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => graphStore.getState().toggleLibraryFunction(entry.id)}
                        class={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-colors ${
                          entry.enabled
                            ? 'bg-emerald-500/15 border-emerald-500/45 text-emerald-700 dark:text-emerald-300'
                            : 'bg-neutral-200/60 dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400'
                        }`}
                        title="Toggle whether this function definition is active in the parser"
                      >
                        {entry.enabled ? 'ON' : 'OFF'}
                      </button>
                      {!defaultIds.has(entry.id) && (
                        <button
                          type="button"
                          onClick={() => graphStore.getState().removeLibraryFunction(entry.id)}
                          class="p-1 rounded text-neutral-400 hover:text-red-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          title="Delete custom function"
                        >
                          <IconTrash class="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Pure Mathematical Formula: KaTeX Display with Click-to-Edit Raw LaTeX */}
                  {isEditing ? (
                    <div class="mt-2.5 space-y-2">
                      <input
                        type="text"
                        ref={(el) => {
                          if (el) editInputRefs.current.set(entry.id, el);
                          else editInputRefs.current.delete(entry.id);
                        }}
                        value={editFormula}
                        onInput={(e) => setEditFormula((e.target as HTMLInputElement).value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSaveEdit(entry);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingId(null);
                          }
                        }}
                        class="w-full px-2.5 py-1.5 rounded bg-white dark:bg-neutral-950 border border-orange-500/70 ring-1 ring-orange-500/20 text-xs font-mono text-neutral-900 dark:text-neutral-100 focus:outline-none"
                      />
                      {editFormula.trim().length > 0 && (
                        <div
                          class="px-2.5 py-1 rounded bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 gs-katex-line text-xs text-neutral-800 dark:text-neutral-200 overflow-x-auto"
                          dangerouslySetInnerHTML={{
                            __html: renderLibraryLatexPreview(editFormula),
                          }}
                        />
                      )}
                      <div class="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          class="px-2.5 py-1 rounded text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 bg-neutral-100 dark:bg-neutral-800"
                        >
                          {t('latex_import_cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(entry)}
                          class="px-2.5 py-1 rounded text-[11px] font-semibold bg-orange-500 text-white"
                        >
                          {t('fn_lib_save_btn')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditFormula(entry.definitionLatex);
                      }}
                      title="Click to edit raw LaTeX / mathematical formula"
                      class="group mt-2 w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 hover:border-orange-500/60 text-left min-w-0 overflow-hidden transition-colors cursor-text"
                    >
                      <span
                        class="gs-katex-line min-w-0 flex-1 text-xs text-neutral-900 dark:text-neutral-100"
                        dangerouslySetInnerHTML={{
                          __html: renderLibraryLatexPreview(entry.definitionLatex),
                        }}
                      />
                      <span class="shrink-0 text-[10px] font-mono text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        ✎ LaTeX
                      </span>
                    </button>
                  )}

                  {/* Transparent Parameter Summary Chips */}
                  {paramList.length > 0 && (
                    <div class="mt-2 flex flex-wrap items-center gap-1">
                      <span class="px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-mono text-[10px]">
                        {paramList[0]}: {t('fn_param_axis_badge')}
                      </span>
                      {configurableParams.map((pName) => {
                        const cfg = resolveEffectiveParamCfg(
                          pName,
                          entry.paramConfigs?.[pName]
                        );
                        const domainTag =
                          cfg.domainMode === 'positive'
                            ? '> 0'
                            : cfg.domainMode === 'non_negative'
                              ? '≥ 0'
                              : 'ℝ';
                        const isRestricted = cfg.domainMode !== 'free';
                        return (
                          <button
                            key={pName}
                            type="button"
                            data-testid={`fn-param-chip-${entry.name}-${pName}`}
                            onClick={() =>
                              setParamSetupOpenId(isParamSetupOpen ? null : entry.id)
                            }
                            title={t('fn_param_setup_title')}
                            class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[10px] transition-colors ${
                              isRestricted
                                ? 'border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 font-semibold'
                                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:border-orange-500/60'
                            }`}
                          >
                            <span class="font-bold">{pName}</span>
                            <span class="opacity-70">·</span>
                            <span>{cfg.role === 'param' ? 'Param' : 'Hyper'}</span>
                            <span class="opacity-70">·</span>
                            <span>{domainTag}</span>
                            <span class="opacity-65 text-[9px]">
                              [{cfg.min}, {cfg.max}]
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Actions: Insert Call, Insert Full Definition, Parameter Setup, Edit Formula */}
                  <div class="mt-2.5 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        if (!entry.enabled) {
                          graphStore.getState().toggleLibraryFunction(entry.id, true);
                        }
                        const callArgs = ['x', ...paramList.slice(1)].join(', ');
                        const callLatex = `\\operatorname{${entry.name}}(${callArgs})`;
                        graphStore
                          .getState()
                          .addExpression(callLatex, `${entry.name}(x)`);
                        onToast(`Added ${entry.name}(x) to expressions`);
                      }}
                      class="px-2.5 py-1 rounded text-[10px] font-semibold bg-orange-500/15 border border-orange-500/40 text-orange-600 dark:text-orange-300 hover:bg-orange-500/25"
                    >
                      {t('fn_lib_use_btn').replace('{fn}', entry.name)}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        graphStore
                          .getState()
                          .addExpression(
                            entry.definitionLatex,
                            `${entry.name}(${paramList.join(', ')})`
                          );
                        onToast(`Inserted full definition of ${entry.name} onto canvas`);
                      }}
                      class="px-2.5 py-1 rounded text-[10px] font-medium bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-orange-500"
                    >
                      {t('fn_lib_insert_def_btn')}
                    </button>
                    {configurableParams.length > 0 && (
                      <button
                        type="button"
                        data-testid={`fn-param-setup-toggle-${entry.name}`}
                        aria-expanded={isParamSetupOpen}
                        onClick={() =>
                          setParamSetupOpenId(isParamSetupOpen ? null : entry.id)
                        }
                        class={`px-2.5 py-1 rounded text-[10px] font-semibold border transition-colors ${
                          isParamSetupOpen
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-orange-500'
                        }`}
                      >
                        {t('fn_param_setup_btn')}
                      </button>
                    )}
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditFormula(entry.definitionLatex);
                        }}
                        class="px-2 py-1 rounded text-[10px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200"
                      >
                        {t('fn_lib_edit_btn')}
                      </button>
                    )}
                  </div>

                  {/* Expandable Parameter Setup Panel */}
                  {isParamSetupOpen && configurableParams.length > 0 && (
                    <div
                      data-testid={`fn-param-setup-panel-${entry.name}`}
                      class="mt-2.5 p-2.5 rounded-lg bg-white dark:bg-neutral-950 border border-orange-500/35 space-y-2"
                    >
                      <div class="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                        {t('fn_param_setup_title')} — {entry.name}
                      </div>
                      {configurableParams.map((pName) => {
                        const cfg = resolveEffectiveParamCfg(
                          pName,
                          entry.paramConfigs?.[pName]
                        );
                        return (
                          <div
                            key={pName}
                            class="flex flex-col gap-1.5 pt-2 first:pt-0 border-t first:border-t-0 border-neutral-100 dark:border-neutral-800/80 text-[10px]"
                          >
                            <div class="flex flex-wrap items-center justify-between gap-1.5">
                              <div class="flex items-center gap-1.5">
                                <span class="font-mono font-bold text-xs text-neutral-900 dark:text-neutral-100">
                                  {pName}
                                </span>
                                <div class="inline-flex items-center rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-0.5 gap-0.5">
                                  {(['param', 'hyperparam'] as const).map((rOpt) => (
                                    <button
                                      key={rOpt}
                                      type="button"
                                      onClick={() =>
                                        handleUpdateEntryParamConfig(
                                          entry,
                                          paramList,
                                          pName,
                                          { role: rOpt }
                                        )
                                      }
                                      class={`px-1.5 py-0.5 rounded font-semibold ${
                                        cfg.role === rOpt
                                          ? rOpt === 'param'
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-purple-500 text-white'
                                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800'
                                      }`}
                                    >
                                      {rOpt === 'param' ? 'Param' : 'Hyper'}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div class="flex items-center gap-1">
                                <span class="font-mono text-neutral-500">
                                  {t('domain_label')}:
                                </span>
                                <div class="inline-flex items-center rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-0.5 gap-0.5">
                                  {domainChoices.map((dc) => (
                                    <button
                                      key={dc.id}
                                      type="button"
                                      data-testid={`fn-param-domain-${entry.name}-${pName}-${dc.id}`}
                                      onClick={() =>
                                        handleUpdateEntryParamConfig(
                                          entry,
                                          paramList,
                                          pName,
                                          { domainMode: dc.id }
                                        )
                                      }
                                      class={`px-1.5 py-0.5 rounded font-mono font-semibold transition-colors ${
                                        cfg.domainMode === dc.id
                                          ? 'bg-orange-500 text-white'
                                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800'
                                      }`}
                                    >
                                      {dc.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 font-mono text-neutral-600 dark:text-neutral-300">
                              <label class="inline-flex items-center gap-1">
                                <span>min:</span>
                                <input
                                  key={`fn-min-${pName}-${cfg.min}-${cfg.domainMode}`}
                                  type="number"
                                  step="0.1"
                                  defaultValue={String(cfg.min)}
                                  onBlur={(e) => {
                                    const v = Number((e.target as HTMLInputElement).value);
                                    if (Number.isFinite(v)) {
                                      handleUpdateEntryParamConfig(
                                        entry,
                                        paramList,
                                        pName,
                                        {
                                          min: v,
                                          ...(v <= 0 && cfg.domainMode === 'positive'
                                            ? { domainMode: 'free' }
                                            : v < 0 && cfg.domainMode === 'non_negative'
                                              ? { domainMode: 'free' }
                                              : {}),
                                        }
                                      );
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  class="w-14 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:border-orange-500 focus:outline-none"
                                />
                              </label>
                              <label class="inline-flex items-center gap-1">
                                <span>max:</span>
                                <input
                                  key={`fn-max-${pName}-${cfg.max}`}
                                  type="number"
                                  step="0.1"
                                  defaultValue={String(cfg.max)}
                                  onBlur={(e) => {
                                    const v = Number((e.target as HTMLInputElement).value);
                                    if (Number.isFinite(v)) {
                                      handleUpdateEntryParamConfig(
                                        entry,
                                        paramList,
                                        pName,
                                        { max: v }
                                      );
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  class="w-14 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:border-orange-500 focus:outline-none"
                                />
                              </label>
                              <label class="inline-flex items-center gap-1">
                                <span>Δ:</span>
                                <input
                                  key={`fn-step-${pName}-${cfg.step}`}
                                  type="number"
                                  step="0.01"
                                  min="0.0001"
                                  defaultValue={String(cfg.step)}
                                  onBlur={(e) => {
                                    const v = Number((e.target as HTMLInputElement).value);
                                    if (Number.isFinite(v)) {
                                      handleUpdateEntryParamConfig(
                                        entry,
                                        paramList,
                                        pName,
                                        { step: Math.max(1e-4, v) }
                                      );
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  class="w-14 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:border-orange-500 focus:outline-none"
                                />
                              </label>
                              <label class="inline-flex items-center gap-1">
                                <span>{t('fn_param_default_label')}:</span>
                                <input
                                  key={`fn-def-${pName}-${cfg.defaultValue}`}
                                  type="number"
                                  step="0.1"
                                  defaultValue={String(cfg.defaultValue)}
                                  onBlur={(e) => {
                                    const v = Number((e.target as HTMLInputElement).value);
                                    if (Number.isFinite(v)) {
                                      handleUpdateEntryParamConfig(
                                        entry,
                                        paramList,
                                        pName,
                                        { defaultValue: v }
                                      );
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  class="w-14 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:border-orange-500 focus:outline-none"
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
