/**
 * app.ts — Entry point for LLM Hardware Profiler.
 *
 * Phase 1: theme, i18n, data loading, preset dropdowns, mode selector
 * Phase 2: runForward() + runQuantComparison() wired to UI & live updates
 * Phase 3: runMatchmaking() + runDiscovery() + runPresetDiscovery() wired to mode tabs
 */
import { init as initI18n, t } from './i18n-client';
import { initTheme } from '@shared/theme/toggle';
import {
  runForward,
  runQuantComparison,
  runOSComparison,
  runMatchmaking,
  runDiscovery,
  runPresetDiscovery,
} from './math-engine';
import type {
  ModelPreset,
  HardwareSpec,
  ModelSpec,
  RuntimeConfig,
  WorkloadSpec,
  AdvancedOpts,
  SLAConstraints,
  ForwardResult,
  QuantComparisonRow,
  OSComparisonRow,
  MatchResult,
  ModelConstraints,
  PresetDiscoveryRow,
  QuantizationType,
  KvQuantType,
  InferenceEngine,
  OSProfile,
  MultiGpuMode,
  SystemRamTier,
  VendorFilter,
  ArchFilter,
  MatchSortBy,
} from './types';

// ─── Data ─────────────────────────────────────────────────────────────────────

let modelPresets: ModelPreset[] = [];
let hardwareDB: HardwareSpec[] = [];

async function loadData(): Promise<void> {
  const [mRes, hRes] = await Promise.all([
    fetch(new URL('../data/model-presets.json', import.meta.url).href),
    fetch(new URL('../data/hardware-db.json', import.meta.url).href),
  ]);
  modelPresets = await mRes.json();
  hardwareDB = await hRes.json();
}

// ─── Dropdown population ──────────────────────────────────────────────────────

function populateModelDropdown(): void {
  const sel = document.getElementById('model-preset') as HTMLSelectElement;
  const families: Record<string, ModelPreset[]> = {};
  modelPresets.forEach((m) => {
    if (!families[m.family]) families[m.family] = [];
    families[m.family].push(m);
  });

  Object.entries(families).forEach(([family, items]) => {
    const grp = document.createElement('optgroup');
    grp.label = family;
    items.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.model_id;
      opt.textContent = m.display_name;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });
}

function buildHardwareOptgroups(db: HardwareSpec[]): DocumentFragment {
  const groups: Record<string, HardwareSpec[]> = {
    apple_silicon: [],
    consumer: [],
    workstation: [],
    datacenter: [],
  };
  db.forEach((h) => groups[h.arch_class]?.push(h));
  const labels: Record<string, string> = {
    apple_silicon: '🍎 Apple Silicon (Unified RAM)',
    consumer: '🖥 Consumer GPU (NVIDIA / AMD / Intel)',
    workstation: '🔧 Workstation & Cloud Inference',
    datacenter: '🏢 Datacenter Server (NVIDIA / AMD)',
  };
  const frag = document.createDocumentFragment();
  Object.entries(groups).forEach(([cls, items]) => {
    if (!items.length) return;
    const grp = document.createElement('optgroup');
    grp.label = labels[cls] ?? cls;
    items.forEach((h) => {
      const opt = document.createElement('option');
      opt.value = h.hardware_id;
      opt.textContent = `${h.display_name} [${h.vendor}]`;
      grp.appendChild(opt);
    });
    frag.appendChild(grp);
  });
  return frag;
}

function populateHardwareDropdown(): void {
  const sel1 = document.getElementById('hardware-preset') as HTMLSelectElement;
  const sel2 = document.getElementById('hardware-preset-discovery') as HTMLSelectElement;
  if (sel1) sel1.appendChild(buildHardwareOptgroups(hardwareDB));
  if (sel2) sel2.appendChild(buildHardwareOptgroups(hardwareDB));
}

// ─── Preset auto-fill ─────────────────────────────────────────────────────────

function fillModelFields(m: ModelPreset): void {
  (document.getElementById('total-params') as HTMLInputElement).value = String(m.total_params);
  (document.getElementById('active-params') as HTMLInputElement).value = String(m.active_params);
  (document.getElementById('hidden-size') as HTMLInputElement).value = String(m.hidden_size);
  (document.getElementById('num-layers') as HTMLInputElement).value = String(m.num_layers);
  (document.getElementById('num-query-heads') as HTMLInputElement).value = String(
    m.num_query_heads
  );
  (document.getElementById('num-kv-heads') as HTMLInputElement).value = String(m.num_kv_heads);
  (document.getElementById('vocab-size') as HTMLInputElement).value = String(m.vocab_size);
  (document.getElementById('max-context-window') as HTMLInputElement).value = String(
    m.max_context_window
  );
  // Keep user's active context limit reasonable (default 4096-8192) instead of clobbering to 128k,
  // only clamping down if current context limit exceeds the model's max_context_window.
  const ctxEl = document.getElementById('context-limit') as HTMLInputElement;
  const currentCtx = parseFloat(ctxEl.value) || 4096;
  ctxEl.value = String(Math.min(currentCtx, m.max_context_window));
}

