/**
 * Registry of all 15 Canonical ML Math Templates (T-01 through T-15) [FR-4.4].
 */
import type { LessonTemplate } from '../../types/plugin';
import { getRegisteredLessons } from '../contracts';
import { TEMPLATES_T01_T03 } from './t01-t03-activations';
import { TEMPLATES_T04_T06 } from './t04-t06-losses';
import { TEMPLATES_T07_T11 } from './t07-t11-prob-schedules';
import { TEMPLATES_T12_T15 } from './t12-t15-specialized';

export const ALL_ML_TEMPLATES: LessonTemplate[] = [
  ...TEMPLATES_T01_T03,
  ...TEMPLATES_T04_T06,
  ...TEMPLATES_T07_T11,
  ...TEMPLATES_T12_T15,
  ...getRegisteredLessons(),
];

export function getTemplateById(id: string): LessonTemplate {
  const dynamicLessons = getRegisteredLessons();
  return (
    ALL_ML_TEMPLATES.find((t) => t.id === id) ??
    dynamicLessons.find((t) => t.id === id) ??
    ALL_ML_TEMPLATES[0]
  );
}
