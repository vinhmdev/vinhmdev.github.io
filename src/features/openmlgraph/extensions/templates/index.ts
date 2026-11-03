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
];

export const ALL_ML_TEMPLATES: LessonTemplate[] = [
  ...TEMPLATES_T01_T03,
  ...TEMPLATES_T04_T06,
  ...TEMPLATES_T07_T11,
  ...TEMPLATES_T12_T15,
  ...getRegisteredLessons(),
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
