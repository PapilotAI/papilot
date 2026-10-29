import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store.ts';
import { Accounts, deviceLabel } from '../src/server/accounts.ts';

const ORIGIN = 'https://mini.example.ts.net:10000';
// Ceremonies that trust whatever the fake browser says, except the challenge,
// which goes through Accounts' own check exactly as the real library does.
function passkeys() {
  let next = 0;
  return {
    generateRegistrationOptions: async (options: any) => ({ challenge: `register-${++next}`, rp: { id: options.rpID }, user: { id: options.userID } }) as any,
    verifyRegistrationResponse: async ({ response, expectedChallenge }: any) => await expectedChallenge(response.challenge)
      ? { verified: true, registrationInfo: { credential: { id: response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } } } as any
      : { verified: false },
    generateAuthenticationOptions: async () => ({ challenge: `sign-in-${++next}` }) as any,
    verifyAuthenticationResponse: async ({ response, expectedChallenge, credential }: any) => {
      if (!await expectedChallenge(response.challenge)) return { verified: false } as any;
      if ((response.counter > 0 || credential.counter > 0) && response.counter <= credential.counter) throw new Error('Counter went backwards.');
      return { verified: true, authenticationInfo: { newCounter: response.counter } } as any;
    },
  };
}
function fixture() {
  let now = 1_000_000;
  const store = new Store(':memory:');
  const accounts = new Accounts(store, ORIGIN, passkeys(), () => now);
  store.saveProject({ id: 'thesis', name: 'Thesis', path: '/unused/thesis', createdAt: 1 });
  store.saveProject({ id: 'grant', name: 'Grant', path: '/unused/grant', createdAt: 1 });
  return { store, accounts, advance: (ms: number) => { now += ms; }, close: () => store.close() };
}
const tokenOf = (link: string) => new URL(link).hash.slice(1);
async function join(accounts: Accounts, link: string, id = 'passkey-1') {
  const options = await accounts.registrationOptions(tokenOf(link));
  return accounts.register(tokenOf(link), { id, challenge: options.challenge } as any, 'Chrome on macOS');
}
async function signIn(accounts: Accounts, id: string, handle: string, counter = 0) {
  const options = await accounts.authenticationOptions();
  return accounts.authenticate({ id, challenge: options.challenge, counter, response: { userHandle: handle } } as any, 'Safari on iPhone');
}
const handleOf = (accounts: Accounts, id: string) => accounts.user(id)!.handle;

