/**
 * export-docx.ts — DOCX export via @m2d/md2docx.
 *
 * Replaces the old markdown-docx + JSZip + manual XML patching approach (~230 lines).
 * @m2d/md2docx handles LaTeX (remark-math) and Mermaid (@m2d/mermaid) natively,
 * producing clean OOXML without post-processing hacks.
 *
 * CORS workaround
 * ───────────────
 * @m2d/md2docx fetches inline image URLs internally, which fails CORS for
 * arbitrary hosts. We route those fetches through a custom proxy by
 * temporarily replacing `window.fetch` while the export is running.
 *
 * Re-entry is prevented by disabling the export button while a run is in
 * flight, so only one fetch patch is ever active at a time.
 */
import { md2docx } from '@m2d/md2docx';
import { WidthType, TableLayoutType } from 'docx';
import { downloadBlob } from './utils';

const CORS_PROXY_HOST = 'cors-proxy.vinhmdev.com';
const CORS_PROXY_BASE = `https://${CORS_PROXY_HOST}/`;

// Captured ONCE at module load — never re-captured, so it cannot end up
// pointing at a previously installed wrapper.
const realFetch: typeof window.fetch = window.fetch.bind(window);

/** Wrap an arbitrary URL with the CORS proxy unless it already points there. */
function withCorsProxy(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url;

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  // Exact hostname match — a substring check would let `not-cors-proxy.vinhmdev.com` bypass.
  if (u.hostname === CORS_PROXY_HOST) return url;

  // The proxy expects the target as `host:port/path`. Preserve any explicit
  // port in the URL; otherwise default to the protocol's standard port.
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  const target = `${u.hostname}:${port}${u.pathname}${u.search}${u.hash}`;
  return `${CORS_PROXY_BASE}${target}`;
}

/** Routes fetches through the CORS proxy. Installed on window.fetch during export. */
async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let url: string;
  if (typeof input === 'string') url = input;
  else if (input instanceof URL) url = input.toString();
  else url = input.url; // RequestInfo | URL narrows to Request here
  return realFetch(withCorsProxy(url), init);
}

/**
 * Initialize the DOCX export button handler.
 *
 * @param getValue - Returns current markdown content from the editor
 * @param showToast - Toast notification function
 * @param t - i18n translation function
 */
export function initExportDocx(
  getValue: () => string,
  showToast: (icon: string, msg: string) => void,
  t: (key: string) => string
): void {
  const btn = document.getElementById('export-doc-btn') as HTMLButtonElement | null;
  btn?.addEventListener('click', async () => {
    if (btn.disabled) return; // Prevent re-entry while an export is in flight.
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));

    btn.disabled = true;
    window.fetch = patchedFetch;

    try {
      showToast('loader', t('toast_generating_doc'));

      const blob = (await md2docx(
        text,
        {
          title: 'Exported Document',
        },
        {},
        'blob',
        {
          table: {
            tableProps: {
              width: { size: 100, type: WidthType.PERCENTAGE },
              layout: TableLayoutType.AUTOFIT,
              // MUST explicitly pass empty columnWidths to bypass docx library's hardcoded fallback
              // which blindly creates a 100-DXA grid column for every cell if undefined.
              columnWidths: [],
            },
            cellProps: {
              // Completely strip the width property so Word uses pure Autofit (simulating "uncheck preferred width").
              // The `as never` cast is needed because docx's type insists width is required,
              // but the runtime accepts undefined and treats it as "no preferred width".
              width: undefined as never,
            },
          },
          image: {
            maxAgeMinutes: 0,
          },
          mermaid: {
            mermaidConfig: {
              htmlLabels: false, // Prevents tainted canvas security error caused by <foreignObject> during SVG to PNG conversion
            },
            maxAgeMinutes: 0,
          },
        }
      )) as Blob;

      downloadBlob(blob, 'document.docx');
      showToast('file-text', t('toast_exported_doc'));
    } catch (err) {
      console.error('DOCX export error:', err);
      showToast('alert-triangle', t('toast_doc_failed'));
    } finally {
      window.fetch = realFetch;
      btn.disabled = false;
    }
  });
}