function fillHardwareFields(h: HardwareSpec): void {
  (document.getElementById('vram-total-gb') as HTMLInputElement).value = String(
    h.specs.vram_total_gb
  );
  (document.getElementById('bandwidth-gbps') as HTMLInputElement).value = String(
    h.specs.raw_bandwidth_gbps
  );
  (document.getElementById('compute-tflops') as HTMLInputElement).value = String(
    h.specs.compute_tflops_fp16
  );
  (document.getElementById('gpu-count') as HTMLInputElement).value = String(h.gpu_count);
}

function bindPresetListeners(): void {
  document.getElementById('model-preset')?.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    const preset = modelPresets.find((m) => m.model_id === id);
    if (preset) {
      fillModelFields(preset);
      onCalculate(true);
    }
  });

  document.getElementById('hardware-preset')?.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    const discSel = document.getElementById(
      'hardware-preset-discovery'
    ) as HTMLSelectElement | null;
    if (discSel) discSel.value = id;
    const hw = hardwareDB.find((h) => h.hardware_id === id);
    if (hw) {
      fillHardwareFields(hw);
      onCalculate(true);
    }
  });

  document.getElementById('hardware-preset-discovery')?.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    const hwSel = document.getElementById('hardware-preset') as HTMLSelectElement | null;
    if (hwSel) hwSel.value = id;
    const hw = hardwareDB.find((h) => h.hardware_id === id);
    if (hw) {
      fillHardwareFields(hw);
      onCalculate(true);
    }
  });

  // Live recalculation on any form input or select change
  const inputsPanel = document.querySelector('.input-panel');
  inputsPanel?.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    if (
      target.id === 'model-preset' ||
      target.id === 'hardware-preset' ||
      target.id === 'hardware-preset-discovery'
    ) {
      return;
    }
    if (target.id === 'total-params') {
      const totalVal = parseFloat((target as HTMLInputElement).value);
      const activeEl = document.getElementById('active-params') as HTMLInputElement | null;
      if (activeEl && totalVal > 0 && parseFloat(activeEl.value) > totalVal) {
        activeEl.value = String(totalVal);
      }
    }
    onCalculate(true);
  });
}

// ─── Read form state ──────────────────────────────────────────────────────────

function num(id: string, fallback = 0): number {
  const val = parseFloat((document.getElementById(id) as HTMLInputElement)?.value);
  if (!Number.isFinite(val) || val < 0) return fallback;
  return val || fallback;
}

function str(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement)?.value ?? '';
}

function checked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement)?.checked ?? false;
}

function readModelSpec(): ModelSpec {
  const totalParams = num('total-params');
  const rawActive = num('active-params') || totalParams;
  return {
    total_params: totalParams,
    active_params: totalParams > 0 ? Math.min(totalParams, rawActive) : rawActive,
    hidden_size: num('hidden-size'),
    num_layers: num('num-layers'),
    num_query_heads: num('num-query-heads'),
    num_kv_heads: num('num-kv-heads'),
    vocab_size: num('vocab-size'),
    max_context_window: num('max-context-window', 8192),
  };
}

function readHardwareSpec(): HardwareSpec | null {
  const presetId = str('hardware-preset') || str('hardware-preset-discovery');
  const preset = hardwareDB.find((h) => h.hardware_id === presetId);

  const vram = num('vram-total-gb');
  const bw = num('bandwidth-gbps');
  const tflops = num('compute-tflops');
  const gpuCount = Math.max(1, Math.round(num('gpu-count', 1)));

  if (preset) {
    // Check if the user manually customized the hardware numbers after selecting a preset
    const isUnmodified =
      Math.abs(vram - preset.specs.vram_total_gb) < 0.01 &&
      Math.abs(bw - preset.specs.raw_bandwidth_gbps) < 0.01 &&
      Math.abs(tflops - preset.specs.compute_tflops_fp16) < 0.01 &&
      gpuCount === preset.gpu_count;

    if (isUnmodified) return preset;

    // If user changed GPU count or specs on top of a preset, preserve vendor/arch/constraints
    const interconnectPenalty =
      gpuCount > 1 && preset.gpu_count === 1
        ? preset.arch_class === 'datacenter'
          ? 0.96
          : 0.8
        : gpuCount === 1
          ? 1.0
          : preset.empirical_constraints.interconnect_penalty;

    return {
      ...preset,
      hardware_id: `${preset.hardware_id}_custom`,
      display_name: `${preset.display_name} (Edited)`,
      gpu_count: gpuCount,
      specs: {
        vram_total_gb: vram || preset.specs.vram_total_gb,
        raw_bandwidth_gbps: bw || preset.specs.raw_bandwidth_gbps,
        compute_tflops_fp16: tflops || preset.specs.compute_tflops_fp16,
      },
      empirical_constraints: {
        ...preset.empirical_constraints,
        interconnect_penalty: interconnectPenalty,
      },
    };
  }

  if (!vram || !bw || !tflops) return null;

  return {
    hardware_id: 'custom',
    display_name: 'Custom Hardware',
    vendor: 'Custom',
    arch_class: 'consumer',
    gpu_count: gpuCount,
    specs: {
      vram_total_gb: vram,
      raw_bandwidth_gbps: bw,
      compute_tflops_fp16: tflops,
    },
    empirical_constraints: {
      os_vram_allocatable_factor: 0.95,
      bandwidth_utilization: 0.73,
      mfu_factor: 0.38,
      interconnect_penalty: gpuCount > 1 ? 0.8 : 1.0,
    },
    economics: { est_hourly_cost_usd: 0 },
  };
}

