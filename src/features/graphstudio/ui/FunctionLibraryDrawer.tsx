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
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_FUNCTION_LIBRARY,
  extractFunctionSignature,
  formatExpressionForKatex,
} from '../core/parser/cortex-setup';
import { t } from '../scripts/i18n-client';
import { graphStore, type GraphStoreState } from '../state/store';
import type { LibraryFunctionEntry } from '../types/math';
import { IconClose, IconFunction, IconTrash } from './icons';
import { getPlottableExpressions } from '../state/expression-kind';

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
  const [newDefLatex, setNewDefLatex] = useState('');
  const [isEditingNewLatex, setIsEditingNewLatex] = useState(false);
  const [newDesc, setNewDesc] = useState('');
  const editInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const newDefInputRef = useRef<HTMLInputElement | null>(null);

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
    graphStore.getState().upsertLibraryFunction({
      ...entry,
      name: sig.name,
      signature: sig.rawHeader,
      definitionLatex: trimmed,
    });
    setEditingId(null);
    onToast(`Updated ${sig.name}(${sig.formalParams.join(', ')})`);
  };

  const handleAddCustomFunction = (): void => {
    const trimmed = newDefLatex.trim();
    const sig = extractFunctionSignature(trimmed);
    if (!sig || sig.formalParams.length === 0) {
      onToast('Please enter a valid definition: Name(p1, p2) = expression');
      return;
    }
    graphStore.getState().upsertLibraryFunction({
      name: sig.name,
      signature: sig.rawHeader,
      exampleCallLatex: `${sig.name}(x${sig.formalParams.length > 1 ? ', ' + sig.formalParams.slice(1).join(', ') : ''})`,
      category: 'custom',
      description:
        newDesc.trim() ||
        `Custom mathematical function ${sig.name}(${sig.formalParams.join(', ')})`,
      definitionLatex: trimmed,
      enabled: true,
    });
    setNewDefLatex('');
    setNewDesc('');
    onToast(`Added ${sig.name}(${sig.formalParams.join(', ')}) to library`);
  };

  return (
    <div class="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-xl h-full bg-[#0d1220] border-l border-slate-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div class="flex items-center justify-between px-3.5 sm:px-5 py-3.5 border-b border-slate-800 bg-[#0b0f19]">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-7 h-7 shrink-0 rounded-lg bg-orange-500/15 border border-orange-500/40 text-orange-300 flex items-center justify-center">
              <IconFunction class="w-4 h-4" />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-slate-100 truncate">
                {t('fn_lib_title') || 'Pure Math & ML Function Library'}
              </h3>
              <p class="text-[11px] text-slate-400 line-clamp-2">
                {t('fn_lib_subtitle') ||
                  'All functions below are pure mathematical definitions expanded via AST Beta-Reduction.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => graphStore.getState().setFunctionLibraryDrawerOpen(false)}
            class="p-1.5 shrink-0 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <IconClose class="w-4 h-4" />
          </button>
        </div>

        {/* Master Toggle Bar */}
        <div class="flex flex-wrap items-center justify-between gap-2 px-3.5 sm:px-5 py-2.5 border-b border-slate-800/80 bg-slate-900/40">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-semibold text-slate-300">
              Active Library Functions ({library.filter((f) => f.enabled).length}/{library.length})
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={() => graphStore.getState().toggleAllLibraryFunctions(!allEnabled)}
              class={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                allEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              {allEnabled ? 'Disable All' : 'Enable All'}
            </button>
            <button
              type="button"
              onClick={() => {
                graphStore.getState().resetFunctionLibrary();
                onToast('Reset function library to defaults');
              }}
              class="px-2.5 py-1 rounded text-[11px] font-medium bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white"
            >
              Reset Defaults
            </button>
          </div>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-5">
          {/* Card-defined functions in the current worksheet */}
          {cardDefinedFunctions.length > 0 && (
            <div class="space-y-2">
              <div class="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                Worksheet Function Definitions (Active on Canvas)
              </div>
              <div class="space-y-1.5">
                {cardDefinedFunctions.map((fn) => (
                  <div
                    key={fn.exprId}
                    class="p-2.5 rounded-lg border border-sky-500/30 bg-sky-500/5 flex items-center justify-between gap-2"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-mono font-bold text-sky-300">
                        {fn.name}({fn.formalParams.join(', ')})
                      </div>
                      <div
                        class="mt-1 gs-katex-line text-xs text-slate-200 overflow-x-auto"
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
                      class="shrink-0 px-2.5 py-1 rounded text-[11px] font-semibold bg-sky-500/20 border border-sky-500/40 text-sky-200 hover:bg-sky-500/30"
                    >
                      + Reuse Call
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new custom reusable function */}
          <div class="p-3.5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-2.5">
            <div class="text-[11px] font-bold uppercase tracking-wider text-orange-300">
              + Define New Reusable Function
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
                  class="w-full px-3 py-1.5 rounded-lg bg-[#080c14] border border-orange-500/70 ring-1 ring-orange-500/20 text-xs font-mono text-slate-100 focus:outline-none"
                />
                {newDefLatex.trim().length > 0 && (
                  <div
                    class="px-2.5 py-1 rounded bg-[#080c14]/70 border border-slate-800/80 gs-katex-line text-xs text-slate-200 overflow-x-auto"
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
                class="group w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[#080c14] border border-slate-700/80 hover:border-orange-500/60 text-left min-w-0 overflow-hidden transition-colors cursor-text"
              >
                <span
                  class="gs-katex-line min-w-0 flex-1 text-xs text-slate-100"
                  dangerouslySetInnerHTML={{
                    __html: renderLibraryLatexPreview(newDefLatex),
                  }}
                />
                <span class="shrink-0 text-[10px] font-mono text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  ✎ LaTeX
                </span>
              </button>
            )}
            <div class="flex items-center gap-2">
              <input
                type="text"
                value={newDesc}
                onInput={(e) => setNewDesc((e.target as HTMLInputElement).value)}
                placeholder="Optional description (e.g. Scaled dot-product attention)"
                class="min-w-0 flex-1 px-3 py-1.5 rounded-lg bg-[#080c14] border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
              />
              <button
                type="button"
                onClick={handleAddCustomFunction}
                class="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold text-xs transition-colors"
              >
                Save Function
              </button>
            </div>
          </div>

          {/* Pre-defined & Custom Library Functions */}
          <div class="space-y-2.5">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Pure Mathematical Function Pack (Toggle ON/OFF)
            </div>
            {library.map((entry) => {
              const sig = extractFunctionSignature(entry.definitionLatex);
              const paramList = sig?.formalParams ?? ['x'];
              const isEditing = editingId === entry.id;

              return (
                <div
                  key={entry.id}
                  class={`p-3.5 rounded-xl border transition-colors ${
                    entry.enabled
                      ? 'border-slate-700/90 bg-slate-900/70'
                      : 'border-slate-800/60 bg-slate-900/25 opacity-65'
                  }`}
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-xs font-mono font-bold text-orange-300">
                          {entry.name}({paramList.join(', ')})
                        </span>
                        <span class="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-slate-800 text-slate-400 border border-slate-700/70">
                          {entry.category}
                        </span>
                      </div>
                      <p class="text-[11px] text-slate-400 mt-0.5">{entry.description}</p>
                    </div>

                    {/* Toggle ON/OFF Switch */}
                    <div class="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => graphStore.getState().toggleLibraryFunction(entry.id)}
                        class={`px-2.5 py-1 rounded-md text-[10px] font-bold border transition-colors ${
                          entry.enabled
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                        title="Toggle whether this function definition is active in the parser"
                      >
                        {entry.enabled ? 'ON' : 'OFF'}
                      </button>
                      {!defaultIds.has(entry.id) && (
                        <button
                          type="button"
                          onClick={() => graphStore.getState().removeLibraryFunction(entry.id)}
                          class="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
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
                        class="w-full px-2.5 py-1.5 rounded bg-[#080c14] border border-orange-500/70 ring-1 ring-orange-500/20 text-xs font-mono text-slate-100 focus:outline-none"
                      />
                      {editFormula.trim().length > 0 && (
                        <div
                          class="px-2.5 py-1 rounded bg-[#080c14]/70 border border-slate-800/80 gs-katex-line text-xs text-slate-200 overflow-x-auto"
                          dangerouslySetInnerHTML={{
                            __html: renderLibraryLatexPreview(editFormula),
                          }}
                        />
                      )}
                      <div class="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          class="px-2.5 py-1 rounded text-[11px] text-slate-400 hover:text-white bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(entry)}
                          class="px-2.5 py-1 rounded text-[11px] font-semibold bg-orange-500 text-slate-950"
                        >
                          Save Formula
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
                      class="group mt-2 w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#080c14] border border-slate-800/90 hover:border-orange-500/60 text-left min-w-0 overflow-hidden transition-colors cursor-text"
                    >
                      <span
                        class="gs-katex-line min-w-0 flex-1 text-xs text-slate-100"
                        dangerouslySetInnerHTML={{
                          __html: renderLibraryLatexPreview(entry.definitionLatex),
                        }}
                      />
                      <span class="shrink-0 text-[10px] font-mono text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        ✎ LaTeX
                      </span>
                    </button>
                  )}

                  {/* Actions: Insert Call, Insert Full Definition, Edit Formula */}
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
                      class="px-2.5 py-1 rounded text-[10px] font-semibold bg-orange-500/15 border border-orange-500/40 text-orange-300 hover:bg-orange-500/25"
                    >
                      + Use {entry.name}(x)
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
                      class="px-2.5 py-1 rounded text-[10px] font-medium bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white"
                    >
                      + Insert Definition Card
                    </button>
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditFormula(entry.definitionLatex);
                        }}
                        class="px-2 py-1 rounded text-[10px] text-slate-400 hover:text-slate-200"
                      >
                        Edit Formula
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
