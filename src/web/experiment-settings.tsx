import { useEffect, useId, useState } from 'react';
import type { CompilerChoice } from '../shared.ts';
import { CollaborationSettings, type CollaborationSettingsProps } from './collaboration-settings.tsx';
import { t } from './i18n.ts';
import { TypelessExperiment } from './typeless.tsx';

export type ChooseCompiler = (compiler?: CompilerChoice['compiler']) => Promise<CompilerChoice>;

// PhiTeX compiles every paper on this host instead of latexmk, once installed.
function PhitexExperiment({ choose, online }: { choose: ChooseCompiler; online: boolean }) {
  const id = useId();
  const [choice, setChoice] = useState<CompilerChoice | null>(null), [saving, setSaving] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void choose().then(value => { if (live) setChoice(value); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [choose]);
  // Shown at once, and restored if it could not be saved.
  const save = async (previous: CompilerChoice, compiler: CompilerChoice['compiler']) => {
    setSaving(true); setFailed(false); setChoice({ ...previous, compiler });
    try { setChoice(await choose(compiler)); } catch { setChoice(previous); setFailed(true); } finally { setSaving(false); }
  };
  if (!choice) return failed ? <div className="settings-card"><p role="alert" className="settings-card-body">{t('Could not read the compiler. Try again.')}</p></div> : null;
  return <div className="settings-card phitex-experiment">
    <div className="settings-row settings-toggle">
      <div className="settings-text">
        <label className="settings-name" htmlFor={id}>{t('Compile with PhiTeX')}</label>
        <p id={id + '-detail'}>{choice.phitex ? t('PhiTeX {version} rebuilds only what each edit changes. LuaLaTeX papers keep using latexmk.', { version: choice.phitex }) : <>{t('PhiTeX is not installed on this computer.')} <a href="https://phitex.org" target="_blank" rel="noreferrer">phitex.org</a></>}</p>
        {failed && <p role="alert" className="settings-warning">{t('Could not save the compiler. Try again.')}</p>}
      </div>
      <input id={id} type="checkbox" className="switch" role="switch" aria-describedby={id + '-detail'} checked={choice.compiler === 'phitex'} disabled={saving || !online || (!choice.phitex && choice.compiler !== 'phitex')} onChange={event => void save(choice, event.target.checked ? 'phitex' : 'latexmk')}/>
    </div>
  </div>;
}

export function ExperimentSettings({ compiler, workflow, online }: { compiler?: ChooseCompiler; workflow?: CollaborationSettingsProps; online: boolean }) {
  return <div className="settings-page experiment-settings">
    <TypelessExperiment/>
    {compiler && <PhitexExperiment choose={compiler} online={online}/>}
    {workflow && <CollaborationSettings {...workflow}/>}
  </div>;
}
