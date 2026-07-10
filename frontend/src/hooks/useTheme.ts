import { useState, useEffect } from 'react';

const THEME_KEY = 'printbridge_theme';
const THEMES = [
  'dark', 'light', 'rush', 'beans', 'shrek', 'transit',
  'hellokitty-light', 'hellokitty-dark',
  'system', 'hellokitty',
] as const;
export type Theme = typeof THEMES[number];
type MetaTheme = 'system' | 'hellokitty';
type ResolvedTheme = Exclude<Theme, MetaTheme>;

export function getResolvedTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'shrek';
  }
  if (theme === 'hellokitty') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'hellokitty-dark' : 'hellokitty-light';
  }
  return theme;
}

const THEME_COLORS: Record<ResolvedTheme, { accent: string; bg: string; muted: string }> = {
  dark:             { accent: '%234a6cf7', bg: '%230d0f12', muted: '%236b7694' },
  light:            { accent: '%233b5bdb', bg: '%23f0f2f8', muted: '%236b7280' },
  rush:             { accent: '%23f5d000', bg: '%23111109', muted: '%238a8060' },
  beans:            { accent: '%23c1622a', bg: '%23fdf6ee', muted: '%238a5c3a' },
  shrek:            { accent: '%237ab32a', bg: '%231a1f0e', muted: '%237a9040' },
  transit:          { accent: '%23f26522', bg: '%23f5f5f0', muted: '%23555550' },
  'hellokitty-light': { accent: '%23e8649a', bg: '%23fff5f8', muted: '%23c4748e' },
  'hellokitty-dark':  { accent: '%23e8649a', bg: '%231a0d12', muted: '%23c4748e' },
};

function buildFaviconHref(resolved: ResolvedTheme): string {
  const c = THEME_COLORS[resolved];
  return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40' fill='none'><circle cx='20' cy='20' r='20' fill='${c.bg}'/><rect x='6' y='14' width='28' height='18' rx='3' fill='${c.accent}' opacity='0.15'/><rect x='6' y='14' width='28' height='18' rx='3' stroke='${c.accent}' stroke-width='2'/><rect x='11' y='8' width='18' height='10' rx='2' fill='${c.bg}' stroke='${c.accent}' stroke-width='2'/><rect x='14' y='26' width='12' height='8' rx='1.5' fill='${c.bg}' stroke='${c.muted}' stroke-width='1.5'/><circle cx='28' cy='22' r='2' fill='${c.accent}'/></svg>`;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return (THEMES.includes(saved as Theme) ? saved : 'dark') as Theme;
  });

  useEffect(() => {
    const apply = () => {
      const resolved = getResolvedTheme(theme);
      document.documentElement.setAttribute('data-theme', resolved);
      localStorage.setItem(THEME_KEY, theme);
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) link.href = buildFaviconHref(resolved);
    };
    apply();

    if (theme === 'system' || theme === 'hellokitty') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  return { theme, setTheme: setThemeState, themes: THEMES };
}
