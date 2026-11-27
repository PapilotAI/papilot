import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { selectOption, selectedValue } from './select.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
fs.mkdirSync('test-results', { recursive: true });
const errors = [];
try {
  for (const [width, dark, language] of [[1360, false, 'en'], [390, true, 'en'], [390, false, 'zh-CN']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light', hasTouch: width < 600 });
    const runtime = { connected: true, authenticated: true, installed: true, account: 'Fixture', error: null, models: [{ id: 'gpt-test', name: 'Test model', isDefault: true, efforts: ['medium', 'high'], defaultEffort: 'high', fastMode: { serviceTier: 'fast', description: 'Priority processing.' } }] };
    const gemini = { ...runtime, models: [{ id: 'gemini-test', name: 'Gemini Test', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }] };
    const opencode = { ...runtime, models: [{ id: 'provider/flash-test', name: 'Flash Test', isDefault: false, efforts: ['low', 'high', 'max'], defaultEffort: null }] };
    const collabRuntime = { connected: true, authenticated: true, installed: true, account: 'Papilot Collaboration Mode', error: null, hidden: true, models: [{ id: 'balanced', name: 'Balanced · Auto route & race', isDefault: true, efforts: [], defaultEffort: null }, { id: 'fast', name: 'Fast · Route only', isDefault: false, efforts: [], defaultEffort: null }, { id: 'thorough', name: 'Thorough · Race & verify', isDefault: false, efforts: [], defaultEffort: null }] };
    const state = { version: 'test', csrf: 'fixture', projects: [], tasks: [], requests: [], runtime, runtimes: { codex: runtime, collaboration: collabRuntime, antigravity: gemini, opencode } };
    let fail = false, saves = 0, hold = null;
    let config = { router: null, judge: null, routes: { quick: null, polish: null, rigorous: null }, racers: [], lanes: [] };
    const defaultLanes = [
      { id: 'quick', name: 'Simple edits', description: 'Typos, punctuation, word swaps, and minor mechanical fixes', models: [{ agent: 'opencode', model: 'provider/flash-test', effort: null }] },
      { id: 'polish', name: 'Prose & polish', description: 'Clarity, flow, conciseness, phrasing, and academic tone', models: [{ agent: 'antigravity', model: 'gemini-test', effort: 'medium' }] },
      { id: 'rigorous', name: 'Math & rigorous', description: 'Proofs, lemmas, typing rules, claims, citations, and technical correctness', models: [{ agent: 'codex', model: 'gpt-test', effort: 'high', serviceTier: 'fast' }] },
      { id: 'layout', name: 'Layout & LaTeX', description: 'Tables, figures, spacing, macros, formatting, and visual layout', models: [{ agent: 'codex', model: 'gpt-test', effort: 'high', serviceTier: 'fast' }] },
    ];
    const resolved = () => {
      const savedById = new Map(config.lanes.map(l => [l.id, l]));
      const lanes = [
        ...defaultLanes.map(d => {
          const s = savedById.get(d.id);
          return s ? { ...d, name: s.name || d.name, description: s.description ?? d.description, models: s.models.length ? s.models : d.models } : d;
        }),
        ...config.lanes.filter(l => !defaultLanes.some(d => d.id === l.id)),
      ];
      return {
        router: config.router || { agent: 'opencode', model: 'provider/flash-test', effort: null },
        judge: config.judge || { agent: 'codex', model: 'gpt-test', effort: 'high', serviceTier: 'fast' },
        routes: {
          quick: lanes.find(l => l.id === 'quick').models[0],
          polish: lanes.find(l => l.id === 'polish').models[0],
          rigorous: lanes.find(l => l.id === 'rigorous').models[0],
        },
        racers: [{ agent: 'codex', model: 'gpt-test', effort: 'high', serviceTier: 'fast' }, { agent: 'antigravity', model: 'gemini-test', effort: 'medium' }],
        lanes,
      };
    };
    const settingsReply = () => ({ enabled: !state.runtimes.collaboration.hidden, ...config, resolved: resolved(), readOnlyAgents: { codex: true, antigravity: true, opencode: true } });
    await context.addInitScript(language => { localStorage.setItem('papilot:language', language); localStorage.setItem('papilot:setup-seen', '1'); }, language);
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/state') return route.fulfill({ json: state });
      if (url.pathname === '/api/collaboration') {
        if (route.request().method() === 'GET') return route.fulfill({ json: settingsReply() });
        saves++;
        if (hold) await hold;
        if (fail) return route.fulfill({ status: 503, json: { error: 'Fixture save failed' } });
        const change = route.request().postDataJSON();
        if (change.reset) config = { router: null, judge: null, routes: { quick: null, polish: null, rigorous: null }, racers: [], lanes: [] };
        if (change.enabled !== undefined) state.runtimes.collaboration.hidden = !change.enabled;
        if (change.router !== undefined) config.router = change.router;
        if (change.judge !== undefined) config.judge = change.judge;
        if (change.routes) config.routes = change.routes;
        if (change.racers !== undefined) config.racers = change.racers;
        if (change.lanes !== undefined) config.lanes = change.lanes;
        return route.fulfill({ json: settingsReply() });
      }
      if (url.pathname === '/api/diagnostics') return route.fulfill({ json: { checks: [], checkedAt: Date.now() } });
      if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname === '/api/runtime/requirements') return route.fulfill({ json: readyRequirements });
      return route.fulfill({ json: {} });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    if (width < 600) await page.locator('.sidebar-toggle').click();
    await page.locator('.settings-link').click();
    await page.locator('[data-settings-page="agents"]').click();
    await expect(page.locator('[data-agent="collaboration"]')).toHaveCount(0);
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="experiments"]').click();
    const disclosure = page.locator('.collaboration-settings'), toggle = disclosure.getByRole('switch').first();
    await expect(toggle).toBeVisible(); await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAccessibleName(language === 'zh-CN' ? '启用协作模式' : 'Enable collaboration mode');
    if (language === 'en') {
      fail = true; await toggle.click(); await expect(disclosure.getByRole('alert')).toContainText('Fixture save failed'); await expect(toggle).not.toBeChecked(); fail = false;
    }
    await toggle.focus(); await page.keyboard.press('Space'); await expect(toggle).toBeChecked();
    await expect(disclosure.getByRole('alert')).toHaveCount(0);

    // Unified per-task lane graph: Router -> 4 built-in single-model lanes -> Judge (idle until a lane races).
    await expect(disclosure.locator('.collab-board')).toBeVisible();
    await expect(disclosure.locator('[data-role="router"]')).toBeVisible();
    await expect(disclosure.locator('[data-role="judge"]')).toBeVisible();
    await expect(disclosure.locator('.collab-lane')).toHaveCount(4);
    await expect(disclosure.locator('.collab-stage-side').nth(1)).toHaveAttribute('data-idle', 'true');

    // Click + on Prose & polish lane -> flips that lane to Race (2 models), wakes Judge, and opens inspector.
    const polishLane = disclosure.locator('[data-lane="polish"]');
    await polishLane.locator('.collab-add-btn').click();
    await expect(polishLane).toHaveAttribute('data-racing', 'true');
    await expect(polishLane.locator('.collab-lane-node')).toHaveCount(2);
    await expect(disclosure.locator('.collab-stage-side').nth(1)).not.toHaveAttribute('data-idle', 'true');
    const inspector = disclosure.locator('.collab-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute('data-inspecting', 'polish:1');
    await expect(inspector.locator('.collaboration-fast [role="switch"]')).toBeVisible();

    // Edit polish:0 model & effort, verifying serialized saves so an earlier reply cannot overwrite a later one.
    await disclosure.locator('[data-lane-model="polish:0"]').click();
    await expect(inspector).toHaveAttribute('data-inspecting', 'polish:0');
    const effort = inspector.getByRole('slider');
    await effort.focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(() => config.lanes.find(l => l.id === 'polish')?.models[0]?.effort).toBe('high');
    let release; hold = new Promise(resolve => { release = resolve; });
    const before = saves;
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await expect.poll(() => saves).toBe(before + 1);
    await page.waitForTimeout(300); assert.equal(saves, before + 1, 'the second save waits for the first');
    await expect(effort).toHaveValue('0');
    hold = null; release();
    await expect.poll(() => saves).toBe(before + 2);
    await expect.poll(() => config.lanes.find(l => l.id === 'polish')?.models[0]?.effort).toBe('low');
    await page.waitForTimeout(300); await expect(effort).toHaveValue('0');

    // Click Router node and change model + effort.
    await disclosure.locator('[data-role="router"]').click();
    await expect(inspector).toHaveAttribute('data-inspecting', 'router');
    await selectOption(inspector.locator('[role="combobox"]'), JSON.stringify(['opencode', 'provider/flash-test']));
    await inspector.getByRole('slider').focus(); await page.keyboard.press('End');
    await expect.poll(() => config.router).toEqual({ agent: 'opencode', model: 'provider/flash-test', effort: 'max' });

    // Add a custom lane, rename it, set its Router rule, and save.
    await disclosure.locator('.collab-add-lane-btn').click();
    await expect(disclosure.locator('.collab-lane')).toHaveCount(5);
    await expect(inspector).toHaveAttribute('data-inspecting', 'lane:custom-1');
    await inspector.locator('input[type="text"]').fill('TikZ diagrams');
    await inspector.locator('textarea').fill('TikZ figures and commutative diagrams');
    await inspector.locator('button[type="submit"]').click();
    await expect.poll(() => config.lanes.find(l => l.id === 'custom-1')?.name).toBe('TikZ diagrams');

    // Keep polish:1 selected for screenshot inspection.
    await disclosure.locator('[data-lane-model="polish:1"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/collaboration-${width}-${language}.png`, animations: 'disabled' });

    // Remove the 2nd model from polish lane via - -> lane returns to Direct.
    await polishLane.locator('.collab-remove-btn').nth(1).click();
    await expect(polishLane).not.toHaveAttribute('data-racing', 'true');
    await expect(polishLane.locator('.collab-lane-node')).toHaveCount(1);

    await page.locator('.modal-close').click(); await page.reload(); if (width < 600) await page.locator('.sidebar-toggle').click(); await page.locator('.settings-link').click();
    if (width < 600) await page.locator('[data-settings-page="general"]').click();
    // General settings' second combobox is the default agent/model, after language.
    const model = page.locator('.settings-content-general [role="combobox"]').nth(1);
    await selectOption(model, JSON.stringify(['collaboration', 'balanced']));
    assert.equal(await selectedValue(model), JSON.stringify(['collaboration', 'balanced']));
    await expect(model).toContainText(language === 'zh-CN' ? '协作模式' : 'Collaboration mode');
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="experiments"]').click();
    await expect(toggle).toBeChecked();
    // Custom lane and Router choice persist after reload.
    await expect(disclosure.locator('[data-lane="custom-1"]')).toContainText('TikZ diagrams');
    await toggle.click(); await expect(toggle).not.toBeChecked(); await expect(disclosure.locator('.collab-board')).toHaveCount(0);
    if (width < 600) await page.locator('.settings-mobile-back').click();
    await page.locator('[data-settings-page="general"]').click();
    await expect(model).toContainText('Codex');
    config = { router: null, judge: null, routes: { quick: null, polish: null, rigorous: null }, racers: [], lanes: [] };
    await context.close();
  }
  assert.deepEqual(errors, []); console.log('Collaboration mode: per-task lane graph, +/- per-lane racing, custom lanes, efforts, errors, persistence, keyboard and mobile layouts checked.');
} finally { await browser.close(); await server.close(); }