function readRuntimeConfig(): RuntimeConfig {
  return {
    weight_quantization: (str('weight-quant') as QuantizationType) || 'GGUF_Q4_K_M',
    kv_quantization: (str('kv-quant') as KvQuantType) || 'FP16',
    context_length_limit: num('context-limit', 4096),
    inference_engine: (str('inference-engine') as InferenceEngine) || 'vLLM',
    os_profile: (str('os-profile') as OSProfile) || 'auto',
    multi_gpu_mode: (str('multi-gpu-mode') as MultiGpuMode) || 'tensor_parallel',
  };
}

function readWorkloadSpec(): WorkloadSpec {
  return {
    max_concurrent_reqs: num('max-concurrent-reqs', 1),
    avg_input_tokens: num('avg-input-tokens', 512),
    avg_output_tokens: num('avg-output-tokens', 256),
    shared_prefix_length: num('shared-prefix', 0),
  };
}

function readAdvancedOpts(): AdvancedOpts {
  return {
    apc_enabled: checked('toggle-apc'),
    spec_decoding_enabled: checked('toggle-spec-decoding'),
    spec_decoding_draft_params: num('draft-params', 1.5),
    spec_decoding_acceptance_rate: num('acceptance-rate', 1.8),
    chunked_prefill_enabled: checked('toggle-chunked-prefill'),
    chunked_prefill_chunk_size: num('chunk-size', 512),
    ram_offload_enabled: checked('toggle-ram-offload'),
    system_ram_tier: (str('system-ram-tier') as SystemRamTier) || 'ddr5_dual',
    system_ram_gb: num('system-ram-gb', 64),
  };
}

function readSLAConstraints(): SLAConstraints {
  return {
    min_decode_tps_per_user: num('min-tps', 1),
    max_ttft_ms: num('max-ttft', 999999),
    vendor_filter: (str('vendor-filter') as VendorFilter) || 'all',
    arch_filter: (str('arch-filter') as ArchFilter) || 'all',
    sort_by: (str('sort-by') as MatchSortBy) || 'cost_hr',
    max_buy_price_usd: num('max-buy-price', 0),
    max_hourly_cost_usd: num('max-hourly-cost', 0),
  };
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function fmt(n: number, decimals = 1): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed(decimals);
}

function fmtGb(n: number): string {
  return n.toFixed(1) + ' GB';
}

function fmtMs(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 's';
  return Math.round(n) + ' ms';
}

function fmtTokens(n: number): string {
  if (n <= 0) return '0';
  if (n >= 1024) return (n / 1024).toFixed(n >= 16384 ? 0 : 1) + 'k';
  return String(n);
}

function fmtTier(vendor: string, arch: string): string {
  const tierKeys: Record<string, string> = {
    consumer: 'tier_consumer',
    workstation: 'tier_workstation',
    apple_silicon: 'tier_apple_silicon',
    datacenter: 'tier_datacenter',
  };
  const label = tierKeys[arch] ? t(tierKeys[arch]) : arch;
  return `${vendor} · ${label}`;
}

function renderVRAM(vram: ForwardResult['vram']): void {
  const pct = (v: number) =>
    vram.allocatable_gb > 0
      ? Math.min((v / vram.allocatable_gb) * 100, 100).toFixed(1) + '%'
      : '0%';

  // Bar segments
  (document.getElementById('vram-seg-weights') as HTMLElement).style.width = pct(vram.weights_gb);
  (document.getElementById('vram-seg-kv') as HTMLElement).style.width = pct(vram.kv_cache_gb);
  (document.getElementById('vram-seg-overhead') as HTMLElement).style.width = pct(vram.overhead_gb);

  // Legend GB values
  const wVal = document.getElementById('vram-val-weights');
  const kvVal = document.getElementById('vram-val-kv');
  const ovVal = document.getElementById('vram-val-overhead');
  if (wVal) wVal.textContent = fmtGb(vram.weights_gb);
  if (kvVal) kvVal.textContent = fmtGb(vram.kv_cache_gb);
  if (ovVal) ovVal.textContent = fmtGb(vram.overhead_gb);

  // OOM overflow stripe
  const bar = document.getElementById('vram-bar');
  let oomStripe = bar?.querySelector('.vram-bar-overflow') as HTMLElement | null;
  if (vram.is_oom) {
    if (!oomStripe) {
      oomStripe = document.createElement('div');
      oomStripe.className = 'vram-bar-overflow';
      bar?.appendChild(oomStripe);
    }
    oomStripe.style.display = 'block';
  } else if (oomStripe) {
    oomStripe.style.display = 'none';
  }

  // Stats
  (document.getElementById('vram-total') as HTMLElement).textContent = fmtGb(vram.total_gb);
  (document.getElementById('vram-available') as HTMLElement).textContent = fmtGb(
    vram.allocatable_gb
  );
  (document.getElementById('vram-utilization') as HTMLElement).textContent =
    vram.utilization_pct.toFixed(0) + '%';

  const maxUsersEl = document.getElementById('vram-max-users');
  if (maxUsersEl) {
    maxUsersEl.textContent =
      vram.max_concurrent_at_context > 0 ? String(vram.max_concurrent_at_context) : '0 (OOM)';
  }
  const maxCtxEl = document.getElementById('vram-max-context');
  if (maxCtxEl) {
    maxCtxEl.textContent = fmtTokens(vram.max_context_single_user);
  }

  // Status badge (sync data-i18n so language switches preserve OOM/Offload/Fit state)
  const badge = document.getElementById('vram-status-badge') as HTMLElement;
  if (vram.fits_with_offload) {
    badge.className = 'status-badge offload ml-auto';
    badge.removeAttribute('data-i18n');
    badge.textContent = `${t('badge_offload')} (+${fmtGb(vram.offloaded_ram_gb)} RAM)`;
  } else {
    const badgeKey = vram.is_oom ? 'badge_oom' : 'badge_fit';
    badge.className = vram.is_oom ? 'status-badge oom ml-auto' : 'status-badge fit ml-auto';
    badge.setAttribute('data-i18n', badgeKey);
    badge.textContent = t(badgeKey);
  }
}

