/**
 * constants.ts — Empirical constants for the LLM Hardware Profiler math engine.
 *
 * Source: Appendix A of "LLM Hardware Estimator & Matchmaking Tool" spec.
 * Do NOT use theoretical or marketing numbers — these are empirical "safe ceiling" values.
 */

import type {
  QuantizationType,
  KvQuantType,
  InferenceEngine,
  OSProfile,
  SystemRamTier,
  ArchClass,
} from './types';

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
  GGUF_Q8_0: 1.1,
  GGUF_Q6_K: 0.82,
  GGUF_Q5_K_M: 0.72,
  GGUF_Q4_K_M: 0.62,
  AWQ: 0.6, // Absorbs group size overhead & FP16 lm_head
  GPTQ: 0.6,
  EXL2: 0.6,
  GGUF_IQ3_XXS: 0.43, // 3-bit importance matrix quantization
};

export const QUANT_DISPLAY_LABELS: Record<QuantizationType, string> = {
  FP16: 'FP16 / BF16 (16-bit)',
  BF16: 'BF16 (16-bit)',
  FP32: 'FP32 (32-bit)',
  INT8: 'INT8 / FP8 (8-bit)',
  FP8: 'FP8 (8-bit)',
  GGUF_Q8_0: 'GGUF Q8_0 (8-bit)',
  GGUF_Q6_K: 'GGUF Q6_K (6-bit)',
  GGUF_Q5_K_M: 'GGUF Q5_K_M (5-bit)',
  GGUF_Q4_K_M: 'GGUF Q4_K_M (4-bit)',
  AWQ: 'AWQ / GPTQ / EXL2 (4-bit)',
  GPTQ: 'GPTQ (4-bit)',
  EXL2: 'EXL2 (4-bit)',
  GGUF_IQ3_XXS: 'GGUF IQ3_XXS (3-bit)',
};

export const QUANT_COMPARISON_LIST: QuantizationType[] = [
  'FP16',
  'INT8',
  'GGUF_Q8_0',
  'GGUF_Q6_K',
  'GGUF_Q5_K_M',
  'GGUF_Q4_K_M',
  'AWQ',
  'GGUF_IQ3_XXS',
];

// ─── B. Bytes-per-KV-Parameter (KV Cache) ────────────────────────────────────
//
// Default FP16 (2.00). Switch to FP8 (1.00) or INT4 (0.55) when user enables
// KV cache quantization.

export const BYTES_PER_KV: Record<KvQuantType, number> = {
  FP16: 2.0,
  FP8: 1.0,
  INT4: 0.55,
};

// ─── C. VRAM Overhead Constants ───────────────────────────────────────────────
//
// Static per-GPU allocation for PyTorch/CUDA context, driver, and activations.
// Mid-point of the spec range [1.2, 1.5] GB per GPU.

export const OVERHEAD_GB_PER_GPU = 1.35;

export const ENGINE_OVERHEAD_GB: Record<InferenceEngine, number> = {
  Standard_HF: 1.35,
  vLLM: 1.35,
  TensorRT_LLM: 1.2,
  llama_cpp: 0.65,
  MLX: 0.55,
};

// ─── D. Memory Fragmentation Buffers ─────────────────────────────────────────
//
// Standard HF pipelines waste ~20-30% VRAM to fragmentation.
// vLLM with PagedAttention reduces this to ~4%.
// Applied as a multiplier on top of (V_weights + V_kv).

export const FRAG_BUFFER_STANDARD = 0.2; // Standard HuggingFace engine
export const FRAG_BUFFER_PAGED = 0.04; // vLLM / TGI with PagedAttention

export const ENGINE_FRAG_BUFFER: Record<InferenceEngine, number> = {
  Standard_HF: FRAG_BUFFER_STANDARD,
  vLLM: FRAG_BUFFER_PAGED,
  TensorRT_LLM: 0.03,
  llama_cpp: 0.05,
  MLX: 0.04,
};

export const ENGINE_EFFICIENCY_FACTOR: Record<InferenceEngine, number> = {
  Standard_HF: 0.85,
  vLLM: 1.0,
  TensorRT_LLM: 1.06,
  llama_cpp: 0.96,
  MLX: 1.02,
};

// ─── E. OS / Platform Environment Multipliers ────────────────────────────────
//
// Objective OS constraints based on kernel/driver memory reservation:
// - linux_headless: No Xorg/Wayland; ~95% VRAM allocatable
// - linux_gui: Desktop compositor reserves ~10% VRAM on primary GPU
// - windows_wsl2: WDDM host reserves ~15% VRAM + paravirt overhead
// - windows_native: WDDM starts paging to shared PCIe system RAM above ~82%
// - macos_default: macOS iogpu.wired_limit_mb defaults to ~75% of Unified RAM
// - macos_tuned: Custom sysctl iogpu.wired_limit_mb allows ~88% of Unified RAM

