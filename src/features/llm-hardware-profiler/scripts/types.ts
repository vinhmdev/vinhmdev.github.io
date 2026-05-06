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

export type ArchClass = 'datacenter' | 'consumer' | 'apple_silicon';

export interface HardwareSpec {
  hardware_id: string;
  display_name: string;
  vendor: string;
  arch_class: ArchClass;
  gpu_count: number;
  specs: {
    /** Hard physical memory limit in GB */
    vram_total_gb: number;
    /** Advertised memory bandwidth in GB/s */
    raw_bandwidth_gbps: number;
    /** Dense FP16 compute performance in TFLOPS */
    compute_tflops_fp16: number;
  };
  empirical_constraints: {
    /** OS ring-fence factor: Apple=0.75, NV/Linux=0.95 */
    os_vram_allocatable_factor: number;
    /** Effective bandwidth efficiency (0.60–0.85) */
    bandwidth_utilization: number;
    /** Model FLOPs Utilization (0.30–0.50) */
    mfu_factor: number;
    /** Tensor parallelism penalty: Unified=1.0, NVLink=0.98, PCIe=0.80 */
    interconnect_penalty: number;
  };
  economics: {
    /** Estimated hourly cost in USD (CapEx amortized or cloud on-demand) */
    est_hourly_cost_usd: number;
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
  | 'GGUF_Q4_K_M'
  | 'GGUF_Q5_K_M'
  | 'GGUF_Q8_0';

/** Maps to BYTES_PER_KV in constants.ts */
export type KvQuantType = 'FP16' | 'FP8';

/** Affects memory fragmentation buffer (Standard_HF=20%, vLLM=4%) */
export type InferenceEngine = 'Standard_HF' | 'vLLM';

export interface RuntimeConfig {
  weight_quantization: QuantizationType;
  kv_quantization: KvQuantType;
  /** Maximum context the server will process at runtime (tokens) */
  context_length_limit: number;
  inference_engine: InferenceEngine;
}

// ─── Group 4: Traffic & Workload ──────────────────────────────────────────────

export interface WorkloadSpec {
  /** "Batch Size" at peak traffic — number of simultaneous users */
  max_concurrent_reqs: number;
  /** Average prompt length in tokens (impacts Prefill compute) */
  avg_input_tokens: number;
  /** Average generated response length in tokens (impacts Decode bandwidth) */
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
}

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface VRAMBreakdown {
  /** Weights memory in GB */
  weights_gb: number;
  /** KV cache memory in GB */
  kv_cache_gb: number;
  /** Overhead + fragmentation buffer in GB */
  overhead_gb: number;
  /** Total required VRAM in GB */
  total_gb: number;
  /** OS-allocatable VRAM ceiling in GB (vram_total × os_factor) */
  allocatable_gb: number;
  /** True if total_gb > allocatable_gb */
  is_oom: boolean;
  /** total_gb / allocatable_gb as a percentage */
  utilization_pct: number;
}

export interface SpeedResult {
  /** Time-To-First-Token for the prefill phase in milliseconds */
  prefill_ttft_ms: number;
  /** Total system decode throughput in tokens/s (all users combined) */
  decode_system_tps: number;
  /** Per-user decode speed in tokens/s */
  decode_per_user_tps: number;
}

export interface ForwardResult {
  vram: VRAMBreakdown;
  speed: SpeedResult;
}

// ─── Mode 2: Matchmaking ──────────────────────────────────────────────────────

export interface SLAConstraints {
  /** Minimum acceptable decode speed per user (tokens/s) */
  min_decode_tps_per_user: number;
  /** Maximum acceptable Time-To-First-Token (ms) */
  max_ttft_ms: number;
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
