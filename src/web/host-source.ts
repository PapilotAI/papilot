import { OPEN_SOURCE, HOST_CAPABILITIES, type SourceLocation } from '../host-events.ts';

export function sourceHostAvailable() {
  const capabilities = { source: false };
  window.dispatchEvent(new CustomEvent(HOST_CAPABILITIES, { detail: capabilities }));
  return capabilities.source;
}

/** A host can cancel the event to take responsibility for opening the editor. */
export function openHostSource(location: SourceLocation): boolean {
  return !window.dispatchEvent(new CustomEvent(OPEN_SOURCE, { detail: location, cancelable: true }));
}
