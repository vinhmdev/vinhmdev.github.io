/**
 * Declarative Plugin & 15 ML Template Contracts [FR-4.4, FR-5.3].
 */
import type { MathJsonExpr } from './math';
import type { GraphStateV2 } from './state';

export type TemplateCategory =
  | 'activation'
  | 'loss'
  | 'probability'
  | 'schedule_norm'
  | 'boundary_kernel';

export interface MathFunctionPlugin {
  name: string;
  latexAliases: string[];
  arity: number;
  evaluateScalar: (...args: number[]) => number;
  firstDerivative?: (args: MathJsonExpr[], diffVar: string) => MathJsonExpr;
  secondDerivative?: (args: MathJsonExpr[], diffVar: string) => MathJsonExpr;
  isPiecewise?: boolean;
  isDiscontinuous?: boolean;
}

export interface OptimizerStepContext {
  w1: number;
  w2: number;
  gradW1: number;
  gradW2: number;
  eta: number;
  beta1: number;
  beta2: number;
  epsilon: number;
  step: number;
  state: Record<string, number>;
}

export interface OptimizerPlugin {
  id: string;
  name: string;
  color: string;
  step: (ctx: OptimizerStepContext) => {
    w1: number;
    w2: number;
    velW1?: number;
    velW2?: number;
    cacheW1?: number;
    cacheW2?: number;
    state: Record<string, number>;
  };
}

export interface LessonTemplate {
  id: string;
  code: string;
  category: TemplateCategory;
  titleKey: string;
  descKey: string;
  defaultLatex: string;
  pedagogicalFocusKey: string;
  buildInitialState: () => Partial<GraphStateV2>;
}