function renderSpeed(
  speed: ForwardResult['speed'],
  vram: ForwardResult['vram'],
  hw: HardwareSpec
): void {
  (document.getElementById('speed-ttft') as HTMLElement).textContent = vram.is_oom
    ? '—'
    : fmtMs(speed.prefill_ttft_ms);
  (document.getElementById('speed-system-tps') as HTMLElement).textContent = vram.is_oom
    ? '0'
    : fmt(speed.decode_system_tps);
  (document.getElementById('speed-user-tps') as HTMLElement).textContent = vram.is_oom
    ? '0'
    : fmt(speed.decode_per_user_tps);

  const e2eEl = document.getElementById('speed-e2e');
  if (e2eEl) {
    e2eEl.textContent = vram.is_oom ? '—' : speed.e2e_latency_s.toFixed(1);
  }

  const regimeBadge = document.getElementById('speed-regime-badge');
  if (regimeBadge) {
    const regimeKey =
      speed.bottleneck_regime === 'ram_offload_bound'
        ? 'regime_ram_offload_bound'
        : speed.bottleneck_regime === 'compute_bound'
          ? 'regime_compute_bound'
          : 'regime_memory_bound';
    regimeBadge.setAttribute('data-i18n', regimeKey);
    regimeBadge.textContent = t(regimeKey);
  }

  const effSummary = document.getElementById('effective-hw-summary');
  if (effSummary) {
    const osShortNames: Record<string, string> = {
      linux_headless: 'Linux Headless',
      linux_gui: 'Linux Desktop',
      windows_wsl2: 'Windows WSL2',
      windows_native: 'Windows Native WDDM',
      macos_default: 'macOS Default',
      macos_tuned: 'macOS sysctl Tuned',
    };
    const allocPct =
      hw.specs.vram_total_gb > 0
        ? Math.round((vram.allocatable_gb / hw.specs.vram_total_gb) * 100)
        : 0;
    const osName = osShortNames[vram.effective_os_profile] ?? vram.effective_os_profile;
    const pwr = hw.economics.power_watts ? ` · ${hw.economics.power_watts}W TDP` : '';
    const offloadNote = vram.fits_with_offload
      ? ` · +${fmtGb(vram.offloaded_ram_gb)} System RAM`
      : '';
    effSummary.textContent = `${osName} (${allocPct}% alloc) · ${speed.effective_engine} · ${speed.effective_bw_gbps.toFixed(0)} GB/s eff · ${speed.effective_tflops.toFixed(1)} TFLOPS eff${pwr}${offloadNote}`;
  }
}

function renderQuantMatrix(rows: QuantComparisonRow[], activeQuant: QuantizationType): void {
  const tbody = document.getElementById('quant-matrix-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row' + (r.quant === activeQuant ? ' best-roi' : '');
    tr.title = 'Click to apply this quantization';

    const statusBadge = r.vram.is_oom
      ? `<span class="status-badge oom badge-sm">${t('badge_oom')}</span>`
      : r.vram.fits_with_offload
        ? `<span class="status-badge offload badge-sm">+${fmtGb(r.vram.offloaded_ram_gb)} RAM</span>`
        : `<span class="status-badge fit badge-sm">${r.vram.utilization_pct.toFixed(0)}%</span>`;

    tr.innerHTML = `
      <td>
        <strong>${r.label}</strong>
        <span class="text-muted text-xs">(${r.bytes_per_param.toFixed(2)} B/p)</span>
      </td>
      <td>${fmtGb(r.vram.weights_gb)}</td>
      <td>${fmtGb(r.vram.total_gb)} / ${fmtGb(r.vram.allocatable_gb)}</td>
      <td>${statusBadge}</td>
      <td>${r.vram.is_oom ? '—' : fmt(r.speed.decode_per_user_tps)}</td>
      <td>${r.vram.is_oom ? '—' : fmtTokens(r.vram.max_context_single_user)}</td>
    `;

    tr.addEventListener('click', () => {
      const sel = document.getElementById('weight-quant') as HTMLSelectElement | null;
      if (sel) {
        sel.value = r.quant;
        onCalculate(false);
      }
    });

    tbody.appendChild(tr);
  });
}