test('an invite registers one passkey, signs its person in, and cannot be used again', async () => {
  const f = fixture();
  try {
    const { id, link } = f.accounts.addPerson('Ada', ['thesis']);
    assert.match(link, /^https:\/\/mini\.example\.ts\.net:10000\/invite#[\w-]{43}$/);
    assert.deepEqual(f.accounts.inviteInfo(tokenOf(link), pid => f.store.projects().find(p => p.id === pid)?.name), { name: 'Ada', owner: false, inviter: f.accounts.owner().name, papers: ['Thesis'], adding: false });
    const started = await join(f.accounts, link);
    assert.equal(f.accounts.session(started.token)?.user.id, id);
    await assert.rejects(f.accounts.registrationOptions(tokenOf(link)), /expired or was already used/);
    const person = f.accounts.people().people.find(p => p.id === id)!;
    assert.deepEqual([person.joined, person.projects, person.devices.map(d => d.kind)], [true, ['thesis'], ['passkey', 'session']]);
  } finally { f.close(); }
});

test('two browsers racing on one invite register only one passkey', async () => {
  const f = fixture();
  try {
    const { link } = f.accounts.addPerson('Ada', ['thesis']), token = tokenOf(link);
    const [a, b] = await Promise.all([f.accounts.registrationOptions(token), f.accounts.registrationOptions(token)]);
    const results = await Promise.allSettled([
      f.accounts.register(token, { id: 'first', challenge: a.challenge } as any, 'one'),
      f.accounts.register(token, { id: 'second', challenge: b.challenge } as any, 'two'),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.accounts.people().people.find(p => p.name === 'Ada')!.devices.filter(d => d.kind === 'passkey').length, 1);
  } finally { f.close(); }
});

test('a challenge works once, only for the ceremony and invite it was made for', async () => {
  const f = fixture();
  try {
    const ada = f.accounts.addPerson('Ada', ['thesis']), bob = f.accounts.addPerson('Bob', ['grant']);
    const forAda = await f.accounts.registrationOptions(tokenOf(ada.link));
    // Bob's invite cannot complete with a challenge made for Ada's.
    await assert.rejects(f.accounts.register(tokenOf(bob.link), { id: 'stolen', challenge: forAda.challenge } as any, 'x'), /could not be created/);
    // That attempt used the challenge up, so Ada needs a fresh one.
    await assert.rejects(f.accounts.register(tokenOf(ada.link), { id: 'late', challenge: forAda.challenge } as any, 'x'), /could not be created/);
    await join(f.accounts, ada.link, 'ada-key');
    // A sign-in cannot reuse a registration challenge, and vice versa.
    const registration = await f.accounts.registrationOptions(tokenOf(bob.link));
    await assert.rejects(f.accounts.authenticate({ id: 'ada-key', challenge: registration.challenge, counter: 0, response: { userHandle: handleOf(f.accounts, ada.id) } } as any, 'x'), /could not sign you in/);
    // Challenges expire after five minutes.
    const options = await f.accounts.authenticationOptions();
    f.advance(5 * 60000 + 1);
    await assert.rejects(f.accounts.authenticate({ id: 'ada-key', challenge: options.challenge, counter: 0, response: { userHandle: handleOf(f.accounts, ada.id) } } as any, 'x'), /could not sign you in/);
  } finally { f.close(); }
});

test('signing in checks the passkey belongs to its person and its counter never goes back', async () => {
  const f = fixture();
  try {
    const ada = f.accounts.addPerson('Ada', ['thesis']), bob = f.accounts.addPerson('Bob', ['grant']);
    await join(f.accounts, ada.link, 'ada-key');
    // A passkey that claims to be someone else's is refused.
    await assert.rejects(signIn(f.accounts, 'ada-key', handleOf(f.accounts, bob.id)), /could not sign you in/);
    await assert.rejects(signIn(f.accounts, 'unknown-key', handleOf(f.accounts, ada.id)), /could not sign you in/);
    // Synced passkeys always report 0; that is allowed again and again.
    assert.ok(await signIn(f.accounts, 'ada-key', handleOf(f.accounts, ada.id), 0));
    assert.ok(await signIn(f.accounts, 'ada-key', handleOf(f.accounts, ada.id), 0));
    assert.ok(await signIn(f.accounts, 'ada-key', handleOf(f.accounts, ada.id), 5));
    await assert.rejects(signIn(f.accounts, 'ada-key', handleOf(f.accounts, ada.id), 5), /could not sign you in/);
    await assert.rejects(signIn(f.accounts, 'ada-key', handleOf(f.accounts, ada.id), 3), /could not sign you in/);
  } finally { f.close(); }
});

test('invites expire, an owner invite within minutes', async () => {
  const f = fixture();
  try {
    const ada = f.accounts.addPerson('Ada', []), owner = f.accounts.invite(f.accounts.owner().id);
    f.advance(15 * 60000 + 1);
    await assert.rejects(f.accounts.registrationOptions(tokenOf(owner)), /expired/);
    assert.ok(await f.accounts.registrationOptions(tokenOf(ada.link)));
    f.advance(7 * 86400000);
    await assert.rejects(f.accounts.registrationOptions(tokenOf(ada.link)), /expired/);
  } finally { f.close(); }
});

test('sessions slide with use, end after 90 days regardless, and end when their person is removed', async () => {
  const f = fixture();
  try {
    const ada = f.accounts.addPerson('Ada', ['thesis']);
    const { token } = await join(f.accounts, ada.link);
    for (const day of [20, 40, 60, 80]) { f.advance(20 * 86400000); assert.ok(f.accounts.session(token), `day ${day}`); }
    f.advance(11 * 86400000);
    assert.equal(f.accounts.session(token), null, 'past the 90-day limit');
    const again = await signIn(f.accounts, 'passkey-1', handleOf(f.accounts, ada.id));
    f.advance(31 * 86400000);
    assert.equal(f.accounts.session(again.token), null, 'unused for 31 days');
    const third = await signIn(f.accounts, 'passkey-1', handleOf(f.accounts, ada.id));
    const revoked: unknown[] = [];
    f.accounts.on('revoked', event => revoked.push(event));
    f.accounts.remove(ada.id);
    assert.equal(f.accounts.session(third.token), null);
    assert.deepEqual(revoked, [{ userId: ada.id }]);
    await assert.rejects(signIn(f.accounts, 'passkey-1', handleOf(f.accounts, f.accounts.owner().id)), /could not sign you in/);
    assert.throws(() => f.accounts.remove(f.accounts.owner().id), /owner cannot be removed/);
  } finally { f.close(); }
});

test('a lost device is revoked on its own, and sharing is read on every check', async () => {
  const f = fixture();
  try {
    const ada = f.accounts.addPerson('Ada', ['thesis']);
    const laptop = await join(f.accounts, ada.link, 'laptop-key');
    const phone = await join(f.accounts, f.accounts.invite(ada.id), 'phone-key');
    f.accounts.revoke(ada.id, phone.session.id);
    assert.equal(f.accounts.session(phone.token), null);
    assert.ok(f.accounts.session(laptop.token));
    const user = f.accounts.user(ada.id)!;
    assert.equal(f.accounts.canSee(user, 'thesis'), true);
    f.accounts.share(ada.id, ['grant']);
    assert.deepEqual([f.accounts.canSee(user, 'thesis'), f.accounts.canSee(user, 'grant')], [false, true]);
    f.accounts.signOutEverywhere(ada.id);
    assert.equal(f.accounts.session(laptop.token), null);
  } finally { f.close(); }
});

test('account writes never make open workspaces reload', async () => {
  const f = fixture();
  try {
    let changes = 0;
    f.store.on('change', () => changes++);
    const ada = f.accounts.addPerson('Ada', ['thesis']);
    const { token } = await join(f.accounts, ada.link);
    for (let i = 0; i < 5; i++) { f.advance(11 * 60000); f.accounts.session(token); }
    await signIn(f.accounts, 'passkey-1', handleOf(f.accounts, ada.id));
    f.accounts.share(ada.id, []);
    assert.equal(changes, 0);
  } finally { f.close(); }
});

test('device labels name the browser and system', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone');
  assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'), 'Chrome on macOS');
  assert.equal(deviceLabel(undefined), 'Browser');
});
