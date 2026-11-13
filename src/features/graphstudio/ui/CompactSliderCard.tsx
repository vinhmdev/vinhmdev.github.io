/**
 * Compact Slider Scrubber Card (~52px single-row default, saving ~38% vertical height).
 *
 * Features a 28px Left Gutter drag handle (`touch-action: none` isolated from `<input type="range">`),
 * inline tap-to-edit min/max bound pills, 3D surface axis badges (`X`/`Y`), and an expandable `[⚙️]`
 * tray with Step nudges, Min/Δ/Max inputs, Loop/Direction/Speed, and Move Up/Down buttons.
 */
import katex from 'katex';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../scripts/i18n-client';
import type { GraphStoreState } from '../state/store';
import type { PlaybackSpeed, SliderLoopMode, SliderState } from '../types/state';
import {
  IconArrowDown,
  IconArrowUp,
  IconGripVertical,
  IconPause,
  IconPlay,
  IconSettings,
  IconStepBack,
  IconStepForward,
} from './icons';
import type { SortableHandleBind, SortableItemBind } from './useSortableList';

function renderSliderSymbol(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: false });
  } catch {
    return latex;
  }
}

const SPEEDS: PlaybackSpeed[] = [0.25, 0.5, 1, 2, 4];

export interface CompactSliderCardProps {
  slider: SliderState;
  index: number;
  totalCount: number;
  axisBadge: 'X' | 'Y' | null;
  configOpen: boolean;
  onToggleConfig: () => void;
  storeState: GraphStoreState;
  itemBind: SortableItemBind;
  handleBind: SortableHandleBind;
}

