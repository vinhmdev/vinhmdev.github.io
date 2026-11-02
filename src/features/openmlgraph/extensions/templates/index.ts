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
    title: 'T-00: Blank Graph & Whiteboard',
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
    sliders: {
      a: makeSlider('a', 'a', 'param', 2.0, -5, 5, 0.05),
      b: makeSlider('b', 'b', 'param', 1.0, -5, 5, 0.05),
      c: makeSlider('c', 'c', 'param', 0.0, -5, 5, 0.05),
    },
  }),
};

export const ALL_ML_TEMPLATES: LessonTemplate[] = [
  ...TEMPLATES_T01_T03,
  ...TEMPLATES_T04_T06,
  ...TEMPLATES_T07_T11,
  ...TEMPLATES_T12_T15,
  ...getRegisteredLessons(),
];

export function getTemplateById(id: string): LessonTemplate {
  if (id === 'T-00') return BLANK_CANVAS_TEMPLATE;
  const dynamicLessons = getRegisteredLessons();
  return (
    ALL_ML_TEMPLATES.find((t) => t.id === id) ??
    dynamicLessons.find((t) => t.id === id) ??
    ALL_ML_TEMPLATES[0]
  );
}
