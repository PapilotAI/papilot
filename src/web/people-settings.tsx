import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import info from 'virtual:papilot-info';
import type { Device, People, Person, Project } from '../shared.ts';

type Api = <T = any>(route: string, body?: unknown) => Promise<T>;
export interface PeopleSettingsProps { api: Api; projects: Project[]; ago: (timestamp: number) => string }
export interface PeopleSettingsControls { isBusy: () => boolean }

// The owner invites people, chooses which papers each can open, and removes
// them or one of their devices. Invite links are shown once, to send yourself.
export function PeopleSettings({ api, projects, ago, controls }: PeopleSettingsProps & { controls: Ref<PeopleSettingsControls> }) {
  const [people, setPeople] = useState<People | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({}), [removing, setRemoving] = useState('');
  const [name, setName] = useState(''), [shared, setShared] = useState<string[]>([]);
  useEffect(() => { void run('load', () => api<People>('/people')); }, []);
  useImperativeHandle(controls, () => ({ isBusy: () => Boolean(busy && busy !== 'load') }));
  async function run(key: string, work: () => Promise<People | void>) {
    setBusy(key); setError('');
    try { const next = await work(); if (next) setPeople(next); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  }
  const invite = () => run('invite', async () => {
    const created = await api<{ id: string; link: string }>('/people', { name: name.trim(), projects: shared });
    setLinks(current => ({ ...current, [created.id]: created.link })); setName(''); setShared([]);
    return api<People>('/people');
  });
  const newLink = (person: Person) => run('link:' + person.id, async () => { const { link } = await api<{ link: string }>(`/people/${person.id}/invite`, {}); setLinks(current => ({ ...current, [person.id]: link })); });
  // The box changes at once; a failed save puts back what the server has.
  const share = (person: Person, projectId: string, on: boolean) => {
    const projects = on ? [...person.projects, projectId] : person.projects.filter(id => id !== projectId);
    setPeople(current => current && { ...current, people: current.people.map(other => other.id === person.id ? { ...other, projects } : other) });
    return run('share:' + person.id, () => api<People>(`/people/${person.id}/share`, { projects }).catch(async error => { setPeople(await api<People>('/people')); throw error; }));
  };
  const revoke = (person: Person, device: Device) => run('device:' + device.id, () => api<People>(`/people/${person.id}/devices/${device.id}/remove`, {}));
  const remove = (person: Person) => run('remove:' + person.id, () => api<People>(`/people/${person.id}/remove`, {}));
  const signOut = (person: Person) => run('sign-out:' + person.id, () => api<People>(`/people/${person.id}/sign-out`, {}));
  const papers = (selected: string[], toggle: (projectId: string, on: boolean) => void, disabled: boolean, label: string) => <fieldset className="people-papers" disabled={disabled}>
    <legend>{label}</legend>
    {projects.map(project => <label key={project.id} className="checkbox"><input type="checkbox" checked={selected.includes(project.id)} onChange={event => toggle(project.id, event.target.checked)}/>{project.name}</label>)}
  </fieldset>;
  return <div className="people-settings settings-page">
      <p className="settings-intro">{t('Share your papers and manage the people you work with.')}</p>
      <aside className="people-warning" aria-labelledby="people-warning-title">
        <Icon name="alert" size={20}/>
        <div><h3 id="people-warning-title">{t('Sharing is not sandboxed')}</h3>
          <p>{t('Invited people can access all files readable by Papilot, including credentials and unshared papers.')}</p>
          <p>{t('Run Papilot and its agents in an isolated container such as Docker to limit access; mounted files remain accessible.')}</p>
          <details className="people-access-details"><summary>{t('What can invited people do?')}<Icon name="chevronDown" size={13}/></summary>
            <p>{t('People you invite sign in with a passkey at the public address and can do everything you can in the papers you share with them, including approving the commands agents run on this host and pushing with its Git credentials.')}</p>
          </details>
        </div>
      </aside>
      {people && !people.origin && <section className="people-setup settings-card settings-card-body" aria-labelledby="people-setup-title">
        <div className="people-setup-heading"><span className="people-setup-icon"><Icon name="people" size={23}/></span><span className="people-badge">{t('Setup required')}</span></div>
        <h3 id="people-setup-title">{t('Bring your collaborators in')}</h3>
        <p>{t('Connect a public HTTPS address to invite people to your papers. They can sign in securely with a passkey.')}</p>
        <a className="button secondary" href={`${info.repository}/blob/main/docs/guide.md#collaborators`} target="_blank" rel="noopener noreferrer">{t('Set up sharing')}<Icon name="external" size={14}/><span className="sr-only">{t('Opens in a new tab')}</span></a>
      </section>}
      {people?.origin && <form className="people-invite settings-card settings-card-body" onSubmit={event => { event.preventDefault(); if (name.trim()) void invite(); }}>
        <div className="people-invite-heading"><Icon name="people" size={18}/><h3>{t('Invite someone')}</h3></div>
        <p className="people-invite-description">{t('Choose the papers to share, then send a personal invite link.')}</p>
        <label><span>{t('Name')}</span><input aria-label={t('Invite someone')} value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder={t('Their name, as others will see it')} autoComplete="off"/></label>
        {papers(shared, (id, on) => setShared(current => on ? [...current, id] : current.filter(other => other !== id)), busy === 'invite', t('Papers they can open'))}
        <div className="button-row"><button className="button primary" disabled={!name.trim() || Boolean(busy)}>{busy === 'invite' ? t('Creating…') : t('Create invite link')}</button></div>
      </form>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!people && busy === 'load' && <p className="muted" role="status">{t('Loading people…')}</p>}
      {people && <section className="people-members" aria-labelledby="people-members-title">
      <div className="people-section-heading"><h3 id="people-members-title">{t('Members')}</h3><span className="people-count">{people.people.length}</span></div>
      <ul className="people-list settings-card">{people.people.map(person => {
        const owner = person.role === 'owner', sessions = person.devices.filter(device => device.kind === 'session');
        return <li key={person.id} className="person">
          <div className="person-head">
            <span className="person-avatar" aria-hidden="true">{Array.from(person.name.trim())[0]?.toLocaleUpperCase() || '?'}</span>
            <div className="person-identity"><strong>{owner ? t('{name} (you)', { name: person.name }) : person.name}</strong>
              <span>{owner ? t('Access to all papers') : !person.joined ? t('Invited, not joined yet') : person.lastSeenAt ? t('Last active {time}', { time: ago(person.lastSeenAt) }) : t('Joined')}</span></div>
            {owner && <span className="people-badge">{t('Owner')}</span>}
          </div>
          {!owner && papers(person.projects, (id, on) => void share(person, id, on), busy === 'share:' + person.id, t('Papers {name} can open', { name: person.name }))}
          {links[person.id] && <div className="invite-link">
            <input readOnly aria-label={t('Invite link for {name}', { name: person.name })} value={links[person.id]} onFocus={event => event.currentTarget.select()}/>
            <button type="button" className="button secondary compact" onClick={() => void navigator.clipboard?.writeText(links[person.id])}><Icon name="copy" size={14}/>{t('Copy')}</button>
            <small className="muted">{owner ? t('Open it on the device you want to sign in from. It works once, within 15 minutes.') : t('Send it to {name} yourself. It works once, within 7 days.', { name: person.name })}</small>
          </div>}
          {person.devices.length > 0 && <ul className="device-list">{person.devices.map(device => <li key={device.id}>
            <Icon name={device.kind === 'passkey' ? 'key' : 'monitor'} size={14}/>
            <span>{device.kind === 'passkey' ? t('Passkey · {label}', { label: device.label }) : t('Signed in · {label}', { label: device.label })}</span>
            <span className="muted">{device.lastUsedAt ? t('used {time}', { time: ago(device.lastUsedAt) }) : t('added {time}', { time: ago(device.createdAt) })}</span>
            <button type="button" className="button secondary compact" disabled={Boolean(busy)} aria-label={t('Remove {device}', { device: device.label })} onClick={() => void revoke(person, device)}>{t('Remove')}</button>
          </li>)}</ul>}
          {people.origin && <div className="person-actions">
            <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => void newLink(person)}>{owner ? t('Sign in from anywhere') : person.joined ? t('Invite link for a new device') : t('New invite link')}</button>
            {sessions.length > 0 && <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => void signOut(person)}>{t('Sign out everywhere')}</button>}
            {!owner && (removing === person.id
              ? <><button type="button" className="button danger compact" disabled={Boolean(busy)} onClick={() => { setRemoving(''); void remove(person); }}>{t('Remove {name}', { name: person.name })}</button><button type="button" className="button secondary compact" onClick={() => setRemoving('')}>{t('Cancel')}</button></>
              : <button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => setRemoving(person.id)}>{t('Remove…')}</button>)}
          </div>}
        </li>;
      })}</ul>
      </section>}
  </div>;
}