function renderOSMatrix(rows: OSComparisonRow[], activeOS: Exclude<OSProfile, 'auto'>): void {
  const tbody = document.getElementById('os-matrix-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const osKeyMap: Record<Exclude<OSProfile, 'auto'>, string> = {
    linux_headless: 'os_linux_headless',
    linux_gui: 'os_linux_gui',
    windows_wsl2: 'os_windows_wsl2',
    windows_native: 'os_windows_native',
    macos_default: 'os_macos_default',
    macos_tuned: 'os_macos_tuned',
  };

  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row' + (r.os_profile === activeOS ? ' best-roi' : '');
    tr.title = 'Click to apply this OS profile';

    const statusBadge = r.vram.is_oom
      ? `<span class="status-badge oom badge-sm">${t('badge_oom')}</span>`
      : r.vram.fits_with_offload
        ? `<span class="status-badge offload badge-sm">+${fmtGb(r.vram.offloaded_ram_gb)} RAM</span>`
        : `<span class="status-badge fit badge-sm">${r.vram.utilization_pct.toFixed(0)}%</span>`;

    tr.innerHTML = `
      <td><strong>${t(osKeyMap[r.os_profile] ?? r.os_profile)}</strong></td>
      <td>${fmtGb(r.vram.allocatable_gb)}</td>
      <td>${statusBadge}</td>
      <td>${r.vram.is_oom ? '—' : fmt(r.speed.decode_per_user_tps)}</td>
      <td>${r.vram.max_concurrent_at_context > 0 ? r.vram.max_concurrent_at_context : '0'}</td>
      <td>${r.vram.is_oom ? '—' : fmtTokens(r.vram.max_context_single_user)}</td>
    `;

    tr.addEventListener('click', () => {
      const sel = document.getElementById('os-profile') as HTMLSelectElement | null;
      if (sel) {
        sel.value = r.os_profile;
        onCalculate(false);
      }
    });

    tbody.appendChild(tr);
  });
}

function showResultsPanel(mode: Mode): void {
  document.getElementById('results-empty')?.classList.add('hidden');
  document.getElementById('results-content')?.classList.remove('hidden');

  const vramCard = document.getElementById('result-vram');
  const speedCard = document.getElementById('result-speed');
  const quantCard = document.getElementById('result-quant-matrix');
  const osCard = document.getElementById('result-os-matrix');
  const matchCard = document.getElementById('result-matchmaking');
  const discovCard = document.getElementById('result-discovery');
  const discovPresetsCard = document.getElementById('result-discovery-presets');

  vramCard?.classList.toggle('hidden', mode !== 'forward');
  speedCard?.classList.toggle('hidden', mode !== 'forward');
  quantCard?.classList.toggle('hidden', mode !== 'forward');
  osCard?.classList.toggle('hidden', mode !== 'forward');
  matchCard?.classList.toggle('hidden', mode !== 'matchmaking');
  discovCard?.classList.toggle('hidden', mode !== 'discovery');
  discovPresetsCard?.classList.toggle('hidden', mode !== 'discovery');
}

function renderMatchmaking(results: MatchResult[]): void {
  const tbody = document.getElementById('match-table-body') as HTMLElement;
  const noResult = document.getElementById('match-no-result') as HTMLElement;
  const matchTable = document.getElementById('match-table') as HTMLElement;
  const countBadge = document.getElementById('match-count-badge');

  tbody.innerHTML = '';
  if (countBadge) countBadge.textContent = `${results.length}`;

  if (results.length === 0) {
    matchTable.classList.add('hidden');
    noResult.classList.remove('hidden');
    return;
  }

  matchTable.classList.remove('hidden');
  noResult.classList.add('hidden');

  const bestROI = results.reduce(
    (best, r) => (r.roi_score > best.roi_score ? r : best),
    results[0]
  );
  const fastest = results.reduce(
    (best, r) =>
      r.result.speed.decode_per_user_tps > best.result.speed.decode_per_user_tps ? r : best,
    results[0]
  );
  const cheapestBuy = results.reduce((best, r) => {
    const p1 = r.hardware.economics.purchase_price_usd ?? Number.MAX_SAFE_INTEGER;
    const p2 = best.hardware.economics.purchase_price_usd ?? Number.MAX_SAFE_INTEGER;
    return p1 < p2 ? r : best;
  }, results[0]);

  results.forEach((r) => {
    const isBestRoi = r.hardware.hardware_id === bestROI.hardware.hardware_id;
    const isFastest =
      r.hardware.hardware_id === fastest.hardware.hardware_id && !isBestRoi && results.length > 1;
    const isCheapestBuy =
      r.hardware.hardware_id === cheapestBuy.hardware.hardware_id &&
      !isBestRoi &&
      !isFastest &&
      results.length > 2;

    const tr = document.createElement('tr');
    tr.className = 'clickable-row' + (isBestRoi ? ' best-roi' : '');
    tr.title = 'Click to inspect this hardware in Forward Mode';

    const buyPrice = r.hardware.economics.purchase_price_usd
      ? `$${r.hardware.economics.purchase_price_usd.toLocaleString()}`
      : '—';

    let badges = '';
    if (isBestRoi) badges += ` <span class="badge-roi">${t('badge_best_roi')}</span>`;
    if (isFastest) badges += ` <span class="badge-roi">${t('badge_fastest')}</span>`;
    if (isCheapestBuy) badges += ` <span class="badge-roi">${t('badge_cheapest_buy')}</span>`;

    tr.innerHTML = `
      <td>
        <strong>${r.hardware.display_name}</strong>${badges}
      </td>
      <td class="text-muted">${fmtTier(r.hardware.vendor, r.hardware.arch_class)}</td>
      <td style="color:${r.result.vram.utilization_pct > 90 ? 'var(--profiler-warning)' : 'inherit'}">
        ${r.result.vram.utilization_pct.toFixed(0)}% (${fmtGb(r.result.vram.total_gb)}/${fmtGb(r.result.vram.allocatable_gb)})
      </td>
      <td><strong>${fmt(r.result.speed.decode_per_user_tps)}</strong> <span class="text-muted">(${fmt(r.result.speed.decode_system_tps)} sys)</span></td>
      <td>${fmtMs(r.result.speed.prefill_ttft_ms)}</td>
      <td>${buyPrice}</td>
      <td>$${r.hardware.economics.est_hourly_cost_usd.toFixed(2)}</td>
      <td>${r.roi_score.toFixed(1)}</td>
    `;

    tr.addEventListener('click', () => {
      const hwSel = document.getElementById('hardware-preset') as HTMLSelectElement | null;
      const hwDiscSel = document.getElementById(
        'hardware-preset-discovery'
      ) as HTMLSelectElement | null;
      if (hwSel) hwSel.value = r.hardware.hardware_id;
      if (hwDiscSel) hwDiscSel.value = r.hardware.hardware_id;
      fillHardwareFields(r.hardware);
      setMode('forward');
    });

    tbody.appendChild(tr);
  });
}

