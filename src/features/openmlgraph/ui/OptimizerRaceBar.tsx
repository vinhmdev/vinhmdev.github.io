/**
 * Bottom 4-Optimizer Race Bar, Timeline Scrubber t in [0, T],
 * Nesterov / Adam Bias Correction Toggles, and Divergence Guard Indicator [FR-4.2, NFR-2].
 */
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { OptimizerId } from '../types/state';
import { graphStore, type GraphStoreState } from '../state/store';
import { t } from '../scripts/i18n-client';
import { IconPause, IconPlay } from './icons';

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

export function OptimizerRaceBar({ storeState }: RaceBarProps): JSX.Element {
  const { graph, trajectories } = storeState;
  const race = graph.optimizerRace;

  const anyDiverged = Object.values(trajectories).some((traj) =>
    traj.some((s) => s.diverged)
  );

  // Scrubber playback animation
  useEffect(() => {
    if (!race.playing) return;
    const timer = setInterval(() => {
      graphStore.getState().stepOptimizerRace();
    }, 45);
    return () => clearInterval(timer);
  }, [race.playing]);

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

      {/* Center: Timeline Scrubber t in [0, T] */}
      <div class="flex items-center gap-2 flex-1 max-w-md">
        <button
          type="button"
          onClick={() =>
            storeState.updateOptimizerRace({
              currentStep: race.currentStep >= race.steps ? 0 : race.currentStep,
              playing: !race.playing,
            })
          }
          class="flex items-center gap-1 px-2.5 py-1 rounded bg-orange-500 text-white font-semibold hover:bg-orange-600"
        >
          {race.playing ? <IconPause /> : <IconPlay />}
          <span>{t('race_launch')}</span>
        </button>

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
          class="omlg-slider flex-1"
        />
        <span class="font-mono text-[11px] w-16 text-right">
          t = {race.currentStep}/{race.steps}
        </span>
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
