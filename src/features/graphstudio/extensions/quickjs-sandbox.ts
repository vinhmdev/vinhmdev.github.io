/**
 * Sandboxed QuickJS WASM Execution Engine for Custom JS Optimizers [FR-5.3].
 *
 * Uses lazy dynamic import (`await import('quickjs-emscripten')`) so the
 * initial bundle stays lightweight, while isolating user-submitted or
 * URL-shared custom optimizer steps inside a memory-capped (8 MB) and
 * time-bounded (<= 50ms per step via `setInterruptHandler`) WebAssembly VM
 * with zero access to `window`, `document`, `fetch`, or `localStorage`.
 */
import type { OptimizerStepContext } from '../types/plugin';
import type { OptimizerTrajectoryStep } from '../types/state';

export interface SandboxStepResult {
  ok: boolean;
  w1: number;
  w2: number;
  state: Record<string, number>;
  error?: string;
}

export interface SandboxTrajectoryResult {
  ok: boolean;
  trajectory: OptimizerTrajectoryStep[];
  error?: string;
}

const DEFAULT_CUSTOM_OPTIMIZER_CODE = `// Custom SignSGD + Cosine Momentum Optimizer (Runs in QuickJS WASM Sandbox)
// Available input object: ctx = { w1, w2, gradW1, gradW2, eta, beta1, step, state }
function step(ctx) {
  const m1 = (ctx.state.m1 || 0) * ctx.beta1 + (1 - ctx.beta1) * ctx.gradW1;
  const m2 = (ctx.state.m2 || 0) * ctx.beta1 + (1 - ctx.beta1) * ctx.gradW2;
  const sign1 = m1 > 0 ? 1 : (m1 < 0 ? -1 : 0);
  const sign2 = m2 > 0 ? 1 : (m2 < 0 ? -1 : 0);
  return {
    w1: ctx.w1 - ctx.eta * 0.5 * (m1 + 0.3 * sign1),
    w2: ctx.w2 - ctx.eta * 0.5 * (m2 + 0.3 * sign2),
    state: { m1, m2 }
  };
}`;

export function getDefaultCustomOptimizerCode(): string {
  return DEFAULT_CUSTOM_OPTIMIZER_CODE;
}

let cachedQuickJSPromise: Promise<unknown> | null = null;

async function loadQuickJS(): Promise<{
  newContext: () => {
    runtime: {
      setMemoryLimit: (bytes: number) => void;
      setInterruptHandler: (cb: () => boolean) => void;
    };
    evalCode: (code: string) => { error?: unknown; value?: unknown; dispose: () => void };
    dump: (handle: unknown) => unknown;
    dispose: () => void;
  };
}> {
  if (!cachedQuickJSPromise) {
    cachedQuickJSPromise = import('quickjs-emscripten').then((mod) => mod.getQuickJS());
  }
  return cachedQuickJSPromise as ReturnType<typeof loadQuickJS>;
}

/**
 * Executes a custom JS optimizer step inside the QuickJS WASM sandbox with
 * strict 50ms execution timeout and 8 MB memory ceiling.
 */
export async function runCustomOptimizerInWasmSandbox(
  userCode: string,
  ctx: OptimizerStepContext,
  timeoutMs = 50
): Promise<SandboxStepResult> {
  try {
    const QuickJS = await loadQuickJS();
    const vm = QuickJS.newContext();
    vm.runtime.setMemoryLimit(8 * 1024 * 1024);
    const deadline = performance.now() + timeoutMs;
    vm.runtime.setInterruptHandler(() => performance.now() > deadline);

    const script = `${userCode}\n;JSON.stringify(step(${JSON.stringify(ctx)}));`;
    const result = vm.evalCode(script);

    if (result.error) {
      const errVal = vm.dump(result.error);
      result.dispose();
      vm.dispose();
      return {
        ok: false,
        w1: ctx.w1,
        w2: ctx.w2,
        state: ctx.state,
        error: typeof errVal === 'object' && errVal && 'message' in errVal
          ? String((errVal as { message: unknown }).message)
          : String(errVal),
      };
    }

    const rawJson = String(vm.dump(result.value));
    result.dispose();
    vm.dispose();

    const parsed = JSON.parse(rawJson) as {
      w1?: unknown;
      w2?: unknown;
      state?: Record<string, number>;
    };

    if (
      typeof parsed?.w1 !== 'number' ||
      !Number.isFinite(parsed.w1) ||
      typeof parsed?.w2 !== 'number' ||
      !Number.isFinite(parsed.w2)
    ) {
      return {
        ok: false,
        w1: ctx.w1,
        w2: ctx.w2,
        state: ctx.state,
        error: 'Custom optimizer step() must return finite numeric { w1, w2 }',
      };
    }

    return {
      ok: true,
      w1: parsed.w1,
      w2: parsed.w2,
      state: parsed.state && typeof parsed.state === 'object' ? parsed.state : ctx.state,
    };
  } catch (err) {
    return {
      ok: false,
      w1: ctx.w1,
      w2: ctx.w2,
      state: ctx.state,
      error: err instanceof Error ? err.message : 'WASM Sandbox execution failed',
    };
  }
}

