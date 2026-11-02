/**
 * Bottom 4-Optimizer Race Bar, Timeline Scrubber t in [0, T],
 * Nesterov / Adam Bias Correction Toggles, and Divergence Guard Indicator [FR-4.2, NFR-2].
 */
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { OptimizerId, OptimizerLoopMode, PlaybackSpeed } from '../types/state';
import { graphStore, type GraphStoreState } from '../state/store';
import { t } from '../scripts/i18n-client';
import {
  IconPause,
  IconPlay,
  IconSkipBack,
  IconStepBack,
  IconStepForward,
} from './icons';

interface RaceBarProps {
  storeState: GraphStoreState;
}

const OPT_META: { id: OptimizerId; label: string; colorClass: string }[] = [
  { id: 'sgd', label: 'SGD', colorClass: 'border-red-500 text-red-600 dark:text-red-400' },
  {
    id: 'momentum',
    label: 'Momentum/NAG',
    colorClass: 'border-orange-500 text-orange-600 dark:text-orange-400',
  },
  { id: 'rmsprop', label: 'RMSProp', colorClass: 'border-cyan-500 text-cyan-600 dark:text-cyan-400' },
  { id: 'adam', label: 'Adam', colorClass: 'border-blue-500 text-blue-600 dark:text-blue-400' },
];

const RACE_SPEEDS: PlaybackSpeed[] = [0.25, 0.5, 1, 2, 4];

const RACE_LOOP_MODES: { id: OptimizerLoopMode; icon: string; title: string }[] = [
  { id: 'once', icon: '→|', title: 'Play once and stop at boundary' },
  { id: 'loop', icon: '↻', title: 'Repeat loop continuously' },
  { id: 'bounce', icon: '⇄', title: 'Bounce forward and backward (0 ↔ T)' },
];

