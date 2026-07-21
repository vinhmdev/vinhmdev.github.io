/**
 * app.ts — Entry point for LLM Hardware Profiler.
 *
 * Phase 1: theme, i18n, data loading, preset dropdowns, mode selector
 * Phase 2: runForward() wired to Calculate button + result rendering
 * Phase 3: runMatchmaking() + runDiscovery() wired to mode tabs
 */
import { init as initI18n, t } from './i18n-client';
import { initTheme } from '@shared/theme/toggle';
import { runForward, runMatchmaking, runDiscovery } from './math-engine';
import type {
  ModelPreset,
  HardwareSpec,
  ModelSpec,
  RuntimeConfig,
  WorkloadSpec,
  AdvancedOpts,
  SLAConstraints,
  ForwardResult,
  MatchResult,
  ModelConstraints,
  QuantizationType,
  KvQuantType,
  InferenceEngine,
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
  modelPresets.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.model_id;
    opt.textContent = m.display_name;
    sel.appendChild(opt);
  });
}

function buildHardwareOptgroups(db: HardwareSpec[]): DocumentFragment {
  const groups: Record<string, HardwareSpec[]> = {
    apple_silicon: [],
    consumer: [],
    datacenter: [],
  };
  db.forEach((h) => groups[h.arch_class]?.push(h));
  const labels: Record<string, string> = {
    apple_silicon: '🍎 Apple Silicon',
    consumer: '🖥 Consumer GPU',
    datacenter: '🏢 Datacenter',
  };
  const frag = document.createDocumentFragment();
  Object.entries(groups).forEach(([cls, items]) => {
    if (!items.length) return;
    const grp = document.createElement('optgroup');
    grp.label = labels[cls] ?? cls;
    items.forEach((h) => {
      const opt = document.createElement('option');
      opt.value = h.hardware_id;
      opt.textContent = h.display_name;
      grp.appendChild(opt);
    });
    frag.appendChild(grp);
  });
  return frag;
}

function populateHardwareDropdown(): void {
  const sel1 = document.getElementById('hardware-preset') as HTMLSelectElement;
  const sel2 = document.getElementById('hardware-preset-discovery') as HTMLSelectElement;
  sel1.appendChild(buildHardwareOptgroups(hardwareDB));
  sel2.appendChild(buildHardwareOptgroups(hardwareDB));
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
  (document.getElementById('context-limit') as HTMLInputElement).value = String(
    m.max_context_window
  );
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
    if (preset) fillModelFields(preset);
  });
  document.getElementById('hardware-preset')?.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    const hw = hardwareDB.find((h) => h.hardware_id === id);
    if (hw) fillHardwareFields(hw);
  });
}

// ─── Read form state ──────────────────────────────────────────────────────────

function num(id: string, fallback = 0): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement)?.value) || fallback;
}

function str(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement)?.value ?? '';
}

function checked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement)?.checked ?? false;
}

function readModelSpec(): ModelSpec {
  return {
    total_params: num('total-params'),
    active_params: num('active-params') || num('total-params'),
    hidden_size: num('hidden-size'),
    num_layers: num('num-layers'),
    num_query_heads: num('num-query-heads'),
    num_kv_heads: num('num-kv-heads'),
    vocab_size: num('vocab-size'),
    max_context_window: num('max-context-window'),
  };
}

function readHardwareSpec(): HardwareSpec | null {
  const presetId = str('hardware-preset');
  const preset = hardwareDB.find((h) => h.hardware_id === presetId);
  if (preset) return preset;

  // Custom (manual) values — build a minimal HardwareSpec
  const vram = num('vram-total-gb');
  const bw = num('bandwidth-gbps');
  const tflops = num('compute-tflops');
  if (!vram || !bw || !tflops) return null;

  return {
    hardware_id: 'custom',
    display_name: 'Custom Hardware',
    vendor: 'Custom',
    arch_class: 'consumer',
    gpu_count: num('gpu-count', 1),
    specs: {
      vram_total_gb: vram,
      raw_bandwidth_gbps: bw,
      compute_tflops_fp16: tflops,
    },
    empirical_constraints: {
      os_vram_allocatable_factor: 0.95,
      bandwidth_utilization: 0.73,
      mfu_factor: 0.38,
      interconnect_penalty: 1.0,
    },
    economics: { est_hourly_cost_usd: 0 },
  };
}

