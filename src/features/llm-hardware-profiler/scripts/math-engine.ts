/**
 * math-engine.ts — Core calculation engine for LLM Hardware Profiler.
 *
 * Pure functions — zero DOM dependency, fully testable in isolation.
 * Implements the Roofline Model as specified in "LLM Hardware Estimator" doc.
 *
 * Mode 1: runForward() & runQuantComparison() — Forward Estimation & Quant Matrix
 * Mode 2: runMatchmaking() — CSP Hardware Matching with Vendor/Tier/OS filters
 * Mode 3: runDiscovery() & runPresetDiscovery() — Max Model Discovery & Preset Matching
 */

import {
  BYTES_PER_PARAM,
  BYTES_PER_KV,
  OVERHEAD_GB_PER_GPU,
  ENGINE_OVERHEAD_GB,
  ENGINE_FRAG_BUFFER,
  ENGINE_EFFICIENCY_FACTOR,
  OS_PROFILE_CONSTRAINTS,
  QUANT_DISPLAY_LABELS,
  QUANT_COMPARISON_LIST,
  DISCOVERY_VOCAB_DEFAULT,
  DISCOVERY_KV_HEADS_RATIO,
  DISCOVERY_CONTEXT_DEFAULT,
  SYSTEM_RAM_SPECS,
  getQuantComputeMultiplier,
} from './constants';

import type {
  ModelSpec,
  ModelPreset,
  HardwareSpec,
  RuntimeConfig,
  WorkloadSpec,
  AdvancedOpts,
  VRAMBreakdown,
  SpeedResult,
  ForwardResult,
  QuantComparisonRow,
  OSComparisonRow,
  SLAConstraints,
  MatchResult,
  ModelConstraints,
  PresetDiscoveryRow,
  QuantizationType,
  InferenceEngine,
  OSProfile,
} from './types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the effective OS profile and its empirical multipliers for a given hardware.
 * When `os_profile` is `'auto'` or omitted, preserves the hardware's native
 * `os_vram_allocatable_factor` from `hardware-db.json` with 1.0× multipliers.
 */
export function resolveOSConstraint(
  hw: HardwareSpec,
  osProfile?: OSProfile
): {
  effective_os: Exclude<OSProfile, 'auto'>;
  allocatable_factor: number;
  overhead_multiplier: number;
  efficiency_multiplier: number;
} {
  const defaultOS: Exclude<OSProfile, 'auto'> =
    hw.arch_class === 'apple_silicon' ? 'macos_default' : 'linux_headless';

  if (!osProfile || osProfile === 'auto') {
    return {
      effective_os: defaultOS,
      allocatable_factor: hw.empirical_constraints.os_vram_allocatable_factor,
      overhead_multiplier: 1.0,
      efficiency_multiplier: 1.0,
    };
  }

  // If Apple Silicon is paired with a non-macOS profile (e.g. in cross-DB matchmaking),
  // keep macOS default unless macos_tuned was explicitly selected.
  if (
    hw.arch_class === 'apple_silicon' &&
    osProfile !== 'macos_default' &&
    osProfile !== 'macos_tuned'
  ) {
    return {
      effective_os: 'macos_default',
      allocatable_factor: hw.empirical_constraints.os_vram_allocatable_factor,
      overhead_multiplier: 1.0,
      efficiency_multiplier: 1.0,
    };
  }

  // Conversely, if a discrete PCIe/SXM GPU or x86 APU is evaluated while a macOS profile is selected,
  // fall back to linux_headless.
  if (
    hw.arch_class !== 'apple_silicon' &&
    (osProfile === 'macos_default' || osProfile === 'macos_tuned')
  ) {
    return {
      effective_os: 'linux_headless',
      allocatable_factor: hw.empirical_constraints.os_vram_allocatable_factor,
      overhead_multiplier: 1.0,
      efficiency_multiplier: 1.0,
    };
  }

  const c = OS_PROFILE_CONSTRAINTS[osProfile];
  // Respect hardware-specific unified memory ceiling (e.g. Ryzen AI Max+ Strix Halo at 0.88)
  // so selecting linux_headless does not exceed the physical BIOS/UMA allocation limit.
  const hwNativeCeiling = hw.empirical_constraints.os_vram_allocatable_factor;
  const baseRef = hw.arch_class === 'apple_silicon' ? 1.0 : 0.95;
  const scaledFactor =
    hw.arch_class !== 'apple_silicon' && hwNativeCeiling < baseRef
      ? (c.allocatable_factor / baseRef) * hwNativeCeiling
      : c.allocatable_factor;

  return {
    effective_os: osProfile,
    allocatable_factor: Math.min(c.allocatable_factor, scaledFactor),
    overhead_multiplier: c.overhead_multiplier,
    efficiency_multiplier: c.efficiency_multiplier,
  };
}

