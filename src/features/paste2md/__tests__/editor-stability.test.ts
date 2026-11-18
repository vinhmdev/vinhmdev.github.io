/**
 * Paste2MD Editor UI & Scroll Stability Test Suite:
 * - Deterministic bidirectional scroll sync with driver isolation, cross-frame
 *   echo suppression, preview-mutation locking, and user-editing protection
 * - Cursor `(line, col)` preservation across Pretty / Compact full-text transforms
 * - Regression guards against variable heading font-size reflows, off-screen
 *   paste carets, outer double-scroll containers, and Mermaid scroll-anchoring jumps
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChangeSet, Text, type ChangeSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { computeMinimalLineChanges, computePreservedCursor } from '../scripts/codemirror-editor';
import { createScrollSyncController, type ScrollMetrics } from '../scripts/scroll-sync';

const PASTE2MD_DIR = resolve(process.cwd(), 'src/features/paste2md');

describe('createScrollSyncController', () => {
  function setupHarness(opts?: { enabled?: boolean }) {
    let clock = 1000;
    let enabled = opts?.enabled ?? true;
    const editor: ScrollMetrics = { scrollTop: 0, scrollHeight: 8000, clientHeight: 600 };
    const preview: ScrollMetrics = { scrollTop: 0, scrollHeight: 14000, clientHeight: 600 };
    const editorWrites: number[] = [];
    const previewWrites: number[] = [];

    const controller = createScrollSyncController({
      isEnabled: () => enabled,
      getEditorMetrics: () => ({ ...editor }),
      getPreviewMetrics: () => ({ ...preview }),
      scrollEditorTo: (top) => {
        editor.scrollTop = top;
        editorWrites.push(top);
      },
      scrollPreviewTo: (top) => {
        preview.scrollTop = top;
        previewWrites.push(top);
      },
      now: () => clock,
    });

    return {
      controller,
      editor,
      preview,
      editorWrites,
      previewWrites,
      advance: (ms: number) => {
        clock += ms;
      },
      setEnabled: (v: boolean) => {
        enabled = v;
      },
    };
  }

  it('syncs Editor -> Preview proportionally and blocks cross-frame Preview echo bounce-back', () => {
    const h = setupHarness();
    h.controller.setActiveDriver('editor');

    // User scrolls editor to 50% (3700 / 7400)
    h.editor.scrollTop = 3700;
    h.controller.handleEditorScroll(h.editor);

    expect(h.previewWrites).toEqual([6700]); // 0.5 * (14000 - 600)

    // 16ms later (next animation frame!), browser dispatches Preview's queued scroll event
    // AND Preview's height also changed slightly: must NOT bounce back into Editor!
    h.advance(16);
    h.preview.scrollHeight = 14500;
    h.controller.handlePreviewScroll(h.preview);

    expect(h.editorWrites).toEqual([]);
    expect(h.editor.scrollTop).toBe(3700);
  });

  it('syncs Preview -> Editor only when Preview is the active driver and blocks Editor echo', () => {
    const h = setupHarness();
    h.controller.setActiveDriver('preview');

    h.preview.scrollTop = 3350; // 25% of 13400
    h.controller.handlePreviewScroll(h.preview);

    expect(h.editorWrites).toEqual([1850]); // 0.25 * 7400

    // CodeMirror virtualized height updates as new lines enter viewport on next frame
    h.advance(20);
    h.editor.scrollHeight = 8200;
    h.controller.handleEditorScroll(h.editor);

    expect(h.previewWrites).toEqual([]);
    expect(h.preview.scrollTop).toBe(3350);
  });

  it('prevents Mermaid / innerHTML scroll spikes in Preview from yanking Editor while typing', () => {
    const h = setupHarness();
    // Suppose user previously scrolled Preview, then started typing in Editor without clicking
    h.controller.setActiveDriver('preview');
    h.editor.scrollTop = 1844;
    h.preview.scrollTop = 3215;

    // User types a character -> markUserEditing switches ownership to editor
    h.controller.markUserEditing();
    expect(h.controller.getActiveDriver()).toBe('editor');

    // Preview re-renders and browser scroll anchoring spikes preview.scrollTop to 9354
    h.controller.beginPreviewMutation();
    h.preview.scrollTop = 9354;
    h.controller.handlePreviewScroll(h.preview);
    h.advance(45);
    h.controller.endPreviewMutation();

    // Delayed async scroll event after Mermaid SVG replacement
    h.advance(50);
    h.controller.handlePreviewScroll(h.preview);

    expect(h.editorWrites).toEqual([]);
    expect(h.editor.scrollTop).toBe(1844);
  });

  it('blocks Preview mutation scroll clamping even when Preview remained the active driver', () => {
    const h = setupHarness();
    h.controller.setActiveDriver('preview');
    h.editor.scrollTop = 5000;
    h.preview.scrollTop = 10000;

    // User toggles Mermaid / LaTeX setting while Preview was last hovered
    h.controller.beginPreviewMutation();
    h.preview.scrollHeight = 7000;
    h.preview.scrollTop = 6400; // clamped by browser
    h.controller.handlePreviewScroll(h.preview);
    h.controller.endPreviewMutation();

    // Queued scroll event firing 30ms after mutation completes
    h.advance(30);
    h.controller.handlePreviewScroll(h.preview);

    expect(h.editorWrites).toEqual([]);
    expect(h.editor.scrollTop).toBe(5000);

    // Once suppression window elapses, genuine user wheel in Preview works normally
    h.advance(300);
    h.preview.scrollTop = 3200;
    h.controller.handlePreviewScroll(h.preview);
    expect(h.editorWrites.length).toBe(1);
  });

  it('handles degenerate, empty, overscrolled, and sub-pixel metrics safely', () => {
    const h = setupHarness();

    // Empty / non-scrollable panes (scrollHeight <= clientHeight)
    h.editor.scrollHeight = 600;
    h.editor.clientHeight = 600;
    h.editor.scrollTop = 0;
    h.preview.scrollTop = 0;
    h.controller.handleEditorScroll(h.editor);
    expect(h.previewWrites).toEqual([]);

    // Sub-pixel (< 1px) difference is ignored to avoid oscillation
    h.editor.scrollHeight = 2600;
    h.preview.scrollHeight = 2600;
    h.editor.scrollTop = 1000;
    h.preview.scrollTop = 999.4;
    h.controller.handleEditorScroll(h.editor);
    expect(h.previewWrites).toEqual([]);

    // Overscroll bounce (< 0 and > maxScroll) clamps cleanly to [0, maxPreview]
    h.editor.scrollTop = -40;
    h.preview.scrollTop = 200;
    h.controller.handleEditorScroll(h.editor);
    expect(h.preview.scrollTop).toBe(0);

    h.advance(200);
    h.editor.scrollTop = 99999;
    h.controller.handleEditorScroll(h.editor);
    expect(h.preview.scrollTop).toBe(2000);

    // Disabled syncScroll setting suppresses all sync
    h.advance(200);
    h.setEnabled(false);
    h.editor.scrollTop = 500;
    h.controller.handleEditorScroll(h.editor);
    expect(h.preview.scrollTop).toBe(2000);
  });

  it('allows immediate Preview -> Editor wheel sync right after typing when user wheels Preview', () => {
    const h = setupHarness();
    h.editor.scrollTop = 1800;
    h.preview.scrollTop = 3200;

    // User types in editor (sets 220ms edit lock against spurious preview scroll events)
    h.controller.markUserEditing();

    // Only 30ms later, user explicitly wheels inside Preview pane
    h.advance(30);
    h.controller.setActiveDriver('preview');
    h.preview.scrollTop = 6700; // 50% of 13400
    h.controller.handlePreviewScroll(h.preview);

    expect(h.editorWrites).toEqual([3700]);
  });

  it('keeps Preview DOM-mutation suppression intact even if user switches driver to Preview right after render', () => {
    const h = setupHarness();
    h.editor.scrollTop = 2400;
    h.preview.scrollTop = 4500;

    // Preview render finishes (e.g. debounced live update at 80ms)
    h.controller.beginPreviewMutation();
    h.controller.endPreviewMutation();

    // 10ms later, user clicks inside Preview while a queued mutation-clamped scroll fires
    h.advance(10);
    h.controller.setActiveDriver('preview');
    h.preview.scrollHeight = 9000;
    h.preview.scrollTop = 8400;
    h.controller.handlePreviewScroll(h.preview);

    expect(h.editorWrites).toEqual([]);
    expect(h.editor.scrollTop).toBe(2400);
  });
});

describe('computeMinimalLineChanges & computePreservedCursor', () => {
  const toText = (s: string) => Text.of(s.split(/\r\n|\r|\n/));

  function assertMinimalDiffAppliesCleanly(beforeStr: string, afterStr: string): void {
    const beforeDoc = toText(beforeStr);
    const changes = computeMinimalLineChanges(beforeStr, afterStr);
    const cs = ChangeSet.of(changes as ChangeSpec[], beforeDoc.length);
    const result = cs.apply(beforeDoc).toString();
    expect(result).toBe(afterStr);
  }

  it('produces minimal ordered hunks that reconstruct Compact and Pretty transforms byte-for-byte', () => {
    assertMinimalDiffAppliesCleanly('', '');
    assertMinimalDiffAppliesCleanly('', '# First heading\n\nBody');
    assertMinimalDiffAppliesCleanly('# Old\n\nBody', '');
    assertMinimalDiffAppliesCleanly('a\n\n\nb\n', 'a\nb');
    assertMinimalDiffAppliesCleanly(
      '## H1\nPara 1\n## H2\nPara 2',
      '## H1\n\nPara 1\n\n## H2\n\nPara 2\n'
    );
    assertMinimalDiffAppliesCleanly(
      '# Title\n\n\n\nParagraph with trailing spaces   \n| a   | b   |\n| --- | --- |',
      '# Title\n\nParagraph with trailing spaces\n| a | b |\n| --- | --- |'
    );
  });

  it('preserves semantic target line and column across Compact (blank-line deletion) and Pretty (blank-line insertion)', () => {
    // Compact: 2 blank lines deleted ABOVE "Paragraph on target line"
    const beforeCompact = toText(
      '# Title\n\n\n\nParagraph on target line   \n| a   | b   |\n| --- | --- |'
    );
    const afterCompact = toText('# Title\n\nParagraph on target line\n| a | b |\n| --- | --- |');

    const oldTargetLine = beforeCompact.line(5);
    expect(oldTargetLine.text).toBe('Paragraph on target line   ');
    const mappedAfterCompact = computePreservedCursor(
      beforeCompact,
      oldTargetLine.from + 10,
      afterCompact
    );
    const newCompactLine = afterCompact.lineAt(mappedAfterCompact);
    expect(newCompactLine.text).toBe('Paragraph on target line');
    expect(mappedAfterCompact - newCompactLine.from).toBe(10);

    // Pretty: Prettier inserts blank lines ABOVE "## Target Heading" and its paragraph
    const beforePretty = toText('## Intro\nIntro text\n## Target Heading\nEditing right here.');
    const afterPretty = toText(
      '## Intro\n\nIntro text\n\n## Target Heading\n\nEditing right here.\n'
    );

    const oldEditLine = beforePretty.line(4);
    expect(oldEditLine.text).toBe('Editing right here.');
    // Column 0 as well as mid-line column 8 stay on "Editing right here."
    const mappedCol0 = computePreservedCursor(beforePretty, oldEditLine.from, afterPretty);
    expect(afterPretty.lineAt(mappedCol0).text).toBe('Editing right here.');
    expect(mappedCol0 - afterPretty.lineAt(mappedCol0).from).toBe(0);

    const mappedCol8 = computePreservedCursor(beforePretty, oldEditLine.from + 8, afterPretty);
    expect(afterPretty.lineAt(mappedCol8).text).toBe('Editing right here.');
    expect(mappedCol8 - afterPretty.lineAt(mappedCol8).from).toBe(8);
  });

  it('clamps safely when line count or line length shrinks or becomes empty', () => {
    const before = toText('Line 1\nLine 2\nLine 3 with very long trailing content\n\n\n');
    const shorter = toText('Line 1\nLine 2\nShort');

    // Cursor was on line 6 (removed trailing blank lines) -> clamps to end of last remaining line
    expect(computePreservedCursor(before, before.length, shorter)).toBe(shorter.line(3).to);

    // Cursor was at end of long line 3 -> clamps to end of "Short"
    const oldLine3End = before.line(3).to;
    expect(computePreservedCursor(before, oldLine3End, shorter)).toBe(shorter.line(3).to);

    // Empty replacement returns 0
    expect(computePreservedCursor(before, oldLine3End, toText(''))).toBe(0);

    // Out-of-bounds negative / huge offsets clamp safely
    expect(computePreservedCursor(before, -50, shorter)).toBe(0);
    expect(computePreservedCursor(before, 999999, shorter)).toBe(shorter.line(3).to);
  });
});

describe('Paste2MD layout & CSS stability contracts', () => {
  it('keeps CodeMirror heading syntax tokens at uniform 1em font-size and aligns documentPadding on .cm-content', () => {
    const editorTs = readFileSync(resolve(PASTE2MD_DIR, 'scripts/codemirror-editor.ts'), 'utf8');
    const highlightBlock = editorTs.slice(
      editorTs.indexOf('function buildHighlightStyle'),
      editorTs.indexOf('const baseTheme')
    );
    expect(highlightBlock).not.toMatch(/fontSize\s*:/);
    expect(editorTs).toContain("padding: '1.25rem 1.25rem 1.25rem 0.5rem'");
    expect(editorTs).toContain("minWidth: '3.75rem'");
    expect(editorTs).toContain('Transaction.addToHistory.of(false)');
    expect(editorTs).toContain('scrollIntoView: true');
    expect(editorTs).toContain("userEvent: 'input.paste'");
  });

  it('prevents outer double-scroll containers, scroll-anchoring spikes, and concurrent Mermaid singleton races', () => {
    const editorCss = readFileSync(resolve(PASTE2MD_DIR, 'styles/editor.css'), 'utf8');
    const previewCss = readFileSync(resolve(PASTE2MD_DIR, 'styles/preview-overrides.css'), 'utf8');
    const previewRendererTs = readFileSync(
      resolve(PASTE2MD_DIR, 'scripts/preview-renderer.ts'),
      'utf8'
    );
    const pageAstro = readFileSync(resolve(PASTE2MD_DIR, 'page.astro'), 'utf8');

    expect(editorCss).toMatch(/\.pane-body\s*\{[^}]*overflow:\s*hidden/);
    expect(editorCss).toMatch(/\.empty-state\.is-hidden\s*\{[^}]*visibility:\s*hidden/);
    expect(previewCss).toMatch(/\.markdown-body\s*\{[^}]*overflow-anchor:\s*none/);
    expect(previewCss).toMatch(/pre\.mermaid-rendered-hide\s*\{[^}]*visibility:\s*hidden/);
    expect(previewCss).not.toMatch(/pre\.mermaid-rendered-hide\s*\{[^}]*display:\s*none/);
    expect(previewRendererTs).toContain('this.mermaidQueue');
    expect(pageAstro).toContain('h-[var(--c2md-vvh,100dvh)]');
  });
});
