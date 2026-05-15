/**
 * math-engine.ts — Core calculation engine for LLM Hardware Profiler.
 *
 * Pure functions — zero DOM dependency, fully testable in isolation.
 * Implements the Roofline Model as specified in "LLM Hardware Estimator" doc.
 *
 * Phase 2: runForward() — Mode 1 (Forward Estimation)
 * Phase 3: runMatchmaking() — Mode 2 (CSP Hardware Matching)
 *          runDiscovery()   — Mode 3 (Max Model Discovery)
 */

import {
  BYTES_PER_PARAM,
  BYTES_PER_KV,
  OVERHEAD_GB_PER_GPU,
  FRAG_BUFFER_STANDARD,
  FRAG_BUFFER_PAGED,
  DISCOVERY_VOCAB_DEFAULT,
  DISCOVERY_KV_HEADS_RATIO,
  DISCOVERY_CONTEXT_DEFAULT,
} from './constants';

import type {
  ModelSpec,
  HardwareSpec,
  RuntimeConfig,
  WorkloadSpec,
  AdvancedOpts,
  VRAMBreakdown,
  SpeedResult,
  ForwardResult,
  SLAConstraints,
  MatchResult,
  ModelConstraints,
  QuantizationType,
} from './types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Compute KV cache bytes per token for a single request.
 * Formula: 2 × L × n_kv × d_head × bytes_per_kv
 * where d_head = hidden_size / num_query_heads
 */
function kvBytesPerToken(model: ModelSpec, rt: RuntimeConfig): number {
  const d_head = model.hidden_size / model.num_query_heads;
  return 2 * model.num_layers * model.num_kv_heads * d_head * BYTES_PER_KV[rt.kv_quantization];
}

/**
 * Effective TFLOPS after MFU factor and interconnect penalty.
 */
function effectiveTFLOPS(hw: HardwareSpec): number {
  return (
    hw.specs.compute_tflops_fp16 *
    hw.empirical_constraints.mfu_factor *
    hw.empirical_constraints.interconnect_penalty
  );
}

/**
 * Effective memory bandwidth after utilization factor and interconnect penalty.
 */
function effectiveBandwidthGBs(hw: HardwareSpec): number {
  return (
    hw.specs.raw_bandwidth_gbps *
    hw.empirical_constraints.bandwidth_utilization *
    hw.empirical_constraints.interconnect_penalty
  );
}

// ─── VRAM Estimation ──────────────────────────────────────────────────────────

/**
 * Compute full VRAM breakdown for a given configuration.
 *
 * V_total = V_weights + V_kv_total + V_overhead
 *
 * Key edge cases handled:
 *  - APC: shared prefix KV allocated once, not per-user
 *  - Speculative Decoding: adds draft model weights
 *  - vLLM: 4% fragmentation buffer; Standard HF: 20%
 */
export function estimateVRAM(
  model: ModelSpec,
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts
): VRAMBreakdown {
  const bytesPerParam = BYTES_PER_PARAM[rt.weight_quantization];

  // ── Model weights ──────────────────────────────────────────────────────────
  // Convert Billions → bytes → GB
  let weights_gb = (model.total_params * 1e9 * bytesPerParam) / 1e9;

  // Speculative Decoding: add draft model weights
  if (opts.spec_decoding_enabled && opts.spec_decoding_draft_params > 0) {
    weights_gb += (opts.spec_decoding_draft_params * 1e9 * bytesPerParam) / 1e9;
  }

  // ── KV Cache ───────────────────────────────────────────────────────────────
  const kv_bytes_per_token = kvBytesPerToken(model, rt);
  const context = Math.min(rt.context_length_limit, model.max_context_window);

  let kv_cache_gb: number;
  if (opts.apc_enabled && wl.shared_prefix_length > 0) {
    // APC: prefix tokens allocated once globally, per-user context is reduced
    const prefix_kv_gb = (kv_bytes_per_token * wl.shared_prefix_length) / 1e9;
    const per_user_context = Math.max(context - wl.shared_prefix_length, 0);
    const per_user_kv_gb = (kv_bytes_per_token * wl.max_concurrent_reqs * per_user_context) / 1e9;
    kv_cache_gb = prefix_kv_gb + per_user_kv_gb;
  } else {
    kv_cache_gb = (kv_bytes_per_token * wl.max_concurrent_reqs * context) / 1e9;
  }

  // ── Overhead + fragmentation ───────────────────────────────────────────────
  const frag = rt.inference_engine === 'vLLM' ? FRAG_BUFFER_PAGED : FRAG_BUFFER_STANDARD;
  const base_overhead_gb = OVERHEAD_GB_PER_GPU * hw.gpu_count;
  // Fragmentation applied as % of (weights + kv)
  const frag_gb = (weights_gb + kv_cache_gb) * frag;
  const overhead_gb = base_overhead_gb + frag_gb;

  // ── Totals ─────────────────────────────────────────────────────────────────
  const total_gb = weights_gb + kv_cache_gb + overhead_gb;
  const allocatable_gb =
    hw.specs.vram_total_gb * hw.empirical_constraints.os_vram_allocatable_factor;
  const is_oom = total_gb > allocatable_gb;
  const utilization_pct = (total_gb / allocatable_gb) * 100;

  return {
    weights_gb,
    kv_cache_gb,
    overhead_gb,
    total_gb,
    allocatable_gb,
    is_oom,
    utilization_pct,
  };
}

