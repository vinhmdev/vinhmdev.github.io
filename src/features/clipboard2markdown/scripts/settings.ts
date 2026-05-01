/**
 * settings.ts — App toggle states backed by localStorage.
 *
 * Encapsulates all boolean settings for clipboard2markdown.
 * Each setting is wired to a checkbox toggle in the UI.
 */

const STORAGE_KEYS = {
  autoConvert: 'c2md-autoconvert',
  renderMermaid: 'c2md-render-mermaid',
  renderLatex: 'c2md-render-latex',
  syncScroll: 'c2md-sync-scroll',
} as const;

type SettingKey = keyof typeof STORAGE_KEYS;

// Map setting key → checkbox element ID
const ELEMENT_IDS: Record<SettingKey, string> = {
  autoConvert: 'auto-convert-toggle',
  renderMermaid: 'render-mermaid-toggle',
  renderLatex: 'render-latex-toggle',
  syncScroll: 'sync-scroll-toggle',
};

function loadFromStorage(key: SettingKey): boolean {
  const saved = localStorage.getItem(STORAGE_KEYS[key]);
  return saved === null ? true : saved === 'true';
}

function saveToStorage(key: SettingKey, val: boolean): void {
  localStorage.setItem(STORAGE_KEYS[key], String(val));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AppSettings {
  /** Get current value of a setting. */
  get(key: SettingKey): boolean;
  /** Register a callback that fires when a setting changes. */
  onChange(key: SettingKey, cb: (val: boolean) => void): void;
}

/**
 * Initialize all settings: load from localStorage, wire checkbox listeners.
 * Returns a Settings interface for reading values and subscribing to changes.
 */
export function initSettings(): AppSettings {
  const state = {} as Record<SettingKey, boolean>;
  const listeners: Partial<Record<SettingKey, Array<(v: boolean) => void>>> = {};

  (Object.keys(STORAGE_KEYS) as SettingKey[]).forEach((key) => {
    state[key] = loadFromStorage(key);

    const el = document.getElementById(ELEMENT_IDS[key]) as HTMLInputElement | null;
    if (!el) return;
    el.checked = state[key];

    el.addEventListener('change', () => {
      state[key] = el.checked;
      saveToStorage(key, el.checked);
      listeners[key]?.forEach((cb) => cb(el.checked));
    });
  });

  return {
    get: (key) => state[key],
    onChange: (key, cb) => {
      if (!listeners[key]) listeners[key] = [];
      listeners[key]!.push(cb);
    },
  };
}
