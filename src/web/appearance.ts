export type ColorMode = 'light' | 'dark';
export type PresetId = 'papilot' | 'paper' | 'slate';
export type AccentId = 'default' | 'blue' | 'graphite' | 'stone';
type Colors = { background?: string; foreground?: string };
export type Appearance = { preset: PresetId; accent: AccentId; colors: Record<ColorMode, Colors>; pdf: 'theme' | 'light'; review: 'pdf' | 'theme' | 'light'; size: number };
export const APPEARANCE_KEY = 'papilot:appearance';
export const DEFAULT_APPEARANCE: Appearance = { preset: 'papilot', accent: 'default', colors: { light: {}, dark: {} }, pdf: 'theme', review: 'pdf', size: 1 };
// Interface size is a whole-window zoom factor, so text, controls, the editor
// and rendered pages grow together instead of text outgrowing fixed layouts.
export const INTERFACE_SIZES = [1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export function stepInterfaceSize(size: number, direction: 'in' | 'out' | 'reset') {
  if (direction === 'reset') return 1;
  const index = INTERFACE_SIZES.findIndex(value => value >= size);
  const current = index < 0 ? INTERFACE_SIZES.length - 1 : index;
  return INTERFACE_SIZES[Math.max(0, Math.min(INTERFACE_SIZES.length - 1, current + (direction === 'in' ? 1 : -1)))];
}
// Paper stays the visual focus. Presets vary the warmth of neutral surfaces;
// accents are reserved for actions, selection and focus, with no decorative tint.
export const PRESETS = {
  papilot: { light: { background: '#ffffff', foreground: '#1e1e1e', accent: '#0b8af0' }, dark: { background: '#2c2c2c', foreground: '#f0f0f0', accent: '#0b8af0' } },
  paper: { light: { background: '#faf9f6', foreground: '#302e2b', accent: '#74695c' }, dark: { background: '#282724', foreground: '#e8e6e1', accent: '#74695c' } },
  slate: { light: { background: '#f6f7f8', foreground: '#2c3035', accent: '#526477' }, dark: { background: '#24272b', foreground: '#e5e7ea', accent: '#526477' } },
} satisfies Record<PresetId, Record<ColorMode, { background: string; foreground: string; accent: string }>>;
export const ACCENTS = { blue: '#526477', graphite: '#55565a', stone: '#74695c' };

export function hexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{6}$/i.test(hex)) return '#' + hex.toLowerCase();
  if (/^[\da-f]{3}$/i.test(hex)) return '#' + [...hex].map(char => char + char).join('').toLowerCase();
}

// Stored preferences are untrusted: old or malformed values fall back field by field.
export function parseAppearance(value: string | null): Appearance {
  try {
    const saved = JSON.parse(value || '{}');
    const colors = (mode: ColorMode): Colors => ({ background: hexColor(saved?.colors?.[mode]?.background), foreground: hexColor(saved?.colors?.[mode]?.foreground) });
    return {
      preset: typeof saved?.preset === 'string' && Object.hasOwn(PRESETS, saved.preset) ? saved.preset : 'papilot',
      accent: typeof saved?.accent === 'string' && (saved.accent === 'default' || Object.hasOwn(ACCENTS, saved.accent)) ? saved.accent : 'default',
      colors: { light: colors('light'), dark: colors('dark') },
      pdf: saved?.pdf === 'light' ? 'light' : 'theme',
      review: saved?.review === 'theme' || saved?.review === 'light' ? saved.review : 'pdf',
      size: INTERFACE_SIZES.find(size => size === saved?.size) ?? 1,
    };
  } catch { return DEFAULT_APPEARANCE; }
}

export function mix(base: string, color: string, amount: number) {
  const channels = [1, 3, 5].map(index => Math.round(parseInt(base.slice(index, index + 2), 16) * (1 - amount) + parseInt(color.slice(index, index + 2), 16) * amount));
  return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
}

export function appearanceColors(appearance: Appearance, mode: ColorMode) {
  const preset = PRESETS[appearance.preset][mode];
  return { background: appearance.colors[mode].background || preset.background, foreground: appearance.colors[mode].foreground || preset.foreground, accent: appearance.accent === 'default' ? preset.accent : ACCENTS[appearance.accent] };
}