function renderDiscovery(c: ModelConstraints, presetRows: PresetDiscoveryRow[]): void {
  (document.getElementById('discovery-max-params') as HTMLElement).textContent =
    c.max_params_b.toFixed(1) + 'B';
  (document.getElementById('discovery-hidden') as HTMLElement).textContent = String(
    c.est_hidden_size
  );
  (document.getElementById('discovery-layers') as HTMLElement).textContent = String(
    c.est_num_layers
  );

  const bottleneckKey =
    c.bottleneck === 'weights'
      ? 'bottleneck_weights'
      : c.bottleneck === 'kv_cache'
        ? 'bottleneck_kv_cache'
        : 'bottleneck_both';
  const bottleneckEl = document.getElementById('discovery-bottleneck') as HTMLElement;
  bottleneckEl.setAttribute('data-i18n', bottleneckKey);
  bottleneckEl.textContent = t(bottleneckKey);
  (document.getElementById('discovery-quant') as HTMLElement).textContent = c.recommended_quant;

  // Render compatible open-source presets table
  const tbody = document.getElementById('discovery-presets-body');
  const table = document.getElementById('discovery-presets-table');
  const emptyMsg = document.getElementById('discovery-no-presets');
  const countBadge = document.getElementById('discovery-presets-count');

  if (!tbody || !table || !emptyMsg) return;
  tbody.innerHTML = '';
  if (countBadge) countBadge.textContent = `${presetRows.length}`;

  if (presetRows.length === 0) {
    table.classList.add('hidden');
    emptyMsg.classList.remove('hidden');
    return;
  }

  table.classList.remove('hidden');
  emptyMsg.classList.add('hidden');

  presetRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row' + (idx === 0 ? ' best-roi' : '');
    tr.title = 'Click to inspect this model in Forward Mode';

    const paramsDesc =
      row.preset.active_params < row.preset.total_params
        ? `${row.preset.total_params}B (${row.preset.active_params}B active)`
        : `${row.preset.total_params}B`;

    tr.innerHTML = `
      <td><strong>${row.preset.display_name}</strong></td>
      <td>${paramsDesc}</td>
      <td>
        <span class="status-badge ${row.fits_current_quant ? 'fit' : 'oom'} badge-sm">
          ${row.active_quant}
        </span>
      </td>
      <td>${row.result.vram.utilization_pct.toFixed(0)}% (${fmtGb(row.result.vram.total_gb)}/${fmtGb(row.result.vram.allocatable_gb)})</td>
      <td><strong>${fmt(row.result.speed.decode_per_user_tps)}</strong></td>
      <td>${fmtMs(row.result.speed.prefill_ttft_ms)}</td>
    `;

    tr.addEventListener('click', () => {
      const mSel = document.getElementById('model-preset') as HTMLSelectElement | null;
      if (mSel) mSel.value = row.preset.model_id;
      fillModelFields(row.preset);
      const qSel = document.getElementById('weight-quant') as HTMLSelectElement | null;
      if (qSel) qSel.value = row.active_quant;
      setMode('forward');
    });

    tbody.appendChild(tr);
  });
}

// ─── Mode selector ────────────────────────────────────────────────────────────

type Mode = 'forward' | 'matchmaking' | 'discovery';

