import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true, timeout: 30000 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
fs.mkdirSync('test-results', { recursive: true });
const errors = [];
const runtime = { connected: true, authenticated: true, installed: true, account: null, error: null, models: [{ id: 'model', name: 'Writing model', isDefault: true, efforts: ['high'], defaultEffort: 'high' }] };
const providerList = [
  ['openai-codex', 'ChatGPT Plus or Pro', 'login'], ['github-copilot', 'GitHub Copilot', 'login'],
  ['anthropic', 'Anthropic (Claude)', 'key', 'ANTHROPIC_API_KEY'], ['openai', 'OpenAI', 'key', 'OPENAI_API_KEY'], ['google', 'Google Gemini', 'key', 'GEMINI_API_KEY'],
  ['openrouter', 'OpenRouter', 'key', 'OPENROUTER_API_KEY'], ['deepseek', 'DeepSeek', 'key', 'DEEPSEEK_API_KEY'], ['xai', 'xAI (Grok)', 'key', 'XAI_API_KEY'],
  ['moonshotai', 'Moonshot (Kimi)', 'key', 'MOONSHOT_API_KEY'], ['zai', 'Z.ai (GLM)', 'key', 'ZAI_API_KEY'], ['mistral', 'Mistral', 'key', 'MISTRAL_API_KEY'],
  ['custom-api', 'Custom API', 'custom'],
];
async function fixture(language = 'en', options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'en-US', colorScheme: 'light', ...options });
  await context.addInitScript(language => { localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); }, language);
  const auth = { providers: providerList.map(([id, name, kind, env]) => ({ id, name, kind, env, configured: id === 'deepseek', source: id === 'deepseek' ? 'environment' : null })), logins: [] };
  const calls = [];
  let failSave = false;
  await context.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/api/writer/')) {
      if (route.request().method() !== 'GET') {
        const body = route.request().postDataJSON(); calls.push({ pathname, body });
        if (pathname.endsWith('/keys')) {
          if (failSave) return route.fulfill({ status: 400, json: { error: 'Invalid fixture key' } });
          Object.assign(auth.providers.find(p => p.id === body.provider), { configured: true, source: 'stored' });
        } else if (pathname.endsWith('/custom-api')) {
          if (failSave) return route.fulfill({ status: 400, json: { error: 'Invalid fixture URL' } });
          auth.customApi = { baseUrl: body.baseUrl, model: body.model };
          Object.assign(auth.providers.find(p => p.id === 'custom-api'), { configured: true, source: 'stored' });
        } else if (pathname.endsWith('/logins')) {
          auth.logins.push({ id: 'fixture-login', provider: body.provider, name: 'ChatGPT', status: 'waiting', url: 'https://example.com/fixture-login', instructions: 'Continue in your browser. Fixture code: TEST-1234', error: null, startedAt: 1 });
        } else if (pathname.endsWith('/cancel')) { auth.logins.at(-1).status = 'cancelled'; }
        else if (pathname.endsWith('/code')) {
          auth.logins.at(-1).status = 'done'; Object.assign(auth.providers.find(p => p.id === auth.logins.at(-1).provider), { configured: true, source: 'stored' });
        } else if (pathname.endsWith('/remove')) {
          Object.assign(auth.providers.find(p => p.id === pathname.split('/').at(-2)), { configured: false, source: null });
          if (pathname.endsWith('/custom-api/remove')) delete auth.customApi;
        }
      }
      return route.fulfill({ json: auth });
    }
    if (pathname === '/api/state') return route.fulfill({ json: { version: 'test', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime, runtimes: { papilot: runtime, codex: runtime } } });
    if (pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (pathname === '/api/runtime/requirements') return route.fulfill({ json: { platform: 'darwin', checks: ['git', 'latexmk', 'synctex', 'tex-engine'].map(id => ({ id, ok: true })) } });
    if (pathname === '/api/diagnostics') return route.fulfill({ json: { checks: [], ok: true } });
    if (pathname.endsWith('/skills')) return route.fulfill({ json: { skills: [] } });
    if (pathname.startsWith('/api/updates')) return route.fulfill({ json: { currentVersion: 'test', phase: 'idle', canUpdate: false } });
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.locator('.settings-link').click();
  await page.locator('[data-settings-page="agents"]').click();
  await page.locator('[data-agent="papilot"] button').click();
  await page.locator('.writer-providers').waitFor();
  return { context, page, auth, calls, failSave: value => { failSave = value; } };
}
async function fits(page, label) {
  const overflow = await page.locator('.runtime-agent-writer').evaluate(root => [root, ...root.querySelectorAll('*')].filter(el => {
    const box = el.getBoundingClientRect(), style = getComputedStyle(el);
    return box.width && box.height && style.display !== 'inline' && style.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2;
  }).map(el => ({ element: el.className || el.tagName, width: el.clientWidth, scroll: el.scrollWidth })));
  if (overflow.length) await page.screenshot({ path: 'test-results/writer-setup-overflow.png' });
  assert.deepEqual(overflow, [], label);
}
try {
  const f = await fixture(), { page } = f;
  const setup = page.locator('.writer-setup');
  const tile = name => setup.locator('.writer-provider').filter({ hasText: name });
  const input = page.locator('#writer-api-key');
  await expect(setup.locator('input[type=password]')).toHaveCount(0);
  await tile('Anthropic').click();
  await expect(input).toBeFocused();
  await input.fill('fixture-key');
  await input.press('Escape');
  await expect(tile('Anthropic')).toBeFocused();
  await expect(page.locator('.runtime-agent-writer')).toBeVisible();
  await tile('Anthropic').click();
  await expect(input).toHaveValue('');
  await input.fill('fixture-key');
  f.failSave(true);
  await page.locator('.writer-key-editor').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(setup.getByRole('alert')).toHaveText('Invalid fixture key');
  await expect(input).toHaveValue('fixture-key');
  f.failSave(false);
  await input.press('Enter');
  await expect(tile('Anthropic')).toHaveAttribute('data-configured', 'true');
  await expect(input).toHaveCount(0);
  await expect(tile('Anthropic')).toBeFocused();
  assert.deepEqual(f.calls.at(-1).body, { provider: 'anthropic', key: 'fixture-key' });
  await tile('Anthropic').click();
  await page.locator('.writer-key-editor').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(input).toBeFocused();
  await input.press('Escape');
  await tile('DeepSeek').click();
  await expect(page.locator('.writer-key-connected')).toContainText('DEEPSEEK_API_KEY');
  await expect(page.locator('.writer-key-editor').getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await page.locator('.writer-key-editor h6').press('Escape');

  const custom = tile('Custom API');
  await custom.press('Enter');
  const customForm = setup.getByRole('form', { name: 'Custom API' });
  const base = customForm.getByRole('textbox', { name: 'API base URL' });
  const model = customForm.getByRole('textbox', { name: 'Model ID' });
  const key = customForm.getByLabel('API key', { exact: true });
  await expect(base).toBeFocused();
  await base.fill('https://api.example.test/v1');
  await base.press('Tab');
  await expect(model).toBeFocused();
  await model.fill('org/writer');
  await model.press('Tab');
  await expect(key).toBeFocused();
  await key.fill('fixture-api-key');
  f.failSave(true);
  await key.press('Enter');
  await expect(customForm.getByRole('alert')).toHaveText('Invalid fixture URL');
  await expect(customForm.getByRole('alert')).toBeFocused();
  await expect(key).toHaveValue('fixture-api-key');
  await page.locator('.settings-dialog').screenshot({ animations: 'disabled', path: 'test-results/custom-api-error.png' });
  f.failSave(false);
  await key.press('Enter');
  await expect(custom).toHaveAttribute('data-configured', 'true');
  await expect(custom).toBeFocused();
  assert.deepEqual(f.calls.at(-1).body, { baseUrl: 'https://api.example.test/v1', model: 'org/writer', key: 'fixture-api-key' });
  await custom.click();
  await expect(base).toHaveValue('https://api.example.test/v1');
  await expect(model).toHaveValue('org/writer');
  await expect(key).toHaveValue('');
  await expect(customForm).toContainText('Leave blank to keep the saved key for this URL.');
  await model.fill('org/edited');
  await model.press('Enter');
  await expect(custom).toBeFocused();
  assert.equal(f.calls.at(-1).body.key, '');
  await custom.click();
  await expect(model).toHaveValue('org/edited');
  await customForm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(custom).toHaveAttribute('data-configured', 'false');
  await expect(custom).toBeFocused();

  const subscription = setup.locator('.writer-subscription').filter({ hasText: 'ChatGPT Plus or Pro' });
  await subscription.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(subscription.getByRole('link', { name: 'Open sign-in page' })).toHaveAttribute('href', 'https://example.com/fixture-login');
  await expect(subscription).toContainText('TEST-1234');
  await subscription.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(subscription.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await subscription.getByRole('button', { name: 'Sign in', exact: true }).click();
  await subscription.locator('.writer-redirect summary').click();
  await subscription.getByRole('textbox').fill('https://localhost/fixture-redirect');
  await subscription.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(subscription.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await subscription.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(subscription.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.locator('.writer-models>summary').click();
  await expect(page.locator('.writer-models')).toContainText('Writing model');
  await f.context.close();

  for (const language of ['en', 'zh-Hans', 'de']) {
    const f = await fixture(language, { hasTouch: true });
    for (const width of [320, 390, 768, 1280]) {
      await f.page.setViewportSize({ width, height: 1000 });
      await fits(f.page, `${language}/${width}`);
      await f.page.locator('.writer-provider').first().click();
      await fits(f.page, `${language}/${width}/editor`);
      await f.page.locator('#writer-api-key').press('Escape');
      if (language === 'zh-Hans') {
        await f.page.locator('#runtime-agent-title').focus();
        await f.page.locator('.settings-content').evaluate(root => { root.scrollTop += root.querySelector('.runtime-agent-writer').getBoundingClientRect().top - root.getBoundingClientRect().top - 12; });
        await f.page.locator('.settings-dialog').screenshot({ animations: 'disabled', path: `test-results/writer-setup-${width}.png` });
      }
      await f.page.locator('.writer-provider').last().click();
      await fits(f.page, `${language}/${width}/custom-api`);
      if (language === 'zh-Hans') {
        await f.page.locator('.writer-custom-api').screenshot({ animations: 'disabled', path: `test-results/custom-api-${width}.png` });
      }
      await f.page.locator('.writer-custom-api [name=baseUrl]').press('Escape');
    }
    await f.page.emulateMedia({ colorScheme: 'dark' });
    await fits(f.page, `${language}/dark`);
    if (language === 'zh-Hans') await f.page.locator('.settings-dialog').screenshot({ animations: 'disabled', path: 'test-results/writer-setup-dark.png' });
    await f.page.setViewportSize({ width: 390, height: 1000 });
    await f.page.locator('.writer-provider').last().click();
    await fits(f.page, `${language}/dark/custom-api`);
    if (language === 'zh-Hans') await f.page.locator('.writer-custom-api').screenshot({ animations: 'disabled', path: 'test-results/custom-api-dark.png' });
    await f.context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Writer setup passed: provider selection, focus, key save/failure/removal, custom API, environment credentials, login/cancel/redirect/sign-out, models, light/dark and responsive translations.');
} finally { await browser.close(); await server.close(); }