export function appearanceVariables(appearance: Appearance, mode: ColorMode): Record<string, string> {
  const { background: bg, foreground: fg, accent } = appearanceColors(appearance, mode);
  const dark = mode === 'dark';
  const darkPaper = dark && appearance.pdf === 'theme';
  const darkReview = appearance.review === 'pdf' ? darkPaper : dark && appearance.review === 'theme';
  const custom = appearance.preset !== 'papilot' || appearance.colors[mode].background || appearance.colors[mode].foreground;
  const customAccent = appearance.preset !== 'papilot' || appearance.accent !== 'default';
  const defaults = dark
    ? { '--sidebar': '#2c2c2c', '--bg-subtle': '#303030', '--bg-muted': '#383838', '--bg-hover': '#383838', '--bg-active': '#444444', '--canvas': '#1e1e1e', '--raised': '#333333', '--thumb': '#4d4d4d', '--line': '#444444', '--line-strong': '#4d4d4d', '--line-hover': '#5e5e5e', '--text-2': '#b3b3b3', '--text-3': '#8c8c8c' }
    : { '--sidebar': '#ffffff', '--bg-subtle': '#fafafa', '--bg-muted': '#f5f5f5', '--bg-hover': '#f0f0f0', '--bg-active': '#e6e6e6', '--canvas': '#f5f5f5', '--raised': '#ffffff', '--thumb': '#ffffff', '--line': '#e6e6e6', '--line-strong': '#d9d9d9', '--line-hover': '#c4c4c4', '--text-2': '#5e5e5e', '--text-3': '#8f8f8f' };
  const activeAccent = customAccent ? (dark ? mix(accent, '#ffffff', .45) : accent) : (dark ? '#3aa6ff' : '#0b8af0');
  return {
    '--bg': bg, '--text': fg,
    ...(custom ? {
      '--sidebar': bg, '--raised': dark ? mix(bg, fg, .04) : bg, '--thumb': dark ? mix(bg, fg, .15) : bg, '--bg-subtle': mix(bg, fg, .025), '--bg-muted': mix(bg, fg, .055),
      '--bg-hover': mix(bg, fg, .09), '--bg-active': mix(bg, fg, .14), '--canvas': mix(bg, dark ? '#000000' : fg, dark ? .24 : .05),
      '--line': mix(bg, fg, .12), '--line-strong': mix(bg, fg, .22), '--line-hover': mix(bg, fg, .32), '--text-2': mix(bg, fg, .76), '--text-3': mix(bg, fg, .58),
    } : defaults),
    '--accent': activeAccent, '--accent-hover': customAccent ? mix(activeAccent, dark ? '#ffffff' : '#000000', .18) : (dark ? '#6bbcff' : '#0a76d1'),
    '--accent-soft': !custom && !customAccent ? (dark ? '#1c3a57' : '#e5f3ff') : mix(bg, activeAccent, .11),
    '--accent-line': !custom && !customAccent ? (dark ? '#2e5f8c' : '#b3dbff') : mix(bg, activeAccent, .3),
    '--primary': accent, '--primary-hover': customAccent ? mix(accent, '#000000', .18) : (dark ? '#2496f2' : '#0a76d1'),
    '--menu-selection': mix(accent, '#000000', .16),
    '--ring': `0 0 0 1px ${activeAccent}`,
    '--pdf-filter': darkPaper ? 'invert(.84) hue-rotate(180deg)' : 'none',
    '--pdf-page': darkPaper ? '#292929' : '#ffffff',
    '--review-theme': darkReview ? 'dark' : 'light',
    '--review-filter': darkReview ? 'invert(.84) hue-rotate(180deg)' : 'none',
    '--review-page': darkReview ? '#292929' : '#ffffff',
    '--review-before': darkReview ? '#47271f' : '#fdede9',
    '--review-after': darkReview ? '#1e3a2a' : '#e6f6ec',
  };
}

const properties = Object.keys(appearanceVariables(DEFAULT_APPEARANCE, 'light'));
export function syncAppearance(source: HTMLElement, target: HTMLElement) {
  target.dataset.theme = source.dataset.theme;
  target.dataset.reviewTheme = source.style.getPropertyValue('--review-theme') || source.dataset.theme || 'light';
  for (const property of properties) {
    const value = source.style.getPropertyValue(property);
    if (value) target.style.setProperty(property, value); else target.style.removeProperty(property);
  }
}
