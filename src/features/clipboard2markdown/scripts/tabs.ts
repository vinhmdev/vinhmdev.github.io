/**
 * Mobile tab switching for clipboard2markdown editor.
 * Handles editor/preview tab toggling and responsive resize.
 *
 * Uses inline styles for show/hide to override Astro's scoped CSS
 * which adds [data-astro-cid-*] attribute selectors with higher specificity
 * than Tailwind utility classes.
 */

/**
 * Initialize tab switching between editor and preview panes.
 * On desktop (≥1024px), both panes are always visible.
 */
export function initTabs(): void {
  const editorPane = document.getElementById('editor-pane') as HTMLDivElement;
  const previewPane = document.getElementById('preview-pane') as HTMLDivElement;
  const btnTabEdit = document.getElementById('tab-edit-btn');
  const btnTabPreview = document.getElementById('tab-preview-btn');

  if (!btnTabEdit || !btnTabPreview) return;

  function showPane(pane: HTMLElement): void {
    pane.style.display = 'flex';
  }

  function hidePane(pane: HTMLElement): void {
    pane.style.display = 'none';
  }

  function clearInlineDisplay(pane: HTMLElement): void {
    pane.style.removeProperty('display');
  }

  function setActiveTab(target: 'edit' | 'preview'): void {
    const isEdit = target === 'edit';

    if (isEdit) {
      showPane(editorPane);
      hidePane(previewPane);
    } else {
      hidePane(editorPane);
      showPane(previewPane);
    }

    btnTabEdit!.dataset.active = String(isEdit);
    btnTabPreview!.dataset.active = String(!isEdit);
  }

  btnTabEdit.addEventListener('click', () => setActiveTab('edit'));
  btnTabPreview.addEventListener('click', () => setActiveTab('preview'));

  function handleResize(): void {
    if (window.innerWidth >= 1024) {
      // Desktop: both panes visible, remove inline overrides
      clearInlineDisplay(editorPane);
      clearInlineDisplay(previewPane);
    } else {
      // Mobile: show only the active tab's pane
      const isPreviewActive = btnTabPreview!.dataset.active === 'true';
      setActiveTab(isPreviewActive ? 'preview' : 'edit');
    }
  }

  window.addEventListener('resize', handleResize);
  handleResize();
}
