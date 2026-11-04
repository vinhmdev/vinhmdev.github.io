/**
 * 4-Optimizer Race Trajectory Engine & Divergence Guard [FR-4.2, NFR-2].
 *
 * Precomputes full optimization trajectories (t in [0, T]) in < 1.0ms for:
 * 1. Vanilla SGD (Red)
 * 2. SGD + Momentum / Nesterov Accelerated Gradient (NAG) (Orange)
 * 3. RMSProp (Cyan)
 * 4. Adam with toggleable Bias Correction (\hat{m}_t, \hat{v}_t) (Blue)
 *
 * Includes Divergence Guard [NFR-2]: halts trajectory when ||w_t|| > 10^6 or NaN.
 */
import type {
  LossKind,
  OptimizerId,
  OptimizerRaceConfig,
  OptimizerTrajectoryStep,
  RegularizationKind,
  SubgradConvention,
} from '../../types/state';
import { evaluateEmpiricalLossAndGrad, type PackedDataset } from './loss-evaluator';

const DIVERGENCE_NORM_LIMIT = 1e6;

export interface OptimizerHyperparams {
  eta: number;
  beta1: number;
  beta2: number;
  epsilon: number;
  delta: number;
  lambda: number;
}

/** Computes learning rate at step t according to the selected schedule (T-10, T-11) */
export function getScheduledLearningRate(
  baseEta: number,
  step: number,
  schedule: OptimizerRaceConfig['lrSchedule']
): number {
  if (schedule === 'cosine_warm_restart') {
    // Cosine Annealing with Warm Restarts every T_i = 25 steps (T-11)
    const period = 25;
    const tCur = step % period;
    const etaMin = 0.005;
    return etaMin + 0.5 * (baseEta - etaMin) * (1.0 + Math.cos((tCur / period) * Math.PI));
  }
  if (schedule === 'catapult') {
    // Transient warmup/catapult spike followed by decay (T-10)
    return step < 8 ? baseEta * 1.35 : baseEta * 0.65;
  }
  return baseEta;
}

export function runOptimizerRace(
  packed: PackedDataset,
  config: OptimizerRaceConfig,
  hyper: OptimizerHyperparams,
  lossKind: LossKind,
  regKind: RegularizationKind,
  convention: SubgradConvention = 'zero'
): Record<OptimizerId, OptimizerTrajectoryStep[]> {
  const result: Record<OptimizerId, OptimizerTrajectoryStep[]> = {
    sgd: [],
    momentum: [],
    rmsprop: [],
    adam: [],
    custom_js: [],
  };

  const optIds: OptimizerId[] = ['sgd', 'momentum', 'rmsprop', 'adam'];

  for (const optId of optIds) {
    if (!config.enabledOptimizers[optId]) continue;

    const traj: OptimizerTrajectoryStep[] = [];
    let w1 = config.startW1;
    let w2 = config.startW2;
    let m1 = 0.0;
    let m2 = 0.0;
    let v1 = 0.0;
    let v2 = 0.0;
    let diverged = false;

    for (let t = 0; t <= config.steps; t++) {
      const currentEval = evaluateEmpiricalLossAndGrad(
        w1,
        w2,
        packed.trainX,
        packed.trainY,
        lossKind,
        hyper.delta,
        regKind,
        hyper.lambda,
        convention
      );

      let nagLookW1: number | undefined;
      let nagLookW2: number | undefined;
      if (optId === 'momentum' && config.useNesterov) {
        nagLookW1 = w1 + hyper.beta1 * m1;
        nagLookW2 = w2 + hyper.beta1 * m2;
      }

      traj.push({
        step: t,
        w1,
        w2,
        loss: currentEval.loss,
        gradW1: currentEval.gradW1,
        gradW2: currentEval.gradW2,
        velW1: m1,
        velW2: m2,
        cacheW1: v1,
        cacheW2: v2,
        nagLookaheadW1: nagLookW1,
        nagLookaheadW2: nagLookW2,
        diverged,
      });

      if (diverged || t === config.steps) break;

      const eta = getScheduledLearningRate(hyper.eta, t, config.lrSchedule);
      let g1 = currentEval.gradW1;
      let g2 = currentEval.gradW2;

      if (optId === 'sgd') {
        w1 -= eta * g1;
        w2 -= eta * g2;
      } else if (optId === 'momentum') {
        if (config.useNesterov && nagLookW1 !== undefined && nagLookW2 !== undefined) {
          const lookEval = evaluateEmpiricalLossAndGrad(
            nagLookW1,
            nagLookW2,
            packed.trainX,
            packed.trainY,
            lossKind,
            hyper.delta,
            regKind,
            hyper.lambda,
            convention
          );
          g1 = lookEval.gradW1;
          g2 = lookEval.gradW2;
        }
        m1 = hyper.beta1 * m1 - eta * g1;
        m2 = hyper.beta1 * m2 - eta * g2;
        w1 += m1;
        w2 += m2;
      } else if (optId === 'rmsprop') {
        v1 = hyper.beta2 * v1 + (1.0 - hyper.beta2) * g1 * g1;
        v2 = hyper.beta2 * v2 + (1.0 - hyper.beta2) * g2 * g2;
        w1 -= (eta * g1) / Math.sqrt(v1 + hyper.epsilon);
        w2 -= (eta * g2) / Math.sqrt(v2 + hyper.epsilon);
      } else if (optId === 'adam') {
        const stepIdx = t + 1;
        m1 = hyper.beta1 * m1 + (1.0 - hyper.beta1) * g1;
        m2 = hyper.beta1 * m2 + (1.0 - hyper.beta1) * g2;
        v1 = hyper.beta2 * v1 + (1.0 - hyper.beta2) * g1 * g1;
        v2 = hyper.beta2 * v2 + (1.0 - hyper.beta2) * g2 * g2;

        const mHat1 = config.adamBiasCorrection
          ? m1 / (1.0 - Math.pow(hyper.beta1, stepIdx))
          : m1;
        const mHat2 = config.adamBiasCorrection
          ? m2 / (1.0 - Math.pow(hyper.beta1, stepIdx))
          : m2;
        const vHat1 = config.adamBiasCorrection
          ? v1 / (1.0 - Math.pow(hyper.beta2, stepIdx))
          : v1;
        const vHat2 = config.adamBiasCorrection
          ? v2 / (1.0 - Math.pow(hyper.beta2, stepIdx))
          : v2;

        w1 -= (eta * mHat1) / (Math.sqrt(vHat1) + hyper.epsilon);
        w2 -= (eta * mHat2) / (Math.sqrt(vHat2) + hyper.epsilon);
      }

      // Divergence Guard [NFR-2]: check norm > 10^6 or non-finite coordinates
      const norm = Math.hypot(w1, w2);
      if (!Number.isFinite(norm) || norm > DIVERGENCE_NORM_LIMIT) {
        diverged = true;
        // Clamp particle to boundary for visual indicator
        const scale = Number.isFinite(norm) && norm > 0 ? DIVERGENCE_NORM_LIMIT / norm : 0;
        w1 = Number.isFinite(w1) ? w1 * scale : config.startW1;
        w2 = Number.isFinite(w2) ? w2 * scale : config.startW2;
      }
    }

    result[optId] = traj;
  }

  return result;
}
