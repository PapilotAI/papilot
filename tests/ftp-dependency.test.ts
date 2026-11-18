import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';

// get-uri still requests basic-ftp 5.x. Exercise the actual FTP adapter against
// a local server before overriding that dependency to the patched 6.x release.
test('get-uri can download, list and revalidate files with the patched FTP client', async t => {
  const require = createRequire(import.meta.url);
  const { getUri } = require('get-uri');
  const sockets = new Set<net.Socket>();
  const servers = new Set<net.Server>();
  const commands: string[] = [];
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    return socket;
  };
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([...servers].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  });
  const server = net.createServer(socket => {
    track(socket);
    socket.setEncoding('utf8');
    socket.write('220 Local FTP fixture\r\n');
    let buffer = '';
    let dataConnection: Promise<net.Socket>;
    let pending = Promise.resolve();
    const command = async (line: string) => {
      commands.push(line);
      const [verb, ...rest] = line.split(' ');
      const argument = rest.join(' ');
      const reply = (value: string) => socket.write(value + '\r\n');
      switch (verb) {
        case 'USER': reply('331 Password required'); break;
        case 'PASS': reply('230 Logged in'); break;
        case 'FEAT': reply('211 No extensions'); break;
        case 'OPTS': case 'TYPE': case 'STRU': case 'MODE': reply('200 OK'); break;
        case 'MDTM':
          reply(argument === '/missing.txt' ? '550 Not found' : argument === '/listing.txt' ? '500 Unsupported' : '213 20260102030405');
          break;
        case 'EPSV': {
          const dataServer = net.createServer();
          servers.add(dataServer);
          dataConnection = once(dataServer, 'connection').then(([data]) => {
            dataServer.close();
            return track(data);
          });
          dataServer.listen(0, '127.0.0.1');
          await once(dataServer, 'listening');
          reply(`229 Entering Extended Passive Mode (|||${(dataServer.address() as net.AddressInfo).port}|)`);
          break;
        }
        case 'MLSD': case 'LIST': case 'RETR': {
          reply('150 Opening data connection');
          const data = await dataConnection;
          data.end(verb === 'RETR' ? 'writer proxy fixture\n' : 'type=file;size=21;modify=20260102030405; listing.txt\r\n');
          await once(data, 'finish');
          reply('226 Transfer complete');
          break;
        }
        case 'QUIT': socket.end('221 Goodbye\r\n'); break;
        default: reply('502 Unsupported command');
      }
    };
    socket.on('data', chunk => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        pending = pending.then(() => command(line)).catch(error => { socket.destroy(error); });
      }
    });
  });
  servers.add(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `ftp://writer:secret@127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const first = await getUri(`${base}/direct.txt`, { timeout: 5000 });
  let contents = '';
  for await (const chunk of first) contents += chunk;
  assert.equal(contents, 'writer proxy fixture\n');
  assert.equal(first.lastModified.toISOString(), '2026-01-02T03:04:05.000Z');
  await assert.rejects(getUri(`${base}/direct.txt`, { cache: first, timeout: 5000 }), { code: 'ENOTMODIFIED' });
  await assert.rejects(getUri(`${base}/missing.txt`, { timeout: 5000 }), { code: 'ENOTFOUND' });
  const listed = await getUri(`${base}/listing.txt`, { timeout: 5000 });
  contents = '';
  for await (const chunk of listed) contents += chunk;
  assert.equal(contents, 'writer proxy fixture\n');
  assert.ok(commands.some(command => /^(MLSD|LIST) /.test(command)), 'falls back to a directory listing');
});
