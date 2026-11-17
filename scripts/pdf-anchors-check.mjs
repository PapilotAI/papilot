import assert from 'node:assert/strict';
import { expect } from './playwright.mjs';

// Run by check-places.mjs (test:ui and the Interface CI job), against the
// same two-document PDF fixture as reading-position restoration.
export async function checkPdfAnchors(page, { switchDocument, recompile }) {
  const box = page.locator('.manuscript .pdf-container');
  const trigger = page.getByRole('button', { name: 'Anchors', exact: true });
  const menu = page.getByRole('dialog', { name: 'Anchors', exact: true });
  const back = page.getByRole('button', { name: 'Back in PDF', exact: true });
  const forward = page.getByRole('button', { name: 'Forward in PDF', exact: true });
  const top = () => box.evaluate(element => element.scrollTop);
  const near = expected => expect.poll(async () => Math.abs(await top() - expected)).toBeLessThan(4);
  const scroll = async value => { await box.evaluate((element, value) => { element.scrollTop = value; }, value); await near(value); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('papilot:pdf-anchors:pdf:paper:main.tex') || '[]'));
  const rename = async (from, to) => {
    await menu.getByRole('button', { name: `Edit anchor: ${from}`, exact: true }).click();
    const input = menu.getByRole('textbox', { name: `Edit anchor: ${from}`, exact: true });
    await input.fill(to); await input.press('Enter');
  };
  const save = async name => {
    await trigger.click(); const count = await menu.locator('.pdf-anchor-row').count();
    await menu.getByRole('button', { name: 'Add anchor', exact: true }).click();
    await expect(menu.locator('.pdf-anchor-row')).toHaveCount(count + 1);
    await expect(menu).toBeVisible();
    await expect(page.locator('.modal-backdrop, .pdf-anchors-menu form')).toHaveCount(0);
    // Adding saves immediately with a useful default; naming is optional.
    const row = menu.locator('.pdf-anchor-row').last();
    const defaultName = await row.locator('.pdf-anchor-jump').getAttribute('aria-label');
    assert.ok(defaultName.trim());
    await row.getByRole('button', { name: `Edit anchor: ${defaultName}`, exact: true }).click();
    await row.getByRole('textbox').fill(name); await row.getByRole('textbox').press('Enter');
    await menu.press('Escape');
    await expect(menu).toBeHidden();
  };
  const jump = async name => { await trigger.click(); await menu.getByRole('button', { name, exact: true }).click(); };
  const swipeDown = target => target.evaluate(element => {
    const touch = y => new Touch({ identifier: 1, target: element, clientX: 100, clientY: y });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(200)] }));
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(250)] }));
  });
  const checkRail = async () => {
    await expect(page.locator('.pdf-toolbar .pdf-navigation')).toHaveCount(0);
    await expect(page.locator('.pdf-rail').getByRole('button', { name: 'Anchors', exact: true })).toBeVisible();
    await expect(page.locator('.pdf-rail').getByRole('button', { name: 'Back in PDF', exact: true })).toBeVisible();
    await expect(page.locator('.pdf-rail').getByRole('button', { name: 'Forward in PDF', exact: true })).toBeVisible();
    const rail = await page.locator('.pdf-rail').boundingBox();
    assert.ok(rail.x >= 0 && rail.x + rail.width <= page.viewportSize().width, 'Navigation fits inside the viewport');
    assert.ok(await page.locator('.pdf-toolbar').evaluate(element => element.clientHeight < 55), 'PDF header stays on one row');
  };

  await switchDocument('main.tex');
  await checkRail();
  await trigger.click();
  await expect(menu).toContainText('Save a place to return to later.');
  await trigger.focus(); await trigger.press('ArrowDown');
  await expect(menu.getByRole('button', { name: 'Add anchor', exact: true })).toBeFocused();
  await menu.press('Escape'); await expect(trigger).toBeFocused();
  await expect(back).toBeDisabled(); await expect(forward).toBeDisabled();
  await trigger.click(); await scroll(100);
  await expect(menu, 'scrolling the PDF keeps the list available; Add captures the updated reading position').toBeVisible();
  await menu.press('Escape');
  // Exercise the fallback needed on phone-accessible HTTP origins.
  await page.evaluate(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); });
  // Save actual passages: a mostly blank fixture page has no source to bind
  // in its lower margin. Pick the heading and then its final prose line.
  const readingTop = text => page.locator('.page[data-page-number="1"] .textLayer span').filter({ hasText: text }).first().evaluate(element => {
    const reader = element.closest('.pdf-container');
    return Math.max(0, reader.scrollTop + element.getBoundingClientRect().top - reader.getBoundingClientRect().top - 32);
  });
  const introTop = await readingTop('Introduction'), equationTop = await readingTop('author');
  await scroll(introTop); await save('Introduction');
  await scroll(equationTop); await save('A useful equation');
  const original = await stored();
  assert.equal(original.length, 2); assert.notEqual(original[0].id, original[1].id);
  assert.equal(original[0].page, original[1].page, 'two anchors on one page preserve distinct positions');
  assert.notEqual(original[0].top, original[1].top);
  await scroll(introTop); await trigger.click(); await scroll(equationTop);
  await menu.getByRole('button', { name: 'Add anchor', exact: true }).click();
  await expect(menu.locator('.pdf-anchor-row')).toHaveCount(3);
  const afterScrolling = (await stored()).at(-1);
  assert.ok(Math.abs(afterScrolling.top - original[1].top) <= 1, 'Add uses the reading position after scrolling with the list open');
  assert.deepEqual(afterScrolling.source.lines, original[1].source.lines, 'the prepared TeX target updates with the reading position');
  await menu.locator('.pdf-anchor-row').last().locator('.pdf-anchor-remove').click(); await menu.press('Escape');
  await jump('Introduction'); await near(introTop);
  await back.click(); await near(equationTop);
  await forward.click(); await near(introTop);
  // Ordinary reading after a jump is the position restored on a forward trip.
  await scroll(350); await back.click(); await near(equationTop); await forward.click(); await near(350);
  await back.click();
  const pageNumber = page.getByRole('textbox', { name: 'Page number', exact: true });
  await pageNumber.fill('2'); await pageNumber.press('Enter');
  await expect(forward).toBeDisabled();
  await back.click(); await near(equationTop);
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.locator('.pdf-contents-menu [role="menuitemradio"]').last().click();
  await back.click(); await near(equationTop);

  // At another zoom level, the anchor still names the same PDF point.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await jump('Introduction'); await save('Position after zoom');
  const afterZoom = (await stored()).at(-1);
  assert.equal(afterZoom.page, original[0].page);
  assert.ok(Math.abs(afterZoom.top - original[0].top) <= 1);
  await trigger.click(); await menu.getByRole('button', { name: 'Delete: Position after zoom', exact: true }).click();
  await rename('A useful equation', 'Lemma 2');
  await page.reload();
  await page.locator('.manuscript .page[data-page-number="2"]').waitFor();
  await trigger.click(); await expect(menu.getByRole('button', { name: 'Lemma 2', exact: true })).toBeEnabled();
  await menu.press('Escape');
  await switchDocument('letter.tex'); await trigger.click();
  await expect(menu).toContainText('Save a place to return to later.'); await menu.press('Escape');
  await save('Letter');
  await switchDocument('main.tex'); await trigger.click();
  await expect(menu.getByRole('button', { name: 'Letter', exact: true })).toHaveCount(0);
  await menu.press('Escape');
  // Another tab can add an anchor while this tab is renaming in place.
  await trigger.click(); await menu.getByRole('button', { name: 'Edit anchor: Introduction', exact: true }).click();
  const other = await page.context().newPage();
  try {
    await other.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<title>Anchor storage fixture</title>' }));
    await other.goto(new URL('/anchor-storage-fixture', page.url()).href);
    await other.evaluate(() => {
      const key = 'papilot:pdf-anchors:pdf:paper:main.tex', anchors = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify([...anchors, { ...anchors[0], id: 'other-tab', name: 'From another tab' }]));
    });
    await menu.getByRole('textbox').press('Enter'); await expect(menu.getByRole('button', { name: 'From another tab', exact: true })).toBeEnabled();
    await menu.getByRole('button', { name: 'Delete: From another tab', exact: true }).click();
    await menu.press('Escape');
  } finally { await other.close(); }

  await recompile();
  await expect(back).toBeDisabled();
  await jump('Lemma 2');
  await jump('Introduction'); await expect(back).toBeEnabled();
  await trigger.click(); await expect(menu).toBeVisible(); await page.screenshot({ animations: 'disabled', path: 'test-results/anchors-desktop.png' }); await menu.press('Escape');
  await page.getByRole('button', { name: 'Collapse marking tools', exact: true }).click();
  await expect(trigger).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand marking tools', exact: true }).click();
  await jump('Lemma 2'); await expect(back).toBeEnabled();
  // Navigation remains in the rail when the desktop PDF pane gets narrow.
  await page.setViewportSize({ width: 1000, height: 900 });
  await checkRail();
  await trigger.click(); await expect(menu).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'test-results/anchors-narrow-desktop.png' }); await menu.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  // A removed page remains editable, while navigation is disabled. Invalid
  // stored records must not prevent the whole PDF from opening.
  await page.evaluate(() => {
    const key = 'papilot:pdf-anchors:pdf:paper:main.tex', anchors = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify([...anchors, { id: 'removed', name: 'Removed appendix', page: 20, top: 700, left: 0 }, null, { id: 'invalid' }]));
  });
  await page.reload(); await page.locator('.manuscript .page[data-page-number="2"]').waitFor();
  await trigger.click();
  await expect(menu.getByRole('button', { name: 'Removed appendix', exact: true })).toBeDisabled();
  await expect(menu).toContainText('Source unavailable');
  await rename('Removed appendix', 'Missing appendix');
  await expect(menu.getByRole('button', { name: 'Edit anchor: Missing appendix', exact: true })).toBeFocused();
  await menu.getByRole('button', { name: 'Delete: Missing appendix', exact: true }).click();
  await menu.press('Escape');
  // A name edit can be cancelled without changing the stored anchor.
  await trigger.click(); await menu.getByRole('button', { name: 'Edit anchor: Introduction', exact: true }).click();
  await menu.getByRole('textbox').fill('Discard me');
  await menu.getByRole('textbox').press('Escape');
  await expect(menu).toBeVisible(); await menu.press('Escape');
  assert.equal((await stored())[0].name, 'Introduction');
  // Clicking away commits an inline rename; IME Enter must not commit it early.
  await trigger.click(); await menu.getByRole('button', { name: 'Edit anchor: Lemma 2', exact: true }).click();
  await menu.getByRole('textbox').fill('Lemma 2 renamed');
  await menu.getByRole('textbox').evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
  await expect(menu.getByRole('textbox')).toBeVisible();
  assert.equal((await stored())[1].name, 'Lemma 2');
  await box.click({ position: { x: 200, y: 300 } });
  await expect(menu).toBeHidden();
  assert.equal((await stored())[1].name, 'Lemma 2 renamed');
  await trigger.click(); await rename('Lemma 2 renamed', 'Lemma 2'); await menu.press('Escape');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.manuscript-view-selector').getByRole('button', { name: 'PDF', exact: true }).click();
    await checkRail();
    await trigger.focus(); await trigger.press('ArrowDown');
    await expect(menu.getByRole('button', { name: 'Add anchor', exact: true })).toBeFocused();
    await menu.press('End'); await menu.press('Escape'); await expect(trigger).toBeFocused();
    await trigger.click(); await expect(menu).toBeVisible();
    await swipeDown(menu);
    await expect(menu).toBeVisible();
    await expect(page.locator('.pdf-rail')).toHaveAttribute('data-collapsed', 'false');
    const bounds = await menu.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ animations: 'disabled', path: `test-results/anchors-phone-${width}.png` });
    await menu.getByRole('button', { name: 'Edit anchor: Lemma 2', exact: true }).click();
    const name = menu.getByRole('textbox', { name: 'Edit anchor: Lemma 2', exact: true });
    await name.fill('Unsaved name'); await swipeDown(name);
    await expect(name).toHaveValue('Unsaved name');
    await page.screenshot({ animations: 'disabled', path: `test-results/anchors-phone-${width}-edit.png` });
    // A keyboard-sized viewport must keep the editor visible and its draft intact.
    await page.setViewportSize({ width, height: 480 });
    await expect(name).toHaveValue('Unsaved name');
    const inputBounds = await name.boundingBox();
    assert.ok(inputBounds.y >= 0 && inputBounds.y + inputBounds.height <= 480);
    await page.setViewportSize({ width, height: 844 });
    await name.press('Escape'); await menu.press('Escape');
    await swipeDown(trigger);
    await expect(page.locator('.pdf-rail')).toHaveAttribute('data-collapsed', 'true');
    await page.getByRole('button', { name: 'Expand marking tools', exact: true }).click();
    await expect(trigger).toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await trigger.click(); await expect(menu).toBeVisible(); await page.screenshot({ animations: 'disabled', path: 'test-results/anchors-desktop-dark.png' }); await menu.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('papilot:language', 'zh-Hans'));
  await page.reload(); await page.locator('.manuscript .page[data-page-number="2"]').waitFor();
  await page.getByRole('button', { name: '锚点', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/anchors-phone-zh-dark.png' });
  await page.getByRole('dialog', { name: '锚点', exact: true }).press('Escape');

  // Initial download failure disables adding/jumping, but saved anchors
  // remain manageable and work after the PDF becomes available again.
  await page.evaluate(() => localStorage.setItem('papilot:language', 'en'));
  const pdfPattern = '**/manuscript.pdf?key=*';
  await page.route(pdfPattern, route => route.fulfill({ status: 503, body: 'PDF temporarily unavailable' }));
  await page.reload();
  await expect(page.locator('.pdf-view').getByRole('alert')).toContainText('The PDF could not be opened');
  await trigger.click();
  await expect(menu.getByRole('button', { name: 'Add anchor', exact: true })).toBeDisabled();
  await expect(menu.getByRole('button', { name: 'Introduction', exact: true })).toBeDisabled();
  await rename('Introduction', 'Unavailable introduction');
  await expect(menu.getByRole('button', { name: 'Edit anchor: Unavailable introduction', exact: true })).toBeFocused();
  await rename('Unavailable introduction', 'Introduction');
  await page.screenshot({ animations: 'disabled', path: 'test-results/anchors-load-error.png' });
  await menu.press('Escape');
  await page.unroute(pdfPattern); await page.reload();
  await page.locator('.manuscript .page[data-page-number="2"]').waitFor();
  await jump('Lemma 2'); await save('After recovery');
  await trigger.click(); await expect(menu.getByRole('button', { name: 'After recovery', exact: true })).toBeEnabled(); await menu.press('Escape');
  // The panel also remains usable without native popovers.
  await page.addInitScript(() => { delete HTMLElement.prototype.popover; });
  await page.reload(); await page.locator('.manuscript .page[data-page-number="2"]').waitFor();
  await save('Without native popovers');
  await trigger.click(); await expect(menu.getByRole('button', { name: 'Without native popovers', exact: true })).toBeVisible();
  await box.click({ position: { x: 150, y: 150 } }); await expect(menu).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  const slots = page.locator('.pdf-anchor-slots'), buttons = slots.locator('.pdf-anchor-slot');
  const quickAdd = page.locator('.pdf-anchor-quick-add');
  const count = (await stored()).length;
  await expect(buttons).toHaveCount(count); await expect(slots).toBeVisible();
  const railOrder = await page.locator('.rail-items').evaluate(element => [...element.children].map(child => child.className));
  assert.deepEqual(railOrder.slice(-2), ['rail-history', 'rail-anchors'], 'desktop anchors follow the last marking actions');
  await expect(buttons.first()).toHaveAttribute('aria-disabled', 'false'); await buttons.first().click(); const firstTop = await top();
  await buttons.nth(1).click(); const secondTop = await top();
  assert.notEqual(firstTop, secondTop);
  await box.focus(); await page.keyboard.press('['); await near(firstTop);
  await page.keyboard.press(']'); await near(secondTop);
  await page.keyboard.press('b'); await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('End'); await expect(buttons.last()).toBeFocused();
  await page.keyboard.press('Tab'); await expect(quickAdd).toBeFocused();
  await near(secondTop);
  await page.getByRole('button', { name: 'Collapse marking tools', exact: true }).click();
  await box.focus(); await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Collapse marking tools', exact: true })).toBeVisible();
  await expect(buttons.last()).toBeFocused();

  // A delayed capture must not steal focus from someone who resumes typing.
  const capturePattern = '**/manuscript/anchors';
  let release, received;
  const waiting = new Promise(resolve => { release = resolve; }), requested = new Promise(resolve => { received = resolve; });
  await page.route(capturePattern, async route => { received(); await waiting; await route.fallback(); });
  await box.focus(); await page.keyboard.press('Shift+B'); await requested;
  await page.keyboard.press('Shift+B'); // An in-flight save is not duplicated.
  const composer = page.getByRole('textbox', { name: 'Describe the revision', exact: true });
  await composer.fill('Continue typing'); release();
  await expect(buttons).toHaveCount(count + 1); await expect(composer).toBeFocused();
  await expect(menu).toBeHidden(); await page.unroute(capturePattern);
  await composer.press('Shift+B'); await composer.press('['); await composer.press(']');
  await expect(composer).toHaveValue('Continue typingB[]');
  await composer.fill('');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Shift+B'); await page.keyboard.press('b');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY');
  await box.focus();
  await box.evaluate(element => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', shiftKey: true, isComposing: true, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', shiftKey: true, repeat: true, bubbles: true }));
  });
  await page.keyboard.press('Control+Shift+B');
  assert.equal((await stored()).length, count + 1, 'typing, unfocused, composing, repeat and modified keys cannot add anchors');
  await page.keyboard.press('Shift+B');
  await expect(buttons).toHaveCount(count + 2); await expect(buttons.last()).toBeFocused();
  await expect(menu).toBeHidden();
  await quickAdd.click(); await expect(buttons).toHaveCount(count + 3); await expect(menu).toBeHidden();

  // All anchors remain reachable in a short desktop window, without hiding history.
  const saved = await stored();
  const replace = anchors => page.evaluate(anchors => {
    const key = 'papilot:pdf-anchors:pdf:paper:main.tex'; localStorage.setItem(key, JSON.stringify(anchors));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, anchors);
  await replace([...saved, ...Array.from({ length: 30 }, (_, index) => ({ ...saved[0], id: `overflow-${index}`, name: `Saved passage ${index + 1}` }))]);
  await page.setViewportSize({ width: 1000, height: 360 });
  await box.focus(); await page.keyboard.press('b');
  await expect(buttons.nth(saved.length - 1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(buttons.last()).toBeFocused();
  const last = await buttons.last().boundingBox(), strip = await slots.boundingBox();
  assert.ok(last.y >= strip.y - 1 && last.y + last.height <= strip.y + strip.height + 1);
  assert.ok(await slots.evaluate(element => element.scrollTop > 0));
  await expect(page.locator('.rail-history')).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: 'test-results/anchors-expanded-short.png' });
  await replace(saved); await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ animations: 'disabled', path: 'test-results/anchors-expanded-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(slots).toBeHidden(); await expect(quickAdd).toBeHidden();
  await box.focus(); await page.keyboard.press('b'); await expect(menu).toBeVisible(); await menu.press('Escape');
  // Browsers without focusgroup still expose one tab stop and arrow navigation.
  await page.addInitScript(() => { delete HTMLElement.prototype.focusGroup; });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.reload();
  await page.locator('.manuscript .page[data-page-number="2"]').waitFor();
  await box.focus(); await page.keyboard.press('b'); await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('End'); await expect(buttons.last()).toBeFocused();
  await page.keyboard.press('Home'); await expect(buttons.first()).toBeFocused();
  await expect(slots.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab'); await expect(quickAdd).toBeFocused();

  // Cropping changes the displayed viewport, not the TeX/PDF coordinate system.
  const reading = () => page.evaluate(() => JSON.parse(localStorage.getItem('papilot:places') || '{}')['pdf:paper:main.tex']);
  const equation = (await stored())[1], expectedTop = 792 * (1 - (equation.source.lines[0] - 1) / 10000) + 24;
  await page.evaluate(() => localStorage.setItem('papilot:pdf-crop:pdf:paper:main.tex', JSON.stringify([.05, .06, .95, .9])));
  await page.reload(); await page.locator('.manuscript .page[data-page-number="2"]').waitFor();
  await expect(page.locator('.pdf-cropped')).toBeVisible();
  await jump('Lemma 2');
  await expect.poll(async () => Math.abs((await reading()).top - expectedTop)).toBeLessThan(2);
  const croppedTop = await top();
  await buttons.first().click(); await back.click(); await near(croppedTop);
  await forward.click(); await back.click(); await near(croppedTop);
  await recompile(); await jump('Lemma 2');
  await expect.poll(async () => Math.abs((await reading()).top - expectedTop)).toBeLessThan(2);
  await page.screenshot({ animations: 'disabled', path: 'test-results/anchors-cropped-desktop.png' });

  // The previous page's blank tail can expose text DOM that the next page
  // clips away. Capture a visible passage, using its original page fractions.
  await page.evaluate(() => localStorage.setItem('papilot:pdf-crop:pdf:paper:main.tex', JSON.stringify([.05, .15, .95, .9])));
  await page.reload();
  const secondPage = page.locator('.manuscript .page[data-page-number="2"]');
  await expect(secondPage.locator('.textLayer span').first()).toBeAttached();
  await box.evaluate(element => {
    const next = element.querySelector('.page[data-page-number="2"]');
    element.scrollTop += next.getBoundingClientRect().top - element.getBoundingClientRect().top - 100;
  });
  const beforeCroppedSave = (await stored()).length;
  const scale = await secondPage.locator('.note-layer').evaluate(element => element.getBoundingClientRect().height / 792);
  await box.focus(); await page.keyboard.press('Shift+B');
  await expect(buttons).toHaveCount(beforeCroppedSave + 1);
  const acrossPages = (await stored()).at(-1), sourceY = (acrossPages.source.lines[0] - 1) / 10000;
  assert.equal(acrossPages.page, 2);
  assert.ok(sourceY >= .15, 'clipped text cannot become the default anchor passage');
  assert.ok(Math.abs(acrossPages.top - (792 * (1 - sourceY) + 24 / scale)) < 2, 'cross-page capture retains original PDF coordinates');

  await page.locator('.pdf-crop-toggle:visible').click();
  const cropDialog = page.locator('.pdf-crop-dialog');
  const beforeCropKeys = await stored();
  await cropDialog.press('Shift+B'); await cropDialog.press('b'); await cropDialog.press('['); await cropDialog.press(']');
  assert.deepEqual(await stored(), beforeCropKeys, 'anchor shortcuts leave the crop editor alone');
  await cropDialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(cropDialog).toHaveCount(0);
  await expect(page.locator('.pdf-cropped')).toHaveCount(0);
  await jump('Lemma 2');
  await expect.poll(async () => Math.abs((await reading()).top - expectedTop)).toBeLessThan(2);
  console.log('PDF anchor checks passed');
}