export function OptimizerRaceBar({ storeState }: RaceBarProps): JSX.Element {
  const { graph, trajectories } = storeState;
  const race = graph.optimizerRace;
  const speed: PlaybackSpeed = race.speed ?? 1;
  const loopMode: OptimizerLoopMode = race.loopMode ?? 'once';
  const direction: 1 | -1 = race.direction === -1 ? -1 : 1;

  const anyDiverged = Object.values(trajectories).some((traj) =>
    traj.some((s) => s.diverged)
  );

  // Scrubber playback animation scaled by selected playback speed
  useEffect(() => {
    if (!race.playing) return;
    const intervalMs = Math.max(12, Math.round(48 / speed));
    const timer = setInterval(() => {
      graphStore.getState().stepOptimizerRace();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [race.playing, speed]);

  return (
    <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/95 dark:bg-neutral-900/95 text-xs">
      {/* Left: 4 Optimizer Toggles & Nesterov / Bias Correction */}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="font-bold text-neutral-600 dark:text-neutral-300 mr-1">
          {t('race_title')}:
        </span>
        {OPT_META.map((opt) => {
          const active = race.enabledOptimizers[opt.id];
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() =>
                storeState.updateOptimizerRace({
                  enabledOptimizers: {
                    ...race.enabledOptimizers,
                    [opt.id]: !active,
                  },
                })
              }
              class={`px-2 py-0.5 rounded border font-semibold transition-opacity ${
                opt.colorClass
              } ${active ? 'opacity-100 bg-neutral-200/50 dark:bg-neutral-800' : 'opacity-40'}`}
            >
              {opt.label}
            </button>
          );
        })}

        <label class="flex items-center gap-1 ml-1 text-[11px] text-neutral-600 dark:text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={race.useNesterov}
            onChange={(e) =>
              storeState.updateOptimizerRace({
                useNesterov: (e.target as HTMLInputElement).checked,
              })
            }
          />
          NAG
        </label>

        <label class="flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={race.adamBiasCorrection}
            onChange={(e) =>
              storeState.updateOptimizerRace({
                adamBiasCorrection: (e.target as HTMLInputElement).checked,
              })
            }
          />
          Adam BiasCorr
        </label>

        {race.customJsCode && (
          <button
            type="button"
            onClick={() =>
              storeState.updateOptimizerRace({
                enabledOptimizers: {
                  ...race.enabledOptimizers,
                  custom_js: !race.enabledOptimizers.custom_js,
                },
              })
            }
            class={`px-2 py-0.5 rounded border border-purple-500 text-purple-600 dark:text-purple-400 font-semibold transition-opacity ${
              race.enabledOptimizers.custom_js
                ? 'opacity-100 bg-purple-500/15'
                : 'opacity-40'
            }`}
          >
            Custom WASM
          </button>
        )}

        <button
          type="button"
          onClick={() => storeState.setCustomOptModalOpen(true)}
          class="px-2 py-0.5 rounded border border-purple-500/50 text-purple-600 dark:text-purple-300 font-medium hover:bg-purple-500/10"
        >
          {t('custom_opt_btn')}
        </button>
      </div>

      {/* Center: Commercial Timeline Transport + Scrubber + Customizable t = [currentStep] / [steps] */}
      <div class="flex flex-wrap items-center gap-1.5 flex-1 min-w-[280px] max-w-2xl">
        {/* Transport Group: Reset (t=0), Step -1, Play/Pause, Step +1 */}
        <div class="inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={() =>
              storeState.updateOptimizerRace({
                currentStep: 0,
                playing: false,
              })
            }
            class="p-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-orange-500 hover:text-orange-500"
            title={`${t('race_reset')} (t = 0)`}
          >
            <IconSkipBack class="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() =>
              storeState.updateOptimizerRace({
                currentStep: Math.max(0, race.currentStep - 1),
                playing: false,
              })
            }
            class="p-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-orange-500 hover:text-orange-500"
            title={t('race_step_back')}
          >
            <IconStepBack class="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() =>
              storeState.updateOptimizerRace({
                playing: !race.playing,
              })
            }
            class="flex items-center gap-1 px-2.5 py-1 rounded bg-orange-500 text-white font-semibold hover:bg-orange-600 shadow-2xs"
            title={race.playing ? t('race_pause') : t('race_launch')}
          >
            {race.playing ? <IconPause /> : <IconPlay />}
            <span>{race.playing ? t('race_pause') : t('race_launch')}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              storeState.updateOptimizerRace({
                currentStep: Math.min(race.steps, race.currentStep + 1),
                playing: false,
              })
            }
            class="p-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-orange-500 hover:text-orange-500"
            title={t('race_step_fwd')}
          >
            <IconStepForward class="w-3 h-3" />
          </button>
        </div>

        {/* Scrubber Track */}
        <input
          type="range"
          min={0}
          max={race.steps}
          step={1}
          value={race.currentStep}
          onInput={(e) =>
            storeState.updateOptimizerRace({
              currentStep: Number((e.target as HTMLInputElement).value),
              playing: false,
            })
          }
          class="omlg-slider flex-1 min-w-[90px]"
        />

        {/* Customizable t = [currentStep] / [steps] */}
        <div class="inline-flex items-center gap-0.5 font-mono text-[11px] bg-white dark:bg-neutral-800 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700">
          <span class="text-neutral-500">t=</span>
          <input
            type="number"
            min={0}
            max={race.steps}
            step={1}
            aria-label="Current step t"
            value={race.currentStep}
            onChange={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              if (!Number.isFinite(val)) return;
              storeState.updateOptimizerRace({
                currentStep: val,
                playing: false,
              });
            }}
            class="w-11 px-1 py-0.5 rounded bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-right font-bold text-neutral-800 dark:text-neutral-100 focus:border-orange-500 focus:outline-none"
            title="Current step t (0..T)"
          />
          <span class="text-neutral-400">/</span>
          <input
            type="number"
            min={1}
            max={1000}
            step={10}
            aria-label="Total steps T"
            value={race.steps}
            onChange={(e) => {
              const val = Number((e.target as HTMLInputElement).value);
              if (!Number.isFinite(val)) return;
              storeState.updateOptimizerRace({
                steps: val,
              });
            }}
            class="w-12 px-1 py-0.5 rounded bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-right font-bold text-orange-600 dark:text-orange-400 focus:border-orange-500 focus:outline-none"
            title={t('race_total_steps')}
          />
        </div>

        {/* Loop Mode (Once / Loop / Bounce), Direction (→ / ←) & Speed (0.25x..4x) */}
        <div class="inline-flex items-center gap-0.5">
          <div class="inline-flex items-center rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-0.5 gap-0.5">
            {RACE_LOOP_MODES.map((m) => {
              const active = loopMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => storeState.updateOptimizerRace({ loopMode: m.id })}
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
              storeState.updateOptimizerRace({
                direction: direction === 1 ? -1 : 1,
              })
            }
            class="px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 font-mono text-[10px] font-bold text-neutral-700 dark:text-neutral-200 hover:border-orange-500"
            title={direction === 1 ? 'Direction: Forward (0 → T)' : 'Direction: Reverse (T → 0)'}
          >
            {direction === 1 ? '→' : '←'}
          </button>

          <button
            type="button"
            onClick={() => {
              const nextSpeed =
                RACE_SPEEDS[(RACE_SPEEDS.indexOf(speed) + 1) % RACE_SPEEDS.length];
              storeState.updateOptimizerRace({ speed: nextSpeed });
            }}
            class="px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 font-mono text-[10px] font-semibold text-neutral-700 dark:text-neutral-200 hover:border-orange-500"
            title="Playback speed (0.25x, 0.5x, 1x, 2x, 4x)"
          >
            {speed}x
          </button>
        </div>
      </div>

      {/* Right: Divergence Guard Alert or LR Schedule */}
      <div class="flex items-center gap-2">
        {anyDiverged && (
          <span class="px-2 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-600 dark:text-red-400 font-semibold">
            {t('status_diverged')}
          </span>
        )}
        <select
          aria-label="Learning Rate Schedule"
          value={race.lrSchedule}
          onChange={(e) =>
            storeState.updateOptimizerRace({
              lrSchedule: (e.target as HTMLSelectElement)
                .value as GraphStoreState['graph']['optimizerRace']['lrSchedule'],
            })
          }
          class="h-6 px-1.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-[11px]"
        >
          <option value="constant">LR: Constant</option>
          <option value="cosine_warm_restart">LR: Cosine Warm Restart</option>
          <option value="catapult">LR: Catapult Spike</option>
        </select>
      </div>
    </div>
  );
}

