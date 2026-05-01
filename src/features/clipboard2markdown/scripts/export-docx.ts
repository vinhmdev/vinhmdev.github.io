/**
 * export-docx.ts — DOCX export via @m2d/md2docx.
 *
 * Replaces the old markdown-docx + JSZip + manual XML patching approach (~230 lines).
 * @m2d/md2docx handles LaTeX (remark-math) and Mermaid (@m2d/mermaid) natively,
 * producing clean OOXML without post-processing hacks.
 */
import { md2docx } from '@m2d/md2docx';
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
  t: (key: string) => string,
): void {
  document.getElementById('export-doc-btn')?.addEventListener('click', async () => {
    const text = getValue();
    if (!text) return showToast('alert-triangle', t('toast_nothing_to_copy'));

    try {
      showToast('loader', 'Generating DOCX...');

      const blob = await md2docx(text, {
        document: {
          title: 'Exported Document',
        },
      });

      downloadBlob(blob, 'document.docx');
      showToast('file-text', t('toast_exported_doc'));
    } catch (err) {
      console.error('DOCX export error:', err);
      showToast('alert-triangle', 'Failed to export DOCX');
    }
  });
}