const DIVERGENCE_NORM_LIMIT = 1e6;

/**
 * Executes a full multi-step custom optimizer trajectory (steps 0..T) inside a single
 * isolated QuickJS WASM VM context with Divergence Guard and 50ms timeout [FR-4.2, FR-5.3].
 */
export async function runCustomOptimizerTrajectoryInWasm(
  userCode: string,
  config: {
    startW1: number;
    startW2: number;
    steps: number;
    eta: number;
    beta1: number;
    beta2: number;
    epsilon: number;
  },
  evalLossAndGrad: (w1: number, w2: number) => { loss: number; gradW1: number; gradW2: number },
  timeoutMs = 50
): Promise<SandboxTrajectoryResult> {
  const trajectory: OptimizerTrajectoryStep[] = [];
  try {
    const QuickJS = await loadQuickJS();
    const vm = QuickJS.newContext();
    vm.runtime.setMemoryLimit(8 * 1024 * 1024);
    const deadline = performance.now() + timeoutMs;
    vm.runtime.setInterruptHandler(() => performance.now() > deadline);

    const initRes = vm.evalCode(userCode);
    if (initRes.error) {
      const errVal = vm.dump(initRes.error);
      initRes.dispose();
      vm.dispose();
      return {
        ok: false,
        trajectory: [],
        error:
          typeof errVal === 'object' && errVal && 'message' in errVal
            ? String((errVal as { message: unknown }).message)
            : String(errVal),
      };
    }
    initRes.dispose();

    let w1 = config.startW1;
    let w2 = config.startW2;
    let state: Record<string, number> = {};
    let diverged = false;

    for (let t = 0; t <= config.steps; t++) {
      const { loss, gradW1, gradW2 } = evalLossAndGrad(w1, w2);
      if (
        !Number.isFinite(w1) ||
        !Number.isFinite(w2) ||
        !Number.isFinite(loss) ||
        Math.hypot(w1, w2) > DIVERGENCE_NORM_LIMIT
      ) {
        diverged = true;
      }

      trajectory.push({
        step: t,
        w1: diverged ? NaN : w1,
        w2: diverged ? NaN : w2,
        loss: diverged ? NaN : loss,
        gradW1: diverged ? NaN : gradW1,
        gradW2: diverged ? NaN : gradW2,
        velW1: 0,
        velW2: 0,
        cacheW1: 0,
        cacheW2: 0,
        diverged,
      });

      if (diverged || t === config.steps) break;

      const ctx: OptimizerStepContext = {
        w1,
        w2,
        gradW1,
        gradW2,
        eta: config.eta,
        beta1: config.beta1,
        beta2: config.beta2,
        epsilon: config.epsilon,
        step: t + 1,
        state,
      };

      const stepRes = vm.evalCode(`JSON.stringify(step(${JSON.stringify(ctx)}))`);
      if (stepRes.error) {
        const errVal = vm.dump(stepRes.error);
        stepRes.dispose();
        vm.dispose();
        return {
          ok: false,
          trajectory,
          error:
            typeof errVal === 'object' && errVal && 'message' in errVal
              ? String((errVal as { message: unknown }).message)
              : String(errVal),
        };
      }

      const rawJson = String(vm.dump(stepRes.value));
      stepRes.dispose();
      const parsed = JSON.parse(rawJson) as {
        w1?: unknown;
        w2?: unknown;
        state?: Record<string, number>;
      };

      w1 = typeof parsed?.w1 === 'number' ? parsed.w1 : NaN;
      w2 = typeof parsed?.w2 === 'number' ? parsed.w2 : NaN;
      if (parsed?.state && typeof parsed.state === 'object') {
        state = parsed.state;
      }
    }

    vm.dispose();
    return { ok: true, trajectory };
  } catch (err) {
    return {
      ok: false,
      trajectory,
      error: err instanceof Error ? err.message : 'WASM Trajectory execution failed',
    };
  }
}