// ─── Speed Estimation (Roofline Model) ───────────────────────────────────────

/**
 * Estimate prefill and decode speed using the Roofline Model.
 *
 * Prefill  → Compute-Bound:  TTFT ≈ (2 × P_active × input_tokens × batch) / eff_TFLOPS
 * Decode   → Memory-Bound:   TPS  ≈ eff_bandwidth / bytes_accessed_per_token
 *
 * Key edge cases:
 *  - APC: reduces effective input tokens (prefix already cached)
 *  - Chunked Prefill: caps TTFT at chunk_size / eff_TFLOPS_per_token
 *  - Speculative Decoding: multiplies per-user TPS by acceptance rate
 */
export function estimateSpeed(
  model: ModelSpec,
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts,
  vram: VRAMBreakdown
): SpeedResult {
  const eff_tflops = effectiveTFLOPS(hw); // TFLOPS
  const eff_bw_gbs = effectiveBandwidthGBs(hw); // GB/s
  const bytesPerParam = BYTES_PER_PARAM[rt.weight_quantization];

  // ── Prefill (Compute-Bound) ────────────────────────────────────────────────
  // Effective input = avg_input - shared_prefix if APC is active
  const effective_input =
    opts.apc_enabled && wl.shared_prefix_length > 0
      ? Math.max(wl.avg_input_tokens - wl.shared_prefix_length, 1)
      : wl.avg_input_tokens;

  // FLOPs = 2 × P_active (in params) × tokens × batch
  const prefill_flops = 2 * (model.active_params * 1e9) * effective_input * wl.max_concurrent_reqs;
  let prefill_ttft_ms = (prefill_flops / (eff_tflops * 1e12)) * 1000;

  // Chunked Prefill: cap TTFT at processing one chunk at a time
  if (opts.chunked_prefill_enabled && opts.chunked_prefill_chunk_size > 0) {
    const chunk_flops = 2 * (model.active_params * 1e9) * opts.chunked_prefill_chunk_size;
    const chunk_ttft_ms = (chunk_flops / (eff_tflops * 1e12)) * 1000;
    prefill_ttft_ms = Math.min(prefill_ttft_ms, chunk_ttft_ms);
  }

  // ── Decode (Memory-Bound) ──────────────────────────────────────────────────
  // Bytes accessed per token = active_weights + KV_total
  const active_weights_bytes = model.active_params * 1e9 * bytesPerParam;
  const kv_total_bytes = vram.kv_cache_gb * 1e9;
  const bytes_per_token = active_weights_bytes + kv_total_bytes;

  // System-wide decode speed (all users combined)
  const decode_system_tps = (eff_bw_gbs * 1e9) / bytes_per_token;

  // Per-user speed with continuous batching
  let decode_per_user_tps = decode_system_tps / wl.max_concurrent_reqs;

  // Speculative Decoding: acceptance rate multiplier boosts per-user speed
  if (opts.spec_decoding_enabled && opts.spec_decoding_acceptance_rate > 1) {
    decode_per_user_tps *= opts.spec_decoding_acceptance_rate;
  }

  return {
    prefill_ttft_ms,
    decode_system_tps,
    decode_per_user_tps,
  };
}

// ─── Mode 1: Forward Estimation ──────────────────────────────────────────────

/**
 * Run Mode 1 — Forward Estimation.
 * Given a model + hardware + runtime + workload, compute VRAM and speed.
 */
export function runForward(
  model: ModelSpec,
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts
): ForwardResult {
  const vram = estimateVRAM(model, hw, rt, wl, opts);
  const speed = estimateSpeed(model, hw, rt, wl, opts, vram);
  return { vram, speed };
}

// ─── Mode 2: Hardware Matchmaking (CSP) ──────────────────────────────────────

/**
 * Run Mode 2 — Hardware Matchmaking via Constraint Satisfaction.
 *
 * Algorithm (per spec §4):
 * 1. Simulate Mode 1 for each hardware entry in the DB
 * 2. Discard: OOM, decode < min_tps, TTFT > max_ttft
 * 3. Sort by est_hourly_cost_usd (ascending)
 * 4. Compute ROI score = decode_per_user_tps / est_hourly_cost_usd
 */
