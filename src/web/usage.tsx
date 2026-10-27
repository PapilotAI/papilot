import type { Usage, UsageWindow } from '../shared.ts';

const plans: Record<string, string> = { pro: 'Pro', plus: 'Plus', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu', free: 'Free', go: 'Go' };

export function windowName(minutes: number | null) {
  if (minutes === 10080) return 'Weekly limit';
  if (minutes === 1440) return 'Daily limit';
  if (minutes && minutes % 1440 === 0) return `${minutes / 1440}-day limit`;
  if (minutes && minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return minutes ? `${minutes}-minute limit` : 'Usage limit';
}

// Soon resets read as a countdown; later ones as a day and time.
export function resetText(at: number, now = Date.now()) {
  const left = at - now;
  if (left <= 60_000) return 'resets now';
  if (left < 86_400_000) {
    const hours = Math.floor(left / 3_600_000), minutes = Math.round((left % 3_600_000) / 60_000);
    return `resets in ${hours ? `${hours} h ` : ''}${minutes} min`;
  }
  const date = new Date(at);
  return 'resets ' + (left < 6 * 86_400_000
    ? date.toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
}

function Limit({ window, reached }: { window: UsageWindow; reached: boolean }) {
  const used = Math.round(window.usedPercent), name = windowName(window.minutes);
  const tone = reached || used >= 90 ? 'critical' : used >= 75 ? 'warning' : '';
  return <div className={'usage-limit ' + tone}>
    <span className="usage-name">{name}</span>
    <span className="usage-bar" role="meter" aria-label={`${name} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-valuetext={`${used}% used`}><span style={{ width: `${used}%` }}/></span>
    <span className="usage-value">{reached && used >= 100 ? 'Limit reached' : `${used}% used`}</span>
    {window.resetsAt && <span className="usage-reset">{resetText(window.resetsAt)}</span>}
  </div>;
}

// The Codex account's included usage, as Codex reports it for this host.
export function UsageSummary({ usage }: { usage: Usage }) {
  const credits = usage.credits;
  return <section className="usage" aria-label="Codex usage">
    <span className="usage-account">Codex{usage.plan && <span className="usage-plan">{plans[usage.plan] || usage.plan}</span>}</span>
    {usage.windows.map((window, index) => <Limit key={index} window={window} reached={usage.reached}/>)}
    {credits && <span className="usage-credits">{credits.unlimited ? 'Unlimited credits' : credits.balance !== null ? `${Math.floor(credits.balance).toLocaleString('en')} credits` : 'Credits available'}</span>}
  </section>;
}
