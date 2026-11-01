import type { CSSProperties } from 'react';
import { t } from './i18n.ts';

// Display and submit the provider's own levels; visual treatments never add
// capabilities to a model (in particular, Max and Ultra remain distinct).
export const effortName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const levels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function EffortSlider({ efforts, value, fallback, onChange }: {
  efforts: string[]; value: string; fallback: string | null; onChange: (value: string) => void;
}) {
  if (!efforts.length) return null;
  const current = efforts.find(item => item === value) || efforts.find(item => item === fallback);
  const index = current ? efforts.indexOf(current) : Math.floor((efforts.length - 1) / 2);
  const share = efforts.length > 1 ? index / (efforts.length - 1) : 1;
  const label = current ? effortName(current) : t('Model default');
  // Unknown provider levels get the ordinary accent, without implying Ultra.
  const level = current ? (levels.includes(current) ? current : 'custom') : 'default';
  const centre = (step: number) => `calc(15px + ${efforts.length > 1 ? step / (efforts.length - 1) : 1} * (100% - 30px))`;
  const style = { '--effort-position': centre(index), '--effort-fill-width': `calc(30px + ${share} * (100% - 30px))` } as CSSProperties;
  return <div className="agent-effort" data-effort={level} style={style}>
    <div className="effort-head"><span>{t('Reasoning effort')}</span><strong key={label} className="effort-value">{label}</strong></div>
    <div className={'effort-track' + (current ? '' : ' unset')}>
      <span className="effort-aura" aria-hidden="true"/>
      <span className="effort-fill" aria-hidden="true">
        <span className="effort-flow"/>
        {level === 'ultra' && <span className="effort-stars"><i/><i/><i/><i/><i/><i/></span>}
      </span>
      {efforts.map((item, step) => step !== index && <span key={item} aria-hidden="true" className={'effort-stop' + (current && step < index ? ' on' : '')} style={{ left: centre(step) }}/>)}
      <span className="effort-thumb" aria-hidden="true">
        {level === 'ultra' && <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path d="M10 1.5 12.4 7.6 18.5 10 12.4 12.4 10 18.5 7.6 12.4 1.5 10 7.6 7.6Z"/></svg>}
      </span>
      <input type="range" min={0} max={efforts.length - 1} step={1} value={index} aria-label={t('Reasoning effort')} aria-valuetext={label} disabled={efforts.length < 2}
        onChange={event => onChange(efforts[Number(event.target.value)])}/>
    </div>
    <div className="effort-scale"><span>{effortName(efforts[0])}</span><button type="button" onClick={() => onChange('')} disabled={!value}>{t('Model default')}</button><span>{effortName(efforts[efforts.length - 1])}</span></div>
  </div>;
}
