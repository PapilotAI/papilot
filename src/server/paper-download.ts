import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import ipaddr from 'ipaddr.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyForUrl } from 'proxy-from-env';

export const SOURCE_LIMIT = 64 * 1024 * 1024;
const unzip = promisify(gunzip);
const invalidAddress = () => new Error('Use a public HTTPS link without a username, password or custom port.');
const tooLarge = () => new Error('The source response is too large to import.');
export function publicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function downloadAddress(value: string | URL) {
  let url: URL;
  try { url = new URL(value); } catch { throw invalidAddress(); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || (isIP(host) && !publicAddress(host))) throw invalidAddress();
  return url;
}
// Check DNS in the socket's lookup callback, rather than resolving once and
// allowing the HTTP client to resolve again to a different, private address.
export const publicLookup: typeof lookup = ((hostname: string, options: any, callback: any) => {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) return callback(invalidAddress());
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}) as typeof lookup;

export type SourceResponse = { status: number; headers: IncomingHttpHeaders; data: Buffer; url: URL };
export type SourceRequest = (url: URL, options?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; origin?: string; limit?: number; signal?: AbortSignal }) => Promise<SourceResponse>;

export const requestSource: SourceRequest = async (initial, options = {}) => {
  let url = downloadAddress(initial);
  const signal = options.signal ?? AbortSignal.timeout(60_000), limit = options.limit ?? SOURCE_LIMIT;
  for (let hop = 0; hop < 6; hop++) {
    downloadAddress(url);
    // Overleaf's session and CSRF headers must never leave Overleaf.
    if (options.origin && url.origin !== options.origin) throw new Error('The source link redirected to an unexpected website.');
    const proxy = getProxyForUrl(url.href);
    let agent: HttpsProxyAgent<string> | undefined, destination: Pick<https.RequestOptions, 'hostname' | 'servername' | 'checkServerIdentity'> | undefined;
    if (proxy) {
      if (!/^https?:\/\//i.test(proxy)) throw new Error('Paper source imports need an HTTP or HTTPS proxy. Check the configured proxy.');
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      signal.throwIfAborted();
      const address = await new Promise<string>((resolve, reject) => {
        const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
        publicLookup(hostname, { all: true }, (error, addresses) => { signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(addresses[0].address); });
      });
      // CONNECT targets the validated IP, even if the proxy has a different DNS
      // view. Host and TLS certificate verification retain the original name.
      destination = { hostname: address, servername: isIP(hostname) ? '' : hostname, checkServerIdentity: (_name, cert) => checkServerIdentity(hostname, cert) };
      agent = new HttpsProxyAgent(proxy, { signal });
    }
    let response: import('node:http').IncomingMessage | undefined;
    try {
      response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        const request = https.request(url, { ...destination, method: options.method ?? 'GET', headers: { 'User-Agent': 'Papilot', 'Accept-Encoding': 'identity', ...options.headers, ...(proxy ? { Host: url.host } : {}) }, signal, lookup: publicLookup, agent: agent ?? false }, resolve);
        request.on('error', reject); request.end(options.body);
      });
      const status = response.statusCode ?? 0, location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        // The only POST is the share-link grant. Do not replay it elsewhere.
        if (options.method === 'POST') throw new Error('Overleaf could not grant access. Use an enabled read-only sharing link.');
        url = downloadAddress(new URL(location, url)); continue;
      }
      if (Number(response.headers['content-length']) > limit) throw tooLarge();
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of response) {
        if ((size += chunk.length) > limit) throw tooLarge();
        chunks.push(chunk);
      }
      let data = Buffer.concat(chunks, size);
      if (response.headers['content-encoding'] === 'gzip') {
        try { data = await unzip(data, { maxOutputLength: limit }); }
        catch { throw new Error('The source response is damaged or too large.'); }
      } else if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new Error('The source website returned an unsupported response encoding.');
      return { status, headers: response.headers, data, url };
    } finally { response?.destroy(); agent?.destroy(); }
  }
  throw new Error('The source link redirected too many times.');
};