/**
 * Resolve vendor-compatible inference engine for a given hardware.
 * Prevents vendor-locked engines (e.g. NVIDIA TensorRT-LLM or Apple MLX) from
 * distorting cross-vendor comparisons in Forward or Matchmaking modes.
 */
export function resolveEngineConstraint(
  hw: HardwareSpec,
  engine?: InferenceEngine
): InferenceEngine {
  const req = engine ?? 'vLLM';
  if (hw.arch_class === 'apple_silicon' || hw.vendor === 'Apple') {
    if (req === 'TensorRT_LLM' || req === 'vLLM') return 'MLX';
    return req;
  }
  if (req === 'MLX') {
    return 'vLLM';
  }
  if (req === 'TensorRT_LLM' && hw.vendor !== 'Nvidia') {
    return 'vLLM';
  }
  return req;
}

/**
 * Compute KV cache bytes per token for a single request.
 * Formula: 2 × L × n_kv × d_head × bytes_per_kv
 * where d_head = hidden_size / num_query_heads
 */
function kvBytesPerToken(model: ModelSpec, rt: RuntimeConfig): number {
  const queryHeads = Math.max(1, model.num_query_heads);
  const d_head = model.hidden_size / queryHeads;
  return 2 * model.num_layers * model.num_kv_heads * d_head * BYTES_PER_KV[rt.kv_quantization];
}

/**
 * Resolve effective multi-GPU interconnect factor based on parallelism strategy.
 * - Tensor Parallelism (default): uses hardware's native all-reduce interconnect_penalty.
 * - Pipeline / Layer Split: point-to-point activation passing avoids heavy all-reduce latency
 *   over PCIe for single/low-batch inference (~0.94 efficiency when gpu_count > 1).
 */
function resolveInterconnectFactor(hw: HardwareSpec, rt?: RuntimeConfig): number {
  if (hw.gpu_count <= 1) return 1.0;
  if (rt?.multi_gpu_mode === 'pipeline_parallel') {
    return Math.max(hw.empirical_constraints.interconnect_penalty, 0.94);
  }
  return hw.empirical_constraints.interconnect_penalty;
}

/**
 * Effective TFLOPS after MFU factor, interconnect penalty, OS, engine, and quant compute multipliers.
 */
function effectiveTFLOPS(hw: HardwareSpec, rt?: RuntimeConfig): number {
  const os = resolveOSConstraint(hw, rt?.os_profile);
  const effEngine = resolveEngineConstraint(hw, rt?.inference_engine);
  const engineFactor = rt ? (ENGINE_EFFICIENCY_FACTOR[effEngine] ?? 1.0) : 1.0;
  const quantComputeFactor = rt
    ? getQuantComputeMultiplier(rt.weight_quantization, hw.arch_class)
    : 1.0;
  const interconnect = resolveInterconnectFactor(hw, rt);
  return (
    hw.specs.compute_tflops_fp16 *
    hw.empirical_constraints.mfu_factor *
    interconnect *
    os.efficiency_multiplier *
    engineFactor *
    quantComputeFactor
  );
}

/**
 * Effective memory bandwidth after utilization factor, interconnect penalty, OS, and engine multipliers.
 */
