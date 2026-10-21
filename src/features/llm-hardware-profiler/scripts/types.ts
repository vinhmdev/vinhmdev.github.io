/**
 * types.ts — Shared TypeScript interfaces for LLM Hardware Profiler.
 *
 * Variable names mirror the spec's "Input Parameters Dictionary" (Groups 1–4)
 * exactly to maintain a 1-1 mapping between the design doc and the codebase.
 */

// ─── Group 1: Model Specifications ──────────────────────────────────────────

export interface ModelSpec {
  /** Total size of the neural network in Billions (e.g. 8.0, 70.0) */
  total_params: number;
  /** Active params per token for MoE models. Equals total_params for dense models. */
  active_params: number;
  /** Width of the network — embedding dimension (e.g. 4096) */
  hidden_size: number;
  /** Depth of the network — transformer blocks (e.g. 32) */
  num_layers: number;
  /** Number of Query attention heads */
  num_query_heads: number;
  /** Number of KV attention heads. Equals num_query_heads for MHA; less for GQA/MQA. */
  num_kv_heads: number;
  /** Vocabulary size — large vocabs add significant VRAM overhead (e.g. 128256) */
  vocab_size: number;
  /** Model's maximum designed context window in tokens (e.g. 8192, 131072) */
  max_context_window: number;
}

export interface ModelPreset extends ModelSpec {
  model_id: string;
  display_name: string;
  family: string;
}

// ─── Group 2: Hardware Capabilities (from DB, not user input) ────────────────

export type ArchClass = 'datacenter' | 'workstation' | 'consumer' | 'apple_silicon';

export type OSProfile =
  | 'auto'
  | 'linux_headless'
  | 'linux_gui'
  | 'windows_wsl2'
  | 'windows_native'
  | 'macos_default'
  | 'macos_tuned';

export type VendorFilter = 'all' | 'Nvidia' | 'AMD' | 'Apple' | 'Intel';
export type ArchFilter = 'all' | ArchClass;
export type MatchSortBy = 'cost_hr' | 'buy_price' | 'roi' | 'tps' | 'ttft';

export interface HardwareSpec {
  hardware_id: string;
  display_name: string;
  vendor: string;
  arch_class: ArchClass;
  gpu_count: number;
  specs: {
    /** Hard physical memory limit in GB (aggregate across gpu_count) */
    vram_total_gb: number;
    /** Advertised memory bandwidth in GB/s (aggregate across gpu_count) */
    raw_bandwidth_gbps: number;
    /** Dense FP16 compute performance in TFLOPS (aggregate across gpu_count) */
    compute_tflops_fp16: number;
  };
  empirical_constraints: {
    /** Default OS ring-fence factor: Apple=0.75, Linux Headless=0.95, APU=0.88 */
    os_vram_allocatable_factor: number;
    /** Effective bandwidth efficiency (0.60–0.85) */
    bandwidth_utilization: number;
    /** Model FLOPs Utilization (0.30–0.50) */
    mfu_factor: number;
    /** Tensor parallelism penalty: Unified=1.0, NVLink=0.98, PCIe=0.76–0.84 */
    interconnect_penalty: number;
  };
  economics: {
    /** Estimated hourly cost in USD (CapEx amortized or cloud on-demand) */
    est_hourly_cost_usd: number;
    /** Estimated street/retail purchase price in USD (CapEx reference) */
    purchase_price_usd?: number;
    /** Typical system/GPU TDP in Watts */
    power_watts?: number;
  };
}

// ─── Group 3: Runtime / Inference Configs (UI Controls) ──────────────────────

/** Maps to BYTES_PER_PARAM in constants.ts */
export type QuantizationType =
  | 'FP16'
  | 'BF16'
  | 'FP32'
  | 'INT8'
  | 'FP8'
  | 'AWQ'
  | 'GPTQ'
  | 'EXL2'
  | 'GGUF_Q8_0'
  | 'GGUF_Q6_K'
  | 'GGUF_Q5_K_M'
  | 'GGUF_Q4_K_M'
  | 'GGUF_IQ3_XXS';

/** Maps to BYTES_PER_KV in constants.ts */
export type KvQuantType = 'FP16' | 'FP8' | 'INT4';

/** Affects memory fragmentation buffer and runtime overhead */
export type InferenceEngine = 'Standard_HF' | 'vLLM' | 'TensorRT_LLM' | 'llama_cpp' | 'MLX';

/** Multi-GPU execution strategy when gpu_count > 1 */
export type MultiGpuMode = 'tensor_parallel' | 'pipeline_parallel';

/** Host System RAM tier for hybrid CPU/RAM layer offloading */
export type SystemRamTier = 'none' | 'ddr4_dual' | 'ddr5_dual' | 'ddr5_server';

export interface RuntimeConfig {
  weight_quantization: QuantizationType;
  kv_quantization: KvQuantType;
  /** Maximum context the server will process at runtime (tokens) */
  context_length_limit: number;
  inference_engine: InferenceEngine;
  /** Target OS / driver environment affecting allocatable VRAM & runtime efficiency */
  os_profile?: OSProfile;
  /** Parallelism mode when running across multiple GPUs */
  multi_gpu_mode?: MultiGpuMode;
}

// ─── Group 4: Traffic & Workload ──────────────────────────────────────────────

export interface WorkloadSpec {
  /** "Batch Size" at peak traffic — number of simultaneous users */
  max_concurrent_reqs: number;
  /** Average prompt length in tokens (impacts Prefill compute) */
  avg_input_tokens: number;
  /** Average generated response length in tokens (impacts E2E latency) */
  avg_output_tokens: number;
  /** Tokens shared across all requests (e.g. system prompt for RAG) */
  shared_prefix_length: number;
}

