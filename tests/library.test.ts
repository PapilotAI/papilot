import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { identify, Library, matchPdf, publicUrl, type LibraryInput } from '../src/server/library.ts';
import { findZotero, readZotero } from '../src/server/zotero.ts';
import { PaperTools, type LibraryWork } from '../src/server/paper-tools.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';
import { Manuscripts } from '../src/server/manuscript.ts';
import { buildApp, gitQueue } from '../src/server/app.ts';
import { libraryReport, recordFinding } from '../src/server/references.ts';
import type { ReviewSnapshot } from '../src/server/ai-review.ts';
import type { CitingSentence, Task } from '../src/shared.ts';

// A stand-in PDF: the header, then one line of text per line, with a form
// feed between pages. The stand-in reader returns those lines, as MuPDF
// returns a real PDF's.
const pdf = (...pages: string[]) => Buffer.from(`%PDF-1.4\n${pages.join('\n\f\n')}`);
const snapshots = {
  runs: 0,
  async run(file: string, key = 'key'): Promise<ReviewSnapshot> {
    this.runs++;
    const lines: ReviewSnapshot['lines'] = [];
    fs.readFileSync(file, 'latin1').split('\n').slice(1).reduce((page, text) => {
      if (text === '\f') return page + 1;
      if (text.trim()) lines.push({ id: `p${page + 1}-l${lines.filter(line => line.page === page).length + 1}`, page, text, rect: [0, 0, 1, 1] });
      return page;
    }, 0);
    if (!lines.length) throw new Error('This PDF has no selectable text to review.');
    return { key, lines };
  },
};
const temporary = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `papilot-${name}-`));
// Names resolve to a public address, except localtest.me, which names this computer.
const lookup = async (host: string) => [{ address: host === 'localtest.me' ? '::1' : '93.184.215.14' }];
const entry = (key: string, fields: Record<string, string>, check?: LibraryInput['check']): LibraryInput => ({ id: `refs.bib#${key}`, key, type: 'article', fields, check });
const verified = (doi: string): LibraryInput['check'] => ({ status: 'verified', via: 'title', differences: [], unavailable: [], checked: 1, record: { source: 'crossref', title: 'x', authors: [], year: null, venue: null, doi, url: `https://doi.org/${doi}` } });

// A Zotero data folder with the tables Papilot reads, and Better BibTeX's.
function zotero(home: string) {
  const data = path.join(home, 'ZoteroData'), base = path.join(home, 'Papers');
  fs.mkdirSync(path.join(data, 'storage', 'ATT00001'), { recursive: true });
  fs.mkdirSync(base, { recursive: true });
  const profile = path.join(home, 'Library', 'Application Support', 'Zotero', 'Profiles', 'abc.default');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'prefs.js'), `user_pref("extensions.zotero.dataDir", ${JSON.stringify(data)});\nuser_pref("extensions.zotero.useDataDir", true);\nuser_pref("extensions.zotero.baseAttachmentPath", ${JSON.stringify(base)});\n`);
  fs.writeFileSync(path.join(data, 'storage', 'ATT00001', 'Zhao 2019.pdf'), pdf('A Mechanical Formalization of Higher-Ranked Polymorphic Type Inference', 'Jinxu Zhao'));
  fs.writeFileSync(path.join(base, 'gradual.pdf'), pdf('Gradual Typing for All, Again', 'arXiv:2203.01835v2'));
  const db = new DatabaseSync(path.join(data, 'zotero.sqlite'));
  db.exec(`CREATE TABLE itemTypes(itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
    CREATE TABLE items(itemID INTEGER PRIMARY KEY, itemTypeID INT, libraryID INT, key TEXT);
    CREATE TABLE fields(fieldID INTEGER PRIMARY KEY, fieldName TEXT);
    CREATE TABLE itemDataValues(valueID INTEGER PRIMARY KEY, value);
    CREATE TABLE itemData(itemID INT, fieldID INT, valueID INT);
    CREATE TABLE baseFieldMappings(itemTypeID INT, baseFieldID INT, fieldID INT);
    CREATE TABLE itemAttachments(itemID INTEGER PRIMARY KEY, parentItemID INT, linkMode INT, contentType TEXT, path TEXT);
    CREATE TABLE deletedItems(itemID INTEGER PRIMARY KEY);
    INSERT INTO itemTypes VALUES (1, 'journalArticle'), (2, 'attachment'), (3, 'case'), (4, 'preprint');
    INSERT INTO fields VALUES (1, 'title'), (2, 'DOI'), (3, 'date'), (4, 'extra'), (5, 'citationKey'), (6, 'caseName'), (7, 'archiveID');
    INSERT INTO baseFieldMappings VALUES (3, 1, 6);
    INSERT INTO items VALUES (1, 1, 1, 'AAAA1111'), (2, 2, 1, 'ATT00001'), (3, 3, 1, 'BBBB2222'), (4, 4, 1, 'CCCC3333'), (5, 2, 1, 'ATT00002'), (6, 1, 1, 'DDDD4444');
    INSERT INTO itemDataValues VALUES (1, 'A Mechanical Formalization of Higher-Ranked Polymorphic Type Inference'), (2, '10.1145/3341716'), (3, '2019-08-00 2019'),
      (4, 'Roe v. Wade'), (5, 'roe1973'), (6, 'Gradual Typing for All, Again'), (7, 'arXiv:2203.01835'), (8, 'Deleted work'), (9, 'Citation Key: gradual2022');
    INSERT INTO itemData VALUES (1, 1, 1), (1, 2, 2), (1, 3, 3), (3, 6, 4), (3, 5, 5), (4, 1, 6), (4, 7, 7), (4, 4, 9), (6, 1, 8);
    INSERT INTO itemAttachments VALUES (2, 1, 1, 'application/pdf', 'storage:Zhao 2019.pdf'), (5, 4, 2, 'application/pdf', 'attachments:gradual.pdf');
    INSERT INTO deletedItems VALUES (6);`);
  db.close();
  const bbt = new DatabaseSync(path.join(data, 'better-bibtex.sqlite'));
  bbt.exec(`CREATE TABLE citationkey(itemID NOT NULL PRIMARY KEY, itemKey NOT NULL, libraryID NOT NULL, citationKey NOT NULL, pinned);
    INSERT INTO citationkey VALUES (1, 'AAAA1111', 1, 'zhaoMechanical2019', 0);`);
  bbt.close();
  return { data, base };
}

