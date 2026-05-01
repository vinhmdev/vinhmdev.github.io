/**
 * Theme toggle logic for clipboard2markdown.
 * Persists user preference in localStorage.
 */

// @ts-ignore — loaded via CDN
const lucide = window.lucide;

const THEME_KEY = 'c2md-theme';

/**
 * Apply a theme and persist it.
 */
function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(THEME_KEY, theme);
}

/**
 * Initialize theme from saved preference or system default,
 * and wire up the toggle button.
 */
export function initTheme(): void {
  const savedTheme = localStorage.getItem(THEME_KEY) as 'dark' | 'light' | null;
  if (savedTheme) {
    applyTheme(savedTheme);
  } else {
    applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
    lucide.createIcons();
    // Dispatch event so other components (like Mermaid) can react
    window.dispatchEvent(
      new CustomEvent('themechange', {
        detail: { theme: isDark ? 'light' : 'dark' },
      })
    );
  });
}
