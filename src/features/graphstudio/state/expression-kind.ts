/**
 * Single source of truth for distinguishing plottable expressions from display-only note rows.
 * Every consumer that parses, evaluates, or fits expressions must go through these helpers.
 */
import type { ExpressionItem } from '../types/state';

export function isNoteExpression(item: Pick<ExpressionItem, 'kind'>): boolean {
  return item.kind === 'note';
}

export function getPlottableExpressions<T extends Pick<ExpressionItem, 'kind'>>(items: T[]): T[] {
  return items.filter((item) => !isNoteExpression(item));
}

/** Ensures exactly one plottable expression carries `fitLoss`, preferring the current holder. */
export function ensureFitTarget(items: ExpressionItem[]): ExpressionItem[] {
  const current = items.find((e) => e.fitLoss && !isNoteExpression(e));
  const targetId = current?.id ?? items.find((e) => !isNoteExpression(e))?.id;
  return items.map((e) => {
    const shouldFit = e.id === targetId;
    if (Boolean(e.fitLoss) === shouldFit) return e;
    return { ...e, fitLoss: shouldFit };
  });
}
