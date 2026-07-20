/**
 * Theme toggle for the encrypted-paste tool.
 * Shares the `c2md-theme` localStorage key with the rest of the site so the
 * light/dark choice carries across tools (BaseLayout reads the same key).
 */

// Lucide is loaded via CDN — typed in src/shared/globals.d.ts.
const lucide = window.lucide;

const THEME_KEY = 'c2md-theme';

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(THEME_KEY, theme);
}

/** Restore the saved/system theme and wire up the toggle button. */
export function initTheme(): void {
  const saved = localStorage.getItem(THEME_KEY) as 'dark' | 'light' | null;
  applyTheme(saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
    lucide.createIcons();
  });
}
