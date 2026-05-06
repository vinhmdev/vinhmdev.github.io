# \[Master Architecture Document\] LLM Hardware Estimator & Matchmaking Tool

## 🎯 Project Overview

Currently, estimating costs and choosing hardware configurations (GPU/Mac Unified) to deploy open-source LLMs (Llama 3, Mixtral, Qwen...) relies heavily on gut feeling or trial-and-error setups.

To solve this, we are building a completely open-source **LLM Hardware Profiler Tool** running directly in the browser (using React + Web Workers for privacy). This engine will act as an Inference Capacity Planning Engine governed by the Roofline Model of performance.

## 🧠 The Core Philosophy: Parameter-Driven Architecture

The core logic of this tool is **strictly parameter-driven**. Instead of hardcoding specific models to specific hardware, the engine abstracts *everything* into raw mathematical constraints.

Because everything is a parameter, the tool unlocks a highly flexible **3-way calculation system**:

1.  **Forward (Performance Forecasting):** Input Model + Existing Server -> Calculate required VRAM & Token generation speed.

2.  **Backward (Hardware Reverse-engineering / Matchmaking):** Input Model + Traffic + Target SLA -> Recommend the most cost-effective hardware setup.

3.  **Model Discovery (Constraint-based):** Input Existing Hardware + Traffic -> Recommend the maximum open-source model specifications you can run.

## 📦 1. Input Parameters Dictionary (Dev Mapping Tables)

*Dev Note: Use the variable names below to build your state/forms. Users can select a pre-configured model from a "Preset Library" to auto-fill Group 1, or input them manually.*

### Group 1: Model Specifications (Structural Dimensions)

| Variable Name        | Symbol       | Data Type | Unit      | Description                                                                             |
| -------------------- | ------------ | --------- | --------- | --------------------------------------------------------------------------------------- |
| `total_params`       | $P_{total}$  | Float     | Billions  | Total size of the neural network (e.g., 8, 70).                                         |
| `active_params`      | $P_{active}$ | Float     | Billions  | Specific to MoE (e.g., Mixtral 8x7B is 47 total, but 13 active). Dictates Decode speed. |
| `hidden_size`        | $d_{model}$  | Integer   | Dimension | The width of the neural network (e.g., 4096).                                           |
| `num_layers`         | $L$          | Integer   | Count     | The depth of the network (e.g., 32).                                                    |
| `num_query_heads`    | $n_q$        | Integer   | Count     | Number of Query Heads.                                                                  |
| `num_kv_heads`       | $n_{kv}$     | Integer   | Count     | Number of Key/Value Heads. (If MHA, $n_{kv} = n_q$. If GQA, $n_{kv} < n_q$).            |
| `vocab_size`         | $V$          | Integer   | Tokens    | Size of the vocabulary (e.g., Qwen-2.5 has 152000). Adds massive VRAM overhead.         |
| `max_context_window` | N/A          | Integer   | Tokens    | The model's max designed context limit (e.g., 128000).                                  |

### Group 2: Hardware Capabilities (Loaded from DB)

*Dev Note: These parameters are strictly pulled from the JSON Database, not inputted by the user.*

| Variable Name           | Data Type | Unit    | Description                                              |
| ----------------------- | --------- | ------- | -------------------------------------------------------- |
| `vram_total_gb`         | Float     | GB      | The hard physical limit of the memory.                   |
| `os_allocatable_factor` | Float     | % (0-1) | OS ring-fence factor (Apple=0.75, NV/Linux=0.95).        |
| `raw_bandwidth_gbps`    | Float     | GB/s    | The "lifeblood" determining Output Decode speed.         |
| `compute_tflops_fp16`   | Float     | TFLOPS  | Determines initial prompt reading speed.                 |
| `bandwidth_utilization` | Float     | % (0-1) | Hardware empirical efficiency (~0.60 to ~0.85).          |
| `mfu_factor`            | Float     | % (0-1) | Model FLOPs Utilization (~0.30 to ~0.50).                |
| `interconnect_penalty`  | Float     | % (0-1) | Penalty for Tensor Parallelism (NVLink=0.98, PCIe=0.80). |

### Group 3: Runtime / Inference Configs (UI Controls)

