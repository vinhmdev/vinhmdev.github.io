/**
 * Paper LaTeX Importer: corpus of formulas as they appear in ML papers. Invariants:
 *  - nothing throws; every segment is ok | fixed | note;
 *  - every ok / fixed segment parses (`classifyLatexExpression(latex).valid`);
 *  - every note carries a reason; every rewrite is reported.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildUserFunctionRegistry,
  classifyLatexExpression,
} from '../core/parser/ast-classifier';
import {
  analyzePastedLatex,
  isTrivialPaste,
  preCleanLatex,
  shouldInterceptPaste,
  splitLatexSegments,
  type ImportSegment,
} from '../core/parser/latex-importer';
import en from '../i18n/en.json';
import vi from '../i18n/vi.json';

const ATTENTION_PAPER = String.raw`$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V, \quad \text{với } \sum_{j=1}^{L} A^{(l,h)}_{i,j} = 1$$`;

const CORPUS: Record<string, string> = {
  attention: ATTENTION_PAPER,
  layerNorm: String.raw`\mathrm{LayerNorm}(x) = \gamma \frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}} + \beta`,
  rmsNorm: String.raw`\mathrm{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{n}\sum_{i=1}^{n} x_i^2 + \epsilon}} \cdot g`,
  crossEntropy: String.raw`\mathcal{L} = -\sum_{i=1}^{C} y_i \log(\hat{y}_i)`,
  adam: String.raw`\begin{align*}
m_t &= \beta_1 m_{t-1} + (1 - \beta_1) g_t \\
\theta_{t+1} &= \theta_t - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}
\end{align*}`,
  gelu: String.raw`\mathrm{GELU}(x) = x \Phi(x) \label{eq:gelu}`,
  softmax: String.raw`\sigma(z)_i = \frac{e^{z_i}}{\sum_{j=1}^{K} e^{z_j}}`,
  l2: String.raw`J(w) = (w x - 2)^2 + \lambda \|w\|^2 \tag{3}`,
  expectation: String.raw`\mathcal{L}_{\text{ELBO}} = \mathbb{E}_{q(z|x)}[\log p(x|z)] - \mathrm{KL}(q(z|x) \| p(z))`,
  argmax: String.raw`\hat{y} = \arg\max_{c} p(c \mid x)`,
  multiline: String.raw`f(x) = x^2 \\ g(x) = \sin(x); h(x) = f(x) + g(x)`,
  chainAlign: String.raw`\begin{align*}
f(x) &= \mathrm{GELU}(x) = x \Phi(x) \\
g(x) &= \lambda \|x\|^2 \\
\theta_{t+1} &= \theta_t - \eta \nabla_\theta \mathcal{L}
\end{align*}`,
  wrapped: 'f(x) = x^2 +\n  3x - 1',
};

function analyze(raw: string): ImportSegment[] {
  return analyzePastedLatex(raw);
}

describe('preCleanLatex / splitLatexSegments', () => {
  it('strips delimiters, labels, tags, font macros and alignment ampersands', () => {
    const clean = preCleanLatex(
      String.raw`\begin{equation} \mathbf{y} &= \boldsymbol{W} x \label{eq:1} \tag{2} \nonumber \end{equation}`
    );
    expect(clean).not.toMatch(/\\(?:begin|end|label|tag|nonumber|mathbf|boldsymbol)|&/);
    expect(splitLatexSegments(clean)).toEqual(['y = W x']);
  });

  it('keeps & and \\\\ inside cases environments', () => {
    const segs = splitLatexSegments(
      preCleanLatex(String.raw`f(x) = \begin{cases} -x & x < 0 \\ x^2 & x \geq 0 \end{cases}`)
    );
    expect(segs.length).toBe(1);
    expect(segs[0]).toContain('&');
  });

  it('splits on \\\\, ;, \\quad and prose connectors, but joins source line-wraps', () => {
    expect(splitLatexSegments(preCleanLatex(CORPUS.multiline)).length).toBe(3);
    expect(splitLatexSegments(preCleanLatex(CORPUS.wrapped))).toEqual(['f(x) = x^2 + 3x - 1']);
  });

  it('carries the left-hand side through align chains', () => {
    const segs = splitLatexSegments(
      preCleanLatex(String.raw`\begin{align} f(x) &= (x+1)^2 \\ &= x^2 + 2x + 1 \end{align}`)
    );
    expect(segs).toEqual(['f(x) = (x+1)^2', 'f(x) = x^2 + 2x + 1']);
  });
});

describe('analyzePastedLatex — the reported Attention formula', () => {
  const segs = analyze(ATTENTION_PAPER);

  it('splits into the equation and the normalization constraint', () => {
    expect(segs.length).toBe(2);
  });

  it('plots the equation and reports the scalar simplifications', () => {
    expect(['ok', 'fixed']).toContain(segs[0].status);
    const codes = segs[0].warnings.map((w) => w.code);
    expect(codes).toContain('imp_warn_transpose');
    expect(codes).toContain('imp_warn_softmax_scalar');
  });

  it('keeps the constraint as a note with its original LaTeX', () => {
    expect(segs[1].status).toBe('note');
    expect(segs[1].reason?.code).toBe('imp_reason_constraint');
    expect(segs[1].latex).toContain('A^{(l,h)}_{i,j}');
  });
});

describe('analyzePastedLatex — corpus invariants', () => {
  for (const [name, raw] of Object.entries(CORPUS)) {
    it(`${name}: every segment is plottable or a reasoned note`, () => {
      const segs = analyze(raw);
      expect(segs.length).toBeGreaterThan(0);
      const plottable: { id: string; latex: string }[] = [];
      for (const seg of segs) {
        if (seg.status === 'note') {
          expect(seg.reason?.code).toMatch(/^imp_reason_/);
          expect(seg.latex).toBe(seg.original);
        } else {
          const registry = buildUserFunctionRegistry(plottable);
          const cls = classifyLatexExpression(seg.latex, {}, registry);
          expect(cls.errorMessage).toBeUndefined();
          expect(cls.valid).toBe(true);
          // A plotted row must be a function, never a 0/1 comparison like `GELU(x) = …`.
          const top = Array.isArray(cls.expr) ? cls.expr[0] : null;
          expect(['Equal', 'NotEqual', 'Less', 'Greater', 'LessEqual', 'GreaterEqual']).not.toContain(top);
          expect(seg.status === 'fixed').toBe(seg.fixes.length > 0);
          plottable.push({ id: `p-${plottable.length}`, latex: seg.latex });
        }
      }
    });
  }
});

describe('analyzePastedLatex — specific fixes and reasons', () => {
  const codesOf = (seg: ImportSegment): string[] => seg.fixes.map((f) => f.code);

  it('LayerNorm: \\gamma before a fraction becomes a product, not the Gamma function', () => {
    const [seg] = analyze(CORPUS.layerNorm);
    expect(codesOf(seg)).toContain('imp_fix_gamma_product');
    expect(JSON.stringify(classifyLatexExpression(seg.latex).expr)).not.toContain('"Gamma"');
  });

  it('GELU: \\Phi becomes the erf form and the \\label is dropped', () => {
    const [seg] = analyze(CORPUS.gelu);
    expect(seg.status).toBe('fixed');
    expect(codesOf(seg)).toContain('imp_fix_normal_cdf');
    expect(seg.latex).not.toContain('\\label');
  });

  it('equality chains keep the first and last side instead of parsing a comparison', () => {
    const [seg] = analyze(String.raw`f(x) = \mathrm{GELU}(x) = x \Phi(x)`);
    expect(seg.fixes.find((f) => f.code === 'imp_fix_equality_chain')?.detail).toBe('\\mathrm{GELU}(x)');
    const cls = classifyLatexExpression(seg.latex);
    expect(JSON.stringify(cls.expr)).not.toContain('"Equal"');
    expect(JSON.stringify(cls.expr)).toContain('"Erf"');
  });

  it('L2 penalty: \\|w\\| becomes |w|', () => {
    const [seg] = analyze(CORPUS.l2);
    expect(codesOf(seg)).toContain('imp_fix_norm_abs');
  });

  it('Cross-entropy: symbolic bound and accents are substituted and reported', () => {
    const [seg] = analyze(CORPUS.crossEntropy);
    expect(seg.status).toBe('fixed');
    const bound = seg.fixes.find((f) => f.code === 'imp_fix_symbolic_bound');
    expect(bound?.detail).toBe('C → 8');
    expect(codesOf(seg)).toContain('imp_fix_accent');
  });

  it('Adam: both update rules are recurrence notes', () => {
    const segs = analyze(CORPUS.adam);
    expect(segs.length).toBe(2);
    expect(segs.map((s) => s.reason?.code)).toEqual([
      'imp_reason_recurrence',
      'imp_reason_recurrence',
    ]);
  });

  it('Softmax: an unparseable left-hand side is dropped and the right-hand side is plotted', () => {
    const [seg] = analyze(CORPUS.softmax);
    expect(seg.status).toBe('fixed');
    expect(seg.fixes.find((f) => f.code === 'imp_fix_drop_lhs')?.detail).toBe('\\sigma(z)_i');
    expect(seg.latex.startsWith('\\frac')).toBe(true);
  });

  it('RMSNorm: a single-letter symbolic bound is replaced everywhere it appears', () => {
    const [seg] = analyze(CORPUS.rmsNorm);
    const syms = classifyLatexExpression(seg.latex).symbols.map((s) => s.name);
    expect(syms).not.toContain('n');
    expect(seg.latex).toContain('\\frac{1}{8}');
  });

  it('ELBO and argmax are notes with notation-specific reasons', () => {
    expect(analyze(CORPUS.expectation)[0].reason?.code).toBe('imp_reason_probability');
    expect(analyze(CORPUS.argmax)[0].reason?.code).toBe('imp_reason_optimization');
  });

  it('later segments can call functions defined by earlier segments', () => {
    const segs = analyze(CORPUS.multiline);
    expect(segs.map((s) => s.status)).toEqual(['ok', 'ok', 'ok']);
    const registry = buildUserFunctionRegistry(
      segs.slice(0, 2).map((s, i) => ({ id: `s${i}`, latex: s.latex }))
    );
    const composed = classifyLatexExpression(segs[2].latex, {}, registry);
    // f(x) + g(x) must resolve to x^2 + sin(x), not the implicit products f·x + g·x.
    expect(composed.symbols.map((s) => s.name)).toEqual(['x']);
    expect(JSON.stringify(composed.expr)).toContain('"Sin"');
  });

  it('a plain valid formula is a trivial paste (no dialog)', () => {
    expect(isTrivialPaste(analyze('x^2 + 1'))).toBe(true);
    expect(isTrivialPaste(analyze(ATTENTION_PAPER))).toBe(false);
  });
});

describe('shouldInterceptPaste', () => {
  it('lets simple formulas and mid-formula fragments paste natively', () => {
    expect(shouldInterceptPaste('x^2 + 1', true)).toBe(false);
    expect(shouldInterceptPaste('+ \\sigma(', false)).toBe(false);
  });

  it('opens the review for paper blocks, even into a non-empty row', () => {
    expect(shouldInterceptPaste(ATTENTION_PAPER, true)).toBe(true);
    expect(shouldInterceptPaste(ATTENTION_PAPER, false)).toBe(true);
  });
});

describe('i18n coverage for importer notices', () => {
  it('every imp_* code emitted by the importer exists in en.json and vi.json', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../core/parser/latex-importer.ts', import.meta.url)),
      'utf8'
    );
    const codes = new Set(src.match(/imp_(?:fix|warn|reason)_[a-z_]+/g) ?? []);
    expect(codes.size).toBeGreaterThan(10);
    for (const dict of [en, vi] as Record<string, string>[]) {
      for (const code of codes) expect(dict[code], code).toBeTruthy();
      for (const status of ['ok', 'fixed', 'note']) {
        expect(dict[`latex_import_status_${status}`]).toBeTruthy();
      }
    }
  });
});