export function CompactSliderCard({
  slider: sl,
  index,
  totalCount,
  axisBadge,
  configOpen,
  onToggleConfig,
  storeState,
  itemBind,
  handleBind,
}: CompactSliderCardProps): JSX.Element {
  const [editingBound, setEditingBound] = useState<'min' | 'max' | null>(null);
  const boundInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!editingBound || !boundInputRef.current) return;
    boundInputRef.current.focus();
    boundInputRef.current.select();
  }, [editingBound]);

  const loopModes: { id: SliderLoopMode; icon: string; title: string }[] = [
    { id: 'once', icon: '→|', title: t('loop_once_desc') },
    { id: 'wrap', icon: '↻', title: t('loop_forward_desc') },
    { id: 'bounce', icon: '⇄', title: t('loop_bounce_desc') },
  ];

  const isParam = sl.role === 'param';

  return (
    <div
      ref={itemBind.ref}
      style={itemBind.style}
      onKeyDown={itemBind.onKeyDown}
      class={`relative rounded-lg border bg-white dark:bg-neutral-900 shadow-2xs flex items-stretch min-h-[48px] transition-shadow ${
        itemBind.isDragging
          ? 'border-orange-500 ring-2 ring-orange-500/50 shadow-lg opacity-95'
          : 'border-neutral-200 dark:border-neutral-800'
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

      {/* 28px Left Gutter Drag Handle */}
      <button
        type="button"
        aria-label={`${t('drag_reorder_tooltip')} (${sl.name})`}
        title={t('drag_reorder_tooltip')}
        {...handleBind}
        class="w-7 shrink-0 flex items-center justify-center rounded-l-lg border-r border-neutral-100 dark:border-neutral-800/80 text-neutral-400 hover:text-orange-500 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 touch-none select-none cursor-grab active:cursor-grabbing transition-colors"
      >
        <IconGripVertical class="w-3.5 h-3.5" />
      </button>

      {/* Main Content */}
      <div class="flex-1 min-w-0 flex flex-col justify-center px-1.5 sm:px-2 py-1.5 gap-1.5">
        {/* Compact Scrubber Row */}
        <div class="flex items-center gap-1 sm:gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => storeState.updateSliderBounds(sl.name, { playing: !sl.playing })}
            class={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center transition-colors ${
              sl.playing
                ? 'bg-orange-500 text-white shadow-xs'
                : 'bg-orange-500/15 text-orange-600 dark:text-orange-400 hover:bg-orange-500/25'
            }`}
            title={sl.playing ? t('pause_all_btn') : t('play_all_btn')}
            aria-label={sl.playing ? `Pause ${sl.name}` : `Play ${sl.name}`}
          >
            {sl.playing ? <IconPause class="w-3 h-3" /> : <IconPlay class="w-3 h-3" />}
          </button>

          {/* Variable Symbol + Role Dot + 3D Axis Tag + Direct Value Input */}
          <label class="inline-flex items-center gap-1 shrink-0 font-mono font-bold text-neutral-800 dark:text-neutral-100">
            <span
              class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isParam ? 'bg-blue-500' : 'bg-purple-500'
              }`}
              title={`${isParam ? 'Param' : 'Hyper'} — ${t('role_edit_hint')}`}
            />
            <span
              class="inline-block text-xs"
              dangerouslySetInnerHTML={{
                __html: renderSliderSymbol(sl.latex || sl.name),
              }}
            />
            {axisBadge && (
              <span
                class="px-1 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[9px] font-mono font-bold leading-tight"
                title={`3D Surface ${axisBadge} axis`}
              >
                {axisBadge}
              </span>
            )}
            <span class="text-neutral-400 font-normal">=</span>
            <input
              type="number"
              step={sl.step}
              aria-label={`${sl.name} value`}
              value={Number(sl.value.toFixed(4))}
              onChange={(e) => {
                const raw = Number((e.target as HTMLInputElement).value);
                if (!Number.isFinite(raw)) return;
                if (raw < sl.min || raw > sl.max) {
                  storeState.updateSliderBounds(sl.name, {
                    min: Math.min(sl.min, raw),
                    max: Math.max(sl.max, raw),
                    value: raw,
                    playing: false,
                  });
                } else {
                  storeState.setSliderValue(sl.name, raw, true);
                }
              }}
              class="w-11 sm:w-13 px-1 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 font-mono font-bold text-[11px] focus:border-orange-500 focus:outline-none"
            />
          </label>

          {/* Inline Bound Pills + Range Scrubber */}
          <div class="flex-1 min-w-0 flex items-center gap-1">
            {editingBound === 'min' ? (
              <input
                ref={boundInputRef}
                type="number"
                step="0.1"
                aria-label={`${sl.name} min`}
                defaultValue={String(sl.min)}
                onBlur={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (Number.isFinite(v)) storeState.updateSliderBounds(sl.name, { min: v });
                  setEditingBound(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                class="w-10 sm:w-11 px-1 py-0.5 rounded border border-orange-500 bg-neutral-50 dark:bg-neutral-950 font-mono text-[10px] text-center focus:outline-none"
              />
            ) : (
              <button
                type="button"
                aria-label={`${sl.name} min`}
                onClick={() => setEditingBound('min')}
                class="shrink-0 px-1 py-0.5 rounded font-mono text-[10px] text-neutral-400 hover:text-orange-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                title="Min bound (click to edit)"
              >
                {sl.min}
              </button>
            )}

            <input
              type="range"
              min={sl.min}
              max={sl.max}
              step={sl.step}
              value={sl.value}
              aria-label={`${sl.name} slider`}
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
              class={`gs-slider flex-1 ${editingBound ? 'min-w-[16px]' : 'min-w-[36px]'}`}
            />

            {editingBound === 'max' ? (
              <input
                ref={boundInputRef}
                type="number"
                step="0.1"
                aria-label={`${sl.name} max`}
                defaultValue={String(sl.max)}
                onBlur={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (Number.isFinite(v)) storeState.updateSliderBounds(sl.name, { max: v });
                  setEditingBound(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                class="w-10 sm:w-11 px-1 py-0.5 rounded border border-orange-500 bg-neutral-50 dark:bg-neutral-950 font-mono text-[10px] text-center focus:outline-none"
              />
            ) : (
              <button
                type="button"
                aria-label={`${sl.name} max`}
                onClick={() => setEditingBound('max')}
                class="shrink-0 px-1 py-0.5 rounded font-mono text-[10px] text-neutral-400 hover:text-orange-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                title="Max bound (click to edit)"
              >
                {sl.max}
              </button>
            )}
          </div>

          <button
            type="button"
            aria-expanded={configOpen}
            aria-label={`${sl.name} ${t('slider_setup_title')}`}
            onClick={onToggleConfig}
            class={`w-6 h-6 shrink-0 rounded border flex items-center justify-center transition-colors ${
              configOpen
                ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/40'
                : 'border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:border-orange-500 hover:text-orange-500'
            }`}
            title={t('slider_setup_title')}
          >
            <IconSettings class="w-3 h-3" />
          </button>
        </div>

        {/* Expandable ⚙️ Setup Tray */}
        {configOpen && (
          <div class="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-neutral-100 dark:border-neutral-800/80 text-[10px] text-neutral-500">
            {/* Step Nudge + Loop / Direction / Speed */}
            <div class="flex flex-wrap items-center gap-1">
              <div class="inline-flex items-center rounded border border-neutral-200 dark:border-neutral-700 overflow-hidden bg-white dark:bg-neutral-800">
                <button
                  type="button"
                  onClick={() => storeState.stepSliderByDelta(sl.name, -1)}
                  class="px-1.5 py-0.5 text-neutral-600 dark:text-neutral-300 hover:text-orange-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  title={`Step backward (-${sl.step})`}
                >
                  <IconStepBack />
                </button>
                <button
                  type="button"
                  onClick={() => storeState.stepSliderByDelta(sl.name, 1)}
                  class="px-1.5 py-0.5 text-neutral-600 dark:text-neutral-300 hover:text-orange-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 border-l border-neutral-200 dark:border-neutral-700"
                  title={`Step forward (+${sl.step})`}
                >
                  <IconStepForward />
                </button>
              </div>

              <div class="inline-flex items-center rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-0.5 gap-0.5">
                {loopModes.map((m) => {
                  const active =
                    m.id === 'wrap'
                      ? sl.loopMode === 'wrap' || sl.loopMode === 'wrap_reverse'
                      : sl.loopMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        storeState.updateSliderBounds(sl.name, { loopMode: m.id })
                      }
                      class={`px-1 py-0.5 rounded font-mono text-[10px] leading-none ${
                        active
                          ? 'bg-orange-500 text-white font-bold'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                      }`}
                      title={m.title}
                    >
                      {m.icon}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() =>
                  storeState.updateSliderBounds(sl.name, {
                    direction: sl.direction === -1 ? 1 : -1,
                    ...(sl.loopMode === 'wrap_reverse' ? { loopMode: 'wrap' } : {}),
                  })
                }
                class="px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 font-mono font-bold text-neutral-700 dark:text-neutral-200 hover:border-orange-500"
                title={sl.direction === -1 ? 'Reverse (max → min)' : 'Forward (min → max)'}
              >
                {sl.direction === -1 ? '←' : '→'}
              </button>

              <button
                type="button"
                onClick={() => {
                  const idx = SPEEDS.indexOf(sl.speed);
                  const nextSpeed = SPEEDS[(idx + 1) % SPEEDS.length];
                  storeState.updateSliderBounds(sl.name, { speed: nextSpeed });
                }}
                class="px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 font-mono font-semibold text-neutral-700 dark:text-neutral-200 hover:border-orange-500"
                title="Playback speed"
              >
                {sl.speed}x
              </button>
            </div>

            {/* Min / Δ / Max + Move Up / Down */}
            <div class="flex flex-wrap items-center gap-1 ml-auto">
              <label class="inline-flex items-center gap-0.5" title="Min">
                <span class="font-mono">min:</span>
                <input
                  type="number"
                  step="0.1"
                  value={sl.min}
                  onChange={(e) =>
                    storeState.updateSliderBounds(sl.name, {
                      min: Number((e.target as HTMLInputElement).value),
                    })
                  }
                  class="w-11 px-1 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 font-mono text-[10px] text-neutral-700 dark:text-neutral-200 focus:border-orange-500 focus:outline-none"
                />
              </label>

              <label class="inline-flex items-center gap-0.5" title="Step Δ">
                <span class="font-mono">Δ:</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.0001"
                  value={sl.step}
                  onChange={(e) =>
                    storeState.updateSliderBounds(sl.name, {
                      step: Math.max(1e-4, Number((e.target as HTMLInputElement).value)),
                    })
                  }
                  class="w-11 px-1 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 font-mono text-[10px] text-neutral-700 dark:text-neutral-200 focus:border-orange-500 focus:outline-none"
                />
              </label>

              <label class="inline-flex items-center gap-0.5" title="Max">
                <span class="font-mono">max:</span>
                <input
                  type="number"
                  step="0.1"
                  value={sl.max}
                  onChange={(e) =>
                    storeState.updateSliderBounds(sl.name, {
                      max: Number((e.target as HTMLInputElement).value),
                    })
                  }
                  class="w-11 px-1 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 font-mono text-[10px] text-neutral-700 dark:text-neutral-200 focus:border-orange-500 focus:outline-none"
                />
              </label>

              {totalCount > 1 && (
                <div class="inline-flex items-center rounded border border-neutral-200 dark:border-neutral-700 overflow-hidden bg-white dark:bg-neutral-800 ml-0.5">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => storeState.moveSlider(sl.name, -1)}
                    class="p-1 text-neutral-600 dark:text-neutral-300 hover:text-orange-500 disabled:opacity-35 disabled:pointer-events-none"
                    title={`${t('move_up')} (Alt+↑)`}
                    aria-label={`${t('move_up')} ${sl.name}`}
                  >
                    <IconArrowUp class="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === totalCount - 1}
                    onClick={() => storeState.moveSlider(sl.name, 1)}
                    class="p-1 text-neutral-600 dark:text-neutral-300 hover:text-orange-500 border-l border-neutral-200 dark:border-neutral-700 disabled:opacity-35 disabled:pointer-events-none"
                    title={`${t('move_down')} (Alt+↓)`}
                    aria-label={`${t('move_down')} ${sl.name}`}
                  >
                    <IconArrowDown class="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