const MODE_DESC_KEY: Record<Mode, string> = {
  forward: 'mode_forward_desc',
  matchmaking: 'mode_matchmaking_desc',
  discovery: 'mode_discovery_desc',
};
const BTN_LABEL_KEY: Record<Mode, string> = {
  forward: 'btn_calculate',
  matchmaking: 'btn_find_hw',
  discovery: 'btn_discover',
};

let activeMode: Mode = 'forward';

function setMode(mode: Mode): void {
  activeMode = mode;
  (['forward', 'matchmaking', 'discovery'] as Mode[]).forEach((m) => {
    const btn = document.getElementById(`mode-btn-${m}`);
    btn?.setAttribute('data-active', String(m === mode));
    btn?.setAttribute('aria-selected', String(m === mode));
  });

  const desc = document.getElementById('mode-desc');
  if (desc) {
    desc.setAttribute('data-i18n', MODE_DESC_KEY[mode]);
    desc.textContent = t(MODE_DESC_KEY[mode]);
  }

  const modelSection = document.getElementById('section-model');
  modelSection?.classList.toggle('hidden', mode === 'discovery');

  const hwSection = document.getElementById('section-hardware');
  hwSection?.classList.toggle('hidden', mode === 'matchmaking');

  const slaSection = document.getElementById('section-sla');
  slaSection?.classList.toggle('hidden', mode !== 'matchmaking');

  const btnLabel = document.getElementById('btn-calculate-label');
  if (btnLabel) {
    btnLabel.setAttribute('data-i18n', BTN_LABEL_KEY[mode]);
    btnLabel.textContent = t(BTN_LABEL_KEY[mode]);
  }

  // Immediately run calculation for the newly selected mode if inputs are ready
  onCalculate(true);
}

function bindModeSwitcher(): void {
  (['forward', 'matchmaking', 'discovery'] as Mode[]).forEach((mode) => {
    document.getElementById(`mode-btn-${mode}`)?.addEventListener('click', () => setMode(mode));
  });
}

// ─── Advanced toggle sub-fields ───────────────────────────────────────────────

function bindAdvancedToggles(): void {
  const specToggle = document.getElementById('toggle-spec-decoding') as HTMLInputElement;
  const specFields = document.getElementById('spec-decoding-fields');
  specToggle?.addEventListener('change', () =>
    specFields?.classList.toggle('hidden', !specToggle.checked)
  );

  const chunkedToggle = document.getElementById('toggle-chunked-prefill') as HTMLInputElement;
  const chunkedFields = document.getElementById('chunked-prefill-fields');
  chunkedToggle?.addEventListener('change', () =>
    chunkedFields?.classList.toggle('hidden', !chunkedToggle.checked)
  );

  const ramToggle = document.getElementById('toggle-ram-offload') as HTMLInputElement;
  const ramFields = document.getElementById('ram-offload-fields');
  ramToggle?.addEventListener('change', () =>
    ramFields?.classList.toggle('hidden', !ramToggle.checked)
  );
}

// ─── URL Permalink Serialization ──────────────────────────────────────────────

function buildShareUrl(): string {
  const url = new URL(window.location.href);
  const p = url.searchParams;
  p.set('mode', activeMode);
  const mPreset = str('model-preset');
  const hPreset = str('hardware-preset');
  if (mPreset) p.set('model', mPreset);
  if (hPreset) p.set('hw', hPreset);
  p.set('os', str('os-profile') || 'auto');
  p.set('wq', str('weight-quant') || 'GGUF_Q4_K_M');
  p.set('kvq', str('kv-quant') || 'FP16');
  p.set('ctx', String(num('context-limit', 4096)));
  p.set('eng', str('inference-engine') || 'vLLM');
  p.set('mgpu', str('multi-gpu-mode') || 'tensor_parallel');
  p.set('reqs', String(num('max-concurrent-reqs', 4)));
  if (checked('toggle-ram-offload')) {
    p.set('offload', '1');
    p.set('ram_tier', str('system-ram-tier') || 'ddr5_dual');
    p.set('ram_gb', String(num('system-ram-gb', 64)));
  } else {
    p.delete('offload');
    p.delete('ram_tier');
    p.delete('ram_gb');
  }
  return url.toString();
}

function restoreFromQuery(): Mode | null {
  const p = new URLSearchParams(window.location.search);
  if (!p.toString()) return null;

  const mId = p.get('model');
  if (mId) {
    const preset = modelPresets.find((m) => m.model_id === mId);
    const mSel = document.getElementById('model-preset') as HTMLSelectElement | null;
    if (preset && mSel) {
      mSel.value = preset.model_id;
      fillModelFields(preset);
    }
  }

  const hId = p.get('hw');
  if (hId) {
    const hw = hardwareDB.find((h) => h.hardware_id === hId);
    const hSel = document.getElementById('hardware-preset') as HTMLSelectElement | null;
    const hDisc = document.getElementById('hardware-preset-discovery') as HTMLSelectElement | null;
    if (hw) {
      if (hSel) hSel.value = hw.hardware_id;
      if (hDisc) hDisc.value = hw.hardware_id;
      fillHardwareFields(hw);
    }
  }

  const setSelectOrInput = (id: string, param: string) => {
    const val = p.get(param);
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (val && el) el.value = val;
  };

  setSelectOrInput('os-profile', 'os');
  setSelectOrInput('weight-quant', 'wq');
  setSelectOrInput('kv-quant', 'kvq');
  setSelectOrInput('context-limit', 'ctx');
  setSelectOrInput('inference-engine', 'eng');
  setSelectOrInput('multi-gpu-mode', 'mgpu');
  setSelectOrInput('max-concurrent-reqs', 'reqs');

  if (p.get('offload') === '1') {
    const ramToggle = document.getElementById('toggle-ram-offload') as HTMLInputElement | null;
    const ramFields = document.getElementById('ram-offload-fields');
    if (ramToggle) {
      ramToggle.checked = true;
      ramFields?.classList.remove('hidden');
    }
    setSelectOrInput('system-ram-tier', 'ram_tier');
    setSelectOrInput('system-ram-gb', 'ram_gb');
  }

  const modeParam = p.get('mode');
  if (modeParam === 'forward' || modeParam === 'matchmaking' || modeParam === 'discovery') {
    return modeParam;
  }
  return null;
}

