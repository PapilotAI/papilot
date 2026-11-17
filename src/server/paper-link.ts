import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { downloadAddress, requestSource, type SourceRequest, type SourceResponse } from './paper-download.ts';

type PaperLink = { kind: 'arxiv'; id: string; url: URL } | { kind: 'overleaf'; url: URL } | { kind: 'github'; name: string; url: URL } | { kind: 'archive'; url: URL };
const ARXIV = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v[1-9]\d*)?$/i;
const OVERLEAF = 'https://www.overleaf.com';
const SHARE = /^\/(?:read\/[a-z]+|\d+[a-z]+)\/?$/;
const PROJECT_SHARE = /^\/project\/([a-f0-9]{24})\/share\/?$/i;
const unsupported = () => new Error('Paste an arXiv paper link, an Overleaf sharing link, a public GitHub repository link, or a source archive link.');
const privateProject = () => new Error('Use an enabled Overleaf read-only sharing link. Private project links require an Overleaf login; you can also upload the source ZIP.');
export function paperLink(value: unknown): PaperLink {
  if (typeof value !== 'string' || !value.trim() || value.length > 8000) throw unsupported();
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw unsupported(); }
  const arxiv = ['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(url.hostname);
  const overleaf = url.hostname === 'overleaf.com' || url.hostname === 'www.overleaf.com';
  if ((arxiv || overleaf) && url.protocol === 'http:' && !url.port) url.protocol = 'https:';
  downloadAddress(url);
  if (arxiv) {
    const id = url.pathname.replace(/^\/(?:abs|pdf|html|src|e-print)\//, '').replace(/(?:\.pdf|\/)$/, '');
    if (!/^\/(?:abs|pdf|html|src|e-print)\//.test(url.pathname) || !ARXIV.test(id)) throw new Error('Use an arXiv abstract, PDF, HTML or source link for one paper.');
    return { kind: 'arxiv', id, url: new URL('https://arxiv.org/src/' + id) };
  }
  if (overleaf) {
    if (PROJECT_SHARE.test(url.pathname)) {
      if (!url.hash) throw new Error('This Overleaf sharing link is incomplete. Copy the full link, including the part after #.');
    } else if (!SHARE.test(url.pathname)) {
      if (/^\/project\/[a-f0-9]{24}\/?$/i.test(url.pathname)) throw privateProject();
      throw unsupported();
    }
    url = new URL(url.pathname.replace(/\/$/, '') + url.hash, OVERLEAF);
    return { kind: 'overleaf', url };
  }
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const match = url.pathname.match(/^\/([a-z\d-]+)\/([a-z\d_.-]+?)(?:\.git)?\/?$/i);
    if (match && !['.', '..'].includes(match[2])) return { kind: 'github', name: match[2], url: new URL(`https://api.github.com/repos/${match[1]}/${match[2]}/zipball`) };
    // Explicit archive/release downloads already point at source bytes.
    if (!/^\/[^/]+\/[^/]+\/(?:archive\/|releases\/download\/)/.test(url.pathname)) throw new Error('Use a public GitHub repository link, or upload its source ZIP.');
  }
  // Archive downloads can use signed query strings or extensionless endpoints.
  // Their bytes, rather than their names or MIME types, decide whether to import.
  url.hash = '';
  return { kind: 'archive', url };
}

function check(response: SourceResponse, overleaf = false) {
  if (response.status === 429) throw new Error('The source website is busy. Wait a little and try again.');
  if (overleaf && [401, 403, 404].includes(response.status)) throw new Error('Overleaf could not open this sharing link. Check that sharing is enabled and use the read-only link, or upload the source ZIP.');
  if (response.status === 404) throw new Error('No source was found at this link. Check the paper link and version.');
  if (response.status < 200 || response.status >= 300) throw new Error('Could not download the source. Check the link and try again.');
  return response;
}

function csrfToken(html: string) {
  const nodes: DefaultTreeAdapterMap['node'][] = [parse(html)];
  while (nodes.length) {
    const node = nodes.pop()!;
    if ('tagName' in node && node.tagName === 'meta' && node.attrs.some(attr => attr.name === 'name' && attr.value === 'ol-csrfToken')) return node.attrs.find(attr => attr.name === 'content')?.value;
    if ('childNodes' in node) nodes.push(...node.childNodes);
  }
}
function title(response: SourceResponse, fallback: string) {
  const disposition = response.headers['content-disposition'] ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let filename = disposition.match(/filename="([^"]+)"/i)?.[1] ?? disposition.match(/filename=([^;]+)/i)?.[1];
  if (encoded) try { filename = decodeURIComponent(encoded); } catch { /* Use the plain filename. */ }
  return (filename?.split(/[\\/]/).pop()?.replace(/\.(?:tar\.gz|tgz|tar|zip)$/i, '').trim() || fallback).slice(0, 120);
}
export async function downloadPaperSource(value: unknown, request: SourceRequest = requestSource) {
  const link = paperLink(value), signal = AbortSignal.timeout(120_000);
  try {
    if (link.kind !== 'overleaf') {
      const downloaded = await request(link.url, { signal });
      if (link.kind === 'github' && [401, 403, 404].includes(downloaded.status)) throw new Error('GitHub could not download this repository. Check that it is public and the link is correct, or upload the source ZIP.');
      const response = check(downloaded);
      let fallback = link.kind === 'arxiv' ? 'arXiv ' + link.id : link.kind === 'github' ? link.name : link.url.pathname.split('/').filter(Boolean).pop() || 'Imported paper';
      if (link.kind === 'archive') { try { fallback = decodeURIComponent(fallback); } catch { /* Preserve malformed escapes as text. */ } fallback = fallback.replace(/\.(?:tar\.gz|tgz|tar|zip)$/i, ''); }
      return { data: response.data, name: link.kind === 'arxiv' || link.kind === 'github' ? fallback : title(response, fallback), zip: false };
    }
    // A fresh anonymous session for each import, never the user's browser cookies.
    const cookies = new Map<string, string>();
    const fetch = async (url: URL, options: Parameters<SourceRequest>[1] = {}) => {
      const response = check(await request(url, { ...options, signal, origin: OVERLEAF, headers: { ...options.headers, ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; ') } : {}) } }), true);
      for (const cookie of response.headers['set-cookie'] ?? []) {
        const pair = cookie.split(';', 1)[0], at = pair.indexOf('=');
        if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
      }
      return response;
    };
    // Fragments carry access tokens. Send them only in the authorization body,
    // never in the landing URL or Referer.
    const landingUrl = new URL(link.url.pathname, OVERLEAF);
    const landing = await fetch(landingUrl, { limit: 2 * 1024 * 1024 });
    const csrf = csrfToken(landing.data.toString('utf8'));
    if (!csrf) throw new Error('Overleaf did not provide access to the source. Try a read-only sharing link or upload the source ZIP.');
    const project = link.url.pathname.match(PROJECT_SHARE)?.[1];
    const grant = await fetch(new URL(link.url.pathname + (project ? '/validate' : '/grant'), OVERLEAF), { method: 'POST', limit: 1024 * 1024, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Origin: OVERLEAF, Referer: landingUrl.href }, body: JSON.stringify(project ? { token: link.url.hash.slice(1) } : link.url.hash ? { tokenHashPrefix: link.url.hash } : {}) });
    let result: { valid?: unknown; redirect?: unknown } | null;
    try { result = JSON.parse(grant.data.toString('utf8')); } catch { throw new Error('Overleaf returned an unexpected response. Try again or upload the source ZIP.'); }
    // New view links grant anonymous access during validation. Other valid
    // invitations may require a login or joining the project; do neither here.
    const projectPath = project
      ? result?.valid === true && result.redirect === true ? '/project/' + project : null
      : typeof result?.redirect === 'string' && /^\/project\/[a-f0-9]{24}$/i.test(result.redirect) ? result.redirect : null;
    if (!projectPath) throw new Error('Overleaf could not open this sharing link. Check that sharing is enabled and use the read-only link, or upload the source ZIP.');
    const source = await fetch(new URL(projectPath + '/download/zip', OVERLEAF));
    return { data: source.data, name: title(source, 'Overleaf paper'), zip: true };
  } catch (error) {
    if (signal.aborted || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new Error('The source download timed out. Try again or upload the source archive.');
    if (error instanceof Error && 'code' in error) throw new Error('Could not reach the source website. Check the internet connection and try again.');
    throw error;
  }
}