function effectiveBandwidthGBs(hw: HardwareSpec, rt?: RuntimeConfig): number {
  const os = resolveOSConstraint(hw, rt?.os_profile);
  const effEngine = resolveEngineConstraint(hw, rt?.inference_engine);
  const engineFactor = rt ? (ENGINE_EFFICIENCY_FACTOR[effEngine] ?? 1.0) : 1.0;
  const interconnect = resolveInterconnectFactor(hw, rt);
  return (
    hw.specs.raw_bandwidth_gbps *
    hw.empirical_constraints.bandwidth_utilization *
    interconnect *
    os.efficiency_multiplier *
    engineFactor
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
 *  - Inference Engine: fragmentation buffer & runtime context overhead
 *  - OS Profile: adjusts allocatable VRAM ceiling & driver overhead
 */
export function estimateVRAM(
  model: ModelSpec,
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts
): VRAMBreakdown {
  const bytesPerParam = BYTES_PER_PARAM[rt.weight_quantization];
  const os = resolveOSConstraint(hw, rt.os_profile);
  const effEngine = resolveEngineConstraint(hw, rt.inference_engine);

  // ── Model weights ──────────────────────────────────────────────────────────
  const totalParams = Math.max(0.1, model.total_params);
  let weights_gb = (totalParams * 1e9 * bytesPerParam) / 1e9;

  // Speculative Decoding: add draft model weights
  if (opts.spec_decoding_enabled && opts.spec_decoding_draft_params > 0) {
    weights_gb += (opts.spec_decoding_draft_params * 1e9 * bytesPerParam) / 1e9;
  }

  // ── KV Cache ───────────────────────────────────────────────────────────────
  const kv_bytes_per_token = kvBytesPerToken(model, rt);
  const maxWindow =
    model.max_context_window > 0 ? model.max_context_window : rt.context_length_limit;
  const context = Math.max(1, Math.min(rt.context_length_limit, maxWindow));
  const concurrentReqs = Math.max(1, wl.max_concurrent_reqs);

  let kv_cache_gb: number;
  if (opts.apc_enabled && wl.shared_prefix_length > 0) {
    // APC: prefix tokens allocated once globally, per-user context is reduced
    const prefix_kv_gb = (kv_bytes_per_token * wl.shared_prefix_length) / 1e9;
    const per_user_context = Math.max(context - wl.shared_prefix_length, 0);
    const per_user_kv_gb = (kv_bytes_per_token * concurrentReqs * per_user_context) / 1e9;
    kv_cache_gb = prefix_kv_gb + per_user_kv_gb;
  } else {
    kv_cache_gb = (kv_bytes_per_token * concurrentReqs * context) / 1e9;
  }

  // ── Overhead + fragmentation ───────────────────────────────────────────────
  const frag = ENGINE_FRAG_BUFFER[effEngine] ?? 0.04;
  const perGpuOverhead = ENGINE_OVERHEAD_GB[effEngine] ?? OVERHEAD_GB_PER_GPU;
  const gpuCount = Math.max(1, hw.gpu_count);
  // Pipeline parallelism avoids full NCCL communicator buffers across every GPU
  const multiGpuOverheadFactor =
    gpuCount > 1 && rt.multi_gpu_mode === 'pipeline_parallel' ? 0.85 : 1.0;
  const base_overhead_gb =
    perGpuOverhead * gpuCount * os.overhead_multiplier * multiGpuOverheadFactor;
  // Fragmentation applied as % of (weights + kv)
  const frag_gb = (weights_gb + kv_cache_gb) * frag;
  const overhead_gb = base_overhead_gb + frag_gb;

  // ── Totals & Capacity Ceilings ─────────────────────────────────────────────
  const total_gb = weights_gb + kv_cache_gb + overhead_gb;
  const allocatable_gb = Math.max(0, hw.specs.vram_total_gb) * os.allocatable_factor;

  // Hybrid System RAM Offloading (applicable to discrete GPUs when enabled; unified memory already uses host RAM)
  const isUnifiedArch =
    hw.arch_class === 'apple_silicon' ||
    hw.empirical_constraints.os_vram_allocatable_factor < 0.92 ||
    hw.display_name.toLowerCase().includes('unified');
  const ramTier = opts.system_ram_tier ?? 'none';
  const ramBudgetGb = Math.max(0, opts.system_ram_gb ?? 0);
  const canUseRamOffload =
    Boolean(opts.ram_offload_enabled) && !isUnifiedArch && ramTier !== 'none' && ramBudgetGb > 0;

  let offloaded_ram_gb = 0;
  let fits_with_offload = false;

  if (total_gb > allocatable_gb && canUseRamOffload) {
    const rawOverflow = total_gb - allocatable_gb;
    // KV cache + runtime overhead + at least 10% of weights must fit in VRAM/RAM budget
    const nonWeightVram = kv_cache_gb + base_overhead_gb;
    if (nonWeightVram < allocatable_gb && rawOverflow <= ramBudgetGb && rawOverflow <= weights_gb) {
      offloaded_ram_gb = rawOverflow;
      fits_with_offload = true;
    }
  }

  const is_oom = total_gb > allocatable_gb && !fits_with_offload;
  const utilization_pct = allocatable_gb > 0 ? (total_gb / allocatable_gb) * 100 : 100;

  // Calculate max concurrent requests & max single-user context before OOM
  // Total = base_overhead + (weights + kv) * (1 + frag) <= effective_memory_ceiling
  const effective_ceiling_gb = canUseRamOffload
    ? allocatable_gb + Math.min(ramBudgetGb, weights_gb * 0.9)
    : allocatable_gb;
  const kv_budget_gb = (effective_ceiling_gb - base_overhead_gb) / (1 + frag) - weights_gb;
  let max_concurrent_at_context = 0;
  let max_context_single_user = 0;

  if (kv_budget_gb > 0 && kv_bytes_per_token > 0) {
    const kv_gb_per_token = kv_bytes_per_token / 1e9;
    max_context_single_user = Math.min(maxWindow, Math.floor(kv_budget_gb / kv_gb_per_token));

    if (opts.apc_enabled && wl.shared_prefix_length > 0) {
      const prefix_kv_gb = kv_gb_per_token * wl.shared_prefix_length;
      const per_user_context = Math.max(context - wl.shared_prefix_length, 0);
      const per_user_kv_gb = kv_gb_per_token * per_user_context;
      if (kv_budget_gb >= prefix_kv_gb) {
        max_concurrent_at_context =
          per_user_kv_gb > 0 ? Math.floor((kv_budget_gb - prefix_kv_gb) / per_user_kv_gb) : 9999;
      }
    } else {
      const per_user_kv_gb = kv_gb_per_token * context;
      max_concurrent_at_context =
        per_user_kv_gb > 0 ? Math.floor(kv_budget_gb / per_user_kv_gb) : 9999;
    }
  }

  return {
    weights_gb,
    kv_cache_gb,
    overhead_gb,
    total_gb,
    allocatable_gb,
    is_oom,
    fits_with_offload,
    offloaded_ram_gb,
    utilization_pct,
    max_concurrent_at_context: Math.max(0, max_concurrent_at_context),
    max_context_single_user: Math.max(0, max_context_single_user),
    effective_os_profile: os.effective_os,
  };
}

// ─── Speed Estimation (Roofline Model) ───────────────────────────────────────

/**
 * Estimate prefill and decode speed using the Roofline Model.
 *
 * Prefill  → Compute-Bound:  TTFT ≈ (2 × P_active × input_tokens × batch) / eff_TFLOPS
 * Decode   → Roofline Bound: Step time = max(t_memory, t_compute)
 *
 * Key edge cases:
 *  - APC: reduces effective input tokens (prefix already cached)
 *  - Chunked Prefill: caps TTFT at chunk_size / eff_TFLOPS_per_token
 *  - Speculative Decoding: accounts for draft weight stream & verification FLOPs,
 *    keeping decode_system_tps consistent with decode_per_user_tps × batch
 *  - High Batch Size: transitions from memory-bound to compute-bound above ridge point
 */
export function estimateSpeed(
  model: ModelSpec,
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts,
  vram: VRAMBreakdown
): SpeedResult {
  const eff_tflops = effectiveTFLOPS(hw, rt); // TFLOPS
  const eff_bw_gbs = effectiveBandwidthGBs(hw, rt); // GB/s
  const effEngine = resolveEngineConstraint(hw, rt.inference_engine);
  const bytesPerParam = BYTES_PER_PARAM[rt.weight_quantization];
  const concurrentReqs = Math.max(1, wl.max_concurrent_reqs);
  const totalParams = Math.max(0.1, model.total_params);
  const activeParams = Math.min(totalParams, Math.max(0.1, model.active_params || totalParams));

  // ── Prefill (Compute-Bound) ────────────────────────────────────────────────
  const effective_input =
    opts.apc_enabled && wl.shared_prefix_length > 0
      ? Math.max(wl.avg_input_tokens - wl.shared_prefix_length, 1)
      : Math.max(wl.avg_input_tokens, 1);

  // FLOPs = 2 × P_active (in params) × tokens × batch
  const prefill_flops = 2 * (activeParams * 1e9) * effective_input * concurrentReqs;
  let prefill_ttft_ms = eff_tflops > 0 ? (prefill_flops / (eff_tflops * 1e12)) * 1000 : 0;

  // Chunked Prefill: cap TTFT at processing one chunk at a time
  if (opts.chunked_prefill_enabled && opts.chunked_prefill_chunk_size > 0 && eff_tflops > 0) {
    const chunk_flops = 2 * (activeParams * 1e9) * opts.chunked_prefill_chunk_size;
    const chunk_ttft_ms = (chunk_flops / (eff_tflops * 1e12)) * 1000;
    prefill_ttft_ms = Math.min(prefill_ttft_ms, chunk_ttft_ms);
  }

  // ── Decode (Roofline Model: Memory-Bound vs Compute-Bound vs RAM Offload) ──
  // Bytes accessed per decode step = active_weights (streamed once across batch) + KV_total
  const active_weights_bytes = activeParams * 1e9 * bytesPerParam;
  const kv_total_bytes = vram.kv_cache_gb * 1e9;
  const bytes_per_token = active_weights_bytes + kv_total_bytes;

  // Memory-bound step duration (s)
  let t_step_mem_s = eff_bw_gbs > 0 ? bytes_per_token / (eff_bw_gbs * 1e9) : 0;
  let isOffloadBound = false;

  if (vram.fits_with_offload && vram.offloaded_ram_gb > 0 && vram.weights_gb > 0) {
    const ramTierKey =
      opts.system_ram_tier && opts.system_ram_tier !== 'none' ? opts.system_ram_tier : 'ddr5_dual';
    const ramSpec = SYSTEM_RAM_SPECS[ramTierKey];
    const eff_ram_bw_gbs = ramSpec.raw_bw_gbps * ramSpec.util_factor;
    // Fraction of active weights spilled to host RAM
    const offloadFraction = Math.min(1, vram.offloaded_ram_gb / vram.weights_gb);
    const offloaded_active_bytes = active_weights_bytes * offloadFraction;
    const vram_active_bytes = active_weights_bytes * (1 - offloadFraction);

    const t_gpu_mem_s =
      eff_bw_gbs > 0 ? (vram_active_bytes + kv_total_bytes) / (eff_bw_gbs * 1e9) : 0;
    const t_ram_mem_s = eff_ram_bw_gbs > 0 ? offloaded_active_bytes / (eff_ram_bw_gbs * 1e9) : 0;
    t_step_mem_s = t_gpu_mem_s + t_ram_mem_s;
    isOffloadBound = t_ram_mem_s > 0;
    // Also penalize prefill TTFT when streaming offloaded layers from host RAM
    prefill_ttft_ms += t_ram_mem_s * 1000 * 1.5;
  }

  // Compute-bound step duration (s): 2 * P_active * batch_size FLOPs per decode step
  const decode_step_flops = 2 * (activeParams * 1e9) * concurrentReqs;
  const t_step_comp_s = eff_tflops > 0 ? decode_step_flops / (eff_tflops * 1e12) : 0;

  // True Roofline: step duration is governed by whichever bound is slower
  let bottleneck_regime: 'memory_bound' | 'compute_bound' | 'ram_offload_bound' = isOffloadBound
    ? 'ram_offload_bound'
    : t_step_comp_s > t_step_mem_s
      ? 'compute_bound'
      : 'memory_bound';
  const t_step_s = Math.max(t_step_mem_s, t_step_comp_s);

  let decode_per_user_tps = t_step_s > 0 ? 1 / t_step_s : 0;

  // Speculative Decoding: draft model generates gamma tokens, target model verifies in 1 pass
  if (
    opts.spec_decoding_enabled &&
    opts.spec_decoding_acceptance_rate > 1 &&
    bottleneck_regime === 'memory_bound'
  ) {
    const draftParams = Math.max(0, opts.spec_decoding_draft_params);
    const acceptRate = opts.spec_decoding_acceptance_rate;
    const draft_weights_bytes = draftParams * 1e9 * bytesPerParam;
    // Per verification cycle (~acceptRate accepted tokens), target weights + KV are read once
    // while draft weights are read across draft steps (~acceptRate times).
    const cycle_bytes = bytes_per_token + draft_weights_bytes * acceptRate;
    const t_spec_mem_per_token =
      eff_bw_gbs > 0 ? cycle_bytes / acceptRate / (eff_bw_gbs * 1e9) : t_step_mem_s;
    const t_spec_comp_per_token =
      eff_tflops > 0
        ? (2 * ((activeParams + draftParams) * 1e9) * concurrentReqs) / (eff_tflops * 1e12)
        : t_step_comp_s;

    if (t_spec_comp_per_token > t_spec_mem_per_token) {
      bottleneck_regime = 'compute_bound';
    }
    const t_spec_step_s = Math.max(t_spec_mem_per_token, t_spec_comp_per_token);
    const spec_tps = t_spec_step_s > 0 ? 1 / t_spec_step_s : decode_per_user_tps;
    // Only apply speculative speedup if the draft model actually improves over baseline
    if (spec_tps > decode_per_user_tps) {
      decode_per_user_tps = spec_tps;
    }
  }

  const decode_system_tps = decode_per_user_tps * concurrentReqs;

  // End-to-end request time (prefill + generating avg_output_tokens)
  const outputTokens = Math.max(0, wl.avg_output_tokens);
  const decode_time_s = decode_per_user_tps > 0 ? outputTokens / decode_per_user_tps : 0;
  const e2e_latency_s = prefill_ttft_ms / 1000 + decode_time_s;

  return {
    prefill_ttft_ms,
    decode_system_tps,
    decode_per_user_tps,
    e2e_latency_s,
    bottleneck_regime,
    effective_bw_gbps: eff_bw_gbs,
    effective_tflops: eff_tflops,
    effective_engine: effEngine,
  };
}

// ─── Mode 1: Forward Estimation & Quantization Comparison ─────────────────────

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

/**
 * Compare how the given model performs across standard quantization formats
 * on the selected hardware and OS profile.
 */
export function runQuantComparison(
  model: ModelSpec,
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts
): QuantComparisonRow[] {
  return QUANT_COMPARISON_LIST.map((quant) => {
    const quantRt: RuntimeConfig = {
      ...rt,
      weight_quantization: quant,
    };
    const { vram, speed } = runForward(model, hw, quantRt, wl, opts);
    return {
      quant,
      label: QUANT_DISPLAY_LABELS[quant],
      bytes_per_param: BYTES_PER_PARAM[quant],
      vram,
      speed,
    };
  });
}

/**
 * Compare how the given model and hardware perform across applicable OS / driver profiles.
 * - Apple Silicon: compares macos_default (75% RAM) vs macos_tuned (88% RAM)
 * - Discrete GPUs / x86 APUs: compares linux_headless, linux_gui, windows_wsl2, windows_native
 */
export function runOSComparison(
  model: ModelSpec,
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts
): OSComparisonRow[] {
  const profiles: Exclude<OSProfile, 'auto'>[] =
    hw.arch_class === 'apple_silicon'
      ? ['macos_default', 'macos_tuned']
      : ['linux_headless', 'linux_gui', 'windows_wsl2', 'windows_native'];

  return profiles.map((os_profile) => {
    const osRt: RuntimeConfig = {
      ...rt,
      os_profile,
    };
    const { vram, speed } = runForward(model, hw, osRt, wl, opts);
    return {
      os_profile,
      vram,
      speed,
    };
  });
}

// ─── Mode 2: Hardware Matchmaking (CSP) ──────────────────────────────────────

/**
 * Run Mode 2 — Hardware Matchmaking via Constraint Satisfaction.
 *
 * Algorithm:
 * 1. Filter by optional vendor_filter and arch_filter
 * 2. Simulate Mode 1 for each hardware entry in the DB
 * 3. Discard: OOM, decode < min_tps, TTFT > max_ttft
 * 4. Sort according to sla.sort_by (defaults to lowest hourly cost)
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
    if (sla.vendor_filter && sla.vendor_filter !== 'all' && hw.vendor !== sla.vendor_filter) {
      continue;
    }
    if (sla.arch_filter && sla.arch_filter !== 'all' && hw.arch_class !== sla.arch_filter) {
      continue;
    }
    if (
      sla.max_buy_price_usd &&
      sla.max_buy_price_usd > 0 &&
      (hw.economics.purchase_price_usd === undefined ||
        hw.economics.purchase_price_usd > sla.max_buy_price_usd)
    ) {
      continue;
    }
    if (
      sla.max_hourly_cost_usd &&
      sla.max_hourly_cost_usd > 0 &&
      hw.economics.est_hourly_cost_usd > sla.max_hourly_cost_usd
    ) {
      continue;
    }

    const result = runForward(model, hw, rt, wl, opts);

    // Filter: OOM
    if (result.vram.is_oom) continue;
    // Filter: decode speed SLA
    if (result.speed.decode_per_user_tps < sla.min_decode_tps_per_user) continue;
    // Filter: TTFT SLA
    if (result.speed.prefill_ttft_ms > sla.max_ttft_ms) continue;

    const costHr = hw.economics.est_hourly_cost_usd;
    const roi_score = costHr > 0 ? result.speed.decode_per_user_tps / costHr : 0;
    results.push({ hardware: hw, result, roi_score });
  }

  const sortBy = sla.sort_by ?? 'cost_hr';
  results.sort((a, b) => {
    if (sortBy === 'buy_price') {
      const pa = a.hardware.economics.purchase_price_usd ?? Number.MAX_SAFE_INTEGER;
      const pb = b.hardware.economics.purchase_price_usd ?? Number.MAX_SAFE_INTEGER;
      return pa - pb;
    }
    if (sortBy === 'roi') {
      return b.roi_score - a.roi_score;
    }
    if (sortBy === 'tps') {
      return b.result.speed.decode_per_user_tps - a.result.speed.decode_per_user_tps;
    }
    if (sortBy === 'ttft') {
      return a.result.speed.prefill_ttft_ms - b.result.speed.prefill_ttft_ms;
    }
    return a.hardware.economics.est_hourly_cost_usd - b.hardware.economics.est_hourly_cost_usd;
  });

  return results;
}

// ─── Mode 3: Model Discovery ──────────────────────────────────────────────────

/**
 * Estimate transformer architecture from total_params using scaling-law
 * heuristics.
 *
 * A dense transformer block holds ≈ 12·hidden² params (attention + FFN), and
 * the standard aspect ratio is num_layers ≈ hidden / 128. So
 *   params ≈ 12 · (hidden/128) · hidden² = (12/128) · hidden³
 *   ⇒ hidden ≈ cbrt(params / (12/128)) = cbrt(params × 10.667)
 */
const PARAMS_PER_HIDDEN_CUBED = 12 / 128; // 0.09375

function paramsToArchitecture(params_b: number): {
  hidden_size: number;
  num_layers: number;
  num_query_heads: number;
  num_kv_heads: number;
} {
  const hidden_raw = Math.cbrt((params_b * 1e9) / PARAMS_PER_HIDDEN_CUBED);
  const hidden_size = Math.max(128, Math.round(hidden_raw / 128) * 128);
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
  let lo = 0.5; // minimum 500M
  let hi = 1000.0; // max 1T
  let best = 0;

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
      max_context_window: Math.max(DISCOVERY_CONTEXT_DEFAULT, rt.context_length_limit),
    };

    const vram = estimateVRAM(syntheticModel, hw, rt, wl, opts);
    if (vram.is_oom) {
      hi = mid;
    } else {
      best = mid;
      lo = mid;
    }
  }

  const effectiveBest = Math.max(best, 0.5);
  const bestArch = paramsToArchitecture(effectiveBest);

  const syntheticModel: ModelSpec = {
    total_params: effectiveBest,
    active_params: effectiveBest,
    hidden_size: bestArch.hidden_size,
    num_layers: bestArch.num_layers,
    num_query_heads: bestArch.num_query_heads,
    num_kv_heads: bestArch.num_kv_heads,
    vocab_size: DISCOVERY_VOCAB_DEFAULT,
    max_context_window: Math.max(DISCOVERY_CONTEXT_DEFAULT, rt.context_length_limit),
  };
  const vramAtBest = estimateVRAM(syntheticModel, hw, rt, wl, opts);

  let bottleneck: 'weights' | 'kv_cache' | 'both';
  const weightsRatio = vramAtBest.weights_gb / vramAtBest.total_gb;
  const kvRatio = vramAtBest.kv_cache_gb / vramAtBest.total_gb;
  if (weightsRatio > 0.6) bottleneck = 'weights';
  else if (kvRatio > 0.4) bottleneck = 'kv_cache';
  else bottleneck = 'both';

  let recommended_quant: QuantizationType = rt.weight_quantization;
  if (
    rt.weight_quantization === 'FP16' ||
    rt.weight_quantization === 'BF16' ||
    rt.weight_quantization === 'FP32'
  ) {
    recommended_quant = 'AWQ';
  } else if (
    rt.weight_quantization === 'INT8' ||
    rt.weight_quantization === 'FP8' ||
    rt.weight_quantization === 'GGUF_Q8_0'
  ) {
    recommended_quant = 'GGUF_Q4_K_M';
  } else if (rt.weight_quantization === 'GGUF_Q6_K' || rt.weight_quantization === 'GGUF_Q5_K_M') {
    recommended_quant = 'GGUF_Q4_K_M';
  }

  return {
    max_params_b: best > 0 ? Math.floor(best * 10) / 10 : 0,
    est_hidden_size: bestArch.hidden_size,
    est_num_layers: bestArch.num_layers,
    bottleneck,
    recommended_quant,
  };
}