export function runMatchmaking(
  model: ModelSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts,
  sla: SLAConstraints,
  db: HardwareSpec[]
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const hw of db) {
    const result = runForward(model, hw, rt, wl, opts);

    // Filter: OOM
    if (result.vram.is_oom) continue;
    // Filter: decode speed SLA
    if (result.speed.decode_per_user_tps < sla.min_decode_tps_per_user) continue;
    // Filter: TTFT SLA
    if (result.speed.prefill_ttft_ms > sla.max_ttft_ms) continue;

    const roi_score = result.speed.decode_per_user_tps / hw.economics.est_hourly_cost_usd;
    results.push({ hardware: hw, result, roi_score });
  }

  // Sort by cost ascending (lowest cost first)
  results.sort(
    (a, b) => a.hardware.economics.est_hourly_cost_usd - b.hardware.economics.est_hourly_cost_usd
  );

  return results;
}

// ─── Mode 3: Model Discovery ──────────────────────────────────────────────────

/**
 * Estimate transformer architecture from total_params using scaling law heuristics.
 * hidden_size ≈ nearest multiple of 128 to sqrt(params_B × 4096)
 * num_layers  ≈ hidden_size / 128 (empirical ratio for dense models)
 */
function paramsToArchitecture(params_b: number): {
  hidden_size: number;
  num_layers: number;
  num_query_heads: number;
  num_kv_heads: number;
} {
  const hidden_size = Math.max(64, Math.round(Math.sqrt(params_b * 4096) / 128) * 128);
  const num_layers = Math.max(4, Math.round(hidden_size / 128));
  const num_query_heads = Math.max(1, Math.round(hidden_size / 128));
  const num_kv_heads = Math.max(1, Math.round(num_query_heads * DISCOVERY_KV_HEADS_RATIO));
  return { hidden_size, num_layers, num_query_heads, num_kv_heads };
}

/**
 * Run Mode 3 — Model Discovery.
 *
 * Binary-searches for the maximum total_params that fits on the given hardware
 * without OOM, then back-calculates an estimated architecture.
 */
export function runDiscovery(
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts
): ModelConstraints {
  // Binary search: find max params_b that fits
  let lo = 0.5; // minimum 500M
  let hi = 1000.0; // max 1T
  let best = lo;

  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    const arch = paramsToArchitecture(mid);

    const syntheticModel: ModelSpec = {
      total_params: mid,
      active_params: mid,
      hidden_size: arch.hidden_size,
      num_layers: arch.num_layers,
      num_query_heads: arch.num_query_heads,
      num_kv_heads: arch.num_kv_heads,
      vocab_size: DISCOVERY_VOCAB_DEFAULT,
      max_context_window: DISCOVERY_CONTEXT_DEFAULT,
    };

    const vram = estimateVRAM(syntheticModel, hw, rt, wl, opts);
    if (vram.is_oom) {
      hi = mid;
    } else {
      best = mid;
      lo = mid;
    }
  }

  const bestArch = paramsToArchitecture(best);

  // Determine bottleneck: estimate weights vs KV at best fit
  const syntheticModel: ModelSpec = {
    total_params: best,
    active_params: best,
    hidden_size: bestArch.hidden_size,
    num_layers: bestArch.num_layers,
    num_query_heads: bestArch.num_query_heads,
    num_kv_heads: bestArch.num_kv_heads,
    vocab_size: DISCOVERY_VOCAB_DEFAULT,
    max_context_window: DISCOVERY_CONTEXT_DEFAULT,
  };
  const vramAtBest = estimateVRAM(syntheticModel, hw, rt, wl, opts);

  let bottleneck: 'weights' | 'kv_cache' | 'both';
  const weightsRatio = vramAtBest.weights_gb / vramAtBest.total_gb;
  const kvRatio = vramAtBest.kv_cache_gb / vramAtBest.total_gb;
  if (weightsRatio > 0.6) bottleneck = 'weights';
  else if (kvRatio > 0.4) bottleneck = 'kv_cache';
  else bottleneck = 'both';

  // Recommend a quantization that would allow ~2× more params
  let recommended_quant: QuantizationType = rt.weight_quantization;
  if (rt.weight_quantization === 'FP16' || rt.weight_quantization === 'BF16') {
    recommended_quant = 'AWQ';
  } else if (rt.weight_quantization === 'INT8' || rt.weight_quantization === 'FP8') {
    recommended_quant = 'GGUF_Q4_K_M';
  }

  return {
    max_params_b: Math.floor(best * 10) / 10, // round to 1 decimal
    est_hidden_size: bestArch.hidden_size,
    est_num_layers: bestArch.num_layers,
    bottleneck,
    recommended_quant,
  };
}
