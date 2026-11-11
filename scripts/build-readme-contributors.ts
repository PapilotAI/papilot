// Regenerate with: node --import tsx scripts/build-readme-contributors.ts
// The README's contributor wall: everyone with a merged pull request or a
// commit on main, as round GitHub avatars with their names. Only the images
// change when someone new contributes, so the README's text, and with it its
// translations, stays the same. Set GITHUB_TOKEN to avoid the API's rate limit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'PapilotAI/papilot';
// The maintainer asked to be left out of contributor lists.
const omitted = new Set(['cu1ch3n']);
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'docs/assets/readme-contributors');
const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'papilot-readme' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

interface GitHubUser { login: string; type: string; avatar_url: string }
async function api<T>(route: string): Promise<T> {
  const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, { headers });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${route}.`);
  return response.json() as Promise<T>;
}
async function pages<T>(route: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const items = await api<T[]>(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    all.push(...items);
    if (items.length < 100) return all;
  }
}

const people = new Map<string, { login: string; avatar: string; pulls: number; commits: number }>();
const person = (user: GitHubUser) => {
  if (user.type !== 'User' || omitted.has(user.login)) return null;
  const entry = people.get(user.login) || { login: user.login, avatar: user.avatar_url, pulls: 0, commits: 0 };
  people.set(user.login, entry);
  return entry;
};
for (const pull of await pages<{ merged_at: string | null; user: GitHubUser | null }>('pulls?state=closed')) {
  const entry = pull.merged_at && pull.user ? person(pull.user) : null;
  if (entry) entry.pulls++;
}
for (const contributor of await pages<GitHubUser & { contributions: number }>('contributors')) {
  const entry = person(contributor);
  if (entry) entry.commits += contributor.contributions;
}
const contributors = [...people.values()].sort((a, b) => b.pulls - a.pulls || b.commits - a.commits || a.login.localeCompare(b.login));
if (!contributors.length) throw new Error('No contributors found.');

const avatars = await Promise.all(contributors.map(async ({ avatar }) => {
  const url = new URL(avatar);
  url.searchParams.set('s', '128');
  const response = await fetch(url, { headers: { 'User-Agent': headers['User-Agent'] } });
  if (!response.ok) throw new Error(`Could not download ${url}.`);
  const type = response.headers.get('content-type') || 'image/png';
  return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}));

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const label = (login: string) => login.length > 14 ? `${login.slice(0, 13)}…` : login;
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
// One image per layout. Its colours follow the reader's light or dark
// appearance, as the README's <picture> sources do.
for (const compact of [false, true]) {
  const columns = Math.min(contributors.length, compact ? 3 : 8);
  const cell = compact ? 100 : 108;
  const rowHeight = 104;
  const size = 64;
  const width = columns * cell;
  const height = Math.ceil(contributors.length / columns) * rowHeight;
  const cells = contributors.map(({ login }, index) => {
    const row = Math.floor(index / columns);
    const count = Math.min(columns, contributors.length - row * columns);
    const x = (width - count * cell) / 2 + (index % columns) * cell + cell / 2;
    const y = row * rowHeight + 8;
    return `  <g>
    <title>${escape(login)}</title>
    <clipPath id="avatar-${index}"><circle cx="${x}" cy="${y + size / 2}" r="${size / 2}"/></clipPath>
    <image href="${avatars[index]}" x="${x - size / 2}" y="${y}" width="${size}" height="${size}" clip-path="url(#avatar-${index})"/>
    <circle class="ring" cx="${x}" cy="${y + size / 2}" r="${size / 2 - 0.5}"/>
    <text x="${x}" y="${y + size + 22}" text-anchor="middle">${escape(label(login))}</text>
  </g>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">Contributors: ${escape(contributors.map(({ login }) => login).join(', '))}</title>
  <style>
    text { fill: #334155; font: 500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
    .ring { fill: none; stroke: #0f172a; stroke-opacity: 0.12; }
    @media (prefers-color-scheme: dark) {
      text { fill: #cbd5e1; }
      .ring { stroke: #f8fafc; stroke-opacity: 0.16; }
    }
  </style>
${cells}
</svg>
`;
  fs.writeFileSync(path.join(output, `${compact ? 'compact' : 'desktop'}.svg`), svg);
}
console.log(contributors.map(({ login, pulls, commits }) => `${login}: ${pulls} merged pull request${pulls === 1 ? '' : 's'}, ${commits} commit${commits === 1 ? '' : 's'}`).join('\n'));
