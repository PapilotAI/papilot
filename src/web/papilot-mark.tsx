import './papilot-mark.css';

type Part = 'top' | 'line' | 'bottom';
type Capsule = readonly [x: number, y: number, width: number, height: number, part: Part];

// The app icon's mark (desktop/assets/icon.svg), flat: navy capsules, the coral
// line and blue capsules, laid along the line before rotating it 45 degrees.
const full: readonly Capsule[] = [
  [-174, -229, 236, 68, 'top'], [-124, -127, 336, 68, 'top'], [-323, -24, 634, 48, 'line'],
  [-124, 59, 336, 68, 'bottom'], [-174, 161, 236, 68, 'bottom'],
];
// At 20 px and below the five stripes run together, so draw the three-stripe
// cut the 16 and 32 px app icons use (desktop/assets/icon-small.svg).
const compact: readonly Capsule[] = [[-180, -172, 380, 104, 'top'], [-310, -34, 620, 68, 'line'], [-180, 68, 380, 104, 'bottom']];

// Decorative: every use sits beside the product name or in a labelled control.
export function PapilotMark({ size, className }: { size: number; className?: string }) {
  const small = size <= 20;
  return <svg className={className ? `papilot-mark ${className}` : 'papilot-mark'} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <g transform={small ? 'translate(31.2657 32.7343) scale(0.119) rotate(-45)' : 'translate(34.4715 29.5285) scale(0.1125) rotate(-45)'}>
      {(small ? compact : full).map(([x, y, width, height, part]) => <rect key={`${x},${y}`} className={`mark-${part}`} x={x} y={y} width={width} height={height} rx={height / 2}/>)}
    </g>
  </svg>;
}
