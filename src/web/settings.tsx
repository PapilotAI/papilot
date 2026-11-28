import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { BrandIcon } from './brand-icon.tsx';
import { PapilotMark } from './papilot-mark.tsx';
import { ChipSelect } from './chip-select.tsx';
import { keepDialogFocus } from './focus.ts';
import { LANGUAGES, browserLanguage, errorText, setLanguage, t, useLanguage, type LanguageChoice } from './i18n.ts';
import { NotificationSettings } from './notification-settings.tsx';
import { browserStorage } from './storage.ts';
import { loadIndirectChanges, saveIndirectChanges, useIndirectChanges } from './effect-preferences.ts';
import { loadNoteAlternatives } from './note-option-preferences.ts';
import { NoteOptionSettings } from './note-option-settings.tsx';
import { agentLabel, offeredAgents } from './agent-choice.ts';
import { CommitAgentSettings, ConflictAgentSettings } from './commit-agent-settings.tsx';
import type { CommitMessageChoice } from './commit-agent-preferences.ts';
import type { RefreshUsage } from './usage.tsx';
import { saveAdvancedGit, useAdvancedGit, saveCommitMessageLanguage, useCommitMessageLanguage } from './git-preferences.ts';
import type { CommitMessageLanguage } from '../commit.ts';
import { AppearanceSettings, type AppearanceSettingsProps } from './appearance-settings.tsx';
import { ShortcutSettings } from './shortcut-settings.tsx';
import { QuickNoteSettings } from './quick-note-settings.tsx';
import { AboutSettings, LicenseSettings } from './about-settings.tsx';
import info from 'virtual:papilot-info';
import { DiagnosticsSettings, type DiagnosticsSettingsProps } from './diagnostics-settings.tsx';
import { ToolRequirement, type RequirementsState } from './system-requirements.tsx';
import { LatexSettings } from './latex-settings.tsx';
import { ExperimentSettings } from './experiment-settings.tsx';
import { UpdateSettings, versionLabel, type UpdateApi } from './update-notice.tsx';
import { SkillLibraryPanel, type SkillLibraryControls, type SkillLibraryOptions } from './skill-library.tsx';
import { MemorySettings, type MemorySettingsOptions } from './memory-settings.tsx';
import type { CollaborationSettingsProps } from './collaboration-settings.tsx';
import type { ChatgptProSettingsProps } from './chatgpt-pro-settings.tsx';
import { ModelDefaultSettings, type ModelDefaultSettingsProps } from './model-default-settings.tsx';
import { ActivitySettings, type LoadActivity } from './activity-settings.tsx';
import { OverleafAccounts } from './overleaf.tsx';
import { ZoteroSettings, type ZoteroApi } from './zotero-settings.tsx';
import { initialsFor } from './host-account-menu.tsx';
import type { HostChrome, OverleafState } from '../shared.ts';

type SettingsPage = 'general' | 'appearance' | 'notifications' | 'review' | 'quickNotes' | 'shortcuts' | 'statistics' | 'about' | 'licenses' | 'agents' | 'git' | 'latex' | 'skills' | 'memory' | 'updates' | 'overleaf' | 'zotero' | 'experiments';
export type SettingsInitialPage = 'general' | 'shortcuts' | 'quickNotes' | 'statistics' | 'git' | 'git-conflicts' | 'latex' | 'agents' | 'memory';
type SettingsEntry = { page: SettingsPage; label: string; icon: string; keywords?: string };

// Shared with the review page's bibliography checks.
const REFERENCE_CHECKS = 'papilot:review:references';

