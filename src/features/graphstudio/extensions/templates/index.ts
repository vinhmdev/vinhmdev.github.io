/**
 * Registry of all 15 Canonical ML Math Templates (T-01 through T-15) [FR-4.4]
 * plus T-00: Bảng trắng (Blank Canvas / Freeform Graphing & Whiteboard).
 */
import type { LessonTemplate } from '../../types/plugin';
import { getRegisteredLessons } from '../contracts';
import { makeSlider, TEMPLATES_T01_T03 } from './t01-t03-activations';
import { TEMPLATES_T04_T06 } from './t04-t06-losses';
import { TEMPLATES_T07_T11 } from './t07-t11-prob-schedules';
import { TEMPLATES_T12_T15 } from './t12-t15-specialized';

export const BLANK_CANVAS_TEMPLATE: LessonTemplate = {
  id: 'T-00',
  code: 'T-00',
  category: 'activation',
  titleKey: 't00_title',
  descKey:
    'Freeform 2D math & ML graphing calculator (Desmos/GeoGebra style) with auto-sliders and whiteboard annotation.',
  defaultLatex: 'a \\cdot \\sin(b \\cdot x) + c',
  pedagogicalFocusKey: 'Freeform Graphing Calculator & Interactive Whiteboard',
  buildInitialState: () => ({
    activeTemplateId: 'T-00',
    title: 'Blank Graph & Whiteboard',
    viewMode: 'inference',
    rightViewportMode: 'loss_surface',
    probeX: null,
    showResiduals: false,
    dataPoints: [],
    leftViewport: { xMin: -10, xMax: 10, yMin: -6, yMax: 6 },
    expressions: [
      {
        id: 'expr-1',
        latex: 'a \\cdot \\sin(b \\cdot x) + c',
        color: '#f97316',
        visible: true,
        showFirstDerivative: false,
        showSecondDerivative: false,
        label: 'f(x)',
      },
      {
        id: 'expr-2',
        latex: '0.25 \\cdot x^2 - 2',
        color: '#3b82f6',
        visible: true,
        showFirstDerivative: false,
        showSecondDerivative: false,
        label: 'g(x)',
      },
    ],
    // Purely dynamic: sliders are never hardcoded in T-00; syncSlidersFromExpressions() derives them from AST symbols
    sliders: {},
  }),
};

