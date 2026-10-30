import { useState } from 'react';
import { t } from './i18n.ts';
import { bindingLabel, defaults, keyBinding, reservedBinding, resolveShortcuts, saveShortcuts, shortcutActions, useShortcuts, type ShortcutAction } from './shortcuts.ts';

export function ShortcutSettings() {
  const shortcuts = useShortcuts();
  const [editing, setEditing] = useState<ShortcutAction | null>(null), [error, setError] = useState('');
  const labels: Record<ShortcutAction, [string, string]> = {
    accept: [t('Accept change'), t('Accept the current proposal. In Changes, stage or unstage it.')],
    reject: [t('Reject change'), t('Reject the current proposal. In Changes, revert it.')],
    comment: [t('Request a revision'), t('Write feedback on the current proposed change.')],
    next: [t('Next change'), t('Move to the next visible change.')],
    previous: [t('Previous change'), t('Move to the previous visible change.')],
    pending: [t('Next undecided change'), t('Jump to the next change that still needs a decision.')],
    source: [t('Show LaTeX source'), t('Show or hide the source for the current change.')],
    undo: [t('Undo review decision'), t('Undo the last review decision or revert.')],
    help: [t('Keyboard shortcuts'), t('Open these shortcut settings.')],
  };
  return <div className="shortcut-settings">
    <p className="shortcut-intro">{t('Review shortcuts work while the PDF review is focused. They pause while you type or select text. Changes are saved in this browser.')}</p>
    <p className="shortcut-instructions" id="shortcut-instructions">{t('Click a key to change it, then press the new shortcut. Escape cancels; Backspace clears it.')}</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="shortcut-list">{shortcutActions.map(action => <div className="shortcut-row" key={action}>
      <div><span id={`shortcut-${action}`} className="settings-name">{labels[action][0]}</span><p>{labels[action][1]}</p></div>
      <button type="button" className={'shortcut-key' + (editing === action ? ' recording' : '')} aria-label={t('Change shortcut: {action}', { action: labels[action][0] })} aria-describedby="shortcut-instructions"
        onClick={() => { setEditing(action); setError(''); }} onBlur={() => setEditing(null)}
        onKeyDown={event => {
          if (editing !== action) return;
          if (event.key === 'Tab') { setEditing(null); return; }
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Escape') { setEditing(null); setError(''); return; }
          const binding = keyBinding(event.nativeEvent);
          if (!binding) return;
          const clear = event.key === 'Backspace' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
          if (!clear && reservedBinding(binding)) { setError(t('This key is reserved for the browser or text editing. Choose another shortcut.')); return; }
          const conflict = shortcutActions.find(other => other !== action && shortcuts[other].includes(binding));
          if (!clear && conflict) { setError(t('Already used for {action}. Choose another shortcut.', { action: labels[conflict][0] })); return; }
          saveShortcuts({ ...shortcuts, [action]: clear ? [] : [binding] }); setEditing(null); setError('');
        }}><kbd>{editing === action ? t('Press a key…') : shortcuts[action].map(bindingLabel).join(' / ') || t('Not assigned')}</kbd></button>
    </div>)}</div>
    <button type="button" className="button secondary compact" disabled={JSON.stringify(shortcuts) === JSON.stringify(defaults)} onClick={() => { saveShortcuts(resolveShortcuts({})); setEditing(null); setError(''); }}>{t('Restore default shortcuts')}</button>
    <div className="shortcut-system"><h3>{t('Standard shortcuts')}</h3>
      <p>{t('These keep the usual browser and text-editing behavior.')}</p>
      <dl><dt><kbd>⌘ / Ctrl + C</kbd></dt><dd>{t('Copy selected PDF text')}</dd>
        <dt><kbd>⌘ / Ctrl + Z</kbd></dt><dd>{t('Undo typing, a deleted note, or the last review decision, depending on focus.')}</dd>
        <dt><kbd>⌘ / Ctrl + Enter</kbd></dt><dd>{t('Send the review comment being written.')}</dd>
        <dt><kbd>Esc</kbd></dt><dd>{t('Close the current editor or cancel region selection.')}</dd></dl>
    </div>
  </div>;
}
