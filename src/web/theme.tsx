import { useEffect, useLayoutEffect, useState } from 'react';
import { browserStorage } from './storage.ts';

export type Theme = 'system' | 'light' | 'dark';
const key = 'papilot:theme';
function preference(value: string | null): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

// The workspace keeps one theme preference and resolves "system" from the
// operating system, live, in this tab and in other tabs.
export function useTheme() {
  const [theme, setTheme] = useState(() => preference(browserStorage.getItem(key)));
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setTheme(preference(browserStorage.getItem(key)));
    };
    change();
    media.addEventListener('change', change);
    window.addEventListener('storage', sync);
    return () => { media.removeEventListener('change', change); window.removeEventListener('storage', sync); };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#26272b' : '#ffffff');
  }, [resolved]);
  return { theme, resolved, setTheme: (value: Theme) => { browserStorage.setItem(key, value); setTheme(value); } };
}