function readRuntimeConfig(): RuntimeConfig {
  return {
    weight_quantization: (str('weight-quant') as QuantizationType) || 'FP16',
    kv_quantization: (str('kv-quant') as KvQuantType) || 'FP16',
    context_length_limit: num('context-limit', 4096),
    inference_engine: (str('inference-engine') as InferenceEngine) || 'vLLM',
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
  };
}

function readSLAConstraints(): SLAConstraints {
  return {
    min_decode_tps_per_user: num('min-tps', 1),
    max_ttft_ms: num('max-ttft', 999999),
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

function renderVRAM(vram: ForwardResult['vram']): void {
  const pct = (v: number) => Math.min((v / vram.allocatable_gb) * 100, 100).toFixed(1) + '%';

  // Bar segments
  (document.getElementById('vram-seg-weights') as HTMLElement).style.width = pct(vram.weights_gb);
  (document.getElementById('vram-seg-kv') as HTMLElement).style.width = pct(vram.kv_cache_gb);
  (document.getElementById('vram-seg-overhead') as HTMLElement).style.width = pct(vram.overhead_gb);

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

  // Status badge
  const badge = document.getElementById('vram-status-badge') as HTMLElement;
  if (vram.is_oom) {
    badge.className = 'status-badge oom';
    badge.textContent = t('badge_oom');
  } else {
    badge.className = 'status-badge fit';
    badge.textContent = t('badge_fit');
  }
}

function renderSpeed(speed: ForwardResult['speed']): void {
  (document.getElementById('speed-ttft') as HTMLElement).textContent = fmtMs(speed.prefill_ttft_ms);
  (document.getElementById('speed-system-tps') as HTMLElement).textContent = fmt(
    speed.decode_system_tps
  );
  (document.getElementById('speed-user-tps') as HTMLElement).textContent = fmt(
    speed.decode_per_user_tps
  );
}

function showResultsPanel(mode: Mode): void {
  document.getElementById('results-empty')!.classList.add('hidden');
  document.getElementById('results-content')!.classList.remove('hidden');

  // Show/hide sub-cards per mode
  const vramCard = document.getElementById('result-vram');
  const speedCard = document.getElementById('result-speed');
  const matchCard = document.getElementById('result-matchmaking');
  const discovCard = document.getElementById('result-discovery');

  vramCard?.classList.toggle('hidden', mode === 'matchmaking');
  speedCard?.classList.toggle('hidden', mode === 'matchmaking' || mode === 'discovery');
  matchCard?.classList.toggle('hidden', mode !== 'matchmaking');
  discovCard?.classList.toggle('hidden', mode !== 'discovery');
}

function renderMatchmaking(results: MatchResult[]): void {
  const tbody = document.getElementById('match-table-body') as HTMLElement;
  const noResult = document.getElementById('match-no-result') as HTMLElement;
  const matchTable = document.getElementById('match-table') as HTMLElement;

  tbody.innerHTML = '';

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

  results.forEach((r) => {
    const isBest = r.hardware.hardware_id === bestROI.hardware.hardware_id;
    const tr = document.createElement('tr');
    if (isBest) tr.className = 'best-roi';

    tr.innerHTML = `
      <td>
        ${r.hardware.display_name}
        ${isBest ? `<span class="badge-roi">${t('badge_best_roi')}</span>` : ''}
      </td>
      <td style="color:${r.result.vram.utilization_pct > 90 ? 'var(--profiler-warning)' : 'inherit'}">
        ${r.result.vram.utilization_pct.toFixed(0)}%
      </td>
      <td>${fmt(r.result.speed.decode_per_user_tps)}</td>
      <td>${fmtMs(r.result.speed.prefill_ttft_ms)}</td>
      <td>$${r.hardware.economics.est_hourly_cost_usd.toFixed(2)}</td>
      <td>${r.roi_score.toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDiscovery(c: ModelConstraints): void {
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
  (document.getElementById('discovery-bottleneck') as HTMLElement).textContent = t(bottleneckKey);
  (document.getElementById('discovery-quant') as HTMLElement).textContent = c.recommended_quant;
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
  if (desc) desc.textContent = t(MODE_DESC_KEY[mode]);

  const slaSection = document.getElementById('section-sla');
  slaSection?.classList.toggle('hidden', mode !== 'matchmaking');

  const hwSection = document.getElementById('section-hardware');
  hwSection?.classList.toggle('hidden', mode === 'discovery');

  const hwDiscoverySection = document.getElementById('section-hardware-discovery');
  hwDiscoverySection?.classList.toggle('hidden', mode !== 'discovery');

  const btnLabel = document.getElementById('btn-calculate-label');
  if (btnLabel) btnLabel.textContent = t(BTN_LABEL_KEY[mode]);

  // Reset results on mode switch
  document.getElementById('results-empty')?.classList.remove('hidden');
  document.getElementById('results-content')?.classList.add('hidden');
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
}

// ─── Calculate handler ────────────────────────────────────────────────────────

function validate(): {
  model: ModelSpec;
  rt: RuntimeConfig;
  wl: WorkloadSpec;
  opts: AdvancedOpts;
} | null {
  const model = readModelSpec();
  if (!model.total_params || !model.hidden_size || !model.num_layers) {
    showToast(t('toast_no_input'));
    return null;
  }
  const rt = readRuntimeConfig();
  if (!rt.context_length_limit) {
    showToast(t('toast_no_input'));
    return null;
  }
  const wl = readWorkloadSpec();
  const opts = readAdvancedOpts();
  return { model, rt, wl, opts };
}

function onCalculate(): void {
  const data = validate();
  if (!data) return;
  const { model, rt, wl, opts } = data;

  if (activeMode === 'forward') {
    const hw = readHardwareSpec();
    if (!hw) {
      showToast(t('toast_no_input'));
      return;
    }
    const result = runForward(model, hw, rt, wl, opts);
    showResultsPanel('forward');
    renderVRAM(result.vram);
    renderSpeed(result.speed);
  } else if (activeMode === 'matchmaking') {
    const sla = readSLAConstraints();
    const results = runMatchmaking(model, rt, wl, opts, sla, hardwareDB);
    showResultsPanel('matchmaking');
    renderMatchmaking(results);
  } else if (activeMode === 'discovery') {
    const hw = hardwareDB[0]; // Mode 3 uses selected hardware preset if available
    const presetId = str('hardware-preset-discovery') || str('hardware-preset');
    const selectedHw = hardwareDB.find((h) => h.hardware_id === presetId) ?? hw;
    if (!selectedHw) {
      showToast(t('toast_no_input'));
      return;
    }
    const result = runDiscovery(selectedHw, rt, wl, opts);
    showResultsPanel('discovery');
    renderDiscovery(result);
  }

  showToast(t('toast_calculated'));
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
  // @ts-ignore — CDN global
  window.lucide?.createIcons();

  initTheme();
  initI18n();

  await loadData();

  populateModelDropdown();
  populateHardwareDropdown();
  bindPresetListeners();
  bindModeSwitcher();
  bindAdvancedToggles();

  // Enable calculate button (Phase 2)
  const calcBtn = document.getElementById('btn-calculate') as HTMLButtonElement;
  if (calcBtn) {
    calcBtn.disabled = false;
    calcBtn.addEventListener('click', onCalculate);
  }

  // Apply initial mode labels after i18n loaded
  setMode('forward');
});
