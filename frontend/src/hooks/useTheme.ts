import { useState, useEffect } from 'react';

const THEME_KEY = 'printbridge_theme';
const THEMES = ['dark', 'light', 'rush', 'beans', 'shrek', 'transit'] as const;
export type Theme = typeof THEMES[number];

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return (THEMES.includes(saved as Theme) ? saved : 'dark') as Theme;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return { theme, setTheme: setThemeState, themes: THEMES };
}
