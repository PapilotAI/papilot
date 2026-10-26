import type { IncomingHttpHeaders } from 'node:http';
export function authorize(headers: IncomingHttpHeaders, remoteAddress: string | undefined, port: number, publicOrigin: string, owner: string): string | null {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress || '')) return 'Papilot 只接受本机或 Tailscale Serve 连接';
  const local = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const host = headers.host || '';
  const remoteHost = publicOrigin ? new URL(publicOrigin).host : '';
  if ((headers['x-forwarded-for'] || headers['tailscale-user-login']) && (!owner || headers['tailscale-user-login'] !== owner)) return '这个 Tailscale 账号没有访问权限';
  if (local.has(host)) {
    if (headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(headers.origin)) return '请求来源不匹配';
    return null;
  }
  if (host !== remoteHost || !owner || headers['tailscale-user-login'] !== owner) return '请使用自己的 Tailscale 账号访问 Papilot';
  if (headers.origin && headers.origin !== publicOrigin) return '请求来源不匹配';
  return null;
}
