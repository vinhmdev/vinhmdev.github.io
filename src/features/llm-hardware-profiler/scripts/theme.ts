/**
 * theme.ts — Theme toggle for LLM Hardware Profiler.
 * Persists user preference in localStorage.
 */

// @ts-ignore — loaded via CDN
const lucide = window.lucide;

const THEME_KEY = 'llm-profiler-theme';

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(THEME_KEY, theme);
}

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
    window.dispatchEvent(
      new CustomEvent('themechange', {
        detail: { theme: isDark ? 'light' : 'dark' },
      })
    );
  });
}