export interface OSConstraint {
  allocatable_factor: number;
  overhead_multiplier: number;
  efficiency_multiplier: number;
}

export const OS_PROFILE_CONSTRAINTS: Record<Exclude<OSProfile, 'auto'>, OSConstraint> = {
  linux_headless: {
    allocatable_factor: 0.95,
    overhead_multiplier: 1.0,
    efficiency_multiplier: 1.0,
  },
  linux_gui: {
    allocatable_factor: 0.9,
    overhead_multiplier: 1.1,
    efficiency_multiplier: 0.98,
  },
  windows_wsl2: {
    allocatable_factor: 0.85,
    overhead_multiplier: 1.15,
    efficiency_multiplier: 0.95,
  },
  windows_native: {
    allocatable_factor: 0.82,
    overhead_multiplier: 1.2,
    efficiency_multiplier: 0.92,
  },
  macos_default: {
    allocatable_factor: 0.75,
    overhead_multiplier: 1.0,
    efficiency_multiplier: 1.0,
  },
  macos_tuned: {
    allocatable_factor: 0.88,
    overhead_multiplier: 1.0,
    efficiency_multiplier: 1.0,
  },
};

// ─── F. Empirical Efficiency Multipliers (by arch_class) ─────────────────────
//
// Mid-points of the ranges from Appendix A §4.

export const DEFAULT_BW_UTILIZATION: Record<string, number> = {
  datacenter: 0.82,
  workstation: 0.76,
  consumer: 0.73,
  apple_silicon: 0.63,
};

export const DEFAULT_MFU_FACTOR: Record<string, number> = {
  datacenter: 0.47,
  workstation: 0.42,
  consumer: 0.38,
  apple_silicon: 0.3,
};

// ─── G. Model Discovery: Scaling Law Heuristics ──────────────────────────────
//
// Used in Mode 3 to back-calculate plausible architecture from total_params.
// params ≈ (12/128) × hidden³  ⇒  hidden ≈ cbrt(params × 10.667)  (CUBIC law)
// num_layers ≈ hidden_size / 128  (see paramsToArchitecture in math-engine.ts)

export const DISCOVERY_VOCAB_DEFAULT = 128000;
export const DISCOVERY_KV_HEADS_RATIO = 0.25; // n_kv ≈ n_q × 0.25 (GQA assumption)
export const DISCOVERY_CONTEXT_DEFAULT = 8192;

// ─── H. Host System RAM Bandwidth (Hybrid CPU/GPU Offloading) ────────────────
//
// Empirical effective memory bandwidth when llama.cpp / Ollama streams offloaded
// layers from host DDR4/DDR5 RAM over CPU cores / PCIe.

export const SYSTEM_RAM_SPECS: Record<
  Exclude<SystemRamTier, 'none'>,
  { raw_bw_gbps: number; util_factor: number }
> = {
  ddr4_dual: { raw_bw_gbps: 51.2, util_factor: 0.72 }, // ~36.8 GB/s effective
  ddr5_dual: { raw_bw_gbps: 89.6, util_factor: 0.75 }, // ~67.2 GB/s effective
  ddr5_server: { raw_bw_gbps: 307.2, util_factor: 0.78 }, // ~239.6 GB/s effective (8-ch EPYC/Xeon)
};

// ─── I. Hardware-Native Quantization Compute Scaling ─────────────────────────
//
// Adjusts effective TFLOPS during prefill & high-batch compute-bound decode:
// - FP32 runs at ~0.5x FP16 Tensor Core rate on most modern GPUs
// - INT8/FP8/AWQ leverage native 8-bit/4-bit Tensor/Matrix cores (~1.25x-1.35x effective speedup)
// - Complex K-quants (GGUF_Q4_K_M, IQ3_XXS) incur slight dequantization ALU overhead (~0.92x-0.96x)

export function getQuantComputeMultiplier(quant: QuantizationType, archClass: ArchClass): number {
  if (quant === 'FP32') return 0.5;
  if (quant === 'FP16' || quant === 'BF16') return 1.0;
  if (quant === 'INT8' || quant === 'FP8') {
    return archClass === 'datacenter' || archClass === 'workstation' ? 1.35 : 1.18;
  }
  if (quant === 'AWQ' || quant === 'GPTQ' || quant === 'EXL2') {
    return archClass === 'apple_silicon' ? 1.0 : 1.15;
  }
  if (quant === 'GGUF_IQ3_XXS') return 0.9;
  return 0.96; // GGUF Q4_K_M / Q5_K_M / Q6_K / Q8_0 dequantization overhead in compute-bound prefill
}
