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
import JSZip from 'jszip';
import { downloadBlob } from './utils';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Injected when missing from styles.xml. docx@9.5's DefaultStylesFactory
// (node_modules/docx/dist/index.cjs:18170+) omits Normal/DefaultParagraphFont,
// yet every emitted style declares <w:basedOn w:val="Normal"/>. Google Docs
// rejects files with dangling basedOn references; Word/LibreOffice tolerate them.
const NORMAL_STYLE =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
  '<w:name w:val="Normal"/><w:qFormat/></w:style>';
const DEFAULT_PARAGRAPH_FONT_STYLE =
  '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">' +
  '<w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/>' +
  '<w:semiHidden/><w:unhideWhenUsed/></w:style>';

/**
 * Post-process the generated DOCX to repair two issues that cause Google Docs
 * to reject the file with "File could not open. Try refreshing the page.":
 *
 * 1. **Duplicate `<w:pStyle>` / `<w:numPr>` inside `<w:pPr>`.** `@m2d/list`
 *    sets both `bullet` and `numbering` on each list item, and `docx@9.5`
 *    emits one element per option — producing two of each. OOXML schema
 *    declares both with `maxOccurs="1"`. We keep the LAST occurrence so the
 *    m2d-defined list reference (e.g. numId="2") wins over the bullet
 *    fallback (numId="1").
 *
 * 2. **Missing `Normal` and `DefaultParagraphFont` styles.** Every emitted
 *    style references `Normal`/`DefaultParagraphFont` via `<w:basedOn>`, but
 *    docx's `DefaultStylesFactory` never emits them. Google Docs rejects the
 *    dangling references; Word/LibreOffice silently fall back to built-ins.
 *
 * Word/LibreOffice tolerate both issues, which is why the file appears valid
 * until you try to open it in Google Docs.
 */
async function repairDocxForGoogleDocs(blob: Blob): Promise<Blob> {
  const zip = await JSZip.loadAsync(blob);
  const docFile = zip.file('word/document.xml');
  const stylesFile = zip.file('word/styles.xml');
  if (!docFile || !stylesFile) return blob;

  let mutated = false;

  // (1) Dedupe duplicates inside each <w:pPr>.
  const docXml = await docFile.async('string');
  const docFixed = docXml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (_m, inner: string) => {
    let body = inner;
    const pStyleMatches = body.match(/<w:pStyle\s[^/]*\/>/g);
    if (pStyleMatches && pStyleMatches.length > 1) {
      let i = 0;
      body = body.replace(/<w:pStyle\s[^/]*\/>/g, (m) =>
        ++i === pStyleMatches.length ? m : ''
      );
    }
    const numPrMatches = body.match(/<w:numPr>[\s\S]*?<\/w:numPr>/g);
    if (numPrMatches && numPrMatches.length > 1) {
      let i = 0;
      body = body.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, (m) =>
        ++i === numPrMatches.length ? m : ''
      );
    }
    return `<w:pPr>${body}</w:pPr>`;
  });
  if (docFixed !== docXml) {
    zip.file('word/document.xml', docFixed);
    mutated = true;
  }

  // (2) Inject Normal / DefaultParagraphFont when absent.
  const stylesXml = await stylesFile.async('string');
  const needsNormal = !/w:styleId="Normal"/.test(stylesXml);
  const needsDefaultFont = !/w:styleId="DefaultParagraphFont"/.test(stylesXml);
  if (needsNormal || needsDefaultFont) {
    const injection =
      (needsNormal ? NORMAL_STYLE : '') +
      (needsDefaultFont ? DEFAULT_PARAGRAPH_FONT_STYLE : '');
    // Prefer to insert right after </w:docDefaults>; fall back to right
    // after the <w:styles ...> opening tag if docDefaults is missing.
    const stylesFixed = stylesXml.includes('</w:docDefaults>')
      ? stylesXml.replace('</w:docDefaults>', `</w:docDefaults>${injection}`)
      : stylesXml.replace(/(<w:styles\b[^>]*>)/, `$1${injection}`);
    zip.file('word/styles.xml', stylesFixed);
    mutated = true;
  }

  if (!mutated) return blob;
  return zip.generateAsync({
    type: 'blob',
    mimeType: DOCX_MIME,
    compression: 'DEFLATE',
  });
}

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
              // Do NOT pass `columnWidths: []` — it serializes as an empty <w:tblGrid/>,
              // which violates OOXML (one <w:gridCol> per column is required) and makes
              // Google Docs reject the file with "File could not open." Leave undefined
              // so docx falls back to Array(N).fill(100); AUTOFIT then resizes at render time.
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

      const repaired = await repairDocxForGoogleDocs(blob);
      downloadBlob(repaired, 'document.docx');
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
