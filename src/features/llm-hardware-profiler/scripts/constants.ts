/**
 * constants.ts — Empirical constants for the LLM Hardware Profiler math engine.
 *
 * Source: Appendix A of "LLM Hardware Estimator & Matchmaking Tool" spec.
 * Do NOT use theoretical or marketing numbers — these are empirical "safe ceiling" values.
 */

import type { QuantizationType, KvQuantType } from './types';

// ─── A. Bytes-per-Parameter (Model Weights) ──────────────────────────────────
//
// Used as the "safe ceiling" multiplier for V_weights calculation.
// Accounts for quantization metadata overhead and mixed-precision lm_head.

export const BYTES_PER_PARAM: Record<QuantizationType, number> = {
  FP16: 2.0,
  BF16: 2.0,
  FP32: 4.0,
  INT8: 1.05, // Accounts for scaling metadata
  FP8: 1.05,
  AWQ: 0.6, // Absorbs group size overhead & FP16 lm_head
  GPTQ: 0.6,
  EXL2: 0.6,
  GGUF_Q4_K_M: 0.62,
  GGUF_Q5_K_M: 0.72,
  GGUF_Q8_0: 1.1,
};

// ─── B. Bytes-per-KV-Parameter (KV Cache) ────────────────────────────────────
//
// Default FP16 (2.00). Switch to FP8 (1.00) only when user explicitly enables
// KV cache quantization toggle.

export const BYTES_PER_KV: Record<KvQuantType, number> = {
  FP16: 2.0,
  FP8: 1.0,
};

// ─── C. VRAM Overhead Constants ───────────────────────────────────────────────
//
// Static per-GPU allocation for PyTorch/CUDA context, driver, and activations.
// Mid-point of the spec range [1.2, 1.5] GB per GPU.

export const OVERHEAD_GB_PER_GPU = 1.35;

// ─── D. Memory Fragmentation Buffers ─────────────────────────────────────────
//
// Standard HF pipelines waste ~20-30% VRAM to fragmentation.
// vLLM with PagedAttention reduces this to ~4%.
// Applied as a multiplier on top of (V_weights + V_kv + overhead).

export const FRAG_BUFFER_STANDARD = 0.2; // Standard HuggingFace engine
export const FRAG_BUFFER_PAGED = 0.04; // vLLM / TGI with PagedAttention

// ─── E. Empirical Efficiency Multipliers (by arch_class) ─────────────────────
//
// Mid-points of the ranges from Appendix A §4.
// These are baked into HardwareDB entries; exposed here for reference and
// for the Model Discovery mode which may need to estimate without a DB entry.

export const DEFAULT_BW_UTILIZATION: Record<string, number> = {
  datacenter: 0.82,
  consumer: 0.73,
  apple_silicon: 0.63,
};

export const DEFAULT_MFU_FACTOR: Record<string, number> = {
  datacenter: 0.47,
  consumer: 0.38,
  apple_silicon: 0.3,
};

// ─── F. Model Discovery: Scaling Law Heuristics ──────────────────────────────
//
// Used in Mode 3 to back-calculate plausible architecture from total_params.
// These are rough heuristics based on standard transformer scaling relationships.
// params ≈ (12/128) × hidden³  ⇒  hidden ≈ cbrt(params × 10.667)  (CUBIC law)
// num_layers ≈ hidden_size / 128  (see paramsToArchitecture in math-engine.ts)

export const DISCOVERY_VOCAB_DEFAULT = 128000;
export const DISCOVERY_KV_HEADS_RATIO = 0.25; // n_kv ≈ n_q × 0.25 (GQA assumption)
export const DISCOVERY_CONTEXT_DEFAULT = 8192;
