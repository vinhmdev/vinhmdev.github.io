/**
 * Display-only note rows: persistence round-trip, isolation from slider sync, fit-target rules,
 * and single-undo batch insertion.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getPlottableExpressions } from '../state/expression-kind';
import {
  createInitialGraphState,
  graphStore,
  syncSlidersFromExpressions,
} from '../state/store';
import {
  packStateToCompactV2,
  unpackCompactV2ToState,
} from '../state/url-codec';
import type { ExpressionItem, GraphStateV2 } from '../types/state';

const NOTE_LATEX = String.raw`\sum_{j=1}^{L} A^{(l,h)}_{i,j} = 1`;

function noteRow(id: string): ExpressionItem {
  return {
    id,
    latex: NOTE_LATEX,
    color: '#3b82f6',
    visible: true,
    showFirstDerivative: false,
    showSecondDerivative: false,
    kind: 'note',
  };
}

function stateWithNote(): GraphStateV2 {
  const base = createInitialGraphState('T-00');
  return {
    ...base,
    expressions: [
      { ...base.expressions[0], latex: 'a \\cdot x + c', fitLoss: true },
      noteRow('note-1'),
    ],
  };
}

describe('Note rows — URL codec', () => {
  it('round-trips kind: note through the compact payload', () => {
    const state = stateWithNote();
    const restored = unpackCompactV2ToState(packStateToCompactV2(state), createInitialGraphState());
    expect(restored.expressions.map((e) => e.kind)).toEqual([undefined, 'note']);
    expect(restored.expressions[1].latex).toBe(NOTE_LATEX);
  });

  it('decodes legacy payloads without the note bit as plot rows', () => {
    const legacy = packStateToCompactV2(createInitialGraphState('T-04'));
    for (const tuple of legacy.e) expect(tuple[3] & 32).toBe(0);
    const restored = unpackCompactV2ToState(legacy, createInitialGraphState());
    expect(restored.expressions.every((e) => e.kind === undefined)).toBe(true);
  });
});

describe('Note rows — compute isolation', () => {
  it('does not create sliders from note rows and does not block slider pruning', () => {
    const synced = syncSlidersFromExpressions(stateWithNote());
    expect(Object.keys(synced.sliders).sort()).toEqual(['a', 'c']);
  });

  it('getPlottableExpressions excludes notes', () => {
    expect(getPlottableExpressions(stateWithNote().expressions).map((e) => e.id)).not.toContain(
      'note-1'
    );
  });
});

describe('Note rows — store actions', () => {
  beforeEach(() => {
    graphStore.getState().selectTemplate('T-00');
  });

  it('addExpressionsBatch inserts all rows in one undo step and keeps the fit target plottable', () => {
    const store = graphStore.getState();
    const firstId = store.graph.expressions[0].id;
    store.updateExpressionLatex(firstId, '');
    const before = graphStore.getState().graph.expressions.length;

    graphStore.getState().addExpressionsBatch(
      [
        { latex: NOTE_LATEX, kind: 'note' },
        { latex: '\\sin(x)', kind: 'plot' },
        { latex: '\\cos(x)', kind: 'plot' },
      ],
      firstId
    );
    const after = graphStore.getState().graph.expressions;
    expect(after.length).toBe(before + 2);
    expect(after[0].id).toBe(firstId);
    expect(after[0].kind).toBe('note');
    expect(after.filter((e) => e.fitLoss).map((e) => e.kind)).toEqual([undefined]);

    graphStore.getState().undo();
    expect(graphStore.getState().graph.expressions.length).toBe(before);
    expect(graphStore.getState().graph.expressions[0].kind).toBeUndefined();
  });

  it('refuses to make a note the fit target and moves fit away when a row becomes a note', () => {
    graphStore.getState().addExpressionsBatch([{ latex: NOTE_LATEX, kind: 'note' }]);
    const exprs = graphStore.getState().graph.expressions;
    const noteId = exprs[exprs.length - 1].id;
    graphStore.getState().setExpressionFitLoss(noteId);
    expect(graphStore.getState().graph.expressions.find((e) => e.id === noteId)?.fitLoss).toBeFalsy();

    const plotId = graphStore.getState().graph.expressions[0].id;
    graphStore.getState().setExpressionKind(plotId, 'note');
    graphStore.getState().setExpressionKind(noteId, 'plot');
    const fit = graphStore.getState().graph.expressions.filter((e) => e.fitLoss);
    expect(fit.length).toBe(1);
    expect(fit[0].kind).toBeUndefined();
  });
});
