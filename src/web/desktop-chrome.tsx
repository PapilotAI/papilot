import './desktop-chrome.css';
import { createPortal } from 'react-dom';
import { APPEARANCE_KEY, parseAppearance, resolveWindowControls, resolveWindowControlsStyle, type WindowControlsPosition, type WindowControlsStyle } from './appearance.ts';
import { t } from './i18n.ts';
import { browserStorage } from './storage.ts';
import type { TypelessStatus } from '../../desktop/typeless-control.ts';

declare global {
  interface Window {
    papilotDesktop?: {
      platform: string; minimize(): void; maximize(): void; close(): void;
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
if (desktopWindow) {
  const platform = window.papilotDesktop!.platform;
  const saved = parseAppearance(browserStorage.getItem(APPEARANCE_KEY));
  document.documentElement.dataset.desktop = platform;
  document.documentElement.dataset.desktopControls = resolveWindowControls(saved.windowControls, platform);
  document.documentElement.dataset.desktopControlsStyle = resolveWindowControlsStyle(saved.windowControlsStyle, platform);
}
// The desktop app opens papers in place, as folders from the system picker.
// Nothing is typed, uploaded or copied.
export const nativeFolders = Boolean(window.papilotDesktop?.chooseDirectory);
export const chooseDirectory = () => window.papilotDesktop!.chooseDirectory!();

export function DesktopWindowChrome({ windowControls = 'auto', windowControlsStyle = 'auto', sidebarCollapsed = false }: { windowControls?: WindowControlsPosition; windowControlsStyle?: WindowControlsStyle; sidebarCollapsed?: boolean }) {
  if (!desktopWindow) return null;
  const controls = window.papilotDesktop!;
  const side = resolveWindowControls(windowControls, controls.platform);
  const style = resolveWindowControlsStyle(windowControlsStyle, controls.platform);
  const close = <button type="button" className="desktop-window-close" aria-label={t('Close window')} title={t('Close window')} onClick={() => controls.close()}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>;
  const chrome = <div className="desktop-window-drag" data-side={side} data-style={style} data-collapsed={sidebarCollapsed || undefined}>
    {controls.platform !== 'darwin' && <div className="desktop-window-buttons">
      {side === 'left' && close}
      <button type="button" aria-label={t('Minimize window')} title={t('Minimize window')} onClick={() => controls.minimize()}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 8h10"/></svg></button>
      <button type="button" aria-label={t('Maximize or restore window')} title={t('Maximize or restore window')} onClick={() => controls.maximize()}><svg aria-hidden="true" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></svg></button>
      {side === 'right' && close}
    </div>}
  </div>;
  // Windows applies overlapping drag/no-drag rectangles in DOM order, even
  // when z-index paints these buttons above a later toolbar. Put non-macOS
  // controls after the workspace so their no-drag regions win native hit
  // testing on either side, whether the sidebar is open or collapsed.
  return controls.platform !== 'darwin' ? createPortal(chrome, document.body) : chrome;
}
