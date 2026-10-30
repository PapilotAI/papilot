import type { Usage, UsageWindow } from '../shared.ts';
import { locale, t } from './i18n.ts';
import { Icon } from './icons.tsx';

const plans: Record<string, string> = { pro: 'Pro', plus: 'Plus', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu', free: 'Free', go: 'Go' };

export function windowName(minutes: number | null) {
  if (minutes === 10080) return t('Weekly limit');
  if (minutes === 1440) return t('Daily limit');
  if (minutes && minutes % 1440 === 0) return t('{n}-day limit', { n: minutes / 1440 });
  if (minutes && minutes % 60 === 0) return t('{n}-hour limit', { n: minutes / 60 });
  return minutes ? t('{n}-minute limit', { n: minutes }) : t('Usage limit');
}

// Soon resets read as a countdown; later ones as a day and time.
export function resetText(at: number, now = Date.now()) {
  const left = at - now;
  if (left <= 60_000) return t('resets now');
  if (left < 86_400_000) {
    const hours = Math.floor(left / 3_600_000), minutes = Math.round((left % 3_600_000) / 60_000);
    return hours ? t('resets in {hours} h {minutes} min', { hours, minutes }) : t('resets in {minutes} min', { minutes });
  }
  const date = new Date(at);
  return t('resets {time}', { time: left < 6 * 86_400_000
    ? date.toLocaleString(locale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) });
}

function Limit({ window, reached }: { window: UsageWindow; reached: boolean }) {
  const used = Math.round(window.usedPercent), name = windowName(window.minutes);
  const tone = reached || used >= 90 ? 'critical' : used >= 75 ? 'warning' : '';
  return <div className={'usage-limit ' + tone}>
    <span className="usage-name">{name}</span>
    <span className="usage-bar" role="meter" aria-label={t('{name} used', { name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-valuetext={t('{used}% used', { used })}><span style={{ width: `${used}%` }}/></span>
    <span className="usage-value">{reached && used >= 100 ? t('Limit reached') : t('{used}% used', { used })}</span>
    {window.resetsAt && <span className="usage-reset">{resetText(window.resetsAt)}</span>}
  </div>;
}

// The agent account's included usage, as the agent reports it for this host.
export function UsageSummary({ usage, agent = 'Codex' }: { usage: Usage; agent?: string }) {
  const credits = usage.credits;
  const primary = usage.windows.reduce<UsageWindow | undefined>((highest, window) => !highest || window.usedPercent > highest.usedPercent ? window : highest, undefined);
  const used = primary ? Math.round(primary.usedPercent) : 0;
  const tone = usage.reached || used >= 90 ? 'critical' : used >= 75 ? 'warning' : '';
  const balance = credits ? credits.unlimited ? t('Unlimited credits') : credits.balance !== null ? t('{n} credits', { n: Math.floor(credits.balance).toLocaleString(locale()) }) : t('Credits available') : '';
  return <section className="usage" aria-label={t('{agent} usage', { agent })}>
    <details key={agent}>
      <summary className={tone} aria-label={t('{agent} usage details', { agent })}>
        <span className="usage-account">{agent}{usage.plan && <span className="usage-plan">{plans[usage.plan] || usage.plan}</span>}</span>
        <span className="usage-overview" title={primary ? windowName(primary.minutes) : undefined}>
          {primary && <span className="usage-bar" aria-hidden="true"><span style={{ width: `${used}%` }}/></span>}
          <span className="usage-value">{usage.reached ? t('Limit reached') : primary ? t('{used}% used', { used }) : balance}</span>
        </span>
        <Icon name="chevronDown" size={13}/>
      </summary>
      <div className="usage-details">
        {usage.windows.map((window, index) => <Limit key={index} window={window} reached={usage.reached}/>)}
        {credits && <span className="usage-credits">{balance}</span>}
      </div>
    </details>
  </section>;
}
