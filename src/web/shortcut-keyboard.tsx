import { useState } from 'react';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { shortcutActions, type ShortcutAction, type Shortcuts } from './shortcuts.ts';

export function shortcutTone(action: ShortcutAction) {
  return ['accept', 'reject', 'comment', 'undo'].includes(action) ? 'decisions' : ['next', 'previous', 'pending'].includes(action) ? 'navigation' : 'view';
}

type Key = { key: string; label?: string; width?: number };
const letters = (keys: string): Key[] => [...keys].map(key => ({ key }));
// A compact QWERTY reference. Bindings still use the character reported by the
// user's keyboard; '?' shares the slash key and implies Shift in this diagram.
const rows: Key[][] = [
  [...letters('`1234567890-='), { key: 'Backspace', label: '⌫', width: 2 }],
  [{ key: 'Tab', label: 'tab', width: 1.5 }, ...letters('qwertyuiop[]'), { key: '\\', width: 1.5 }],
  [{ key: 'CapsLock', label: 'caps', width: 1.75 }, ...letters("asdfghjkl;'"), { key: 'Enter', label: '↵', width: 2.25 }],
  [{ key: 'Shift', label: '⇧', width: 2.25 }, ...letters('zxcvbnm,./'), { key: 'Shift', label: '⇧', width: 2.75 }],
  [{ key: 'Ctrl', width: 1.25 }, { key: 'Alt', width: 1.25 }, { key: 'Meta', width: 1.25 }, { key: ' ', label: '', width: 7 }, { key: 'Meta', width: 1.25 }, { key: 'ArrowLeft', label: '←' }, { key: 'arrows' }, { key: 'ArrowRight', label: '→' }],
];
function physicalKey(binding: string) { const key = binding.split('+').at(-1)!; return key === '?' ? '/' : key; }
function includesKey(binding: string, key: string) { return physicalKey(binding) === key || binding.split('+').slice(0, -1).includes(key) || (key === 'Shift' && binding.endsWith('?')); }

export function ShortcutKeyboard({ shortcuts, labels, mac, keyLabel, active, onHighlight, onEdit }: {
  shortcuts: Shortcuts;
  labels: Record<ShortcutAction, [string, string]>;
  mac: boolean;
  keyLabel: (binding: string) => string;
  active: ShortcutAction | null;
  onHighlight: (action: ShortcutAction | null) => void;
  onEdit: (action: ShortcutAction) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const assignments = (key: string) => shortcutActions.filter(action => shortcuts[action].some(binding => physicalKey(binding) === key));
  const selectedActions = selectedKey ? assignments(selectedKey) : [];
  function keycap({ key, label, width = 1 }: Key, index = 0) {
    if (key === 'arrows') return <span className="shortcut-keyboard-arrows" key={key}>{keycap({ key: 'ArrowUp', label: '↑' })}{keycap({ key: 'ArrowDown', label: '↓' })}</span>;
    const actions = assignments(key), action = active && actions.includes(active) ? active : actions[0];
    const lit = active && shortcuts[active].some(binding => includesKey(binding, key));
    const caption = label ?? (key === 'Meta' ? mac ? '⌘' : 'Win' : key === 'Alt' && mac ? '⌥' : key.toUpperCase());
    const className = 'shortcut-keycap' + (actions.length ? ' assigned' : '') + (lit ? ' lit' : '');
    const content = <><span>{caption}</span>{key === '/' && <small>?</small>}{actions.length > 0 && <i/>}</>;
    return actions.length ? <button type="button" key={`${key}-${index}`} className={className} style={{ flexGrow: width }} data-key={key} data-tone={shortcutTone(action)}
      aria-label={t('Keyboard key {key}: {actions}', { key: caption, actions: actions.map(action => `${labels[action][0]} (${shortcuts[action].filter(binding => physicalKey(binding) === key).map(keyLabel).join(', ')})`).join('; ') })}
      onMouseEnter={() => onHighlight(action)} onMouseLeave={() => onHighlight(null)} onFocus={() => onHighlight(action)} onBlur={() => onHighlight(null)}
      onClick={() => { if (actions.length === 1) { setSelectedKey(null); onEdit(action); } else setSelectedKey(key); }}>{content}</button>
      : <span key={`${key}-${index}`} className={className} style={{ flexGrow: width }} data-key={key} data-tone={lit && active ? shortcutTone(active) : undefined} aria-hidden="true">{content}</span>;
  }
  return <section className="shortcut-overview" aria-labelledby="shortcut-keyboard-title">
    <header className="shortcut-overview-header">
      <div><h3 id="shortcut-keyboard-title">{t('Your review keyboard')}</h3><p>{t('Click a highlighted key to customize it.')}</p></div>
      <span className="shortcut-layout-label">QWERTY</span>
    </header>
    <div className="shortcut-keyboard" role="group" aria-label={t('Review shortcut keyboard')}>
      {rows.map((row, index) => <div className="shortcut-keyboard-row" key={index}>{row.map(keycap)}</div>)}
    </div>
    <div className="shortcut-keyboard-legend">
      <span data-tone="decisions"><i className="shortcut-dot"/>{t('Review decisions')}</span>
      <span data-tone="navigation"><i className="shortcut-dot"/>{t('Review navigation')}</span>
      <span data-tone="view"><i className="shortcut-dot"/>{t('View & help')}</span>
    </div>
    <div className="shortcut-keyboard-detail">
      {selectedActions.length > 1 ? <div className="shortcut-keyboard-choices"><span>{t('Choose a shortcut to edit:')}</span>{selectedActions.map(action => <button type="button" key={action} onClick={() => { setSelectedKey(null); onEdit(action); }}>{labels[action][0]} <kbd>{shortcuts[action].filter(binding => physicalKey(binding) === selectedKey).map(keyLabel).join(' / ')}</kbd></button>)}</div>
        : active ? <><span className="shortcut-detail-keys">{shortcuts[active].map(binding => <kbd key={binding}>{keyLabel(binding)}</kbd>)}</span><span><strong>{labels[active][0]}</strong><span className="shortcut-detail-description">{labels[active][1]}</span></span></>
          : <><Icon name="keyboard" size={19}/><span>{t('Hover over a highlighted key to see what it does.')}</span></>}
    </div>
  </section>;
}