export const MATH_TEMPLATES: LessonTemplate[] = [
  {
    id: 'M-01',
    code: 'M-01',
    category: 'activation',
    titleKey: 'm01_title',
    descKey: 'Cubic polynomial f(x) = a*x^3 + b*x^2 + c*x + d with 1st and 2nd derivatives.',
    defaultLatex: 'a \\cdot x^3 + b \\cdot x^2 + c \\cdot x + d',
    pedagogicalFocusKey: 'Extrema, Roots & Inflection Points',
    buildInitialState: () => ({
      activeTemplateId: 'M-01',
      title: 'Cubic Polynomial & Calculus',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      probeX: 0.5,
      showResiduals: false,
      dataPoints: [],
      leftViewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      expressions: [
        {
          id: 'expr-1',
          latex: 'a \\cdot x^3 + b \\cdot x^2 + c \\cdot x + d',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: true,
          label: 'f(x)',
        },
      ],
      sliders: {
        a: makeSlider('a', 'a', 'param', 1.0, -3, 3, 0.05),
        b: makeSlider('b', 'b', 'param', 0.0, -4, 4, 0.05),
        c: makeSlider('c', 'c', 'param', -3.0, -6, 6, 0.05),
        d: makeSlider('d', 'd', 'param', 0.0, -4, 4, 0.05),
      },
    }),
  },
  {
    id: 'M-02',
    code: 'M-02',
    category: 'activation',
    titleKey: 'm02_title',
    descKey: 'Harmonic wave interference and frequency modulation.',
    defaultLatex: 'a \\cdot \\sin(b \\cdot x) + \\cos(c \\cdot x)',
    pedagogicalFocusKey: 'Trigonometry & Wave Interference',
    buildInitialState: () => ({
      activeTemplateId: 'M-02',
      title: 'Trigonometry & Wave Interference',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      probeX: null,
      showResiduals: false,
      dataPoints: [],
      leftViewport: { xMin: -8, xMax: 8, yMin: -4.5, yMax: 4.5 },
      expressions: [
        {
          id: 'expr-1',
          latex: 'a \\cdot \\sin(b \\cdot x) + \\cos(c \\cdot x)',
          color: '#f97316',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'f(x)',
        },
        {
          id: 'expr-2',
          latex: 'a \\cdot \\sin(b \\cdot x)',
          color: '#3b82f6',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'g(x)',
        },
      ],
      sliders: {
        a: makeSlider('a', 'a', 'param', 1.5, -4, 4, 0.05),
        b: makeSlider('b', 'b', 'param', 1.0, 0.2, 5, 0.05),
        c: makeSlider('c', 'c', 'param', 3.0, 0.2, 8, 0.05),
      },
    }),
  },
  {
    id: 'M-03',
    code: 'M-03',
    category: 'activation',
    titleKey: 'm03_title',
    descKey: 'Rational functions with vertical and oblique asymptotes.',
    defaultLatex: '\\frac{x^2 - a}{x - b}',
    pedagogicalFocusKey: 'Rational Functions & Asymptotes',
    buildInitialState: () => ({
      activeTemplateId: 'M-03',
      title: 'Rational Functions & Asymptotes',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      probeX: null,
      showResiduals: false,
      dataPoints: [],
      leftViewport: { xMin: -8, xMax: 8, yMin: -8, yMax: 8 },
      expressions: [
        {
          id: 'expr-1',
          latex: '\\frac{x^2 - a}{x - b}',
          color: '#f97316',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'f(x)',
        },
        {
          id: 'expr-2',
          latex: 'x + b',
          color: '#10b981',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'Asymptote',
        },
      ],
      sliders: {
        a: makeSlider('a', 'a', 'param', 4.0, -6, 6, 0.1),
        b: makeSlider('b', 'b', 'param', 1.0, -4, 4, 0.1),
      },
    }),
  },
  {
    id: 'M-04',
    code: 'M-04',
    category: 'activation',
    titleKey: 'm04_title',
    descKey: 'Exponential growth/decay and logarithmic functions.',
    defaultLatex: 'a \\cdot e^{k \\cdot x}',
    pedagogicalFocusKey: 'Exponential & Logarithmic Functions',
    buildInitialState: () => ({
      activeTemplateId: 'M-04',
      title: 'Exponential & Logarithmic Functions',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      probeX: null,
      showResiduals: false,
      dataPoints: [],
      leftViewport: { xMin: -5, xMax: 6, yMin: -4, yMax: 6 },
      expressions: [
        {
          id: 'expr-1',
          latex: 'a \\cdot e^{k \\cdot x}',
          color: '#f97316',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'f(x)',
        },
        {
          id: 'expr-2',
          latex: '\\ln(x)',
          color: '#3b82f6',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'ln(x)',
        },
      ],
      sliders: {
        a: makeSlider('a', 'a', 'param', 1.0, 0.1, 4, 0.05),
        k: makeSlider('k', 'k', 'param', 0.5, -2, 2, 0.05),
      },
    }),
  },
  {
    id: 'M-05',
    code: 'M-05',
    category: 'activation',
    titleKey: 'm05_title',
    descKey: 'Gaussian bell curve and damped harmonic oscillation.',
    defaultLatex: 'e^{-a \\cdot x^2} \\cdot \\cos(b \\cdot x)',
    pedagogicalFocusKey: 'Gaussian Envelope & Damped Oscillation',
    buildInitialState: () => ({
      activeTemplateId: 'M-05',
      title: 'Gaussian Bell & Damped Oscillation',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      probeX: null,
      showResiduals: false,
      dataPoints: [],
      leftViewport: { xMin: -5, xMax: 5, yMin: -2.5, yMax: 2.5 },
      expressions: [
        {
          id: 'expr-1',
          latex: 'e^{-a \\cdot x^2} \\cdot \\cos(b \\cdot x)',
          color: '#f97316',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'f(x)',
        },
        {
          id: 'expr-2',
          latex: 'e^{-a \\cdot x^2}',
          color: '#a855f7',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'Envelope',
        },
      ],
      sliders: {
        a: makeSlider('a', 'a', 'param', 0.35, 0.05, 2.0, 0.05),
        b: makeSlider('b', 'b', 'param', 4.0, 0.5, 10.0, 0.1),
      },
    }),
  },
  {
    id: 'M-06',
    code: 'M-06',
    category: 'activation',
    titleKey: 'm06_title',
    descKey: 'Taylor polynomial approximation of sin(x) up to degree 5 around x = 0.',
    defaultLatex: 'x - \\frac{x^3}{6} + a \\cdot \\frac{x^5}{120}',
    pedagogicalFocusKey: 'Taylor Series Convergence & Polynomial Approximation',
    buildInitialState: () => ({
      activeTemplateId: 'M-06',
      title: 'Taylor Series of sin(x)',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      probeX: null,
      showResiduals: false,
      dataPoints: [],
      leftViewport: { xMin: -6.5, xMax: 6.5, yMin: -3.5, yMax: 3.5 },
      expressions: [
        {
          id: 'expr-1',
          latex: '\\sin(x)',
          color: '#3b82f6',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'sin(x)',
        },
        {
          id: 'expr-2',
          latex: 'x - \\frac{x^3}{6} + a \\cdot \\frac{x^5}{120}',
          color: '#f97316',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'Taylor T₅(x)',
        },
      ],
      sliders: {
        a: makeSlider('a', 'a', 'param', 1.0, 0.0, 1.5, 0.05),
      },
    }),
  },
  {
    id: 'M-07',
    code: 'M-07',
    category: 'activation',
    titleKey: 'm07_title',
    descKey: 'Double-well quartic potential V(x) = 0.25*x^4 - 0.5*a*x^2 + b*x showing symmetry breaking and bifurcation.',
    defaultLatex: '0.25 \\cdot x^4 - 0.5 \\cdot a \\cdot x^2 + b \\cdot x',
    pedagogicalFocusKey: 'Quartic Double-Well Potential & Symmetry Breaking',
    buildInitialState: () => ({
      activeTemplateId: 'M-07',
      title: 'Quartic Double-Well & Bifurcation',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      probeX: 0.0,
      showResiduals: false,
      dataPoints: [],
      leftViewport: { xMin: -4.5, xMax: 4.5, yMin: -3.5, yMax: 4.5 },
      expressions: [
        {
          id: 'expr-1',
          latex: '0.25 \\cdot x^4 - 0.5 \\cdot a \\cdot x^2 + b \\cdot x',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          label: 'V(x)',
        },
      ],
      sliders: {
        a: makeSlider('a', 'a', 'param', 3.0, -2.0, 5.0, 0.1),
        b: makeSlider('b', 'b', 'param', 0.2, -2.0, 2.0, 0.05),
      },
    }),
  },
  {
    id: 'M-08',
    code: 'M-08',
    category: 'activation',
    titleKey: 'm08_title',
    descKey: 'Non-smooth piecewise absolute value and staircase floor functions with exact kink & jump detection.',
    defaultLatex: '\\left|x^2 - a\\right| - b \\cdot x',
    pedagogicalFocusKey: 'Piecewise Kinks, Subdifferentials & Step Discontinuities',
    buildInitialState: () => ({
      activeTemplateId: 'M-08',
      title: 'Piecewise Absolute Value & Floor Step',
      viewMode: 'inference',
      rightViewportMode: 'loss_surface',
      probeX: null,
      showResiduals: false,
      dataPoints: [],
      leftViewport: { xMin: -5, xMax: 5, yMin: -4, yMax: 6 },
      expressions: [
        {
          id: 'expr-1',
          latex: '\\left|x^2 - a\\right| - b \\cdot x',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          label: '|x² - a| - bx',
        },
        {
          id: 'expr-2',
          latex: '0.5 \\cdot \\operatorname{floor}(x)',
          color: '#10b981',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: '0.5·floor(x)',
        },
      ],
      sliders: {
        a: makeSlider('a', 'a', 'param', 2.25, 0.0, 6.0, 0.05),
        b: makeSlider('b', 'b', 'param', 0.4, -2.0, 2.0, 0.05),
      },
    }),
  },
];

