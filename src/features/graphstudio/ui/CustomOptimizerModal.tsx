/**
 * Custom JS Optimizer Editor Modal with QuickJS WASM Sandbox Verification [FR-5.3].
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  getDefaultCustomOptimizerCode,
  runCustomOptimizerInWasmSandbox,
} from '../extensions/quickjs-sandbox';
import { t } from '../scripts/i18n-client';
import type { GraphStoreState } from '../state/store';
import { IconClose } from './icons';

interface CustomOptModalProps {
  storeState: GraphStoreState;
  onToast: (msg: string) => void;
}

export function CustomOptimizerModal({
  storeState,
  onToast,
}: CustomOptModalProps): JSX.Element | null {
  if (!storeState.customOptModalOpen) return null;

  const [code, setCode] = useState(
    storeState.graph.optimizerRace.customJsCode || getDefaultCustomOptimizerCode()
  );
  const [testing, setTesting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleTestAndApply = async (): Promise<void> => {
    setTesting(true);
    setErrorMsg(null);
    const res = await runCustomOptimizerInWasmSandbox(
      code,
      {
        w1: -2.0,
        w2: 1.5,
        gradW1: -0.8,
        gradW2: 0.6,
        eta: 0.1,
        beta1: 0.9,
        beta2: 0.99,
        epsilon: 1e-8,
        step: 1,
        state: {},
      },
      50
    );
    setTesting(false);

    if (!res.ok) {
      setErrorMsg(res.error ?? 'Execution failed inside QuickJS WASM Sandbox');
      return;
    }

    storeState.updateOptimizerRace({
      customJsCode: code,
      enabledOptimizers: {
        ...storeState.graph.optimizerRace.enabledOptimizers,
        custom_js: true,
      },
    });
    storeState.setCustomOptModalOpen(false);
    onToast('Custom WASM Optimizer verified & activated!');
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4">
      <div class="w-full max-w-xl max-h-[90vh] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl flex flex-col overflow-hidden text-xs">
        <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <div class="min-w-0">
            <h3 class="font-bold text-sm text-neutral-900 dark:text-neutral-100 truncate">
              {t('custom_opt_modal_title')}
            </h3>
            <p class="text-[11px] text-neutral-500">{t('custom_opt_modal_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => storeState.setCustomOptModalOpen(false)}
            class="p-1 shrink-0 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <IconClose />
          </button>
        </div>

        <div class="p-4 flex flex-col gap-3 overflow-y-auto">
          <textarea
            rows={12}
            value={code}
            onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)}
            class="w-full p-2.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 font-mono text-xs leading-relaxed focus:outline-none focus:border-orange-500"
          />

          {errorMsg && (
            <div class="p-2.5 rounded-lg bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-400 font-mono">
              {errorMsg}
            </div>
          )}

          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => storeState.setCustomOptModalOpen(false)}
              class="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700"
            >
              {t('custom_opt_cancel')}
            </button>
            <button
              type="button"
              disabled={testing}
              onClick={() => void handleTestAndApply()}
              class="px-4 py-1.5 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50"
            >
              {testing ? t('custom_opt_verifying') : t('custom_opt_submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