test('Zotero items are read with their keys, identifiers and existing PDFs, never written', () => {
  const home = temporary('zotero');
  try {
    const { data, base } = zotero(home);
    const location = findZotero(home, 'darwin', {});
    assert.deepEqual(location, { dataDir: data, base });
    const before = fs.readFileSync(path.join(data, 'zotero.sqlite'));
    const items = readZotero(location!);
    assert.deepEqual(items.map(item => [item.key, item.citationKeys, item.doi, item.arxiv, item.title, item.year, item.pdfs.map(file => path.relative(home, file))]), [
      ['AAAA1111', ['zhaoMechanical2019'], '10.1145/3341716', null, 'A Mechanical Formalization of Higher-Ranked Polymorphic Type Inference', 2019, ['ZoteroData/storage/ATT00001/Zhao 2019.pdf']],
      ['BBBB2222', ['roe1973'], null, null, 'Roe v. Wade', null, []],
      ['CCCC3333', ['gradual2022'], null, '2203.01835', 'Gradual Typing for All, Again', null, ['Papers/gradual.pdf']],
    ]);
    assert.ok(fs.readFileSync(path.join(data, 'zotero.sqlite')).equals(before));
    assert.equal(findZotero(temporary('empty'), 'darwin', {}), null);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('an entry is known by its DOI, its arXiv identifier, a verified record and its title with its year', () => {
  assert.deepEqual(identify(entry('a', { doi: 'https://doi.org/10.1145/ABC', title: 'Some Long Enough Title' })).ids, ['doi:10.1145/abc', 'title:somelongenoughtitle|']);
  assert.deepEqual(identify(entry('b', { eprint: '2203.01835v2', archiveprefix: 'arXiv', title: 'Short' })).ids, ['arxiv:2203.01835']);
  assert.deepEqual(identify(entry('c', { title: 'Found by its record online', year: '2020' }, verified('10.1/x'))).ids, ['doi:10.1/x', 'title:foundbyitsrecordonline|2020']);
  // A record that differs from the entry does not say which work it is.
  assert.deepEqual(identify(entry('d', { title: 'Found by its record online' }, { ...verified('10.1/x')!, status: 'mismatch' })).ids, ['title:foundbyitsrecordonline|']);
  // A short title names a work together with its year and first author.
  assert.deepEqual(identify(entry('e', { title: 'Deep Sets', author: 'Zaheer, Manzil and others', year: '2017' })).ids, ['title:deepsets|2017|zaheer']);
});

test('only public web addresses are fetched', () => {
  for (const url of ['https://arxiv.org/pdf/1', 'http://link.springer.com/x.pdf']) assert.ok(publicUrl(url), url);
  for (const url of ['http://127.0.0.1:7274/api/state', 'http://localhost/x', 'http://192.168.1.2/x', 'http://10.0.0.1/x', 'http://169.254.169.254/latest', 'http://[::1]/x', 'file:///etc/passwd', 'data:application/pdf;base64,JVBERi0=', 'http://printer.local/x', 'https://exa mple.org/a.pdf', 'http://localhost./x', 'http://printer.local./x', 'http://[::7f00:1]/x', 'http://[64:ff9b::7f00:1]/x']) assert.ok(!publicUrl(url), url);
});

test('the library takes PDFs from Zotero by citation key, DOI or arXiv identifier and reads their text once', async () => {
  const home = temporary('library-zotero'), dir = temporary('library');
  const { data, base } = zotero(home), location = { dataDir: data, base };
  const library = new Library(dir, { snapshots, lookup, findZotero: () => location, fetch: async () => { throw new Error('offline'); } });
  try {
    const inputs = [
      entry('zhaoMechanical2019', { title: 'A mechanical formalization of higher-ranked polymorphic type inference' }),
      entry('gradual', { title: 'Gradual typing for all, again', eprint: '2203.01835' }),
      // A coauthor's key that happens to be a Zotero key of another work.
      entry('roe1973', { title: 'Something else entirely, by someone else' }),
    ];
    let status = library.status(inputs, { online: false, zotero: true });
    assert.equal(status.entries['refs.bib#zhaoMechanical2019'].find, 'waiting');
    await library.idle();
    status = library.status(inputs, { online: false, zotero: true });
    assert.equal(status.pending, 0);
    assert.equal(status.entries['refs.bib#zhaoMechanical2019'].pdf?.source, 'zotero');
    assert.equal(status.entries['refs.bib#zhaoMechanical2019'].pdf?.text, 'ready');
    assert.equal(status.entries['refs.bib#gradual'].pdf?.source, 'zotero');
    assert.deepEqual(status.entries['refs.bib#roe1973'], { pdf: null, find: 'off', landing: null });
    // Zotero's files stay where Zotero keeps them.
    assert.equal(library.file(status.entries['refs.bib#gradual'].pdf!.hash), path.join(location.base, 'gradual.pdf'));
    assert.deepEqual(fs.readdirSync(path.join(dir, 'files')), []);
    const runs = snapshots.runs;
    assert.equal((await library.text(status.entries['refs.bib#gradual'].pdf!.hash))?.lines[0].text, 'Gradual Typing for All, Again');
    assert.equal(snapshots.runs, runs);

    // Another paper citing the same work under another key finds the same PDF.
    const other = library.status([entry('zhao19', { doi: '10.1145/3341716', title: 'Mechanical formalization' })], { online: false, zotero: true });
    assert.equal(other.entries['refs.bib#zhao19'].pdf?.hash, status.entries['refs.bib#zhaoMechanical2019'].pdf?.hash);

    // A PDF the author takes away is not linked again by itself.
    library.remove(inputs[1]);
    status = library.status(inputs, { online: false, zotero: true });
    await library.idle();
    status = library.status(inputs, { online: false, zotero: true });
    assert.equal(status.entries['refs.bib#gradual'].pdf, null);
    assert.equal(status.pending, 0);
    assert.ok(fs.existsSync(path.join(location.base, 'gradual.pdf')));

    // Turned off, Zotero's files are no longer used; turned on, they are again.
    assert.equal(library.status(inputs, { online: false, zotero: false }).entries['refs.bib#zhaoMechanical2019'].pdf, null);
    library.status(inputs, { online: false, zotero: true });
    await library.idle();
    assert.equal(library.status(inputs, { online: false, zotero: true }).entries['refs.bib#zhaoMechanical2019'].pdf?.source, 'zotero');
    // A file deleted outside Zotero is given up on rather than looked for forever.
    fs.rmSync(path.join(location.dataDir, 'storage', 'ATT00001', 'Zhao 2019.pdf'));
    library.status(inputs, { online: false, zotero: true });
    await library.idle();
    status = library.status(inputs, { online: false, zotero: true });
    assert.equal(status.entries['refs.bib#zhaoMechanical2019'].find, 'off');
    assert.equal(status.pending, 0);
  } finally { library.stop(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Zotero library is reported with where it is and how many of its items can serve a citation', () => {
  const home = temporary('library-zotero-report'), dir = temporary('library');
  const { data, base } = zotero(home);
  let location: { dataDir: string; base: string | null } | null = { dataDir: data, base };
  const library = new Library(dir, { snapshots, findZotero: () => location });
  try {
    // Three items, not the deleted one: two with a PDF, and each with a key
    // from Better BibTeX, Zotero's own field or Extra.
    assert.deepEqual(library.zoteroStatus(), { local: { chosen: null, state: 'ready', dataDir: data, items: 3, withPdf: 2, citationKeys: 3 }, account: null, use: true });
    const broken = path.join(home, 'Broken');
    fs.mkdirSync(broken);
    fs.writeFileSync(path.join(broken, 'zotero.sqlite'), 'not a database');
    location = { dataDir: broken, base: null };
    assert.deepEqual(library.zoteroStatus().local, { chosen: null, state: 'unreadable', dataDir: broken });
    location = null;
    assert.deepEqual(library.zoteroStatus().local, { chosen: null, state: 'missing' });
    // A data directory Zotero's settings do not name can be chosen, and the choice undone.
    assert.throws(() => library.setZoteroDir(home), /This folder has no zotero.sqlite/);
    library.setZoteroDir(data);
    assert.deepEqual(library.zoteroStatus().local, { chosen: data, state: 'ready', dataDir: data, items: 3, withPdf: 2, citationKeys: 3 });
    fs.renameSync(data, data + '-moved');
    assert.deepEqual(library.zoteroStatus().local, { chosen: data, state: 'missing' });
    library.setZoteroDir(null);
    assert.deepEqual(library.zoteroStatus().local, { chosen: null, state: 'missing' });
  } finally { library.stop(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

// Zotero's web API for one account: the user's library and a group, with
// pages of two items, the versions they changed in, deletions, and files in
// Zotero's storage, served from elsewhere after a redirect.
function zoteroApi(key: string) {
  const asked: { url: string; key?: string }[] = [];
  const reply = (body: BodyInit | null, type: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': type, ...headers } });
  const libraries: Record<string, { version: number; deleted: string[]; items: Record<string, unknown>[] }> = {
    'users/7': { version: 10, deleted: [], items: [
      { key: 'ITEM0001', version: 3, itemType: 'journalArticle', title: 'Linear types can change the world!', DOI: '10.1000/open', citationKey: 'wadler90', date: '1990' },
      { key: 'ATT00001', version: 3, itemType: 'attachment', parentItem: 'ITEM0001', linkMode: 'imported_file', contentType: 'application/pdf', filename: 'Wadler 1990.pdf', md5: 'a1' },
      { key: 'ITEM0002', version: 4, itemType: 'preprint', title: 'Gradual Typing for All, Again', archiveID: 'arXiv:2203.01835', extra: 'Citation Key: gradual2022' },
      // Synced elsewhere than Zotero's storage: the API has no file.
      { key: 'ATT00002', version: 4, itemType: 'attachment', parentItem: 'ITEM0002', linkMode: 'imported_url', contentType: 'application/pdf', filename: 'gradual.pdf', md5: 'b2' },
      { key: 'ATT00003', version: 4, itemType: 'attachment', parentItem: 'ITEM0002', linkMode: 'linked_file', contentType: 'application/pdf', path: '/Users/someone/gradual.pdf' },
      { key: 'ITEM0003', version: 5, itemType: 'journalArticle', title: 'A work in the trash', deleted: 1 },
      { key: 'NOTE0001', version: 5, itemType: 'note', note: '<p>Read later</p>' },
    ] },
    'groups/9': { version: 5, deleted: [], items: [{ key: 'GROUP001', version: 2, itemType: 'book', title: 'Types and Programming Languages' }] },
  };
  const state = { revoked: false, backoff: '', failAt: null as number | null, edition: 1 };
  const fetch = async (url: string, init?: RequestInit) => {
    const sent = (init?.headers as Record<string, string> | undefined)?.['Zotero-API-Key'];
    asked.push({ url, key: sent });
    const address = new URL(url);
    if (address.host === 'api.zotero.org') {
      if (sent !== key || state.revoked) return reply('Forbidden', 'text/plain', 403);
      const extra = state.backoff ? { backoff: state.backoff } : undefined;
      if (address.pathname === '/keys/current') return reply(JSON.stringify({ userID: 7, username: 'researcher', access: { user: { library: true, files: true }, groups: { all: { library: true } } } }), 'application/json', 200, extra);
      if (address.pathname === '/users/7/groups') return reply(JSON.stringify([{ id: 9, data: { name: 'Lab' } }]), 'application/json', 200, { 'total-results': '1' });
      const listed = /^\/(users\/7|groups\/9)\/(items|deleted)$/.exec(address.pathname);
      if (listed) {
        const library = libraries[listed[1]], since = Number(address.searchParams.get('since'));
        if (listed[2] === 'deleted') return reply(JSON.stringify({ items: library.deleted }), 'application/json');
        const changed = library.items.filter(item => (item.version as number) > since), start = Number(address.searchParams.get('start'));
        if (listed[1] === 'users/7' && start === state.failAt) return reply('Service unavailable', 'text/plain', 503);
        return reply(JSON.stringify(changed.slice(start, start + 2).map(data => ({ key: data.key, data }))), 'application/json', 200, { 'total-results': String(changed.length), 'last-modified-version': String(library.version) });
      }
      if (address.pathname === '/users/7/items/ATT00001/file') return reply(null, 'text/plain', 302, { location: `https://files.storage-example.com/wadler?edition=${state.edition}` });
      return reply('Not found', 'text/plain', 404);
    }
    if (url.startsWith('https://files.storage-example.com/wadler?edition=')) return reply(pdf('Linear types can change the world!', 'Philip Wadler', `Edition ${address.searchParams.get('edition')}`), 'application/pdf');
    if (url === 'https://export.arxiv.org/pdf/2203.01835') return reply(pdf('Gradual Typing for All, Again'), 'application/pdf');
    return reply('Not found', 'text/plain', 404);
  };
  return { asked, libraries, state, fetch: fetch as typeof globalThis.fetch };
}

test('a Zotero account gives the PDFs Zotero stores, and its key goes only to Zotero\'s web API', async () => {
  const dir = temporary('library-account'), api = zoteroApi('GOODKEY123');
  const library = new Library(dir, { snapshots, lookup, fetch: api.fetch, findZotero: () => null, sleep: async () => {} });
  const inputs = [
    entry('wadler90', { title: 'Linear types can change the world!' }),
    entry('gradual', { title: 'Gradual typing for all, again', eprint: '2203.01835' }),
  ];
  const pdfOf = (key: string, options = { online: true, zotero: true }) => library.status(inputs, { ...options, poll: true }).entries[`refs.bib#${key}`].pdf;
  try {
    await assert.rejects(library.connectZotero('WRONGKEY1'), /Zotero does not accept this key/);
    await library.connectZotero(' GOODKEY123\n');
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'zotero-account.json')).mode & 0o777, 0o600);
    assert.equal(library.zoteroStatus().account?.syncing, true);
    // Until the first sync, works the account may have wait for it.
    assert.deepEqual(Object.values(library.status(inputs, { online: true, zotero: true }).entries).map(item => item.find), ['waiting', 'waiting']);
    await library.idle();
    assert.ok(!api.asked.some(item => item.url.includes('arxiv')), 'Nothing is looked for elsewhere before the account is synced');
    const synced = library.zoteroStatus().account!;
    assert.deepEqual({ ...synced, synced: typeof synced.synced }, { username: 'researcher', syncing: false, synced: 'number', problem: null, libraries: [
      { name: null, items: 2, withPdf: 2, citationKeys: 2 }, { name: 'Lab', items: 1, withPdf: 0, citationKeys: 0 }] });
    // Turned off while its downloads wait, Zotero gives nothing.
    library.status(inputs, { online: false, zotero: true });
    library.setUseZotero(false);
    await library.idle();
    assert.equal(library.pdfOf(inputs[0]), null);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'files')), []);
    library.setUseZotero(true);
    // The citation key finds the work; its file comes from Zotero's storage.
    // One Zotero does not store is looked for elsewhere.
    library.status(inputs, { online: true, zotero: true });
    await library.idle();
    library.status(inputs, { online: true, zotero: true, poll: true });
    await library.idle();
    assert.equal(pdfOf('wadler90')?.source, 'zotero');
    assert.equal(pdfOf('gradual')?.source, 'arxiv');
    for (const { url, key } of api.asked) assert.equal(key && new URL(url).host, key ? 'api.zotero.org' : undefined, url);
    assert.ok(api.asked.some(item => item.url.startsWith('https://files.storage-example.com/') && !item.key));
    // Turned off in Settings, every work loses its Zotero PDF at once, for
    // agents too, and the downloaded copy goes; turned on, it comes back.
    const { hash } = pdfOf('wadler90')!;
    library.setUseZotero(false);
    assert.equal(library.useZotero(), false);
    assert.equal(library.pdfOf(inputs[0]), null);
    assert.equal(library.file(hash), null);
    library.setUseZotero(true);
    library.status(inputs, { online: true, zotero: true });
    await library.idle();
    assert.equal(pdfOf('wadler90')?.hash, hash);
    // A file replaced in Zotero replaces the downloaded copy.
    const own = api.libraries['users/7'];
    Object.assign(own.items.find(item => item.key === 'ATT00001')!, { version: 11, md5: 'a2' });
    own.version = 11;
    api.state.edition = 2;
    library.syncZotero();
    await library.idle();
    assert.equal(pdfOf('wadler90'), null);
    await library.idle();
    const replaced = pdfOf('wadler90')!;
    assert.notEqual(replaced.hash, hash);
    assert.equal(library.file(hash), null);
    // A later sync asks only for what changed, and drops what was deleted.
    own.version = 12;
    own.deleted = ['ITEM0002'];
    own.items.push({ key: 'ITEM0004', version: 12, itemType: 'conferencePaper', title: 'Bidirectional typing', DOI: '10.1145/3450952' });
    library.syncZotero();
    await library.idle();
    assert.ok(api.asked.some(item => item.url.includes('/users/7/items?since=11&')));
    assert.ok(api.asked.some(item => item.url.endsWith('/users/7/deleted?since=11')));
    assert.deepEqual(library.zoteroStatus().account?.libraries[0], { name: null, items: 2, withPdf: 1, citationKeys: 1 });
    // Disconnecting forgets the key, the items and the PDFs downloaded.
    library.disconnectZotero();
    assert.equal(library.zoteroStatus().account, null);
    assert.equal(library.file(replaced.hash), null);
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.startsWith('zotero-')), []);
  } finally { library.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a Zotero account whose key stops working says so, and Zotero asking to back off is respected', async () => {
  const dir = temporary('library-account-revoked'), api = zoteroApi('GOODKEY123');
  let now = 1_000_000;
  const library = new Library(dir, { snapshots, lookup, fetch: api.fetch, findZotero: () => null, sleep: async () => {}, now: () => now });
  const zoteroAsked = () => api.asked.filter(item => item.url.startsWith('https://api.zotero.org/')).length;
  try {
    // Asked to back off, Papilot does not ask Zotero again before then, nor
    // waits for it: the sync ends unfinished and entries do not wait.
    api.state.backoff = '5';
    await library.connectZotero('GOODKEY123');
    await library.idle();
    assert.equal(zoteroAsked(), 1);
    assert.deepEqual({ ...library.zoteroStatus().account!, synced: null }, { username: 'researcher', libraries: [], syncing: false, synced: null, problem: 'unreachable' });
    assert.equal(library.status([entry('wadler90', { title: 'Linear types can change the world!' })], { online: false, zotero: true, poll: true }).entries['refs.bib#wadler90'].find, 'off');
    now += 6000;
    api.state.backoff = '';
    library.syncZotero();
    await library.idle();
    assert.equal(library.zoteroStatus().account?.problem, null);
    api.state.revoked = true;
    library.syncZotero();
    await library.idle();
    const account = library.zoteroStatus().account!;
    assert.equal(account.problem, 'revoked');
    // What the last sync found stays until the author connects again.
    assert.equal(account.libraries.length, 2);
  } finally { library.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an unfinished first sync starts over, and a new connection syncs on its own', async () => {
  const dir = temporary('library-account-partial'), api = zoteroApi('GOODKEY123');
  const library = new Library(dir, { snapshots, lookup, fetch: api.fetch, findZotero: () => null, sleep: async () => {} });
  try {
    api.state.failAt = 2;
    await library.connectZotero('GOODKEY123');
    await library.idle();
    assert.equal(library.zoteroStatus().account?.problem, 'unreachable');
    // A work received before the sync broke off is deleted in Zotero; the
    // next sync, a first one again, does not keep it.
    const own = api.libraries['users/7'];
    own.items = own.items.filter(item => item.key !== 'ITEM0001' && item.key !== 'ATT00001');
    own.version = 11;
    own.deleted = ['ITEM0001', 'ATT00001'];
    api.state.failAt = null;
    library.syncZotero();
    await library.idle();
    assert.deepEqual(library.zoteroStatus().account?.libraries[0], { name: null, items: 1, withPdf: 1, citationKeys: 1 });
    // Connecting again while the earlier connection's sync runs syncs the
    // new one too.
    await library.connectZotero('GOODKEY123');
    await library.connectZotero('GOODKEY123');
    await library.idle();
    const account = library.zoteroStatus().account!;
    assert.equal(account.syncing, false);
    assert.equal(typeof account.synced, 'number');
    assert.equal(account.libraries.length, 2);
  } finally { library.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a download with the same bytes as a Zotero file stays when Zotero is turned off', async () => {
  const home = temporary('library-twin'), dir = temporary('library');
  const { data, base } = zotero(home), location = { dataDir: data, base };
  let downloads = 0;
  const fetch = (async () => { downloads++; return new Response(fs.readFileSync(path.join(base, 'gradual.pdf')), { headers: { 'content-type': 'application/pdf' } }); }) as typeof globalThis.fetch;
  const library = new Library(dir, { snapshots, lookup, fetch, findZotero: () => location, sleep: async () => {} });
  try {
    const inputs = [entry('gradual', { title: 'Gradual typing for all, again', eprint: '2203.01835' })];
    library.status(inputs, { online: true, zotero: true });
    await library.idle();
    assert.equal(library.status(inputs, { online: true, zotero: true }).entries['refs.bib#gradual'].pdf?.source, 'zotero');
    library.status(inputs, { online: true, zotero: false });
    await library.idle();
    for (let poll = 0; poll < 3; poll++) {
      const status = library.status(inputs, { online: true, zotero: false, poll: true });
      await library.idle();
      assert.equal(status.entries['refs.bib#gradual'].pdf?.source, 'arxiv');
      assert.equal(status.pending, 0);
    }
    assert.equal(downloads, 1);
    assert.ok(fs.existsSync(path.join(base, 'gradual.pdf')));
  } finally { library.stop(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing PDFs are downloaded from arXiv and open-access copies that are visibly the work', async () => {
  const dir = temporary('library-online'), asked: string[] = [];
  const reply = (body: BodyInit, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
  const fetch = async (url: string) => {
    asked.push(url);
    if (url === 'https://export.arxiv.org/pdf/2203.01835') return reply(pdf('Gradual Typing for All, Again'), 'application/pdf');
    if (url.startsWith('https://api.openalex.org/works/doi:10.1000%2Fopen')) return reply(JSON.stringify({ best_oa_location: { pdf_url: 'https://publisher.example/a.pdf', source: { type: 'journal' } }, locations: [
      { pdf_url: 'https://repository.example/wrong.pdf', source: { type: 'repository' } }, { pdf_url: 'https://mirror.example/right.pdf', source: { type: 'repository' } }] }), 'application/json');
    if (url.startsWith('https://api.openalex.org/works/doi:10.1000%2Fclosed')) return reply(JSON.stringify({ best_oa_location: null, locations: [{ pdf_url: 'https://publisher.example/closed.pdf', source: { type: 'journal' } }] }), 'application/json');
    if (url.startsWith('https://api.openalex.org/works/doi:10.1000%2Flanding')) return reply(JSON.stringify({ open_access: { is_oa: true, oa_url: 'https://publisher.example/chapter' }, best_oa_location: { pdf_url: null, landing_page_url: 'https://publisher.example/chapter', source: { type: 'book series' } }, locations: [] }), 'application/json');
    if (url === 'https://publisher.example/chapter') return reply('<html><head><meta content="/content/pdf/chapter.pdf" name="citation_pdf_url"/></head></html>', 'text/html; charset=utf-8');
    if (url === 'https://publisher.example/content/pdf/chapter.pdf') return reply(pdf('Lecture Notes', 'Let arguments go first'), 'application/pdf');
    if (url.startsWith('https://api.openalex.org/works?search=Programming%20with%20first-class%20environments')) return reply(JSON.stringify({ results: [
      { title: 'Programming with environments', publication_year: 2024, doi: 'https://doi.org/10.1000/other', open_access: { is_oa: true }, locations: [{ pdf_url: 'https://repository.example/other.pdf', source: { type: 'repository' } }] },
      { title: 'Programming with First-Class Environments', publication_year: 2024, doi: 'https://doi.org/10.1000/titled', open_access: { is_oa: true }, locations: [{ pdf_url: 'https://repository.example/titled.pdf', source: { type: 'repository' } }] }] }), 'application/json');
    if (url === 'https://repository.example/titled.pdf') return reply(pdf('Programming with first-class environments', 'A thesis'), 'application/pdf');
    if (url === 'https://repository.example/wrong.pdf') return reply(pdf('A completely different paper about compilers'), 'application/pdf');
    if (url === 'https://mirror.example/right.pdf') return reply(pdf('Linear types can change', 'the world!', 'Philip Wadler'), 'application/pdf');
    return reply('<html>Are you a robot?</html>', 'text/html', 403);
  };
  const library = new Library(dir, { snapshots, lookup, fetch: fetch as typeof globalThis.fetch, findZotero: () => null, sleep: async () => {} });
  try {
    const inputs = [
      entry('gradual', { title: 'Gradual typing for all, again', eprint: '2203.01835' }),
      entry('wadler', { title: 'Linear types can change the world!', doi: '10.1000/open' }),
      entry('closed', { title: 'A work behind a paywall somewhere', doi: '10.1000/closed' }),
      entry('unchecked', { title: 'An entry without identifiers' }),
      entry('unknown', { title: 'An entry no source knows of' }, { status: 'unverified', via: 'title', differences: [], unavailable: [], checked: 1 }),
      entry('chapter', { title: 'Let arguments go first', doi: '10.1000/landing' }),
      entry('titled', { title: 'Programming with first-class environments', year: '2024' }, { status: 'unverified', via: 'title', differences: [], unavailable: [], checked: 1 }),
    ];
    let status = library.status(inputs, { online: true, zotero: false });
    assert.deepEqual(Object.values(status.entries).map(item => item.find), ['searching', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
    await library.idle();
    status = library.status(inputs, { online: true, zotero: false });
    assert.equal(status.entries['refs.bib#gradual'].pdf?.source, 'arxiv');
    assert.equal(status.entries['refs.bib#wadler'].pdf?.source, 'open-access');
    assert.equal(status.entries['refs.bib#wadler'].pdf?.url, 'https://mirror.example/right.pdf');
    assert.deepEqual(status.entries['refs.bib#closed'], { pdf: null, find: 'paywalled', landing: 'https://doi.org/10.1000/closed' });
    assert.deepEqual(status.entries['refs.bib#unknown'], { pdf: null, find: 'unidentified', landing: null });
    // A landing page names the PDF; a title finds a work without a DOI.
    assert.equal(status.entries['refs.bib#chapter'].pdf?.url, 'https://publisher.example/content/pdf/chapter.pdf');
    assert.equal(status.entries['refs.bib#titled'].pdf?.url, 'https://repository.example/titled.pdf');
    assert.ok(!asked.includes('https://repository.example/other.pdf'));
    assert.equal(status.pending, 1);
    // The wrong copy is not kept, and a paywalled work is not asked for again.
    assert.equal(fs.readdirSync(path.join(dir, 'files')).length, 4);
    // A PDF taken away is not downloaded and kept again, and no file is left.
    library.remove(inputs[0]);
    assert.equal(library.status(inputs, { online: true, zotero: false }).entries['refs.bib#gradual'].find, 'removed');
    library.status([inputs[0]], { online: true, zotero: false, retry: true });
    await library.idle();
    assert.equal(library.status([inputs[0]], { online: true, zotero: false }).entries['refs.bib#gradual'].pdf, null);
    assert.equal(fs.readdirSync(path.join(dir, 'files')).length, 3);
    const count = asked.length;
    library.status(inputs, { online: true, zotero: false });
    await library.idle();
    assert.equal(asked.length, count);
    library.status(inputs, { online: true, zotero: false, retry: true });
    await library.idle();
    assert.ok(asked.length > count);
  } finally { library.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a PDF the author adds goes to the entry it is dropped on, or to the one its first page names', async () => {
  const dir = temporary('library-add');
  const library = new Library(dir, { snapshots, findZotero: () => null });
  try {
    const inputs = [
      entry('wadler', { title: 'Linear types can change the world!', doi: '10.1000/open' }),
      entry('other', { title: 'Same title, different work', doi: '10.1000/a' }),
      entry('again', { title: 'Same title, different work', doi: '10.1000/b' }),
    ];
    await assert.rejects(library.add(Buffer.from('<html>'), inputs), /not a PDF/);
    assert.deepEqual(await library.add(pdf('Some unrelated notes'), inputs), { entry: null });
    assert.deepEqual(fs.readdirSync(path.join(dir, 'files')), []);
    const named = await library.add(pdf('Proceedings 1990', 'doi:10.1000/open.'), inputs);
    assert.equal(named.entry, 'refs.bib#wadler');
    const dropped = await library.add(pdf('My scan of the paper'), inputs, 'refs.bib#other');
    assert.equal(dropped.entry, 'refs.bib#other');
    await library.idle();
    const status = library.status(inputs, { online: false, zotero: false });
    assert.equal(status.entries['refs.bib#wadler'].pdf?.source, 'author');
    assert.equal(status.entries['refs.bib#other'].pdf?.hash, dropped.hash);
    // Another work with the same title does not take that PDF.
    assert.equal(status.entries['refs.bib#again'].pdf, null);
    assert.equal(matchPdf((await library.text(dropped.hash!))!, inputs), null);
    const files = fs.readdirSync(path.join(dir, 'files')).sort();
    await assert.rejects(library.add(pdf('x'), inputs, 'refs.bib#gone'), /no longer in the bibliography/);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'files')).sort(), files);

    // A dropped PDF replaces the entry's earlier one, which no work needs any more.
    const replaced = await library.add(pdf('A better scan of the paper'), inputs, 'refs.bib#other');
    assert.ok(!library.file(dropped.hash!));
    assert.ok(library.file(replaced.hash!));
    // The same file dropped on the library and on its entry at once ends up the entry's.
    const scan = pdf('Yet another scan');
    const [auto, onEntry] = await Promise.all([library.add(scan, inputs), library.add(scan, inputs, 'refs.bib#other')]);
    assert.equal(auto.entry, null);
    await library.idle();
    assert.equal(library.status(inputs, { online: false, zotero: false }).entries['refs.bib#other'].pdf?.hash, onEntry.hash);
    assert.ok(library.file(onEntry.hash!));
    // A file the author took away is not matched to that entry again.
    library.remove(inputs[0]);
    assert.deepEqual(await library.add(pdf('Proceedings 1990', 'doi:10.1000/open.'), inputs), { entry: null });

    // Two works called "Deep learning" keep their own PDFs, and a short
    // title holds a PDF under its year and first author.
    const book = entry('goodfellow', { title: 'Deep Learning', author: 'Goodfellow, Ian and Bengio, Yoshua', year: '2016' });
    const nature = entry('lecun', { title: 'Deep learning', author: 'LeCun, Yann', year: '2015', doi: '10.1038/nature14539' });
    const sets = entry('deepsets', { title: 'Deep Sets', author: 'Zaheer, Manzil', year: '2017' });
    await library.add(pdf('Deep Learning', 'Ian Goodfellow'), [book, nature, sets], book.id);
    assert.equal((await library.add(pdf('Deep Sets', 'Manzil Zaheer'), [book, nature, sets], sets.id)).entry, sets.id);
    const shelf = library.status([book, nature, sets], { online: false, zotero: false });
    assert.ok(shelf.entries[book.id].pdf);
    assert.equal(shelf.entries[nature.id].pdf, null);
    assert.ok(shelf.entries[sets.id].pdf);
  } finally { library.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sources that cannot be reached are asked again soon, and only public web addresses are asked', async () => {
  const dir = temporary('library-failures'), asked: string[] = [];
  let now = 1_000_000, offline = true;
  const reply = (body: BodyInit, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
  const fetch = async (url: string) => {
    asked.push(url);
    if (offline) throw new TypeError('fetch failed');
    if (url.startsWith('https://api.openalex.org/works/doi:10.1000%2Fbusy')) return reply('', 'text/plain', 503);
    if (url.startsWith('https://api.openalex.org/works/doi:10.1000%2Flater')) return reply(JSON.stringify({ best_oa_location: { pdf_url: 'https://repository.example/later.pdf', source: { type: 'repository' } }, locations: [] }), 'application/json');
    if (url === 'https://repository.example/later.pdf') return new Response('Come back later', { status: 503, headers: { 'retry-after': '30' } });
    if (url.startsWith('https://api.openalex.org/works/doi:10.1000%2Fodd')) return reply(JSON.stringify({ open_access: { is_oa: true }, best_oa_location: { landing_page_url: 'https://publisher.example/odd' },
      locations: [{ pdf_url: 'https://exa mple.org/a.pdf' }, { pdf_url: 'http://127.0.0.1:7274/api/state' }] }), 'application/json');
    if (url === 'https://publisher.example/odd') return reply('<html><head><meta name="citation_pdf_url" content="http://192.168.1.2/paper.pdf"></head>', 'text/html');
    if (url === 'https://export.arxiv.org/pdf/2203.01835') return reply(pdf('Gradual Typing for All, Again'), 'application/pdf');
    return reply('missing', 'text/plain', 404);
  };
  const library = new Library(dir, { snapshots, lookup, fetch: fetch as typeof globalThis.fetch, findZotero: () => null, sleep: async () => {}, now: () => now });
  try {
    const inputs = [entry('gradual', { title: 'Gradual typing for all, again', eprint: '2203.01835' }), entry('busy', { title: 'A work on a busy server', doi: '10.1000/busy' }), entry('odd', { title: 'A work with odd links', doi: '10.1000/odd' }),
      entry('later', { title: 'A work whose repository asks to come back later', doi: '10.1000/later' })];
    library.status(inputs, { online: true, zotero: false });
    await library.idle();
    let status = library.status(inputs, { online: true, zotero: false });
    assert.deepEqual(Object.values(status.entries).map(item => item.find), ['unreachable', 'unreachable', 'unreachable', 'unreachable']);
    assert.equal(status.pending, 0);
    offline = false;
    now += 121000;
    // While the panel keeps polling, they are not asked again, so polling ends.
    const count = asked.length;
    assert.equal(library.status(inputs, { online: true, zotero: false, poll: true }).pending, 0);
    await library.idle();
    assert.equal(asked.length, count);
    library.status(inputs, { online: true, zotero: false });
    await library.idle();
    status = library.status(inputs, { online: true, zotero: false });
    assert.equal(status.entries['refs.bib#gradual'].pdf?.source, 'arxiv');
    assert.equal(status.entries['refs.bib#busy'].find, 'unreachable');
    assert.equal(status.entries['refs.bib#odd'].find, 'paywalled');
    // A host asking Papilot to come back later is asked again soon, not in a week.
    assert.equal(status.entries['refs.bib#later'].find, 'unreachable');
    assert.equal(status.pending, 0);
    assert.ok(!asked.some(url => /127\.0\.0\.1|192\.168|exa mple/.test(url)), asked.join('\n'));
  } finally { library.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// A folder its owner cannot write to stays writable for root.
test('a download that cannot be saved leaves the server running and the work to be asked for again', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const dir = temporary('library-readonly'), files = path.join(dir, 'files');
  const library = new Library(dir, { snapshots, lookup, fetch: (async () => new Response(pdf('Gradual Typing for All, Again'), { headers: { 'content-type': 'application/pdf' } })) as typeof globalThis.fetch, findZotero: () => null, sleep: async () => {} });
  fs.chmodSync(files, 0o500);
  try {
    const inputs = [entry('gradual', { title: 'Gradual typing for all, again', eprint: '2203.01835' })];
    library.status(inputs, { online: true, zotero: false });
    await library.idle();
    assert.equal(library.status(inputs, { online: true, zotero: false }).entries['refs.bib#gradual'].find, 'unreachable');
  } finally { fs.chmodSync(files, 0o700); library.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('agents list, search and read the PDFs of the works the paper cites', async () => {
  const store = new Store(':memory:');
  const task: Task = { id: 'task', projectId: 'paper', name: 'p-task', title: 'Write', instructions: 'Write.', document: 'main.tex', worktree: '/unused', threadId: null, turnId: null, model: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
  store.saveProject({ id: 'paper', name: 'Paper', path: '/unused', createdAt: 1 }); store.saveTask(task);
  const lines = (...texts: string[][]): ReviewSnapshot => ({ key: 'hash', lines: texts.flatMap((page, index) => page.map((text, line) => ({ id: `p${index + 1}-l${line + 1}`, page: index, text, rect: [0, 0, 1, 1] as [number, number, number, number] }))) });
  const works: LibraryWork[] = [
    { key: 'wadler', title: 'Linear types can change the world!', authors: 'Philip Wadler', year: '1990', pdf: true, pages: 2, lines: async () => lines(['Linear types can change the world!'], ['A linear value is used exactly', 'once.']) },
    { key: 'girard', title: 'Linear logic', authors: 'Jean-Yves Girard', year: '1987', pdf: false, pages: null, lines: async () => null },
    { key: 'walker', title: 'Substructural type systems', authors: 'David Walker', year: '2005', pdf: true, pages: 1, lines: async () => lines(['Each value is used exactly once in a linear system.']) },
  ];
  const added: string[][] = [], recorded: unknown[] = [];
  const sentence = (id: string, keys: string[], text: string, findings: CitingSentence['findings'] = {}): CitingSentence => ({ id, keys, file: 'main.tex', line: 3, section: '1 Introduction', sentence: text, findings });
  const sentences = [
    sentence('s1', ['wadler'], 'Linear values are used exactly once [wadler].', { wadler: { verdict: 'supported', note: 'Stated on page 2.', evidence: [], pdf: 'hash', checkedAt: 1 } }),
    sentence('s2', ['walker', 'girard'], 'Substructural systems control how often values are used [walker, girard].'),
  ];
  const tools = new PaperTools(store, {} as Manuscripts, () => false, {
    works: async () => works,
    add: async (_paper, key, url) => {
      added.push([key, url]);
      if (url.includes('wrong')) throw new Error('The first page of this PDF shows neither the work\'s full title nor its DOI, so it was not kept.');
      return { pages: 12 };
    },
    citations: async () => sentences,
    record: async (_paper, record) => {
      recorded.push(record);
      if (record.id === 'gone') throw new Error('No citing sentence has the ID gone; the paper may have changed. Use citations_list.');
      return { verdict: record.verdict as 'supported', note: record.note, evidence: [{ quote: 'Each value is used exactly once in a linear system.', page: 1, marks: [] }], pdf: 'hash', checkedAt: 2 };
    },
  });
  const call = (tool: string, args: object) => tools.call(task, tool, args, () => true) as Promise<any>;
  try {
    const listed = await call('library_list', {});
    assert.deepEqual(listed.works.map((work: any) => [work.key, work.pdf]), [['wadler', true], ['girard', false], ['walker', true]]);
    assert.equal(listed.withPdf, 2);
    const found = await call('library_search', { query: 'used exactly once' });
    assert.deepEqual(found.matches.map((match: any) => [match.key, match.start, match.page]), [['wadler', 'p2-l1', 2], ['walker', 'p1-l1', 1]]);
    assert.equal(found.withoutPdf, 1);
    assert.deepEqual((await call('library_search', { query: 'used exactly once', key: 'walker' })).matches.map((match: any) => match.key), ['walker']);
    const read = await call('library_read', { key: 'wadler', page: 2 });
    assert.deepEqual(read.lines.map((line: any) => line.text), ['A linear value is used exactly', 'once.']);
    assert.equal(read.key, 'wadler');
    await assert.rejects(call('library_read', { key: 'girard' }), /no PDF of girard/);
    await assert.rejects(call('library_read', { key: 'nobody' }), /No bibliography entry has the key nobody/);
    // An agent adds a missing PDF from an open copy; the library says why it refuses one.
    assert.deepEqual(await call('library_add', { key: 'girard', url: 'https://people.example/girard.pdf' }), { key: 'girard', added: true, pages: 12 });
    await assert.rejects(call('library_add', { key: 'girard', url: 'https://people.example/wrong.pdf' }), /shows neither the work's full title nor its DOI/);
    await assert.rejects(call('library_add', { key: 'wadler', url: 'https://people.example/wadler.pdf' }), /wadler already has a PDF/);
    await assert.rejects(call('library_add', { key: 'nobody', url: 'https://people.example/x.pdf' }), /No bibliography entry has the key nobody/);
    assert.deepEqual(added, [['girard', 'https://people.example/girard.pdf'], ['girard', 'https://people.example/wrong.pdf']]);
    // Citations: the sentences with each work's PDF and verdict, and recording one.
    const cited = await call('citations_list', {});
    assert.deepEqual(cited.sentences.map((item: any) => [item.id, item.works]), [['s1', [{ key: 'wadler', pdf: true, verdict: 'supported' }]], ['s2', [{ key: 'walker', pdf: true }, { key: 'girard', pdf: false }]]]);
    assert.deepEqual((await call('citations_list', { unchecked: true })).sentences.map((item: any) => item.id), ['s2']);
    assert.deepEqual((await call('citations_list', { key: 'wadler' })).sentences.map((item: any) => item.id), ['s1']);
    const saved = await call('citation_record', { id: 's2', key: 'walker', verdict: 'supported', evidence: [{ start: 'p1-l1', end: 'p1-l1' }], note: 'The work defines linear systems so.' });
    assert.deepEqual(saved, { recorded: true, verdict: 'supported', evidence: [{ page: 1, quote: 'Each value is used exactly once in a linear system.' }] });
    assert.deepEqual(recorded, [{ id: 's2', key: 'walker', verdict: 'supported', evidence: [{ start: 'p1-l1', end: 'p1-l1' }], note: 'The work defines linear systems so.' }]);
    await assert.rejects(call('citation_record', { id: 'gone', key: 'walker', verdict: 'unclear', note: 'A figure.' }), /No citing sentence has the ID gone/);
    await assert.rejects(call('citation_record', { id: 's2', key: 'walker', verdict: 'supported', evidence: ['p1-l1'], note: 'Stated.' }), /evidence is a list/);
  } finally { store.close(); }
});

test('a PDF an agent found is downloaded by the library and kept only when it is visibly the work', async () => {
  const dir = temporary('library-agent'), asked: string[] = [];
  const reply = (body: BodyInit, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
  const fetch = async (url: string) => {
    asked.push(url);
    if (url === 'https://people.example/girard.pdf') return reply(pdf('Linear Logic', 'Jean-Yves Girard'), 'application/pdf');
    if (url === 'https://people.example/wrong.pdf') return reply(pdf('Proofs and Types'), 'application/pdf');
    // A later paper that cites the work early on is not the work.
    if (url === 'https://people.example/later.pdf') return reply(pdf('Twenty years of resource-aware proofs', 'As Linear Logic by Girard showed'), 'application/pdf');
    if (url === 'https://people.example/page') return reply('<html><body>Download</body></html>', 'text/html');
    return reply('missing', 'text/plain', 404);
  };
  const library = new Library(dir, { snapshots, lookup, fetch: fetch as typeof globalThis.fetch, findZotero: () => null, sleep: async () => {} });
  const girard = entry('girard', { title: 'Linear logic', author: 'Girard, Jean-Yves', year: '1987' });
  try {
    await assert.rejects(library.addFrom('https://people.example/wrong.pdf', girard), /shows neither the work's full title nor its DOI/);
    await assert.rejects(library.addFrom('https://people.example/later.pdf', girard), /shows neither the work's full title nor its DOI/);
    await assert.rejects(library.addFrom('https://people.example/page', girard), /gave no PDF/);
    await assert.rejects(library.addFrom('http://10.0.0.5/girard.pdf', girard), /gave no PDF/);
    // A name that resolves to this computer is no public address either.
    await assert.rejects(library.addFrom('http://localtest.me:7274/api/state', girard), /gave no PDF/);
    assert.ok(!asked.some(url => /10\.0\.0\.5|localtest/.test(url)), asked.join(' '));
    assert.deepEqual(fs.readdirSync(path.join(dir, 'files')), [], 'A refused PDF leaves no file');
    assert.equal((await library.addFrom('https://people.example/girard.pdf', girard)).pages, 2);
    const pdfOf = () => library.status([girard], { online: false, zotero: false }).entries['refs.bib#girard'].pdf;
    assert.deepEqual({ source: pdfOf()?.source, url: pdfOf()?.url }, { source: 'agent', url: 'https://people.example/girard.pdf' });
    await assert.rejects(library.addFrom('https://people.example/girard.pdf', girard), /girard already has a PDF/);
    // One the author took away is not added again.
    library.remove(girard);
    await assert.rejects(library.addFrom('https://people.example/girard.pdf', girard), /took this PDF away/);
    assert.equal(pdfOf(), null);
  } finally { library.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a PDF an agent adds neither relabels another work\'s nor leaves the finder\'s copy behind', async () => {
  const home = temporary('library-agent-zotero'), dir = temporary('library-agent-race');
  const { data, base } = zotero(home);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reply = (body: BodyInit) => new Response(body, { headers: { 'content-type': 'application/pdf' } });
  const fetch = async (url: string) => {
    // The same bytes as a Zotero PDF of another work.
    if (url === 'https://people.example/zhao.pdf') return reply(fs.readFileSync(path.join(data, 'storage', 'ATT00001', 'Zhao 2019.pdf')));
    if (url === 'https://people.example/gradual.pdf') return reply(pdf('Gradual Typing for All, Again', 'Author version'));
    if (url === 'https://export.arxiv.org/pdf/2203.01835') { await gate; return reply(pdf('Gradual Typing for All, Again', 'arXiv version')); }
    return new Response('missing', { status: 404 });
  };
  const library = new Library(dir, { snapshots, lookup, fetch: fetch as typeof globalThis.fetch, findZotero: () => ({ dataDir: data, base }), sleep: async () => {} });
  const zhao = entry('zhaoMechanical2019', { title: 'A mechanical formalization of higher-ranked polymorphic type inference' });
  const girard = entry('girard', { title: 'Linear logic', author: 'Girard, Jean-Yves', year: '1987' });
  const gradual = entry('gradualAgain', { title: 'Gradual typing for all, again', eprint: '2203.01835' });
  const sourceOf = (input: LibraryInput) => library.status([input], { online: false, zotero: true, poll: true }).entries[input.id].pdf?.source;
  try {
    library.status([zhao], { online: false, zotero: true });
    await library.idle();
    assert.equal(sourceOf(zhao), 'zotero');
    await assert.rejects(library.addFrom('https://people.example/zhao.pdf', girard), /shows neither/);
    assert.equal(sourceOf(zhao), 'zotero');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'files')), []);
    // The finder's arXiv download is still running when the agent adds a copy.
    library.status([gradual], { online: true, zotero: false });
    await new Promise(resolve => setTimeout(resolve, 50));
    await library.addFrom('https://people.example/gradual.pdf', gradual);
    release();
    await library.idle();
    assert.equal(sourceOf(gradual), 'agent');
    assert.equal(fs.readdirSync(path.join(dir, 'files')).length, 1, 'The finder\'s copy no work links is not kept');
  } finally { release(); library.stop(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('what a cited work says of a sentence is recorded with its own lines as evidence, and goes stale when the PDF or sentence changes', async () => {
  const root = temporary('citation-paper'), dir = temporary('citation-library');
  execFileSync('git', ['init', '-q'], { cwd: root });
  const main = (claim: string) => `\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\n${claim}~\\cite{wadler}.\n\\bibliography{refs}\n\\end{document}\n`;
  fs.writeFileSync(path.join(root, 'main.tex'), main('Linear values can be updated in place'));
  fs.writeFileSync(path.join(root, 'refs.bib'), '@article{wadler, title = {Linear types can change the world!}, author = {Wadler, Philip}, year = 1990}\n');
  const library = new Library(dir, { snapshots, findZotero: () => null });
  const report = () => libraryReport(root, { online: false, zotero: false }, library);
  try {
    const inputs = (await report()).entries.map(entry => ({ id: entry.id, key: entry.key, type: entry.type, fields: Object.fromEntries(entry.fields.map(field => [field.name, field.value])) }));
    await library.add(pdf('Linear types can change the world!', 'A linear value is used exactly once,', 'so it can be updated in place.'), inputs);
    const [cited] = (await report()).citations;
    assert.deepEqual({ keys: cited.keys, section: cited.section, sentence: cited.sentence }, { keys: ['wadler'], section: '1 Introduction', sentence: 'Linear values can be updated in place [wadler].' });
    // The quote is the PDF's own lines, from one anchor to the other.
    const finding = await recordFinding(root, { id: cited.id, key: 'wadler', verdict: 'supported', evidence: [{ start: 'p3-l1', end: 'p2-l1' }], note: 'Stated directly.' }, library);
    assert.deepEqual(finding.evidence.map(item => ({ quote: item.quote, page: item.page, pages: item.marks.map(mark => mark.page) })), [{ quote: 'A linear value is used exactly once, so it can be updated in place.', page: 2, pages: [2, 3] }]);
    assert.equal((await report()).citations[0].findings.wadler.verdict, 'supported');
    await assert.rejects(recordFinding(root, { id: 'gone', key: 'wadler', verdict: 'supported', evidence: [], note: '' }, library), /No citing sentence has the ID gone/);
    await assert.rejects(recordFinding(root, { id: cited.id, key: 'girard', verdict: 'supported', evidence: [], note: '' }, library), /This sentence cites wadler, not girard/);
    await assert.rejects(recordFinding(root, { id: cited.id, key: 'wadler', verdict: 'maybe', evidence: [], note: '' }, library), /The verdict is one of/);
    await assert.rejects(recordFinding(root, { id: cited.id, key: 'wadler', verdict: 'supported', evidence: [], note: '' }, library), /Give the lines/);
    await assert.rejects(recordFinding(root, { id: cited.id, key: 'wadler', verdict: 'partial', evidence: [{ start: 'p9-l1', end: 'p9-l2' }], note: '' }, library), /has no line p9-l1/);
    // Another PDF of the work makes the finding stale; a rewritten sentence is checked again.
    await library.add(pdf('Linear types can change the world!', 'Revised edition'), inputs, inputs[0].id);
    assert.equal((await report()).citations[0].findings.wadler.stale, true);
    fs.writeFileSync(path.join(root, 'main.tex'), main('Linear values are never copied'));
    assert.deepEqual((await report()).citations[0].findings, {});
  } finally { library.stop(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the library routes add, serve and take away the PDFs of the paper\'s own entries', async () => {
  const root = temporary('library-paper'), dir = temporary('library-routes');
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'main.tex'), '\\documentclass{article}\\begin{document}\\cite{wadler}\\bibliography{refs}\\end{document}\n');
  fs.writeFileSync(path.join(root, 'refs.bib'), '@article{wadler, title = {Linear types can change the world!}, doi = {10.1000/open}, year = 1990}\n');
  const store = new Store(path.join(dir, 'state.sqlite'));
  class Agent extends EventEmitter { ready = false; async request() { return {}; } start = async () => {}; respond() {} reject() {} close() {} }
  const review = { url: 'http://unused', token: '', get: async () => ({ cursor: 0, feedback: [] }) as any, post: async () => ({ worktree: root }) as any };
  const workspace = new Workspace(store, new Agent() as any, async () => review, { claude: new Agent() as any, antigravity: new Agent() as any });
  store.saveProject({ id: 'paper', path: root, name: 'Paper', createdAt: 1 });
  store.saveProject({ id: 'other', path: path.join(dir, 'other'), name: 'Other', createdAt: 1 });
  const library = new Library(path.join(dir, 'library'), { snapshots, findZotero: () => null });
  const app = await buildApp({ listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' }, store, workspace, manuscripts: new Manuscripts(), csrf: 'csrf', serialGit: gitQueue(), dist: null, version: 'test', connectReview: async () => review, library });
  const headers = { host: '127.0.0.1:7274', origin: 'http://127.0.0.1:7274', 'x-papilot-token': 'csrf' };
  try {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/library/zotero', headers })).json(), { local: { chosen: null, state: 'missing' }, account: null, use: true });
    const located = await app.inject({ method: 'POST', url: '/api/library/zotero/location', headers, payload: { dataDir: dir } });
    assert.equal(located.statusCode, 400);
    assert.match(located.json().error, /This folder has no zotero.sqlite/);
    const off = await app.inject({ method: 'POST', url: '/api/library/zotero/use', headers, payload: { use: false } });
    assert.equal(off.json().use, false);
    assert.equal((await app.inject({ method: 'POST', url: '/api/library/zotero/use', headers, payload: { use: true } })).json().use, true);
    const refused = await app.inject({ method: 'POST', url: '/api/library/zotero/account', headers, payload: { key: 'not a key!' } });
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.json().error, 'Zotero does not accept this key. Check it and try again.');
    assert.equal((await app.inject({ method: 'POST', url: '/api/library/zotero/account', payload: { key: 'KEY' }, headers: { ...headers, 'x-papilot-token': 'wrong' } })).statusCode, 403);
    const upload = await app.inject({ method: 'POST', url: '/api/projects/paper/library/pdf', headers: { ...headers, 'content-type': 'application/octet-stream', 'x-papilot-filename': 'wadler.pdf' }, payload: pdf('Linear types can change the world!', 'Philip Wadler') });
    assert.equal(upload.statusCode, 200, upload.body);
    assert.equal(upload.json().entry, 'refs.bib#wadler');
    const report = (await app.inject({ method: 'GET', url: '/api/projects/paper/library?online=0', headers })).json();
    assert.equal(report.entries[0].key, 'wadler');
    const { hash, source } = report.library.entries['refs.bib#wadler'].pdf;
    assert.equal(source, 'author');
    const served = await app.inject({ method: 'GET', url: `/api/projects/paper/library/pdfs/${hash}`, headers });
    assert.equal(served.statusCode, 200);
    assert.equal(served.headers['content-type'], 'application/pdf');
    assert.ok(served.rawPayload.subarray(0, 5).equals(Buffer.from('%PDF-')));
    assert.equal((await app.inject({ method: 'GET', url: `/api/projects/paper/library/pdfs/${'0'.repeat(64)}`, headers })).statusCode, 404);
    const removed = await app.inject({ method: 'POST', url: '/api/projects/paper/library/remove', headers, payload: { entry: 'refs.bib#wadler' } });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal((await app.inject({ method: 'GET', url: `/api/projects/paper/library/pdfs/${hash}`, headers })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/api/projects/paper/library?online=0', headers })).json().library.entries['refs.bib#wadler'].pdf, null);
  } finally {
    await app.close(); workspace.close(); store.close(); library.stop();
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('quick citation checks run from the library routes, automatically once per citation, and the library search pages through PDFs', async () => {
  const root = temporary('quick-paper'), dir = temporary('quick-routes');
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'main.tex'), '\\documentclass{article}\\begin{document}\\section{Introduction}Linear values can be updated in place \\cite{wadler}.\\bibliography{refs}\\end{document}\n');
  fs.writeFileSync(path.join(root, 'refs.bib'), '@article{wadler, title = {Linear types can change the world!}, doi = {10.1000/open}, year = 1990}\n');
  const store = new Store(path.join(dir, 'state.sqlite'));
  class Agent extends EventEmitter { ready = false; async request() { return {}; } start = async () => {}; respond() {} reject() {} close() {} }
  const review = { url: 'http://unused', token: '', get: async () => ({ cursor: 0, feedback: [] }) as any, post: async () => ({ worktree: root }) as any };
  const workspace = new Workspace(store, new Agent() as any, async () => review, { claude: new Agent() as any, antigravity: new Agent() as any });
  store.saveProject({ id: 'paper', path: root, name: 'Paper', createdAt: 1 });
  const prompts: string[] = [];
  // The quick model, faked: it supports every item with the first line it was shown.
  workspace.quickReply = async ({ prompt }) => {
    prompts.push(prompt);
    const results = prompt.split('## Item ').slice(1).map(block => { const id = block.split('\n')[0], line = /<(p\d+-l\d+)>/.exec(block)![1]; return { id, verdict: 'supported', note: 'Stated.', evidence: [{ start: line, end: line }] }; });
    return { reply: JSON.stringify({ results }), agent: 'deepseek', model: 'DeepSeek V4.1 Flash UltraFast' };
  };
  const library = new Library(path.join(dir, 'library'), { snapshots, findZotero: () => null });
  const app = await buildApp({ listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' }, store, workspace, manuscripts: new Manuscripts(), csrf: 'csrf', serialGit: gitQueue(), dist: null, version: 'test', connectReview: async () => review, library });
  const headers = { host: '127.0.0.1:7274', origin: 'http://127.0.0.1:7274', 'x-papilot-token': 'csrf' };
  const report = async () => (await app.inject({ method: 'GET', url: '/api/projects/paper/library?online=0', headers })).json();
  const settled = async () => { for (let i = 0; i < 200; i++) { const value = await report(); if (!value.quickCheck?.running) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('The check did not finish.'); };
  try {
    await app.inject({ method: 'POST', url: '/api/projects/paper/library/pdf', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: pdf('Linear types can change the world!', 'A linear value is used exactly once, so it can be updated in place.') });
    for (let i = 0; i < 200 && (await report()).library.entries['refs.bib#wadler'].pdf?.text !== 'ready'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await report()).autoCheck, false);
    assert.equal(prompts.length, 0, 'nothing is checked by itself until the author turns it on');
    const on = await app.inject({ method: 'POST', url: '/api/projects/paper/citations/auto-check?online=0', headers, payload: { enabled: true } });
    assert.equal(on.json().autoCheck, true);
    let value = await settled();
    assert.equal(prompts.length, 1);
    const [sentence] = value.citations;
    assert.deepEqual([sentence.findings.wadler.verdict, sentence.findings.wadler.by], ['supported', 'DeepSeek V4.1 Flash UltraFast']);
    assert.deepEqual([value.quickCheck.done, value.quickCheck.total, value.quickCheck.failed], [1, 1, 0]);
    // A finding the author dismisses is not checked again by itself.
    await app.inject({ method: 'POST', url: '/api/projects/paper/citations/forget?online=0', headers, payload: { id: sentence.id, key: 'wadler' } });
    value = await settled();
    assert.equal(prompts.length, 1);
    assert.deepEqual(value.citations[0].findings, {});
    // Check citations asks again on request; a rewritten sentence is new and is checked by itself.
    await app.inject({ method: 'POST', url: '/api/projects/paper/citations/quick-check?online=0', headers, payload: {} });
    value = await settled();
    assert.equal(prompts.length, 2);
    fs.writeFileSync(path.join(root, 'main.tex'), '\\documentclass{article}\\begin{document}\\section{Introduction}A linear value is used exactly once \\cite{wadler}.\\bibliography{refs}\\end{document}\n');
    await report(); value = await settled();
    assert.equal(prompts.length, 3);
    assert.equal(value.citations[0].findings.wadler.verdict, 'supported');
    // The library search finds the words in the PDFs, a page at a time.
    const found = (await app.inject({ method: 'GET', url: '/api/projects/paper/library/search?q=updated%20in%20place', headers })).json();
    assert.deepEqual(found.matches.map((match: any) => [match.key, match.page, match.text]), [['wadler', 2, 'A linear value is used exactly once, so it can be updated in place.']]);
    assert.equal(found.nextCursor, null);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/projects/paper/library/search?q=%20%20', headers })).json(), { matches: [], nextCursor: null });
    assert.equal((await app.inject({ method: 'GET', url: '/api/projects/paper/library/search?q=linear&cursor=-1:0', headers })).statusCode, 400);
    // The quick model choice is checked and saved on the host.
    assert.equal((await app.inject({ method: 'POST', url: '/api/quick-model', headers, payload: { agent: 'nobody' } })).statusCode, 400);
    assert.deepEqual((await app.inject({ method: 'POST', url: '/api/quick-model', headers, payload: { agent: 'deepseek', model: 'deepseek/deepseek-v4.1-flash-ultrafast' } })).json(), { choice: { agent: 'deepseek', model: 'deepseek/deepseek-v4.1-flash-ultrafast', effort: null } });
    assert.deepEqual((await app.inject({ method: 'POST', url: '/api/quick-model', headers, payload: { agent: null } })).json(), { choice: null });
  } finally {
    await app.close(); workspace.close(); store.close(); library.stop();
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('Find sources suggests a library work for a sentence that cites nothing, only when asked, once per set of ranked works, and a dismissed one stays gone', async () => {
  const root = temporary('suggest-paper'), dir = temporary('suggest-routes');
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'main.tex'), [
    '\\documentclass{article}\\begin{document}\\section{Introduction}',
    'Linear values can be updated in place \\cite{wadler}.',
    'A linear value is used exactly once, which is why it can be updated destructively.',
    'Our dataset was collected from three hospitals in the spring.',
    '\\bibliography{refs}\\end{document}', ''].join('\n'));
  fs.writeFileSync(path.join(root, 'refs.bib'), '@article{wadler, title = {Linear types can change the world!}, doi = {10.1000/open}, year = 1990}\n');
  const store = new Store(path.join(dir, 'state.sqlite'));
  class Agent extends EventEmitter { ready = false; async request() { return {}; } start = async () => {}; respond() {} reject() {} close() {} }
  const review = { url: 'http://unused', token: '', get: async () => ({ cursor: 0, feedback: [] }) as any, post: async () => ({ worktree: root }) as any };
  const workspace = new Workspace(store, new Agent() as any, async () => review, { claude: new Agent() as any, antigravity: new Agent() as any });
  store.saveProject({ id: 'paper', path: root, name: 'Paper', createdAt: 1 });
  const asked: string[] = [];
  workspace.quickReply = async ({ prompt, what }) => {
    asked.push(what);
    const results = prompt.split('## Item ').slice(1).map(block => {
      // Suggestion passages name their work in each anchor; the model answers with the line alone.
      const id = block.split('\n')[0], line = /<(?:[^:>]+:)?(p\d+-l\d+)>/.exec(block)![1];
      return /^Work \[/m.test(block) ? { id, key: 'wadler', verdict: 'supported', note: 'Stated.', evidence: [{ start: line, end: line }] } : { id, verdict: 'supported', note: 'Stated.', evidence: [{ start: line, end: line }] };
    });
    return { reply: JSON.stringify({ results }), agent: 'deepseek', model: 'DeepSeek V4.1 Flash UltraFast' };
  };
  const library = new Library(path.join(dir, 'library'), { snapshots, findZotero: () => null });
  const app = await buildApp({ listener: { kind: 'local', port: 7274, publicOrigin: '', owner: '' }, store, workspace, manuscripts: new Manuscripts(), csrf: 'csrf', serialGit: gitQueue(), dist: null, version: 'test', connectReview: async () => review, library });
  const headers = { host: '127.0.0.1:7274', origin: 'http://127.0.0.1:7274', 'x-papilot-token': 'csrf' };
  const report = async () => (await app.inject({ method: 'GET', url: '/api/projects/paper/library?online=0', headers })).json();
  const settled = async () => { for (let i = 0; i < 200; i++) { const value = await report(); if (!value.quickCheck?.running) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('The check did not finish.'); };
  try {
    await app.inject({ method: 'POST', url: '/api/projects/paper/library/pdf', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: pdf('Linear types can change the world!', 'A linear value is used exactly once, so it can be updated in place.') });
    for (let i = 0; i < 200 && (await report()).library.entries['refs.bib#wadler'].pdf?.text !== 'ready'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    // Checking citations, also automatically, never looks for sources: only Find sources does.
    await app.inject({ method: 'POST', url: '/api/projects/paper/citations/auto-check?online=0', headers, payload: { enabled: true } });
    await settled();
    assert.deepEqual(asked, ['check citations']);
    assert.equal((await report()).uncited, 2);
    assert.equal((await app.inject({ method: 'POST', url: '/api/projects/paper/citations/quick-check?online=0', headers, payload: { kind: 'everything' } })).statusCode, 400);
    await app.inject({ method: 'POST', url: '/api/projects/paper/citations/quick-check?online=0', headers, payload: { kind: 'sources' } });
    let value = await settled();
    assert.equal(value.quickCheck.kind, 'sources');
    assert.deepEqual(asked, ['check citations', 'find sources for uncited sentences'], 'the hospital sentence shares too few words with any work to ask about');
    assert.equal(value.suggestions.length, 1);
    const [suggestion] = value.suggestions;
    assert.deepEqual([suggestion.key, suggestion.verdict, suggestion.by, suggestion.line], ['wadler', 'supported', 'DeepSeek V4.1 Flash UltraFast', 3]);
    assert.match(suggestion.sentence, /^A linear value is used exactly once/);
    assert.match(suggestion.evidence[0].quote, /used exactly once/);
    // The works it ranks did not change: the sentence is not asked about again.
    await app.inject({ method: 'POST', url: '/api/projects/paper/citations/quick-check?online=0', headers, payload: { kind: 'sources' } });
    await settled();
    assert.equal(asked.length, 2);
    const dismissed = await app.inject({ method: 'POST', url: '/api/projects/paper/citations/suggestions/dismiss?online=0', headers, payload: { id: suggestion.id } });
    assert.deepEqual(dismissed.json().suggestions, []);
    assert.deepEqual((await report()).suggestions, []);
  } finally {
    await app.close(); workspace.close(); store.close(); library.stop();
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
