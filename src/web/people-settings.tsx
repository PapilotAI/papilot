import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
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
      <p className="settings-intro">{t('People you invite sign in with a passkey at the public address and can do everything you can in the papers you share with them, including approving the commands agents run on this host and pushing with its Git credentials.')}</p>
      <p className="people-warning settings-notice"><Icon name="alert" size={15}/><span>{t('Agents and builds can read any file on this host, including your other papers. Invite only people you would trust with access to it.')}</span></p>
      {people && !people.origin && <p className="people-setup settings-card settings-card-body">{t('To invite people, give Papilot a public HTTPS address: set PAPILOT_ACCOUNT_ORIGIN and forward it to this host, as the Collaborators section of the guide describes.')}</p>}
      {people?.origin && <form className="people-invite settings-card settings-card-body" onSubmit={event => { event.preventDefault(); if (name.trim()) void invite(); }}>
        <label>{t('Invite someone')}<input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder={t('Their name, as others will see it')} autoComplete="off"/></label>
        {papers(shared, (id, on) => setShared(current => on ? [...current, id] : current.filter(other => other !== id)), busy === 'invite', t('Papers they can open'))}
        <div className="button-row"><button className="button primary" disabled={!name.trim() || Boolean(busy)}>{busy === 'invite' ? t('Creating…') : t('Create invite link')}</button></div>
      </form>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!people && busy === 'load' && <p className="muted" role="status">{t('Loading people…')}</p>}
      <ul className="people-list">{people?.people.map(person => {
        const owner = person.role === 'owner', sessions = person.devices.filter(device => device.kind === 'session');
        return <li key={person.id} className="person settings-card settings-card-body">
          <div className="person-head"><strong>{owner ? t('{name} (you)', { name: person.name }) : person.name}</strong>
            <span className="muted">{owner ? t('Owner') : !person.joined ? t('Invited, not joined yet') : person.lastSeenAt ? t('Last active {time}', { time: ago(person.lastSeenAt) }) : t('Joined')}</span></div>
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
  </div>;
}
