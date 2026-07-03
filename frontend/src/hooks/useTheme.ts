import { useState, useEffect } from 'react';

const THEME_KEY = 'printbridge_theme';
const THEMES = ['dark', 'light', 'rush', 'beans', 'shrek', 'transit', 'system'] as const;
export type Theme = typeof THEMES[number];

export function getResolvedTheme(theme: Theme): Exclude<Theme, 'system'> {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'shrek';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return (THEMES.includes(saved as Theme) ? saved : 'dark') as Theme;
  });

  useEffect(() => {
    const apply = () => {
      document.documentElement.setAttribute('data-theme', getResolvedTheme(theme));
      localStorage.setItem(THEME_KEY, theme);
    };
    apply();

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  return { theme, setTheme: setThemeState, themes: THEMES };
}
