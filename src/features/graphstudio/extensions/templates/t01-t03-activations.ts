/**
 * Templates T-01 to T-03: Activation Functions, Vanishing Gradient & Temperature Softmax [FR-4.4].
 */
import type { LessonTemplate } from '../../types/plugin';
import { getDefaultSliderBounds } from '../../core/parser/ast-classifier';
import type { SliderState } from '../../types/state';

export function makeSlider(
  name: string,
  latex: string,
  role: 'param' | 'hyperparam',
  value: number,
  min?: number,
  max?: number,
  step?: number
): SliderState {
  const def = getDefaultSliderBounds(name, role);
  return {
    name,
    latex,
    role,
    value,
    min: min ?? def.min,
    max: max ?? def.max,
    step: step ?? def.step,
    playing: false,
    speed: 1,
    loopMode: 'bounce',
    direction: 1,
  };
}

export const TEMPLATES_T01_T03: LessonTemplate[] = [
  {
    id: 'T-01',
    code: 'T-01',
    category: 'activation',
    titleKey: 't01_title',
    descKey: 'Observe peak derivative sigma\'(x) <= 0.25 and exponential decay across L layers: (0.25)^L.',
    defaultLatex: '\\sigma(w \\cdot x + b)',
    pedagogicalFocusKey: 'Vanishing Gradient in Deep Sigmoid/Tanh Networks',
    buildInitialState: () => ({
      activeTemplateId: 'T-01',
      title: 'Sigmoid, Tanh & Vanishing Gradient',
      viewMode: 'dual',
      rightViewportMode: 'loss_surface',
      showResiduals: true,
      dataPoints: [],
      expressions: [
        {
          id: 'expr-1',
          latex: '\\sigma(w \\cdot x + b)',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          label: 'Sigmoid σ(wx+b)',
        },
        {
          id: 'expr-2',
          latex: '\\tanh(w \\cdot x + b)',
          color: '#3b82f6',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          label: 'Tanh(wx+b)',
        },
        {
          id: 'expr-3',
          latex: '(\\sigma(x) \\cdot (1 - \\sigma(x)))^L',
          color: '#10b981',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'L-Layer Gradient Product',
        },
      ],
      sliders: {
        w: makeSlider('w', 'w', 'param', 1.2, -5, 5, 0.05),
        b: makeSlider('b', 'b', 'param', 0.0, -5, 5, 0.05),
        L: makeSlider('L', 'L', 'hyperparam', 4, 1, 10, 1),
        eta: makeSlider('eta', '\\eta', 'hyperparam', 0.12, 0.001, 2.0, 0.01),
      },
    }),
  },
  {
    id: 'T-02',
    code: 'T-02',
    category: 'activation',
    titleKey: 't02_title',
    descKey: 'Compare ReLU kink at (0,0) with LeakyReLU(x, α), ELU, Swish, and smooth GELU.',
    defaultLatex: '\\operatorname{relu}(x)',
    pedagogicalFocusKey: 'Dead ReLU & Smooth Gate Rescue (GELU / Swish)',
    buildInitialState: () => ({
      activeTemplateId: 'T-02',
      title: 'ReLU Family: LeakyReLU, ELU, Swish & GELU',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      showResiduals: true,
      dataPoints: [],
      probeX: 0.0,
      expressions: [
        {
          id: 'expr-1',
          latex: '\\operatorname{relu}(x)',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: true,
          label: 'ReLU(x)',
        },
        {
          id: 'expr-2',
          latex: '\\operatorname{gelu}(x)',
          color: '#3b82f6',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          label: 'GELU(x)',
        },
        {
          id: 'expr-3',
          latex: '\\max(\\alpha \\cdot x, x)',
          color: '#10b981',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'LeakyReLU(x, α)',
        },
      ],
      sliders: {
        alpha: makeSlider('alpha', '\\alpha', 'hyperparam', 0.15, 0.01, 1.0, 0.01),
        beta: makeSlider('beta', '\\beta', 'hyperparam', 1.0, 0.1, 5.0, 0.05),
      },
    }),
  },
  {
    id: 'T-03',
    code: 'T-03',
    category: 'activation',
    titleKey: 't03_title',
    descKey: 'Drag temperature τ from 2.0 (uniform) down to 0.01 (sharp argmax) with LogSumExp stability.',
    defaultLatex: '\\operatorname{softmax}(x, z_1, z_2, z_3, \\tau)',
    pedagogicalFocusKey: 'Temperature Scaling & Barycentric 2-Simplex',
    buildInitialState: () => ({
      activeTemplateId: 'T-03',
      title: 'Temperature Softmax & 2-Simplex',
      viewMode: 'dual',
      rightViewportMode: 'softmax_simplex',
      showResiduals: true,
      dataPoints: [],
      expressions: [
        {
          id: 'expr-1',
          latex: '\\operatorname{softmax}(x, z_1, z_2, z_3, \\tau)',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          label: 'Softmax(x; z, τ)',
        },
      ],
      sliders: {
        tau: makeSlider('tau', '\\tau', 'hyperparam', 0.5, 0.01, 2.5, 0.01),
        z_1: makeSlider('z_1', 'z_1', 'param', 1.4, -4, 4, 0.05),
        z_2: makeSlider('z_2', 'z_2', 'param', 0.3, -4, 4, 0.05),
        z_3: makeSlider('z_3', 'z_3', 'param', -0.8, -4, 4, 0.05),
      },
    }),
  },
];
