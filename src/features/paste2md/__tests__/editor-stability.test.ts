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
import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { computePreservedCursor } from '../scripts/codemirror-editor';
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
});

describe('computePreservedCursor', () => {
  const toText = (s: string) => Text.of(s.split(/\r\n|\r|\n/));

  it('preserves exact line and column when compacting or formatting multi-line documents', () => {
    const before = toText('# Title\n\n\n\nParagraph on line 5\n| a   | b   |\n| --- | --- |');
    const after = toText('# Title\n\nParagraph on line 5\n| a | b |\n| --- | --- |');

    // Cursor at line 5 ("Paragraph on line 5"), col 10 -> in `after`, line 5 exists ("| --- | --- |")
    const line5 = before.line(5);
    const oldHead = line5.from + 10;
    const mapped = computePreservedCursor(before, oldHead, after);
    const mappedLine = after.lineAt(mapped);

    expect(mappedLine.number).toBe(5);
    expect(mapped - mappedLine.from).toBe(10);
  });

  it('clamps safely when line count or line length shrinks or becomes empty', () => {
    const before = toText('Line 1\nLine 2\nLine 3 with very long trailing content\n\n\n');
    const shorter = toText('Line 1\nLine 2\nShort');

    // Cursor was on line 6 (removed trailing blank lines) -> clamps to last line (line 3)
    expect(computePreservedCursor(before, before.length, shorter)).toBe(shorter.line(3).from);

    // Cursor was at end of long line 3 -> clamps to end of "Short"
    const oldLine3End = before.line(3).to;
    expect(computePreservedCursor(before, oldLine3End, shorter)).toBe(shorter.line(3).to);

    // Empty replacement returns 0
    expect(computePreservedCursor(before, oldLine3End, toText(''))).toBe(0);

    // Out-of-bounds negative / huge offsets clamp safely
    expect(computePreservedCursor(before, -50, shorter)).toBe(0);
    expect(computePreservedCursor(before, 999999, shorter)).toBe(shorter.line(3).from);
  });
});

describe('Paste2MD layout & CSS stability contracts', () => {
  it('keeps CodeMirror heading syntax tokens at uniform 1em font-size to prevent Setext/ATX jumps', () => {
    const editorTs = readFileSync(resolve(PASTE2MD_DIR, 'scripts/codemirror-editor.ts'), 'utf8');
    const highlightBlock = editorTs.slice(
      editorTs.indexOf('function buildHighlightStyle'),
      editorTs.indexOf('const baseTheme')
    );
    expect(highlightBlock).not.toMatch(/fontSize\s*:/);
    expect(editorTs).toContain('scrollIntoView: true');
    expect(editorTs).toContain("userEvent: 'input.paste'");
  });

  it('prevents outer double-scroll containers and scroll-anchoring spikes in CSS', () => {
    const editorCss = readFileSync(resolve(PASTE2MD_DIR, 'styles/editor.css'), 'utf8');
    const previewCss = readFileSync(resolve(PASTE2MD_DIR, 'styles/preview-overrides.css'), 'utf8');
    const pageAstro = readFileSync(resolve(PASTE2MD_DIR, 'page.astro'), 'utf8');

    expect(editorCss).toMatch(/\.pane-body\s*\{[^}]*overflow:\s*hidden/);
    expect(editorCss).toMatch(/\.empty-state\.is-hidden\s*\{[^}]*visibility:\s*hidden/);
    expect(previewCss).toMatch(/\.markdown-body\s*\{[^}]*overflow-anchor:\s*none/);
    expect(previewCss).toMatch(/pre\.mermaid-rendered-hide\s*\{[^}]*visibility:\s*hidden/);
    expect(previewCss).not.toMatch(/pre\.mermaid-rendered-hide\s*\{[^}]*display:\s*none/);
    expect(pageAstro).toContain('h-[var(--c2md-vvh,100dvh)]');
  });
});
