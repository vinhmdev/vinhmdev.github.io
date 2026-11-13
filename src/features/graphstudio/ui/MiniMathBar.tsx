/**
 * Zero-dependency (0 KB external chunk) Quick Math Symbol Strip for Formula Input.
 *
 * Replaces the unused 827 KB `mathlive` import while giving touch & mobile users
 * single-tap insertion of common LaTeX tokens (`\sqrt{}`, `\frac{}{}`, `\pi`, `\theta`, etc.)
 * without blurring the active input or dismissing the virtual keyboard.
 */
import type { JSX } from 'preact';

export interface MathSymbolPreset {
  label: string;
  snippet: string;
  /** Number of characters from the end of `snippet` to step the cursor back (e.g. 1 puts caret inside `{}`) */
  cursorStepBack?: number;
  title: string;
}

export const MINI_MATH_SYMBOLS: readonly MathSymbolPreset[] = [
  { label: 'x', snippet: 'x', title: 'Variable x' },
  { label: 'x²', snippet: '^2', title: 'Square (^2)' },
  { label: 'xⁿ', snippet: '^{}', cursorStepBack: 1, title: 'Exponent (^{})' },
  { label: '√', snippet: '\\sqrt{}', cursorStepBack: 1, title: 'Square root (\\sqrt{})' },
  { label: 'a/b', snippet: '\\frac{}{}', cursorStepBack: 3, title: 'Fraction (\\frac{}{})' },
  { label: 'π', snippet: '\\pi', title: 'Pi (\\pi)' },
  { label: 'θ', snippet: '\\theta', title: 'Theta (\\theta)' },
  { label: 'sin', snippet: '\\sin()', cursorStepBack: 1, title: 'Sine (\\sin)' },
  { label: 'cos', snippet: '\\cos()', cursorStepBack: 1, title: 'Cosine (\\cos)' },
  { label: 'eˣ', snippet: 'e^{}', cursorStepBack: 1, title: 'Exponential (e^{})' },
  { label: 'ln', snippet: '\\ln()', cursorStepBack: 1, title: 'Natural log (\\ln)' },
  { label: '|x|', snippet: '||', cursorStepBack: 1, title: 'Absolute value (|x|)' },
  { label: '≤', snippet: ' \\le ', title: 'Less than or equal (\\le)' },
  { label: '≥', snippet: ' \\ge ', title: 'Greater than or equal (\\ge)' },
];

export function insertLatexSnippet(
  currentValue: string,
  selectionStart: number,
  selectionEnd: number,
  snippet: string,
  cursorStepBack = 0
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, currentValue.length));
  const end = Math.max(start, Math.min(selectionEnd, currentValue.length));
  const selected = currentValue.slice(start, end);

  if (selected.length > 0 && cursorStepBack > 0) {
    const insertPos = snippet.length - cursorStepBack;
    const filled = snippet.slice(0, insertPos) + selected + snippet.slice(insertPos);
    const nextVal = currentValue.slice(0, start) + filled + currentValue.slice(end);
    return {
      value: nextVal,
      caret: start + insertPos + selected.length,
    };
  }

  const nextVal = currentValue.slice(0, start) + snippet + currentValue.slice(end);
  const caret = Math.max(0, start + snippet.length - cursorStepBack);
  return { value: nextVal, caret };
}

interface MiniMathBarProps {
  inputEl?: HTMLInputElement | HTMLTextAreaElement | null;
  getInputEl?: () => HTMLInputElement | HTMLTextAreaElement | null;
  currentValue: string;
  onInsert: (nextValue: string) => void;
}

export function MiniMathBar({
  inputEl = null,
  getInputEl,
  currentValue,
  onInsert,
}: MiniMathBarProps): JSX.Element {
  const handlePressSymbol = (sym: MathSymbolPreset, e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    const el = getInputEl ? getInputEl() : inputEl;
    const baseValue = el ? el.value : currentValue;
    const selStart = el?.selectionStart ?? baseValue.length;
    const selEnd = el?.selectionEnd ?? baseValue.length;
    const { value, caret } = insertLatexSnippet(
      baseValue,
      selStart,
      selEnd,
      sym.snippet,
      sym.cursorStepBack ?? 0
    );
    onInsert(value);
    if (el && el.isConnected) {
      el.value = value;
      el.focus({ preventScroll: true });
      el.setSelectionRange(caret, caret);
    }
    requestAnimationFrame(() => {
      const liveEl = getInputEl ? getInputEl() : inputEl;
      if (liveEl && liveEl.isConnected) {
        liveEl.focus({ preventScroll: true });
        liveEl.setSelectionRange(caret, caret);
      }
    });
  };

  return (
    <div
      role="toolbar"
      aria-label="Quick math symbols"
      class="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 select-none"
    >
      {MINI_MATH_SYMBOLS.map((sym) => (
        <button
          key={sym.label}
          type="button"
          tabIndex={-1}
          title={sym.title}
          onPointerDown={(e) => handlePressSymbol(sym, e)}
          onClick={(e) => {
            // Keyboard / assistive click fallback when pointerdown didn't fire
            if ((e as MouseEvent).detail === 0) {
              handlePressSymbol(sym, e);
            }
          }}
          class="shrink-0 h-6 min-w-[26px] px-1.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-100/80 dark:bg-neutral-800/80 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400 active:scale-95 font-mono text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 transition-all"
        >
          {sym.label}
        </button>
      ))}
    </div>
  );
}
