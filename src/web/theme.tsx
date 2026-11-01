import { useEffect, useLayoutEffect, useState } from 'react';
import { browserStorage } from './storage.ts';
import { APPEARANCE_KEY, appearanceVariables, parseAppearance, type Appearance } from './appearance.ts';

export type Theme = 'system' | 'light' | 'dark';
const key = 'papilot:theme';
function preference(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

// The workspace keeps one theme preference and resolves "system" from the
// operating system, live, in this tab and in other tabs.
export function useTheme() {
  const [theme, setTheme] = useState(() => preference(browserStorage.getItem(key)));
  const [appearance, setAppearance] = useState(() => parseAppearance(browserStorage.getItem(APPEARANCE_KEY)));
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setTheme(preference(browserStorage.getItem(key)));
      if (event.key === APPEARANCE_KEY || event.key === null) setAppearance(parseAppearance(browserStorage.getItem(APPEARANCE_KEY)));
    };
    change();
    media.addEventListener('change', change);
    window.addEventListener('storage', sync);
    return () => { media.removeEventListener('change', change); window.removeEventListener('storage', sync); };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    const variables = appearanceVariables(appearance, resolved);
    for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, value);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', variables['--bg']);
  }, [resolved, appearance]);
  return { theme, resolved, appearance,
    setTheme: (value: Theme) => { browserStorage.setItem(key, value); setTheme(value); },
    setAppearance: (value: Appearance) => { browserStorage.setItem(APPEARANCE_KEY, JSON.stringify(value)); setAppearance(value); },
  };
}
