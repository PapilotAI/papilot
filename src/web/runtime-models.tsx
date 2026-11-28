import { useState } from 'react';
import type { AgentModel } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

// An agent's models. With onHide, each one is a toggle for whether the
// pickers offer it. A long catalog can be searched, and Show all and Hide all
// then apply to the matches.
export function RuntimeModels({ models, connected, hidden = [], onHide, onRefresh, refreshing = false }: { models: AgentModel[]; connected: boolean; hidden?: string[]; onHide?: (hidden: string[]) => void; onRefresh?: () => void; refreshing?: boolean }) {
  const [expanded, setExpanded] = useState(false), [query, setQuery] = useState('');
  const terms = onHide ? query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
  const matches = terms.length ? models.filter(model => terms.every(term => `${model.name} ${model.id}`.toLocaleLowerCase().includes(term))) : models;
  const visible = expanded || terms.length ? matches : matches.slice(0, 6);
  const hiddenCount = models.filter(model => hidden.includes(model.id)).length;
  const matching = matches.map(model => model.id);
  const toggle = (id: string) => onHide?.(hidden.includes(id) ? hidden.filter(item => item !== id) : [...hidden, id]);
  const showAll = Boolean(onHide && connected && matching.some(id => hidden.includes(id)));
  const hideAll = Boolean(onHide && connected && matching.some(id => !hidden.includes(id)));
  return <section className="runtime-agent-models" aria-label={t('Available models')}>
    <div className="runtime-models-head">
      <h5>{t('Available models')}{connected && models.length > 0 && <small>{hiddenCount ? t('{shown} of {total}', { shown: models.length - hiddenCount, total: models.length }) : models.length}</small>}</h5>
      {(showAll || hideAll || (connected && onRefresh)) && <div className="runtime-models-actions">
        {showAll && <button type="button" onClick={() => onHide!(hidden.filter(id => !matching.includes(id)))}>{t('Show all')}</button>}
        {hideAll && <button type="button" onClick={() => onHide!([...new Set([...hidden, ...matching])])}>{t('Hide all')}</button>}
        {connected && onRefresh && <button type="button" disabled={refreshing} aria-busy={refreshing || undefined} onClick={onRefresh}>{refreshing ? t('Refreshing…') : t('Refresh')}</button>}
      </div>}
    </div>
    {!connected ? <p>{t('Connect and sign in to load the model list.')}</p> : !models.length ? <p>{t('This agent has not reported a model list. Its configured default can still be used.')}</p> : <>
      {onHide && models.length > 6 && <label className="model-search runtime-model-search"><Icon name="search" size={13}/><input type="search" value={query} placeholder={t('Search models')} aria-label={t('Search models')} onChange={event => setQuery(event.target.value)}/></label>}
      {onHide
        ? <div className="runtime-model-list runtime-model-toggles" role="group" aria-label={t('Models offered in the model picker')}>{visible.map(model => (
          <button key={model.id} type="button" aria-pressed={!hidden.includes(model.id)} title={model.id} onClick={() => toggle(model.id)}><Icon name={hidden.includes(model.id) ? 'plus' : 'check'} size={12}/><span>{model.name || model.id}</span></button>
        ))}</div>
        : <ul className="runtime-model-list" tabIndex={expanded ? 0 : undefined}>{visible.map(model => <li key={model.id} title={model.id}>
          <span>{model.name || model.id}</span>{model.isDefault && <small>{t('Default')}</small>}
        </li>)}</ul>}
      {terms.length > 0 && !matches.length && <p className="runtime-model-empty">{t('No models match “{query}”', { query: query.trim() })}</p>}
      {!terms.length && models.length > 6 && <button type="button" className="runtime-model-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('Show fewer models') : t('Show {n} more models', { n: models.length - visible.length })}<Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={13}/></button>}
    </>}
  </section>;
}