// ─── Advanced Optimisation Options ───────────────────────────────────────────

export interface AdvancedOpts {
  /** Automatic Prefix Caching — allocate shared prefix KV once */
  apc_enabled: boolean;
  /** Speculative Decoding — draft model trades compute for bandwidth */
  spec_decoding_enabled: boolean;
  /** Draft model size in Billions */
  spec_decoding_draft_params: number;
  /** Acceptance rate multiplier, typically 1.5–2.2× */
  spec_decoding_acceptance_rate: number;
  /** Chunked Prefill — caps TTFT spikes for large prompts */
  chunked_prefill_enabled: boolean;
  /** Chunk size in tokens (e.g. 512) */
  chunked_prefill_chunk_size: number;
  /** Hybrid System RAM Offloading — spill weights exceeding VRAM into host RAM */
  ram_offload_enabled?: boolean;
  /** Host RAM architecture tier governing offload memory bandwidth */
  system_ram_tier?: SystemRamTier;
  /** Available host RAM budget for offloaded weights in GB */
  system_ram_gb?: number;
}

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface VRAMBreakdown {
  /** Weights memory in GB */
  weights_gb: number;
  /** KV cache memory in GB */
  kv_cache_gb: number;
  /** Overhead + fragmentation buffer in GB */
  overhead_gb: number;
  /** Total required memory in GB */
  total_gb: number;
  /** OS-allocatable VRAM ceiling in GB (vram_total × os_factor) */
  allocatable_gb: number;
  /** True if total_gb > allocatable_gb and not rescued by valid System RAM offload */
  is_oom: boolean;
  /** True if total_gb > allocatable_gb but fits via Hybrid System RAM offload */
  fits_with_offload: boolean;
  /** Amount of model weights spilled to host System RAM in GB (0 if fits in VRAM) */
  offloaded_ram_gb: number;
  /** total_gb / allocatable_gb as a percentage */
  utilization_pct: number;
  /** Maximum concurrent users that fit before OOM at current context_length_limit */
  max_concurrent_at_context: number;
  /** Maximum context tokens for a single user before OOM */
  max_context_single_user: number;
  /** Effective OS profile applied */
  effective_os_profile: Exclude<OSProfile, 'auto'>;
}

export interface SpeedResult {
  /** Time-To-First-Token for the prefill phase in milliseconds */
  prefill_ttft_ms: number;
  /** Total system decode throughput in tokens/s (all users combined) */
  decode_system_tps: number;
  /** Per-user decode speed in tokens/s */
  decode_per_user_tps: number;
  /** End-to-end latency in seconds for avg_input_tokens + avg_output_tokens */
  e2e_latency_s: number;
  /** Whether decode is memory-bandwidth bound, compute-bound, or PCIe/RAM offload bound */
  bottleneck_regime: 'memory_bound' | 'compute_bound' | 'ram_offload_bound';
  /** Effective memory bandwidth in GB/s after utilization, interconnect, and OS/engine factors */
  effective_bw_gbps: number;
  /** Effective compute in TFLOPS after MFU, interconnect, and OS/engine factors */
  effective_tflops: number;
  /** Effective inference engine applied after vendor compatibility resolution */
  effective_engine: InferenceEngine;
}

export interface ForwardResult {
  vram: VRAMBreakdown;
  speed: SpeedResult;
}

export interface QuantComparisonRow {
  quant: QuantizationType;
  label: string;
  bytes_per_param: number;
  vram: VRAMBreakdown;
  speed: SpeedResult;
}

export interface OSComparisonRow {
  os_profile: Exclude<OSProfile, 'auto'>;
  vram: VRAMBreakdown;
  speed: SpeedResult;
}

// ─── Mode 2: Matchmaking ──────────────────────────────────────────────────────

export interface SLAConstraints {
  /** Minimum acceptable decode speed per user (tokens/s) */
  min_decode_tps_per_user: number;
  /** Maximum acceptable Time-To-First-Token (ms) */
  max_ttft_ms: number;
  /** Optional vendor filter */
  vendor_filter?: VendorFilter;
  /** Optional architecture class filter */
  arch_filter?: ArchFilter;
  /** Optional sort order */
  sort_by?: MatchSortBy;
  /** Optional maximum hardware purchase budget in USD (0 = unlimited) */
  max_buy_price_usd?: number;
  /** Optional maximum cloud/hourly budget in USD/hr (0 = unlimited) */
  max_hourly_cost_usd?: number;
}

export interface MatchResult {
  hardware: HardwareSpec;
  result: ForwardResult;
  /** Performance-per-dollar score: decode_tps_per_user / est_hourly_cost_usd */
  roi_score: number;
}

// ─── Mode 3: Model Discovery ──────────────────────────────────────────────────

export interface ModelConstraints {
  /** Maximum total parameters that fit without OOM (Billions) */
  max_params_b: number;
  /** Estimated hidden size for max params */
  est_hidden_size: number;
  /** Estimated number of layers for max params */
  est_num_layers: number;
  /** Whether the max param fit required lower quantization */
  bottleneck: 'weights' | 'kv_cache' | 'both';
  /** Recommended quantization to maximize model size */
  recommended_quant: QuantizationType;
}

export interface PresetDiscoveryRow {
  preset: ModelPreset;
  fits_current_quant: boolean;
  active_quant: QuantizationType;
  result: ForwardResult;
}
