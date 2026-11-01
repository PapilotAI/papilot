import { useState } from 'react';
import type { AgentModel } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

export function RuntimeModels({ models, connected }: { models: AgentModel[]; connected: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? models : models.slice(0, 6);
  return <section className="runtime-agent-models" aria-label={t('Available models')}>
    <h5>{t('Available models')}{connected && models.length > 0 && <small>{models.length}</small>}</h5>
    {!connected ? <p>{t('Connect and sign in to load the model list.')}</p> : !models.length ? <p>{t('This agent has not reported a model list. Its configured default can still be used.')}</p> : <>
      <ul className="runtime-model-list" tabIndex={expanded ? 0 : undefined}>{visible.map(model => <li key={model.id} title={model.id}>
        <span>{model.name || model.id}</span>{model.isDefault && <small>{t('Default')}</small>}
      </li>)}</ul>
      {models.length > 6 && <button type="button" className="runtime-model-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('Show fewer models') : t('Show {n} more models', { n: models.length - visible.length })}<Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={13}/></button>}
    </>}
  </section>;
}