| Variable Name          | Data Type | Enum Options / Unit                    | Description                                            |
| ---------------------- | --------- | -------------------------------------- | ------------------------------------------------------ |
| `weight_quantization`  | String    | `FP16`, `INT8`, `INT4`, `Q4_K_M`, etc. | Maps to `Bytes_per_Param` in Appendix A.               |
| `kv_quantization`      | String    | `FP16`, `FP8`                          | Maps to `Bytes_per_KV_Param` (2.0 or 1.0).             |
| `context_length_limit` | Integer   | Tokens                                 | Max context actively allowed by the server at runtime. |
| `inference_engine`     | String    | `Standard_HF`, `vLLM`                  | Affects memory fragmentation buffer (30% vs 4%).       |

### Group 4: Traffic & Workload (The Constraints)

| Variable Name          | Data Type | Unit   | Description                                            |
| ---------------------- | --------- | ------ | ------------------------------------------------------ |
| `max_concurrent_reqs`  | Integer   | Users  | "Batch Size" at peak traffic.                          |
| `avg_input_tokens`     | Integer   | Tokens | Average prompt length (impacts Prefill compute load).  |
| `avg_output_tokens`    | Integer   | Tokens | Generated response length (impacts Decode bandwidth).  |
| `shared_prefix_length` | Integer   | Tokens | How many tokens are identical across concurrent users. |

## 🧮 2. The Core Heuristic Formulas (The Math Engine)

### A. Total VRAM Estimation

$$V_{total} = V_{weights} + V_{KV\_total} + V_{overhead}$$

-   **Model Weights:** $V_{weights} \approx P_{total} \times \text{Bytes\_per\_Param}$

-   **KV Cache per Token:** $V_{KV\_token} = 2 \times L \times n_{kv} \times d_{head} \times \text{Bytes\_per\_KV\_Param}$ (where $d_{head} = d_{model} / n_q$)

-   **Total KV Cache:** $V_{KV\_total} = V_{KV\_token} \times \text{Batch Size} \times \text{Total Active Context Limit}$

-   **Overhead:** Statically allocate $\sim 1.2\text{GB}$ to $1.5\\text{GB}$ per GPU for PyTorch/CUDA contexts, plus a fragmentation buffer.

### B. Speed Estimation (Roofline Model)

1.  **Prefill Phase (Compute-Bound):**

    $$\text{Prefill Time} \approx \frac{2 \times P_{active} \times \text{Input Tokens} \times \text{Batch Size}}{\text{Effective Hardware TFLOPS}}$$
2.  **Decode Phase (Memory-Bound):**

    $$\text{Bytes accessed per token} = (P_{active} \times \text{Bytes\_per\_Param}) + V_{KV\_total}$$$$\text{System Speed (Tokens/s)} \approx \frac{\text{Effective Memory Bandwidth}}{\text{Bytes accessed per token}}$$$$\text{Decode Speed (Tokens/s/User)} = \frac{\text{System Speed}}{\text{Batch Size}}$$

## 🚦 3. Real-World Edge Cases (The "Secret Sauce")

To make this tool production-grade, the engine must account for these modern optimization techniques (built as UI toggles):

1.  **Memory Fragmentation & PagedAttention (vLLM):** \* *Math Shift:* Standard pipelines waste up to 30% VRAM to fragmentation. PagedAttention drops this to ~4%.

    -   *Integration:* If vLLM/TGI is selected, shrink the VRAM fragmentation overhead buffer to 5%.

2.  **Automatic Prefix Caching (APC):**

    -   *Math Shift:* Instead of computing a 2,000-token system prompt 50 times for 50 users, compute it once.

    -   *Integration:* Subtract the *Shared Prefix Length* from the Prefill Compute load for subsequent requests, and allocate the KV Cache VRAM for those prefix tokens only once.

3.  **Speculative Decoding:**

    -   *Math Shift:* Trades Compute for Memory Bandwidth using a "Draft Model".

    -   *Integration:* Add Draft Model parameters to $V_{weights}$, but multiply final Decode Speed by an Acceptance Rate (~1.5x to ~2.2x).

4.  **Interconnect Penalties (Tensor Parallelism):**

    -   *Math Shift:* Pooling VRAM across GPUs requires syncing tensors.

    -   *Integration:* 2x RTX 4090s (PCIe 4.0) = penalize Bandwidth by ~15-20%. 2x A100s (NVLink) = penalize by only ~2-5%.

5.  **Chunked Prefill:**

    -   *Math Shift:* Prevents massive TTFT spikes when a new user submits a huge prompt by breaking it into blocks (e.g., 512 tokens).

    -   *Integration:* Caps maximum TTFT and smooths out the Decode SLA across the concurrent batch.

## 🔄 4. Tool Execution Flow & Matchmaking Algorithm

For **Mode 2 (Hardware Matchmaking)**, the engine will NOT try to solve an algebraic inverse equation due to non-linearity. Instead, it operates as a **Constraint Satisfaction Problem (CSP)**:

