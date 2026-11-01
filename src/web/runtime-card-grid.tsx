import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react';

// Match the shared card grid's CSS so details always follow the selected row.
const columnQuery = '(max-width: 1000px)';
const gridColumns = () => window.matchMedia(columnQuery).matches ? 2 : 3;
function watchColumns(changed: () => void) {
  const media = window.matchMedia(columnQuery);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
}

export function RuntimeCardGrid({ tiles, selectedIndex, drawer }: { tiles: ReactElement[]; selectedIndex: number; drawer: ReactNode }) {
  const columns = useSyncExternalStore(watchColumns, gridColumns);
  const rowEnd = selectedIndex < 0 ? -1 : Math.min(Math.ceil((selectedIndex + 1) / columns) * columns, tiles.length) - 1;
  return <ul className="diagnostic-agent-grid">{tiles.flatMap((tile, index) => index === rowEnd && drawer
    ? [tile, <li key="drawer" className="runtime-agent-drawer">{drawer}</li>]
    : [tile])}</ul>;
}
