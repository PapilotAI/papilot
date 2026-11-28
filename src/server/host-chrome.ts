import type { IncomingHttpHeaders } from 'node:http';
import { AGENT_IDS, isAgentId, type AgentId, type HostChrome, type HostUser } from '../shared.ts';

export interface HostChromeConfig {
  name?: string;
  homeUrl?: string;
  accountUrl?: string;
  billingUrl?: string;
  logoutUrl?: string;
  trustHeaders: boolean;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function cleanHttpUrl(value: unknown): string | undefined {
  const raw = cleanText(value, 2048);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function headerValue(headers: IncomingHttpHeaders, key: string): string | undefined {
  const value = headers[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/** Parses PAPILOT_ALLOWED_AGENTS (comma-separated AgentIds). Returns null when unset/blank. */
export function parseAllowedAgents(raw: string | undefined): AgentId[] | null {
  if (!raw || !raw.trim()) return null;
  const requested = new Set(
    raw
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(isAgentId),
  );
  return AGENT_IDS.filter(id => requested.has(id));
}

/** Reads optional host navigation/account integration settings from the environment. */
export function readHostChromeConfig(env: NodeJS.ProcessEnv = process.env): HostChromeConfig | null {
  const name = cleanText(env.PAPILOT_HOST_NAME, 80);
  const homeUrl = cleanHttpUrl(env.PAPILOT_HOST_HOME_URL);
  const accountUrl = cleanHttpUrl(env.PAPILOT_HOST_ACCOUNT_URL);
  const billingUrl = cleanHttpUrl(env.PAPILOT_HOST_BILLING_URL);
  const logoutUrl = cleanHttpUrl(env.PAPILOT_HOST_LOGOUT_URL);
  const trustHeaders = env.PAPILOT_TRUST_HOST_HEADERS === '1' || env.PAPILOT_TRUST_HOST_HEADERS === 'true';
  if (!name && !homeUrl && !accountUrl && !billingUrl && !logoutUrl && !trustHeaders) return null;
  return {
    ...(name ? { name } : {}),
    ...(homeUrl ? { homeUrl } : {}),
    ...(accountUrl ? { accountUrl } : {}),
    ...(billingUrl ? { billingUrl } : {}),
    ...(logoutUrl ? { logoutUrl } : {}),
    trustHeaders,
  };
}

/** Builds per-request host chrome metadata, trusting user headers only over loopback when enabled. */
export function resolveHostChrome(
  config: HostChromeConfig | null | undefined,
  headers: IncomingHttpHeaders,
  remoteAddress?: string,
): HostChrome | undefined {
  if (!config) return undefined;
  let user: HostUser | undefined;
  if (config.trustHeaders && LOOPBACK.has(remoteAddress || '')) {
    const name = cleanText(headerValue(headers, 'x-papilot-user-name'), 120);
    const email = cleanText(headerValue(headers, 'x-papilot-user-email'), 200);
    const plan = cleanText(headerValue(headers, 'x-papilot-user-plan'), 40);
    const rawPct = cleanText(headerValue(headers, 'x-papilot-usage-pct'), 16);
    const parsedPct = rawPct !== undefined ? Number(rawPct) : NaN;
    const usagePercent = Number.isFinite(parsedPct) ? Math.min(100, Math.max(0, Math.round(parsedPct))) : undefined;
    if (name || email || plan || usagePercent !== undefined) {
      user = {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        ...(plan ? { plan } : {}),
        ...(usagePercent !== undefined ? { usagePercent } : {}),
      };
    }
  }
  const chrome: HostChrome = {
    ...(config.name ? { name: config.name } : {}),
    ...(config.homeUrl ? { homeUrl: config.homeUrl } : {}),
    ...(config.accountUrl ? { accountUrl: config.accountUrl } : {}),
    ...(config.billingUrl ? { billingUrl: config.billingUrl } : {}),
    ...(config.logoutUrl ? { logoutUrl: config.logoutUrl } : {}),
    ...(user ? { user } : {}),
  };
  return Object.keys(chrome).length ? chrome : undefined;
}