1.  The app loads a hardcoded JSON database of standard setups (e.g., Mac Studio 128GB, 1x RTX 4090, 8x H100) along with estimated hourly CapEx/OpEx.

2.  The user inputs Model + SLA Requirements + Traffic constraints.

3.  The Web Worker loops through the hardware database and simulates Mode 1 for each configuration.

4.  The engine discards setups that trigger OOM or fail the SLA limits.

5.  The UI sorts the remaining viable setups by lowest Cost and presents them to the user.

## 🛠️ Appendix A: Developer Implementation Guide & Empirical Constants

This appendix contains the deterministic constants, JSON schemas, and architectural limits required to build the core Math Engine. Do not use "theoretical" or marketing numbers; strictly adhere to the empirical baselines below to avoid OOM errors in production.

### 1\. Constants Lookup Table (`Constants.ts`)

**A. Empirical Bytes-per-Parameter (Weights)** Use these values as the safe "ceiling" multiplier for $V_{weights}$ calculation:

-   `FP16 / BF16 / FP32` (Unquantized): **2.00**

-   `INT8 / FP8` (8-bit): **1.05** *(Accounts for scaling metadata)*

-   `AWQ / GPTQ / EXL2` (4-bit): **0.60** *(Absorbs group size overhead & FP16 lm\_head)*

-   `GGUF Q4_K_M`: **0.62**

-   `GGUF Q5_K_M`: **0.72**

-   `GGUF Q8_0`: **1.10**

**B. KV Cache Constants**

-   `Bytes_per_KV_Param`: Default to **2.00** (FP16). Only switch to **1.00** if the user explicitly toggles FP8 KV Cache.

### 2\. Hardware Database JSON Schema (`HardwareDB.json`)

Use this exact structure for the Constraint Satisfaction Problem (CSP) matchmaking engine.

```
{
  "hardware_id": "mac_studio_m2_ultra_192",
  "display_name": "Mac Studio M2 Ultra (192GB)",
  "vendor": "Apple",
  "arch_class": "apple_silicon",      // Enums: datacenter | consumer | apple_silicon
  "gpu_count": 1,

  "specs": {
    "vram_total_gb": 192.0,
    "raw_bandwidth_gbps": 800.0,
    "compute_tflops_fp16": 134.0      // Use Dense TFLOPS only
  },

  "empirical_constraints": {
    "os_vram_allocatable_factor": 0.75, // Apple=0.75, Linux/NV=0.95
    "bandwidth_utilization": 0.65,      // Maps to Decode Speed
    "mfu_factor": 0.30,                 // Maps to Prefill Speed
    "interconnect_penalty": 1.0         // Unified=1.0, NVLink=0.98, PCIe=0.80
  },

  "economics": {
    "est_hourly_cost_usd": 2.50         // Used by the Mode 2 CSP to sort optimal ROI
  }
}
```

### 3\. Continuous Batching (Steady-State Peak Load Engine)

Do NOT build a Monte Carlo temporal simulator. Model continuous batching as follows:

-   **UI Terminology:** Frame "Batch Size" conceptually as **"Max Concurrent Requests"**.

-   **Peak VRAM Logic:**

    $$V_{total} = V_{weights} + (\text{Max Concurrent} \times \text{Avg Context} \times \text{KV\_Bytes\_per\_Token})$$

    *Note: Set the memory fragmentation buffer to a strictly low **0.04 (4%)** due to PagedAttention.*

-   **Throughput Logic:** Continuous batching perfectly interleaves tokens. Calculate the Total System Decode Speed (Tokens/s) using the Effective Bandwidth, then:

    $$\text{Decode Speed per User} = \frac{\text{Total System Decode Speed}}{\text{Max Concurrent Requests}}$$

### 4\. Empirical Efficiency Multipliers

Map these directly to the `arch_class` in the Hardware DB.

| Architecture Class | Hardware Example      | Bandwidth Utilization ($\eta_{bw}$) | MFU Factor ($\eta_{compute}$) |
| ------------------ | --------------------- | ----------------------------------- | ----------------------------- |
| **Datacenter**     | Nvidia H100, A100     | 0.80 - 0.85                         | 0.45 - 0.50                   |
| **Consumer**       | Nvidia RTX 4090, 3090 | 0.70 - 0.75                         | 0.35 - 0.40                   |
| **Apple Silicon**  | M-Series Max / Ultra  | 0.60 - 0.65                         | 0.30 - 0.35                   |

_(End of Document)_