/**
 * Evaluate which real models from the preset database can run on the target hardware.
 * First tests at the user's selected quantization; if OOM and the user selected >4-bit,
 * also checks if the model fits with 4-bit quantization (AWQ / GGUF_Q4_K_M).
 */
export function runPresetDiscovery(
  hw: HardwareSpec,
  rt: RuntimeConfig,
  wl: WorkloadSpec,
  opts: AdvancedOpts,
  presets: ModelPreset[]
): PresetDiscoveryRow[] {
  const rows: PresetDiscoveryRow[] = [];
  const fallbackQuant: QuantizationType =
    hw.arch_class === 'apple_silicon' || hw.vendor !== 'Nvidia' ? 'GGUF_Q4_K_M' : 'AWQ';

  for (const preset of presets) {
    const resCurrent = runForward(preset, hw, rt, wl, opts);
    if (!resCurrent.vram.is_oom) {
      rows.push({
        preset,
        fits_current_quant: true,
        active_quant: rt.weight_quantization,
        result: resCurrent,
      });
      continue;
    }

    // If current quant is wider than 4-bit, check if 4-bit fits
    if (BYTES_PER_PARAM[rt.weight_quantization] > BYTES_PER_PARAM[fallbackQuant]) {
      const rt4bit: RuntimeConfig = {
        ...rt,
        weight_quantization: fallbackQuant,
      };
      const res4bit = runForward(preset, hw, rt4bit, wl, opts);
      if (!res4bit.vram.is_oom) {
        rows.push({
          preset,
          fits_current_quant: false,
          active_quant: fallbackQuant,
          result: res4bit,
        });
      }
    }
  }

  // Sort by total_params descending (largest capable models first)
  rows.sort((a, b) => b.preset.total_params - a.preset.total_params);
  return rows;
}
