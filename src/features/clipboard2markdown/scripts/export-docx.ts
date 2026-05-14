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
 * The patch is reference-counted at module scope so that overlapping export
 * clicks (a real possibility — DOCX generation is slow) cannot corrupt
 * `window.fetch`. The previous per-call implementation captured the patched
 * fetch as "original" on the second click, then permanently froze the
 * wrapper onto `window.fetch` when both `finally` blocks ran.
 */
import { md2docx } from '@m2d/md2docx';
import { WidthType, TableLayoutType } from 'docx';
import { downloadBlob } from './utils';

const CORS_PROXY_HOST = 'cors-proxy.vinhmdev.com';
const CORS_PROXY_BASE = `https://${CORS_PROXY_HOST}/`;

// Captured ONCE at module load — never re-captured, so it cannot end up
// pointing at a previously installed wrapper.
const realFetch: typeof window.fetch = window.fetch.bind(window);

let activeExports = 0;

/** Wrap an arbitrary URL with the CORS proxy unless it already points there. */
function withCorsProxy(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return url;
  }
  // Exact hostname match — a substring check would let `not-cors-proxy.vinhmdev.com` bypass.
  if (hostname === CORS_PROXY_HOST) return url;

  // The proxy expects the target as `host:port/path`. Strip the scheme and
  // synthesize the explicit port the proxy expects (443 for https, 80 for http).
  const isHttps = url.startsWith('https://');
  const stripped = url.replace(isHttps ? 'https://' : 'http://', '');
  const port = isHttps ? ':443' : ':80';
  const target = stripped.includes('/')
    ? stripped.replace('/', `${port}/`)
    : stripped + port;
  return `${CORS_PROXY_BASE}${target}`;
}

/** Shared wrapper installed once across all concurrent exports. */
async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let url: string;
  if (typeof input === 'string') url = input;
  else if (input instanceof URL) url = input.toString();
  else if (input instanceof Request) url = input.url;
  else url = String(input);
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
  document.getElementById('export-doc-btn')?.addEventListener('click', async () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));

    // First concurrent export installs the wrapper; subsequent ones share it.
    if (activeExports++ === 0) {
      window.fetch = patchedFetch;
    }

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
      // Last concurrent export restores the real fetch.
      if (--activeExports === 0) {
        window.fetch = realFetch;
      }
    }
  });
}
