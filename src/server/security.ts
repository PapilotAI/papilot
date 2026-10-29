import type { IncomingHttpHeaders } from 'node:http';
export function authorize(headers: IncomingHttpHeaders, remoteAddress: string | undefined, port: number, publicOrigin: string, owner: string): string | null {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress || '')) return 'Papilot only accepts local or Tailscale Serve connections.';
  const local = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const host = headers.host || '';
  const remoteHost = publicOrigin ? new URL(publicOrigin).host : '';
  if ((headers['x-forwarded-for'] || headers['tailscale-user-login']) && (!owner || headers['tailscale-user-login'] !== owner)) return 'This Tailscale account does not have access.';
  if (local.has(host)) {
    if (headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(headers.origin)) return 'The request origin does not match.';
    return null;
  }
  if (host !== remoteHost || !owner || headers['tailscale-user-login'] !== owner) return 'Use your authorized Tailscale account to access Papilot.';
  if (headers.origin && headers.origin !== publicOrigin) return 'The request origin does not match.';
  return null;
}

// The public sign-in URL needs its own port, an exact HTTPS origin (plain HTTP
// only on localhost, for testing), and must not be the tailnet endpoint, whose
// requests are trusted as the owner.
export function accountProblem(accountOrigin: string, accountPort: number, port: number, publicOrigin: string): string | null {
  if (!accountOrigin) return null;
  let url: URL;
  try { url = new URL(accountOrigin); } catch { return `PAPILOT_ACCOUNT_ORIGIN is not a URL: ${accountOrigin}`; }
  if (url.origin !== accountOrigin) return `PAPILOT_ACCOUNT_ORIGIN must be an origin without a path, such as ${url.origin}.`;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) return 'PAPILOT_ACCOUNT_ORIGIN must use https://.';
  if (!Number.isInteger(accountPort) || accountPort < 1 || accountPort > 65535 || accountPort === port) return `PAPILOT_ACCOUNT_PORT must be a free port other than ${port}.`;
  if (publicOrigin && new URL(publicOrigin).host === url.host) return 'PAPILOT_ACCOUNT_ORIGIN must differ from PAPILOT_PUBLIC_ORIGIN, the tailnet address; use another port, such as :10000.';
  return null;
}
// HSTS on the public address covers every port of its host name, so it is
// left off when the tailnet endpoint on that host uses plain HTTP.
export function accountHsts(accountOrigin: string, publicOrigin: string) {
  const account = new URL(accountOrigin);
  return account.protocol === 'https:' && !(publicOrigin.startsWith('http:') && new URL(publicOrigin).hostname === account.hostname);
}
