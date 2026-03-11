/**
 * Shared UI utilities for clipboard2markdown.
 * Toast notifications, clipboard, and file download helpers.
 */

// @ts-ignore — loaded via CDN
const lucide = window.lucide;

// --- Toast notification ---

let toastTimeout: ReturnType<typeof setTimeout>;

/**
 * Show a toast notification with an icon and message.
 */
export function showToast(icon: string, msg: string): void {
  const toast = document.getElementById('toast') as HTMLDivElement;
  if (!toast) return;

  clearTimeout(toastTimeout);

  const iconEl = document.getElementById('toast-icon');
  if (iconEl) {
    iconEl.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i>`;
  }
  const msgEl = document.getElementById('toast-msg');
  if (msgEl) msgEl.innerText = msg;
  lucide.createIcons();

  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  toastTimeout = setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 3000);
}

// --- Clipboard ---

// execCommand is deprecated but intentionally kept as a fallback
// for non-HTTPS contexts or older browsers where navigator.clipboard is unavailable.
function fallbackCopy(text: string): void {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

/**
 * Copy text to clipboard with fallback for older browsers.
 */
export function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

// --- File download ---

/**
 * Trigger a file download from a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
