/**
 * Templates T-12 to T-15: BatchNorm Conditioning, ROC-AUC, 3D SVM RBF Kernel & 2-Layer MLP Space Folding [FR-4.4].
 */
import type { LessonTemplate } from '../../types/plugin';
import { makeSlider } from './t01-t03-activations';

export const TEMPLATES_T12_T15: LessonTemplate[] = [
  {
    id: 'T-12',
    code: 'T-12',
    category: 'schedule_norm',
    titleKey: 't12_title',
    descKey: 'Toggle BatchNorm ON/OFF to transform an ill-conditioned narrow elliptical canyon into isotropic circular contours.',
    defaultLatex: 'w \\cdot x + b',
    pedagogicalFocusKey: 'Hessian Condition Number Reduction via Batch Normalization',
    buildInitialState: () => ({
      activeTemplateId: 'T-12',
      title: 'T-12: Batch Normalization & Loss Landscape Conditioning',
      viewMode: 'dual',
      rightViewportMode: 'loss_surface',
      lossKind: 'mse',
      batchNormEnabled: true,
      expressions: [
        {
          id: 'expr-1',
          latex: 'w \\cdot x + b',
          color: '#f97316',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'Normalized Predictor',
        },
      ],
      sliders: {
        w: makeSlider('w', 'w', 'param', 1.2, -5, 5, 0.05),
        b: makeSlider('b', 'b', 'param', -0.5, -5, 5, 0.05),
        eta: makeSlider('eta', '\\eta', 'hyperparam', 0.15, 0.005, 1.5, 0.01),
      },
      // High-offset, high-variance x values create a steep narrow valley without BatchNorm
      dataPoints: [
        { id: 'p1', x: 2.2, y: 1.0, split: 'train' },
        { id: 'p2', x: 2.8, y: 1.8, split: 'train' },
        { id: 'p3', x: 3.4, y: 2.5, split: 'train' },
        { id: 'p4', x: 4.1, y: 3.3, split: 'train' },
        { id: 'p5', x: 4.8, y: 4.2, split: 'train' },
      ],
    }),
  },
  {
    id: 'T-13',
    code: 'T-13',
    category: 'boundary_kernel',
    titleKey: 't13_title',
    descKey: 'Drag classification threshold τ in [0, 1] on the left and watch the active operating point glide along the ROC-AUC curve on the right.',
    defaultLatex: '\\sigma(w_1 \\cdot x + b)',
    pedagogicalFocusKey: 'Decision Threshold τ Trade-off (FPR vs TPR) & Area Under ROC Curve',
    buildInitialState: () => ({
      activeTemplateId: 'T-13',
      title: 'T-13: 2D Logistic Regression & ROC-AUC Curve',
      viewMode: 'dual',
      rightViewportMode: 'roc_curve',
      lossKind: 'bce',
      expressions: [
        {
          id: 'expr-1',
          latex: '\\sigma(w_1 \\cdot x + b)',
          color: '#f97316',
          visible: true,
          showFirstDerivative: false,
          showSecondDerivative: false,
          label: 'Logistic Probability P(y=1|x)',
        },
      ],
      sliders: {
        w_1: makeSlider('w_1', 'w_1', 'param', 1.4, -5, 5, 0.05),
        w_2: makeSlider('w_2', 'w_2', 'param', 1.1, -5, 5, 0.05),
        b: makeSlider('b', 'b', 'param', -0.2, -5, 5, 0.05),
        tau: makeSlider('tau', '\\tau', 'hyperparam', 0.5, 0.01, 0.99, 0.01),
      },
      dataPoints: [
        { id: 'c1', x: -2.2, y: -1.5, x2: -1.5, label: 0, split: 'train' },
        { id: 'c2', x: -1.6, y: -0.8, x2: -0.8, label: 0, split: 'train' },
        { id: 'c3', x: -0.9, y: -1.2, x2: -1.2, label: 0, split: 'train' },
        { id: 'c4', x: -0.3, y: 0.4, x2: 0.4, label: 0, split: 'train' },
        { id: 'c5', x: 0.2, y: -0.4, x2: -0.4, label: 1, split: 'train' },
        { id: 'c6', x: 0.9, y: 1.1, x2: 1.1, label: 1, split: 'train' },
        { id: 'c7', x: 1.5, y: 0.8, x2: 0.8, label: 1, split: 'train' },
        { id: 'c8', x: 2.1, y: 1.9, x2: 1.9, label: 1, split: 'train' },
      ],
    }),
  },
  {
    id: 'T-14',
    code: 'T-14',
    category: 'boundary_kernel',
    titleKey: 't14_title',
    descKey: 'Lift concentric 2D rings onto a 3D Radial Basis Function hill φ(x) = exp(-γ||x||²) where a flat hyperplane cleanly separates them.',
    defaultLatex: '\\exp(-\\gamma \\cdot x^2)',
    pedagogicalFocusKey: 'Cover’s Theorem & RBF Kernel Feature Space Lift',
    buildInitialState: () => ({
      activeTemplateId: 'T-14',
      title: 'T-14: SVM Kernel Trick (2D Rings → 3D RBF)',
      viewMode: 'dual',
      rightViewportMode: 'svm_feature_3d',
      expressions: [
        {
          id: 'expr-1',
          latex: '\\exp(-\\gamma \\cdot x^2)',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          label: 'RBF Kernel Profile exp(-γr²)',
        },
      ],
      sliders: {
        gamma: makeSlider('gamma', '\\gamma', 'hyperparam', 0.6, 0.1, 2.5, 0.05),
        tau: makeSlider('tau', '\\tau', 'hyperparam', 0.45, 0.05, 0.95, 0.02),
      },
      dataPoints: [
        { id: 'r1', x: 0.4, y: 0.3, x2: 0.3, label: 1, split: 'train' },
        { id: 'r2', x: -0.5, y: 0.4, x2: 0.4, label: 1, split: 'train' },
        { id: 'r3', x: 0.3, y: -0.5, x2: -0.5, label: 1, split: 'train' },
        { id: 'r4', x: -0.4, y: -0.4, x2: -0.4, label: 1, split: 'train' },
        { id: 'r5', x: 2.1, y: 0.8, x2: 0.8, label: 0, split: 'train' },
        { id: 'r6', x: -2.0, y: 1.1, x2: 1.1, label: 0, split: 'train' },
        { id: 'r7', x: 1.1, y: -2.1, x2: -2.1, label: 0, split: 'train' },
        { id: 'r8', x: -1.5, y: -1.8, x2: -1.8, label: 0, split: 'train' },
      ],
    }),
  },
  {
    id: 'T-15',
    code: 'T-15',
    category: 'boundary_kernel',
    titleKey: 't15_title',
    descKey: 'Scrub homotopy slider t in [0, 1] to continuously fold the 2D coordinate grid via h = tanh(W₁x + b₁) so XOR becomes linearly separable.',
    defaultLatex: '\\tanh(w_1 \\cdot x + b)',
    pedagogicalFocusKey: 'Topological Space Folding by Hidden Layer Representations (XOR)',
    buildInitialState: () => ({
      activeTemplateId: 'T-15',
      title: 'T-15: 2-Layer MLP & Homotopy Space Folding (XOR)',
      viewMode: 'dual',
      rightViewportMode: 'mlp_grid_warp',
      expressions: [
        {
          id: 'expr-1',
          latex: '\\tanh(w_1 \\cdot x + b)',
          color: '#f97316',
          visible: true,
          showFirstDerivative: true,
          showSecondDerivative: false,
          label: 'Hidden Unit Activation tanh(w₁x+b)',
        },
      ],
      sliders: {
        t: makeSlider('t', 't', 'hyperparam', 1.0, 0.0, 1.0, 0.01),
        w_1: makeSlider('w_1', 'w_1', 'param', 2.4, -4, 4, 0.05),
        b: makeSlider('b', 'b', 'param', -1.2, -4, 4, 0.05),
      },
      dataPoints: [
        { id: 'xor1', x: -1.0, y: -1.0, x2: -1.0, label: 0, split: 'train' },
        { id: 'xor2', x: 1.0, y: 1.0, x2: 1.0, label: 0, split: 'train' },
        { id: 'xor3', x: -1.0, y: 1.0, x2: 1.0, label: 1, split: 'train' },
        { id: 'xor4', x: 1.0, y: -1.0, x2: -1.0, label: 1, split: 'train' },
      ],
    }),
  },
];