export function SettingsDialog({ theme, onTheme, resolved, appearance, onAppearance, onClose, diagnostics, requirements, skills, activity, updates, modelDefaults, workflow, chatgptPro, overleaf, zotero, commitWriter, conflictWriter, refreshUsage, memory, host, singleAgent = false, initialPage = 'general' }: AppearanceSettingsProps & { onClose: () => void; diagnostics?: DiagnosticsSettingsProps; requirements?: { state: RequirementsState; online: boolean }; skills?: SkillLibraryOptions; activity?: LoadActivity; memory?: MemorySettingsOptions; updates?: UpdateApi; modelDefaults: ModelDefaultSettingsProps; commitWriter?: CommitMessageChoice; conflictWriter: CommitMessageChoice; refreshUsage?: RefreshUsage; workflow?: CollaborationSettingsProps; chatgptPro?: ChatgptProSettingsProps; overleaf?: { api: UpdateApi; state: OverleafState | undefined }; zotero?: ZoteroApi; host?: HostChrome; singleAgent?: boolean; initialPage?: SettingsInitialPage }) {
  const hosted = Boolean(host);
  const dialog = useRef<HTMLDialogElement>(null);
  const skillControls = useRef<SkillLibraryControls>(null);
  const focusConflictAgent = useRef(initialPage === 'git-conflicts');
  const { choice } = useLanguage();
  const indirectChanges = useIndirectChanges();
  const advancedGit = useAdvancedGit();
  const gitAgents = (diagnostics ? offeredAgents(diagnostics.runtimes).map(value => ({ value, label: agentLabel(value), runtime: diagnostics.runtimes[value] })) : modelDefaults.agents).filter(item => item.value !== 'collaboration' && item.value !== 'chatgpt');
  const commitLanguage = useCommitMessageLanguage();
  useEffect(loadIndirectChanges, []);
  useEffect(loadNoteAlternatives, []);
  const [page, setPage] = useState<SettingsPage>(initialPage === 'git-conflicts' ? 'git' : initialPage);
  const [showCategories, setShowCategories] = useState(() => initialPage === 'general' && window.matchMedia('(max-width: 760px)').matches);
  const [query, setQuery] = useState('');
  const [environment, setEnvironment] = useState('');
  useEffect(() => { if (window.papilotDesktop?.platform === 'win32') void window.papilotDesktop.environment?.().then(setEnvironment); }, []);
  const [checkReferences, setCheckReferences] = useState(() => browserStorage.getItem(REFERENCE_CHECKS) !== 'off');
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (opener?.isConnected && opener.getClientRects().length) opener.focus(); };
  }, []);
  const hostUser = host?.user;
  const hasHostUser = Boolean(hostUser && (hostUser.name || hostUser.email || hostUser.plan || typeof hostUser.usagePercent === 'number'));
  const hostDisplayName = hostUser?.name || hostUser?.email || host?.name || t('Account');
  const hostUsagePct = typeof hostUser?.usagePercent === 'number' && Number.isFinite(hostUser.usagePercent)
    ? Math.min(100, Math.max(0, Math.round(hostUser.usagePercent)))
    : undefined;
  const hostUsageTone = hostUsagePct !== undefined && hostUsagePct >= 95 ? 'danger' : hostUsagePct !== undefined && hostUsagePct >= 80 ? 'warn' : undefined;
  const showHostAccount = Boolean(host && (hasHostUser || host.accountUrl || host.billingUrl || host.logoutUrl));
  const showAgentsPage = Boolean(diagnostics && !(hosted && singleAgent));
  const showLatexPage = Boolean(diagnostics && !hosted);
  const showUpdatesPage = Boolean(updates && !hosted);
  const showStatisticsPage = Boolean(activity && !(hosted && host?.billingUrl));
  const showExperimentsPage = Boolean(!hosted && (diagnostics?.compiler || workflow || chatgptPro || window.papilotDesktop?.platform === 'darwin'));
  const groups: { label: string; entries: SettingsEntry[] }[] = [
    { label: t('Personal'), entries: [
      { page: 'general', label: t('General'), icon: 'settings', keywords: `${t('Language')} ${t('Default model')} ${t('Default reasoning effort')}${showHostAccount ? ` ${t('Account')} ${t('Usage & limits')}` : ''}` },
      { page: 'appearance', label: t('Appearance'), icon: 'sun', keywords: `${t('Light')} ${t('Dark')} ${t('System')} ${t('Theme')} ${t('Accent')} ${t('Background')} ${t('Foreground')} ${t('Interface size')} ${t('Text size')} ${t('Editor font size')}` },
      { page: 'notifications', label: t('Notifications'), icon: 'bell' },
      { page: 'shortcuts', label: t('Keyboard shortcuts'), icon: 'keyboard' },
    ] },
    // How agents write and review for the author: their review, quick notes, skills and memory.
    { label: t('Writing and review'), entries: [
      { page: 'review', label: t('Review preferences'), icon: 'diff', keywords: `${t('Look up references online')} ${t('Track indirect changes')} ${t('Prepare alternatives for PDF notes')}` },
      { page: 'quickNotes', label: t('Quick notes'), icon: 'toolMagic', keywords: `${t('Magic pen')} ${t('Polish')} ${t('Shorten')} ${t('Runt')} ${t('Connect')} ${t('Verify')}` },
      ...(skills ? [{ page: 'skills' as const, label: t('Skills'), icon: 'spark' }] : []),
      ...(memory ? [{ page: 'memory' as const, label: t('Memory'), icon: 'brain', keywords: `${t('Learn from reviews')} ${t('Writing memory')} ${t('Shared with coauthors')}` }] : []),
    ] },
    { label: hosted ? t('Tools') : t('Runtime'), entries: [
      { page: 'git', label: 'Git', icon: 'git', keywords: `${t('Version history')} ${t('Show advanced Git features')} ${t('Commit message language')}${hosted && singleAgent ? '' : ` ${t('Commit-message agent')} ${t('Conflict-resolution agent')}`}` },
      ...(showAgentsPage ? [{ page: 'agents' as const, label: t('Agents'), icon: 'terminal', keywords: `${t('Agent configuration')} ${t('Available models')} ${t('Usage & limits')}` }] : []),
      ...(showLatexPage ? [{ page: 'latex' as const, label: 'LaTeX', icon: 'paper', keywords: 'TeX Live MacTeX BasicTeX MiKTeX' }] : []),
      ...(overleaf ? [{ page: 'overleaf' as const, label: 'Overleaf', icon: 'overleaf', keywords: `${t('Sync with Overleaf…')} ${t('Sign in')} ${t('Sign out')}` }] : []),
      ...(zotero ? [{ page: 'zotero' as const, label: 'Zotero', icon: 'zotero', keywords: `${t('Library')} ${t('Use PDFs from Zotero')} ${t('Zotero account')} ${t('API key')} Better BibTeX` }] : []),
    ] },
    { label: t('Application'), entries: [
      ...(showStatisticsPage ? [{ page: 'statistics' as const, label: t('Statistics'), icon: 'chart', keywords: `${t('Tokens')} ${t('Spend')} ${t('Agent runs')} ${t('Active hours')} ${t('Accept / Reject')} ${t('Annotations')} ${t('Daily breakdown')}` }] : []),
      ...(showUpdatesPage ? [{ page: 'updates' as const, label: t('Updates'), icon: 'refresh' }] : []),
      ...(showExperimentsPage ? [{ page: 'experiments' as const, label: t('Experiments'), icon: 'flask', keywords: `Typeless PhiTeX ChatGPT Pro ${t('Compile with PhiTeX')} ${t('Enable collaboration mode')} ${t('Enable ChatGPT Pro (web)')}` }] : []),
      { page: 'about', label: t('About Papilot'), icon: 'info', keywords: t('Third-party licenses') },
    ] },
  ];
  const allEntries = groups.flatMap(group => group.entries);
  const resolvedPage: SettingsPage = page === 'licenses' || allEntries.some(entry => entry.page === page) ? page : 'general';
  useEffect(() => {
    const element = dialog.current!;
    element.querySelector('.settings-content')!.scrollTop = 0;
    if (focusConflictAgent.current) {
      focusConflictAgent.current = false;
      const resolver = element.querySelector<HTMLElement>('#git-conflict-agent');
      if (resolver) { resolver.focus(); return; }
    }
    const target = showCategories ? element.querySelector<HTMLElement>('.settings-category[aria-current="page"]') || element.querySelector<HTMLInputElement>('.settings-search input') : element.querySelector<HTMLElement>('#settings-title');
    target?.focus();
  }, [resolvedPage, showCategories]);
  function navigate(proceed: () => void) {
    if (resolvedPage === 'skills') skillControls.current?.navigate(proceed); else proceed();
  }
  function goTo(next: SettingsPage) {
    const proceed = () => { setPage(next); setShowCategories(false); };
    if (next === resolvedPage) proceed(); else navigate(proceed);
  }
  function browseCategories() {
    navigate(() => { setPage('general'); setShowCategories(true); });
  }
  const browserName = LANGUAGES.find(item => item.id === browserLanguage())!.name;
  const close = () => { if (resolvedPage === 'skills') skillControls.current?.cancel(); else navigate(onClose); };
  const title = resolvedPage === 'licenses' ? t('Third-party licenses') : allEntries.find(entry => entry.page === resolvedPage)!.label;
  const search = query.trim().toLocaleLowerCase();
  const visibleGroups = groups.map(group => ({ ...group, entries: group.entries.filter(entry => `${group.label} ${entry.label} ${entry.keywords || ''}`.toLocaleLowerCase().includes(search)) })).filter(group => group.entries.length);
  return <dialog ref={dialog} className="modal-backdrop" aria-label={resolvedPage === 'general' ? t('Settings') : title} onKeyDown={keepDialogFocus} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className={'modal settings-dialog' + (showCategories ? ' settings-browse' : '')}>
      <button className="modal-close icon-button" aria-label={t('Close')} onClick={close}><Icon name="close"/></button>
      <aside className="settings-sidebar">
        <h2 className="settings-sidebar-title">{t('Settings')}</h2>
        <label className="settings-search"><Icon name="search" size={17}/><input type="search" aria-label={t('Search settings')} placeholder={t('Search settings')} value={query} onChange={event => setQuery(event.target.value)}/></label>
        <nav className="settings-categories" aria-label={t('Settings categories')}>
          {visibleGroups.map(group => <section className="settings-category-group" key={group.label}>
            <h3>{group.label}</h3>
            {group.entries.map(entry => <button type="button" key={entry.label} className="settings-category" data-settings-page={entry.page} aria-current={entry.page === resolvedPage || (resolvedPage === 'licenses' && entry.page === 'about') ? 'page' : undefined} onClick={() => goTo(entry.page)}>
              {entry.page === 'about' ? <PapilotMark size={18}/> : (entry.page === 'latex' || entry.page === 'git' || entry.page === 'overleaf' || entry.page === 'zotero') ? <BrandIcon name={entry.page} size={18}/> : <Icon name={entry.icon} size={18}/>}<span>{entry.label}</span>
            </button>)}
          </section>)}
          {!visibleGroups.length && <p className="settings-search-empty">{t('No matching settings')}</p>}
        </nav>
        {!hosted && <div className="settings-sidebar-bottom">
          <footer className="settings-footer"><span>Papilot · v{versionLabel(info.version)}</span><a href={info.repository} target="_blank" rel="noopener noreferrer" aria-label={`GitHub · ${t('Opens in a new tab')}`}><Icon name="github" size={16}/></a></footer>
        </div>}
      </aside>
      <div className={`settings-content settings-content-${resolvedPage}`}>
        <header className="settings-content-header">
          <button type="button" className="settings-back settings-mobile-back" onClick={browseCategories}><Icon name="chevronLeft" size={14}/>{t('Settings')}</button>
          {resolvedPage === 'licenses' && <button type="button" className="settings-back" onClick={() => goTo('about')}><Icon name="chevronLeft" size={14}/>{t('About Papilot')}</button>}
          <h2 id="settings-title" tabIndex={-1}>{(resolvedPage === 'latex' || resolvedPage === 'git' || resolvedPage === 'overleaf' || resolvedPage === 'zotero') && <BrandIcon name={resolvedPage} size={30}/>}{title}</h2>
        </header>
        {resolvedPage === 'general' && <div className="settings-page">
          {showHostAccount && host && <section className="settings-card settings-card-body settings-account-card" aria-label={t('Account')}>
            <div className="settings-account-top">
              <span className="settings-account-avatar" aria-hidden="true">{initialsFor(hostUser?.name, hostUser?.email)}</span>
              <div className="settings-account-identity">
                <div className="settings-account-heading">
                  <strong>{hostDisplayName}</strong>
                  {hostUser?.plan && <span className="settings-account-plan">{hostUser.plan}</span>}
                </div>
                {hostUser?.email && hostUser.email !== hostDisplayName && <p>{hostUser.email}</p>}
              </div>
            </div>
            {hostUsagePct !== undefined && <div className={'settings-account-usage' + (hostUsageTone ? ` is-${hostUsageTone}` : '')}>
              <div className="host-account-usage-row">
                <span>{t('Usage & limits')}</span>
                <strong>{hostUsagePct}%</strong>
              </div>
              <progress className="host-account-progress" value={hostUsagePct} max={100} aria-label={t('Usage & limits')}/>
            </div>}
            {(host.accountUrl || host.billingUrl || host.logoutUrl) && <div className="settings-account-actions">
              {host.billingUrl && <a className="button secondary compact" href={host.billingUrl}>{t('Usage & limits')}</a>}
              {host.accountUrl && <a className="button secondary compact" href={host.accountUrl}>{t('Account')}</a>}
              {host.logoutUrl && <a className="button ghost compact danger-text" href={host.logoutUrl}>{t('Sign out')}</a>}
            </div>}
          </section>}
          <section className="settings-card">
            <div className="settings-row settings-choice">
              <div className="settings-text"><span className="settings-name">{t('Language')}</span><p>{t('Language for the Papilot interface.')}</p></div>
              <ChipSelect label={t('Language')} value={choice} onChange={value => setLanguage(value as LanguageChoice)} options={[{ value: 'system', label: t('Browser default ({language})', { language: browserName }) }, ...LANGUAGES.map(item => ({ value: item.id, label: item.name }))]}/>
            </div>
            <ModelDefaultSettings {...modelDefaults} singleAgent={singleAgent}/>
            {window.papilotDesktop?.platform === 'win32' && <div className="settings-row settings-choice">
              <div className="settings-text"><span className="settings-name">{t('Environment')}</span><p>{environment || 'Windows / WSL'}</p></div>
              <button type="button" onClick={() => void window.papilotDesktop?.openEnvironment?.()}>{t('Change…')}</button>
            </div>}
          </section>
        </div>}
        {resolvedPage === 'appearance' && <AppearanceSettings theme={theme} onTheme={onTheme} resolved={resolved} appearance={appearance} onAppearance={onAppearance}/>}
        {resolvedPage === 'review' && <section className="settings-card">
          <NoteOptionSettings/>
          <div className="settings-row settings-toggle">
            <div className="settings-text">
              <label className="settings-name" htmlFor="settings-references">{t('Look up references online')}</label>
              <p id="settings-references-detail">{t('Check bibliography entries in Crossref, DBLP and arXiv, and download open-access PDFs from arXiv and OpenAlex. Only titles, authors, years and identifiers are sent.')}</p>
            </div>
            <input id="settings-references" type="checkbox" role="switch" className="switch" aria-describedby="settings-references-detail" checked={checkReferences} onChange={event => { setCheckReferences(event.target.checked); browserStorage.setItem(REFERENCE_CHECKS, event.target.checked ? 'on' : 'off'); }}/>
          </div>
          <div className="settings-row settings-toggle">
            <div className="settings-text">
              <label className="settings-name" htmlFor="settings-effects">{t('Track indirect changes')}</label>
              <p id="settings-effects-detail">{t('Find and show what each edit changes elsewhere, such as the uses of a macro and renumbered references. Off by default: each edit shows its own lines.')}</p>
              {indirectChanges && <p className="settings-warning" role="note">{t('Slower reviews: verifying which edits reproduce each indirect change requires additional compilations.')}</p>}
            </div>
            <input id="settings-effects" type="checkbox" role="switch" className="switch" aria-describedby="settings-effects-detail" checked={indirectChanges} onChange={event => void saveIndirectChanges(event.target.checked)}/>
          </div>
        </section>}
        {resolvedPage === 'notifications' && <NotificationSettings/>}
        {resolvedPage === 'shortcuts' && <ShortcutSettings/>}
        {resolvedPage === 'quickNotes' && <QuickNoteSettings/>}
        {resolvedPage === 'about' && <AboutSettings onLicenses={() => goTo('licenses')}/>}
        {resolvedPage === 'experiments' && showExperimentsPage && <ExperimentSettings compiler={diagnostics?.compiler} workflow={workflow} chatgptPro={chatgptPro} online={diagnostics?.online ?? workflow?.online ?? chatgptPro?.online ?? true}/>}
        {resolvedPage === 'licenses' && <LicenseSettings/>}
        {resolvedPage === 'agents' && showAgentsPage && diagnostics && <DiagnosticsSettings {...diagnostics}/>}
        {resolvedPage === 'git' && <div className="settings-page">
          {!hosted && requirements && <section className="settings-card settings-card-body"><ToolRequirement tool="git" {...requirements}/></section>}
          {!(hosted && singleAgent) && <section id="git-conflict-agent" className="settings-card" tabIndex={-1} aria-label={t('Conflict-resolution agent')}>
            <ConflictAgentSettings refreshUsage={refreshUsage} current={conflictWriter} agents={gitAgents} reconnect={diagnostics?.reconnect}/>
          </section>}
          <section className="settings-card">
            {!(hosted && singleAgent) && (commitWriter ? <CommitAgentSettings refreshUsage={refreshUsage} current={commitWriter} agents={gitAgents.filter(option => option.runtime?.supportsReadOnlyTasks !== false)} reconnect={diagnostics?.reconnect}/>
              : <div className="settings-row"><div className="settings-text"><span className="settings-name">{t('Commit-message agent')}</span><p>{errorText('Connect an agent that supports read-only tasks, such as Codex.')}</p></div></div>)}
            <div className="settings-row settings-choice">
              <div className="settings-text"><span className="settings-name">{t('Commit message language')}</span><p>{t('For generated messages. Auto follows recent commits, or uses English when there are none.')}</p></div>
              <ChipSelect label={t('Commit message language')} value={commitLanguage} onChange={value => saveCommitMessageLanguage(value as CommitMessageLanguage)} options={[{ value: 'auto', label: t('Auto') }, ...LANGUAGES.map(item => ({ value: item.id, label: item.name }))]}/>
            </div>
            <div className="settings-row settings-toggle">
              <div className="settings-text">
                <label className="settings-name" htmlFor="settings-advanced-git">{t('Show advanced Git features')}</label>
                <p id="settings-advanced-git-detail">{t('Show the commit graph, worktrees, amend and separate remote actions in the Git panel. Off by default.')}</p>
              </div>
              <input id="settings-advanced-git" type="checkbox" role="switch" className="switch" aria-describedby="settings-advanced-git-detail" checked={advancedGit} onChange={event => saveAdvancedGit(event.target.checked)}/>
            </div>
          </section>
        </div>}
        {resolvedPage === 'latex' && showLatexPage && diagnostics && <LatexSettings online={diagnostics.online} load={diagnostics.latex} requirements={requirements}/>}
        {resolvedPage === 'updates' && showUpdatesPage && updates && <UpdateSettings api={updates}/>}
        {resolvedPage === 'overleaf' && overleaf && <div className="settings-page"><OverleafAccounts api={overleaf.api} overleaf={overleaf.state}/></div>}
        {resolvedPage === 'zotero' && zotero && <ZoteroSettings api={zotero} hosted={hosted}/>}
        {resolvedPage === 'skills' && skills && <SkillLibraryPanel {...skills} controls={skillControls} onClose={onClose}/>}
        {resolvedPage === 'statistics' && showStatisticsPage && activity && <ActivitySettings load={activity} initialProjectId={skills?.project?.id || diagnostics?.project?.id}/>}
        {resolvedPage === 'memory' && memory && <MemorySettings {...memory} hosted={hosted}/>}
      </div>
    </section>
  </dialog>;
}
