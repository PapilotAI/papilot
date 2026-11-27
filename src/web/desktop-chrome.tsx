import './desktop-chrome.css';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { t } from './i18n.ts';
import type { TypelessStatus } from '../../desktop/typeless-control.ts';
import type { WindowButton, WindowButtons } from '../../desktop/window-buttons.ts';

declare global {
  interface Window {
    papilotDesktop?: {
      platform: string; windowButtons?: WindowButtons; minimize(): void; maximize(): void; close(): void;
      typelessStatus?(): Promise<TypelessStatus>;
      typelessShortcut?(inputId: string): Promise<TypelessStatus>;
      chooseDirectory?(): Promise<string | null>;
      overleafSignIn?(origin: string): Promise<string | null>;
      openEnvironment?(): Promise<void>;
      environment?(): Promise<string>;
      onOpenSettings?(listener: () => void): () => void;
      onOpenFolder?(listener: (folder: string) => void): () => void;
      takeNewPaper?(): Promise<{ id: string; version: string } | null>;
      onNewPaper?(listener: () => void): () => void;
      notify?(alert: { taskId: string | null; title: string; body: string; sound: boolean }): Promise<boolean>;
      onOpenTask?(listener: (taskId: string) => void): () => void;
      setZoom?(factor: number): void;
      onZoom?(listener: (direction: 'in' | 'out' | 'reset') => void): () => void;
    };
  }
}
export const desktopWindow = Boolean(window.papilotDesktop);
// Windows always puts these buttons on the right. Linux desktops choose their
// own buttons and side, which the desktop app reads from the system; without
// it, they keep a GNOME-style close button first on the left.
function windowButtons(): WindowButtons {
  const platform = window.papilotDesktop!.platform, system = window.papilotDesktop!.windowButtons;
  if (platform === 'win32') return { side: 'right', buttons: ['minimize', 'maximize', 'close'] };
  if (platform === 'darwin') return { side: 'left', buttons: [] };
  const buttons = Array.isArray(system?.buttons) ? system.buttons.filter(button => ['minimize', 'maximize', 'close'].includes(button)) : [];
  return (system?.side === 'left' || system?.side === 'right') && buttons.length ? { side: system.side, buttons } : { side: 'left', buttons: ['close', 'minimize', 'maximize'] };
}
const layout = desktopWindow ? windowButtons() : null;
if (layout) {
  const root = document.documentElement;
  root.dataset.desktop = window.papilotDesktop!.platform;
  root.dataset.desktopControls = layout.side;
  root.style.setProperty('--desktop-window-buttons', String(layout.buttons.length));
}
// The desktop app opens papers in place, as folders from the system picker.
// Nothing is typed, uploaded or copied.
export const nativeFolders = Boolean(window.papilotDesktop?.chooseDirectory);
export const chooseDirectory = () => window.papilotDesktop!.chooseDirectory!();

export function DesktopWindowChrome() {
  if (!layout) return null;
  const controls = window.papilotDesktop!;
  const button: Record<WindowButton, ReactNode> = {
    minimize: <button key="minimize" type="button" aria-label={t('Minimize window')} title={t('Minimize window')} onClick={() => controls.minimize()}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 8h10"/></svg></button>,
    maximize: <button key="maximize" type="button" aria-label={t('Maximize or restore window')} title={t('Maximize or restore window')} onClick={() => controls.maximize()}><svg aria-hidden="true" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></svg></button>,
    close: <button key="close" type="button" className="desktop-window-close" aria-label={t('Close window')} title={t('Close window')} onClick={() => controls.close()}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>,
  };
  const chrome = <div className="desktop-window-drag">
    {layout.buttons.length > 0 && <div className="desktop-window-buttons">{layout.buttons.map(name => button[name])}</div>}
  </div>;
  // Windows applies overlapping drag/no-drag rectangles in DOM order, even
  // when z-index paints these buttons above a later toolbar. Put right-side
  // controls after the workspace, whose toolbars they overlap, so their
  // no-drag regions win native hit testing.
  return layout.side === 'right' ? createPortal(chrome, document.body) : chrome;
}
