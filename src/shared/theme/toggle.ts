/**
 * Shared light/dark theme toggle for every tool.
 *
 * One implementation, one storage key. The key MUST match the pre-paint
 * script in BaseLayout.astro (`c2md-theme`) so the restored theme and the
 * flash-prevention script agree, and so the choice carries across all tools.
 *
 * On toggle a `themechange` CustomEvent is dispatched on window so tools that
 * render theme-aware content (Mermaid diagrams, the Markdown preview, charts)
 * can react.
 */
const lucide = window.lucide ?? { createIcons: () => {} };

const THEME_KEY = 'c2md-theme';
type Theme = 'dark' | 'light';

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(THEME_KEY, theme);
}

/** Restore the saved/system theme and wire up #theme-toggle-btn. */
export function initTheme(): void {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  applyTheme(saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const next: Theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next);
    lucide.createIcons();
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  });
}
