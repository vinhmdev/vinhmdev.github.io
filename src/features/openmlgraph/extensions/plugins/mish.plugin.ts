/**
 * Built-in Declarative Math Function Plugin: Mish Activation [FR-5.3].
 *
 * Demonstrates single-file plugin extensibility via `defineMathFunction`:
 *   mish(x) = x * tanh(softplus(x)) = x * tanh(ln(1 + exp(x)))
 */
import { defineMathFunction } from '../contracts';

function safeSoftplus(x: number): number {
  if (x > 20) return x;
  if (x < -20) return Math.exp(x);
  return Math.log1p(Math.exp(x));
}

export const mishPlugin = defineMathFunction({
  name: 'mish',
  latexAliases: ['\\operatorname{mish}'],
  arity: 1,
  evaluateScalar: (x = 0): number => {
    const sp = safeSoftplus(x);
    return x * Math.tanh(sp);
  },
  firstDerivative: ([arg], diffVar) => [
    'Multiply',
    [
      'Add',
      ['Tanh', ['Softplus', arg ?? 'x']],
      [
        'Divide',
        ['Multiply', arg ?? 'x', ['Sigmoid', arg ?? 'x']],
        ['Power', ['Cosh', ['Softplus', arg ?? 'x']], 2],
      ],
    ],
    diffVar === arg ? 1 : 1,
  ],
});