export interface QuickFormulaGroup {
  groupKey: string;
  items: { label: string; desc: string; latex: string }[];
}

export const QUICK_FORMULA_GROUPS: QuickFormulaGroup[] = [
  {
    groupKey: 'qf_group_algebra',
    items: [
      { label: 'ax² + bx + c', desc: 'Quadratic parabola', latex: 'a \\cdot x^2 + b \\cdot x + c' },
      { label: 'ax³ + bx² + cx + d', desc: 'Cubic polynomial', latex: 'a \\cdot x^3 + b \\cdot x^2 + c \\cdot x + d' },
      { label: '¼x⁴ - ½ax² + bx', desc: 'Double-well quartic', latex: '0.25 \\cdot x^4 - 0.5 \\cdot a \\cdot x^2 + b \\cdot x' },
      { label: '(x² - a) / (x - b)', desc: 'Rational with asymptote', latex: '\\frac{x^2 - a}{x - b}' },
      { label: '|x² - a|', desc: 'Piecewise folded parabola', latex: '\\left|x^2 - a\\right|' },
      { label: '√(x² + a)', desc: 'Smooth hyperbola', latex: '\\sqrt{x^2 + a}' },
    ],
  },
  {
    groupKey: 'qf_group_trig',
    items: [
      { label: 'a·sin(bx) + c', desc: 'Sine wave with amplitude/phase', latex: 'a \\cdot \\sin(b \\cdot x) + c' },
      { label: 'a·sin(bx) + cos(cx)', desc: 'Harmonic wave interference', latex: 'a \\cdot \\sin(b \\cdot x) + \\cos(c \\cdot x)' },
      { label: 'sin(x)/x (Sinc)', desc: 'Damped cardinal sine', latex: '\\frac{\\sin(a \\cdot x)}{x}' },
      { label: 'e^(-ax²)·cos(bx)', desc: 'Gabor wavelet / damped wave', latex: 'e^{-a \\cdot x^2} \\cdot \\cos(b \\cdot x)' },
      { label: 'tan(a·x)', desc: 'Periodic tangent with poles', latex: '\\tan(a \\cdot x)' },
    ],
  },
  {
    groupKey: 'qf_group_exp',
    items: [
      { label: 'a·e^(kx)', desc: 'Exponential growth / decay', latex: 'a \\cdot e^{k \\cdot x}' },
      { label: 'ln(x)', desc: 'Natural logarithm (x > 0)', latex: '\\ln(x)' },
      { label: 'e^(-a·x²)', desc: 'Gaussian bell curve', latex: 'e^{-a \\cdot x^2}' },
      { label: '1 / (1 + a·x²)', desc: 'Witch of Agnesi / Cauchy', latex: '\\frac{1}{1 + a \\cdot x^2}' },
      { label: 'floor(x) & sign(x)', desc: 'Step discontinuity', latex: '\\operatorname{floor}(x)' },
    ],
  },
  {
    groupKey: 'qf_group_ml_act',
    items: [
      { label: 'σ(wx + b)', desc: 'Logistic Sigmoid activation', latex: '\\sigma(w \\cdot x + b)' },
      { label: 'tanh(wx + b)', desc: 'Hyperbolic Tangent activation', latex: '\\tanh(w \\cdot x + b)' },
      { label: 'ReLU(wx + b)', desc: 'Rectified Linear Unit', latex: '\\operatorname{relu}(w \\cdot x + b)' },
      { label: 'LeakyReLU(x, α)', desc: 'Leaky ReLU with slope α', latex: '\\max(\\alpha \\cdot x, x)' },
      { label: 'GELU(x)', desc: 'Gaussian Error Linear Unit', latex: '\\operatorname{gelu}(x)' },
      { label: 'Swish(x, β)', desc: 'SiLU / Swish x·σ(βx)', latex: '\\operatorname{swish}(x, \\beta)' },
      { label: 'Mish(x)', desc: 'x·tanh(softplus(x))', latex: '\\operatorname{mish}(x)' },
      { label: 'Softplus(x)', desc: 'Smooth ReLU ln(1 + e^x)', latex: '\\operatorname{softplus}(x)' },
    ],
  },
  {
    groupKey: 'qf_group_ml_loss',
    items: [
      { label: 'Huber(x, δ)', desc: 'Outlier-robust Huber loss', latex: '\\operatorname{huber}(x, \\delta)' },
      { label: 'BCEWithLogits(1, wx+b)', desc: 'Numerically stable Binary Cross-Entropy', latex: '\\operatorname{bce\\_logits}(1, w \\cdot x + b)' },
      { label: 'Hinge max(0, 1 - wx)', desc: 'SVM max-margin Hinge loss', latex: '\\max(0, 1 - (w \\cdot x + b))' },
      { label: 'Gaussian PDF N(x; μ, σ²)', desc: 'Normal density distribution', latex: '\\frac{1}{\\sigma \\cdot \\sqrt{2 \\cdot \\pi}} \\cdot \\exp\\left(-\\frac{(x - \\mu)^2}{2 \\cdot \\sigma^2}\\right)' },
      { label: 'Beta PDF(x, α, β)', desc: 'Bayesian conjugate Beta density', latex: 'betaPdf(x, alpha, beta)' },
      { label: 'Rastrigin 0.15x² - 1.2cos(2.5x)', desc: 'Non-convex multi-basin objective', latex: '0.15 \\cdot x^2 - 1.2 \\cdot \\cos(2.5 \\cdot x) + 1.2' },
    ],
  },
];

export const ALL_ML_TEMPLATES: LessonTemplate[] = [
  ...TEMPLATES_T01_T03,
  ...TEMPLATES_T04_T06,
  ...TEMPLATES_T07_T11,
  ...TEMPLATES_T12_T15,
  ...getRegisteredLessons(),
];

export const ALL_EXPLORE_TEMPLATES: LessonTemplate[] = [
  ...MATH_TEMPLATES,
  ...ALL_ML_TEMPLATES,
];

export function isMathTemplateId(id: string): boolean {
  return id === 'T-00' || id.startsWith('M-');
}

export function getTemplateById(id: string): LessonTemplate {
  if (id === 'T-00') return BLANK_CANVAS_TEMPLATE;
  const mathTpl = MATH_TEMPLATES.find((t) => t.id === id);
  if (mathTpl) return mathTpl;
  const dynamicLessons = getRegisteredLessons();
  return (
    ALL_ML_TEMPLATES.find((t) => t.id === id) ??
    dynamicLessons.find((t) => t.id === id) ??
    ALL_ML_TEMPLATES[0]
  );
}
