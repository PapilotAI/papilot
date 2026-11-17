/** Optional host integration. The web app works unchanged without listeners. */
export const OPEN_SOURCE = 'papilot:host:open-source';
export const OPEN_PAPER = 'papilot:host:open-paper';
export const SHOW_SOURCE = 'papilot:host:show-source';
export const SOURCE_SAVED = 'papilot:host:source-saved';
export const SOURCE_READY = 'papilot:host:source-ready';
export const SELECT_PAPER = 'papilot:host:select-paper';
export const HOST_READY = 'papilot:host:ready';
export const HOST_CAPABILITIES = 'papilot:host:capabilities';
export interface PaperSelection { projectId: string; taskId?: string; main?: string }
export interface SourceLocation {
  projectId: string;
  taskId?: string;
  file: string;
  /** Zero-based, end-exclusive lines, as in the source API. */
  lines: [number, number];
}
