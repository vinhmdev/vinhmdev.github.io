/**
 * export-docx.ts — DOCX export via @m2d/md2docx.
 *
 * Replaces the old markdown-docx + JSZip + manual XML patching approach (~230 lines).
 * @m2d/md2docx handles LaTeX (remark-math) and Mermaid (@m2d/mermaid) natively,
 * producing clean OOXML without post-processing hacks.
 */
import { md2docx } from '@m2d/md2docx';
import { WidthType, TableLayoutType } from 'docx';
import { downloadBlob } from './utils';

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

    // Temporarily intercept fetch to bypass CORS for online images
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      let url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      // Prefix with cors-proxy to bypass CORS restrictions if it's an external HTTP/HTTPS URL
      if (
        (url.startsWith('http://') || url.startsWith('https://')) &&
        !url.includes('cors-proxy.vinhmdev.com')
      ) {
        let targetUrl = url;
        if (targetUrl.startsWith('https://')) {
          targetUrl = targetUrl.replace('https://', '');
          targetUrl = targetUrl.includes('/')
            ? targetUrl.replace('/', ':443/')
            : targetUrl + ':443';
        } else if (targetUrl.startsWith('http://')) {
          targetUrl = targetUrl.replace('http://', '');
          targetUrl = targetUrl.includes('/') ? targetUrl.replace('/', ':80/') : targetUrl + ':80';
        }
        url = `https://cors-proxy.vinhmdev.com/${targetUrl}`;
      }
      return originalFetch(url, init);
    };

    try {
      showToast('loader', 'Generating DOCX...');

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
              // MS Word parses w:w="100%" as 100 fiftieths of a percent (2%). We must use 5000 for 100%.
              width: { size: 5000, type: WidthType.PERCENTAGE },
              layout: TableLayoutType.AUTOFIT,
            },
            cellProps: {
              width: { size: 0, type: WidthType.AUTO },
            },
          },
          image: {
            maxAgeMinutes: 0,
          },
        }
      )) as Blob;

      downloadBlob(blob, 'document.docx');
      showToast('file-text', t('toast_exported_doc'));
    } catch (err) {
      console.error('DOCX export error:', err);
      showToast('alert-triangle', 'Failed to export DOCX');
    } finally {
      // Restore original fetch
      window.fetch = originalFetch;
    }
  });
}