// ─── Calculate handler ────────────────────────────────────────────────────────

function onCalculate(silent = false): void {
  const rt = readRuntimeConfig();
  if (!rt.context_length_limit) {
    if (!silent) showToast(t('toast_no_input'));
    return;
  }
  const wl = readWorkloadSpec();
  const opts = readAdvancedOpts();

  if (activeMode === 'forward') {
    const model = readModelSpec();
    const hw = readHardwareSpec();
    if (!model.total_params || !model.hidden_size || !model.num_layers || !hw) {
      if (!silent) showToast(t('toast_no_input'));
      return;
    }
    const result = runForward(model, hw, rt, wl, opts);
    const quantRows = runQuantComparison(model, hw, rt, wl, opts);
    const osRows = runOSComparison(model, hw, rt, wl, opts);
    showResultsPanel('forward');
    renderVRAM(result.vram);
    renderSpeed(result.speed, result.vram, hw);
    renderQuantMatrix(quantRows, rt.weight_quantization);
    renderOSMatrix(osRows, result.vram.effective_os_profile);
  } else if (activeMode === 'matchmaking') {
    const model = readModelSpec();
    if (!model.total_params || !model.hidden_size || !model.num_layers) {
      if (!silent) showToast(t('toast_no_input'));
      return;
    }
    const sla = readSLAConstraints();
    const results = runMatchmaking(model, rt, wl, opts, sla, hardwareDB);
    showResultsPanel('matchmaking');
    renderMatchmaking(results);
  } else if (activeMode === 'discovery') {
    const hw = readHardwareSpec() ?? hardwareDB[0];
    if (!hw) {
      if (!silent) showToast(t('toast_no_input'));
      return;
    }
    const result = runDiscovery(hw, rt, wl, opts);
    const presetRows = runPresetDiscovery(hw, rt, wl, opts, modelPresets);
    showResultsPanel('discovery');
    renderDiscovery(result, presetRows);
  }

  if (!silent) showToast(t('toast_calculated'));
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string): void {
  const toast = document.getElementById('profiler-toast');
  const msgEl = document.getElementById('profiler-toast-msg');
  if (!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  window.lucide?.createIcons();

  initTheme();
  initI18n();

  await loadData();

  populateModelDropdown();
  populateHardwareDropdown();
  bindPresetListeners();
  bindModeSwitcher();
  bindAdvancedToggles();

  // Re-render dynamic results & translated badges whenever language changes
  window.addEventListener('langchange', () => {
    onCalculate(true);
  });

  // Pre-select a representative default model (Llama 3 8B) and GPU (RTX 4090)
  // so users immediately see an objective calculation on page load.
  const defaultModel = modelPresets.find((m) => m.model_id === 'llama3_8b') ?? modelPresets[0];
  const defaultHw = hardwareDB.find((h) => h.hardware_id === 'rtx_4090_1x') ?? hardwareDB[0];

  if (defaultModel) {
    const mSel = document.getElementById('model-preset') as HTMLSelectElement | null;
    if (mSel) mSel.value = defaultModel.model_id;
    fillModelFields(defaultModel);
  }
  if (defaultHw) {
    const hSel = document.getElementById('hardware-preset') as HTMLSelectElement | null;
    const hDiscSel = document.getElementById(
      'hardware-preset-discovery'
    ) as HTMLSelectElement | null;
    if (hSel) hSel.value = defaultHw.hardware_id;
    if (hDiscSel) hDiscSel.value = defaultHw.hardware_id;
    fillHardwareFields(defaultHw);
  }

  const calcBtn = document.getElementById('btn-calculate') as HTMLButtonElement;
  if (calcBtn) {
    calcBtn.disabled = false;
    calcBtn.addEventListener('click', () => onCalculate(false));
  }

  document.getElementById('share-link-btn')?.addEventListener('click', () => {
    const shareUrl = buildShareUrl();
    window.history.replaceState({}, '', shareUrl);
    navigator.clipboard?.writeText(shareUrl).catch(() => {});
    showToast(t('toast_link_copied'));
  });

  // Restore URL query state if present, and render initial results
  const initialMode = restoreFromQuery() ?? 'forward';
  setMode(initialMode);
});
