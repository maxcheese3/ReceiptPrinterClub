import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Theme } from '../hooks/useTheme';
import { getResolvedTheme } from '../hooks/useTheme';

const CAROUSEL_THEMES: Theme[] = ['dark', 'light', 'rush', 'beans', 'shrek', 'transit', 'system', 'hellokitty'];

const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark Mode',
  light: 'Light Mode',
  rush: 'Premium Rush',
  beans: 'Beans',
  shrek: 'Shrek',
  transit: 'TriMet',
  system: 'Match System',
  hellokitty: 'Hello Kitty',
  'hellokitty-light': 'Hello Kitty Light',
  'hellokitty-dark': 'Hello Kitty Dark',
};

const THEME_EMOJIS: Record<Theme, string> = {
  dark: '🌑',
  light: '☀️',
  rush: '🚲',
  beans: '🫘',
  shrek: '🧅',
  transit: '🚌',
  system: '🔄',
  hellokitty: '🐱',
  'hellokitty-light': '🐱',
  'hellokitty-dark': '🐱',
};

interface ThemePickerModalProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onClose: () => void;
}

export default function ThemePickerModal({ theme, onThemeChange, onClose }: ThemePickerModalProps) {
  // Remember the original theme so we can revert on cancel
  const originalTheme = useRef<Theme>(theme);
  const [tempTheme, setTempTheme] = useState<Theme>(theme);

  // Apply the theme live as the user navigates
  useEffect(() => {
    onThemeChange(tempTheme);
  }, [tempTheme, onThemeChange]);

  const handleCancel = useCallback(() => {
    // Revert to original before closing
    onThemeChange(originalTheme.current);
    onClose();
  }, [onThemeChange, onClose]);

  const handleDone = useCallback(() => {
    // Theme is already applied — just close
    onClose();
  }, [onClose]);

  function prev(t: Theme): Theme {
    const idx = CAROUSEL_THEMES.indexOf(t);
    return CAROUSEL_THEMES[(idx - 1 + CAROUSEL_THEMES.length) % CAROUSEL_THEMES.length];
  }

  function next(t: Theme): Theme {
    const idx = CAROUSEL_THEMES.indexOf(t);
    return CAROUSEL_THEMES[(idx + 1) % CAROUSEL_THEMES.length];
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleCancel();
      if (e.key === 'ArrowLeft') setTempTheme((t) => prev(t));
      if (e.key === 'ArrowRight') setTempTheme((t) => next(t));
      if (e.key === 'Enter') handleDone();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleCancel, handleDone]);

  const resolvedLabel =
    tempTheme === 'system'
      ? `Currently: ${getResolvedTheme('system') === 'dark' ? 'Dark Mode' : 'Shrek'}`
      : tempTheme === 'hellokitty'
      ? `Currently: ${getResolvedTheme('hellokitty') === 'hellokitty-dark' ? 'Hello Kitty Dark' : 'Hello Kitty Light'}`
      : null;

  return createPortal(
    <div className="theme-picker-modal-backdrop" onClick={handleCancel}>
      <div
        className="theme-picker-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Select theme"
      >
        <button className="theme-picker-modal-close" onClick={handleCancel} aria-label="Close">✕</button>

        <p className="theme-picker-modal-heading">SELECT THEME</p>

        <div className="theme-picker-carousel">
          <button
            className="theme-carousel-arrow"
            onClick={() => setTempTheme((t) => prev(t))}
            aria-label="Previous theme"
          >
            ◄
          </button>

          <div className="theme-carousel-center">
            <span className="theme-carousel-emoji">{THEME_EMOJIS[tempTheme]}</span>
            <span className="theme-carousel-name">{THEME_LABELS[tempTheme]}</span>
            {resolvedLabel && (
              <span className="theme-carousel-sub">{resolvedLabel}</span>
            )}
          </div>

          <button
            className="theme-carousel-arrow"
            onClick={() => setTempTheme((t) => next(t))}
            aria-label="Next theme"
          >
            ►
          </button>
        </div>

        <div className="theme-picker-dots">
          {CAROUSEL_THEMES.map((t) => (
            <button
              key={t}
              className={`theme-picker-dot${t === tempTheme ? ' active' : ''}`}
              onClick={() => setTempTheme(t)}
              aria-label={THEME_LABELS[t]}
            />
          ))}
        </div>

        <button className="btn btn-primary theme-picker-done" onClick={handleDone}>
          DONE
        </button>
      </div>
    </div>,
    document.body
  );
}
