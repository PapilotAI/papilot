import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Feedback } from "../../src/types.ts";
test.beforeEach(async ({ page }) => {
  await page.goto("/?task=tighten-design");
  await expect(page.locator(".change").first()).toBeVisible();
});
async function totalUnits(page: Page) {
  const progress = page.getByRole("progressbar");
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  return Number(await progress.getAttribute("aria-valuemax"));
}
test("full-paper diagnostics follow the pinned PDF through chapter, raw pass and completed builds", async ({ page }) => {
  const pdf = readFileSync(new URL('../../../tests/fixtures/outline.pdf', import.meta.url));
  const chapter = 'chapter.tex:4: Missing number.', full = 'other.tex:8: Command already defined.';
  let repaired = false, releaseRaw!: () => void, releaseFinal!: () => void, releasePdf!: () => void;
  const rawReady = new Promise<void>(resolve => { releaseRaw = resolve; });
  const finalReady = new Promise<void>(resolve => { releaseFinal = resolve; });
  const pdfReady = new Promise<void>(resolve => { releasePdf = resolve; });
  const requests: string[] = [];
  await page.route('**/rounds/1', async route => {
    const response = await route.fetch(), detail = await response.json();
    await route.fulfill({ response, json: { ...detail, pdf: '/reader.pdf', passes: '/reader-passes', revisedErrors: [chapter] } });
  });
  await page.route('**/reader-passes?*', async route => {
    const after = Number(new URL(route.request().url()).searchParams.get('after'));
    if (repaired) return route.fulfill({ json: { pass: null, key: 'repaired' } });
    if (!after) return route.fulfill({ json: { pass: 1, key: 'chapter', errors: [chapter] } });
    if (after === 1) {
      await rawReady;
      return route.fulfill({ json: { pass: 2 } });
    }
    await finalReady;
    return route.fulfill({ json: { pass: null, key: 'full', errors: [full] } });
  });
  await page.route('**/reader.pdf?*', async route => {
    const query = new URL(route.request().url()).search;
    requests.push(query);
    if (query === '?build=full') await pdfReady;
    await route.fulfill({ contentType: 'application/pdf', body: pdf });
  });
  const summary = page.locator('summary').filter({ hasText: 'This PDF has compilation errors.' });
  const diagnostics = page.getByRole('region', { name: 'This PDF has compilation errors.' });
  await page.reload();
  await expect(summary).toBeVisible();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(diagnostics).toHaveText(chapter);
  await expect(page.locator('.paper-updating')).toBeVisible();
  expect(requests).toContain('?build=chapter');
  // A raw TeX pass has no completed build diagnostics of its own.
  releaseRaw();
  await expect.poll(() => requests.includes('?pass=2')).toBe(true);
  await expect(summary).toHaveCount(0);
  releaseFinal();
  await expect.poll(() => requests.includes('?build=full')).toBe(true);
  await expect(summary).toHaveCount(0); // Metadata cannot label the old pages.
  await expect(page.locator('.paper-updating')).toBeVisible();
  releasePdf();
  await expect(summary).toBeVisible();
  await expect(page.locator('.paper-updating')).toHaveCount(0);
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(diagnostics).toHaveText(full);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await diagnostics.scrollIntoViewIfNeeded();
    const bounds = await diagnostics.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.cache/full-reader-errors-${width}.png` });
  }
  repaired = true;
  await page.reload();
  await expect(page.locator('.paper-page')).toHaveCount(2);
  await expect(page.locator('.paper-updating')).toHaveCount(0);
  await expect(summary).toHaveCount(0);
  expect(requests).toContain('?build=repaired');
});
test("full-paper load failure does not attach completed diagnostics to a partial PDF", async ({ page }) => {
  const pdf = readFileSync(new URL('../../../tests/fixtures/outline.pdf', import.meta.url));
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rounds/1', async route => {
    const response = await route.fetch(), detail = await response.json();
    await route.fulfill({ response, json: { ...detail, pdf: '/reader.pdf', passes: '/reader-passes' } });
  });
  await page.route('**/reader-passes?*', async route => {
    const after = Number(new URL(route.request().url()).searchParams.get('after'));
    if (!after) return route.fulfill({ json: { pass: 1, key: 'chapter', errors: ['Chapter diagnostic'] } });
    await ready;
    return route.fulfill({ json: { pass: null, key: 'removed', errors: ['Full diagnostic'] } });
  });
  await page.route('**/reader.pdf?*', route => new URL(route.request().url()).searchParams.get('build') === 'chapter'
    ? route.fulfill({ contentType: 'application/pdf', body: pdf })
    : route.fulfill({ status: 404, json: { error: 'Build no longer exists' } }));
  await page.reload();
  await expect(page.locator('.paper-page')).toHaveCount(2);
  release();
  await expect(page.getByRole('alert')).toContainText('The full PDF could not be loaded.');
  await expect(page.getByText('Full diagnostic', { exact: true })).toHaveCount(0);
  await page.getByRole('alert').getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.locator('.change').first()).toBeVisible();
});
test("recovered revised errors stay separate from baseline errors and clear after repair", async ({ page }) => {
  const revised = 'main.tex:12: Undefined control sequence.', baseline = 'main.tex:5: Missing number.';
  let repaired = false;
  await page.route('**/rounds/1', async route => {
    const response = await route.fetch(), detail = await response.json();
    await route.fulfill({ response, json: { ...detail, baselineErrors: [baseline], revisedErrors: repaired ? undefined : [revised] } });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    const summary = page.locator('summary').filter({ hasText: 'The revised text has compilation errors.' });
    const errors = page.getByRole('region', { name: 'The revised text has compilation errors.' });
    await expect(summary).toBeVisible();
    await expect(errors).toBeHidden();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(errors).toHaveText(revised);
    await expect(errors).not.toContainText(baseline);
    await expect(page.locator('.change').first()).toBeVisible();
    const bounds = await errors.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.cache/revised-errors-${width}.png` });
  }
  repaired = true;
  await page.reload();
  await expect(page.locator('.change').first()).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: 'The revised text has compilation errors.' })).toHaveCount(0);
  await expect(page.locator('summary').filter({ hasText: 'The text before these changes has compilation errors.' })).toBeVisible();
});
test("focusing a note and switching options preserves unrelated resolved groups", async ({ page }) => {
  const groups = await page.locator('.change[data-units]').evaluateAll(elements => elements.map(element => element.getAttribute('data-units')!.split(' ')));
  expect(groups.length).toBeGreaterThan(1);
  const accepted = groups[0], focused = groups.find(group => group.every(id => !accepted.includes(id)))!;
  expect(focused).toBeTruthy();
  let round = 0;
  await page.route('**/api/tasks/tighten-design/state*', async route => {
    const response = await route.fetch(), state = await response.json();
    round = state.round;
    for (const id of accepted) state.decisions[id] = 'accepted';
    await route.fulfill({ response, json: state });
  });
  await page.reload();
  const resolved = page.locator('.change[data-state="accepted"]').first();
  await expect(resolved).toHaveAttribute('data-resolved', 'after');
  await expect(resolved.locator('.change-head')).toBeHidden();
  const visibleGroups = () => page.locator('.change > .change-head:visible').count();
  const originalCount = await visibleGroups();
  const show = (units: string[] | null, preview = false) => page.evaluate(({ round, units, preview }) => {
    window.dispatchEvent(new CustomEvent('papilot:note-focus', { detail: { key: 'note:0', round, units } }));
    window.dispatchEvent(new CustomEvent('papilot:option-preview', { detail: preview ? { key: 'note:0', round } : null }));
  }, { round, units, preview });
  for (const preview of [false, true, false]) {
    await show(focused, preview);
    await expect(resolved).toHaveAttribute('data-resolved', 'after');
    await expect(resolved.locator('.side.before')).toBeHidden();
    await expect(resolved.locator('.change-head')).toBeHidden();
    expect(await visibleGroups()).toBe(originalCount);
  }
  await show(null, true); // Show all changes changes highlights, not history.
  await expect(resolved.locator('.change-head')).toBeHidden();
  expect(await visibleGroups()).toBe(originalCount);
  await show(accepted);
  await expect(resolved.locator('.change-head')).toBeVisible();
  await show(focused);
  await expect(resolved.locator('.change-head')).toBeHidden();
  expect(await visibleGroups()).toBe(originalCount);
  await page.route('**/decide', async route => {
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const sent = page.waitForRequest(request => request.url().endsWith('/decide') && request.method() === 'POST');
  await page.keyboard.press('r');
  const payload = (await sent).postDataJSON();
  expect(payload.noteKey).toBe('note:0');
  expect(payload.changes.length).toBeGreaterThan(0);
  expect(payload.changes.every((id: string) => focused.includes(id))).toBeTruthy();
  await expect(page.locator('.change[data-state="rejected"]').first()).toBeVisible();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.locator('.change[data-state="rejected"]')).toHaveCount(0);
});
test("renders vectors and selectable text without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".pdf-text").first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".pdf-strip img")
        .evaluateAll(
          (images) =>
            images.filter(
              (img) =>
                !(img as HTMLImageElement).complete ||
                (img as HTMLImageElement).naturalWidth === 0,
            ).length,
        ),
    )
    .toBe(0);
  await expect.poll(() => page.locator(".pdf-glyph").count()).toBeGreaterThan(100);
  await page.screenshot({ path: ".cache/browser-review.png", fullPage: false });
  expect(errors).toEqual([]);
});
test("long reviews keep searchable text and preserve selections while limiting glyph layout", async ({ page }) => {
  await page.route("**/rounds/1", async route => {
    const response = await route.fetch(), detail = await response.json();
    const blocks = Array.from({ length: 80 }, (_, page) => ({ kind: "context", image: {
      src: "viewport-fixture.svg", clean: "viewport-fixture.svg", width: 600, height: 220, page: page + 1, label: `fixture-${page}`,
      text: Array.from({ length: 10 }, (_, row) => {
        const text = `ViewportFindAnchor${page} row ${row}: Text with Ω, 字, and 🧪 remains readable and selectable.`;
        return { text, chars: Array.from(text, (text, x) => ({ text, rect: [20 + x * 6, 10 + row * 20, 26 + x * 6, 24 + row * 20] })) };
      }),
    } }));
    detail.sections.unshift({ node: "viewport-fixture", title: "Viewport fixture", number: "", blocks });
    await route.fulfill({ json: detail });
  });
  await page.route("**/viewport-fixture.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220"><text x="20" y="30">Synthetic viewport fixture</text></svg>' }));
  await page.reload();
  const first = page.locator('.pdf-strip[data-page="fixture-0"]');
  await first.waitFor();
  await page.locator("#paper").evaluate(paper => { paper.scrollTop = 0; });
  await expect(first.locator(".pdf-glyph").first()).toBeVisible();
  const allText = () => page.locator(".pdf-text").allTextContents();
  const original = await allText();
  expect(await page.locator(".pdf-glyph").count()).toBeLessThan(10000);
  const selected = await first.locator(".pdf-text-line").first().evaluate(line => {
    const range = document.createRange(); range.selectNodeContents(line);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    return selection.toString();
  });
  await page.locator('.pdf-strip[data-page="fixture-79"]').evaluate(strip => strip.scrollIntoView({ block: "center" }));
  await expect(page.locator('.pdf-strip[data-page="fixture-79"] .pdf-glyph').first()).toBeAttached();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  expect(await first.locator(".pdf-glyph").count()).toBeGreaterThan(0);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(first.locator(".pdf-glyph")).toHaveCount(0);
  expect(await allText()).toEqual(original);
  const found = await page.evaluate(() => (window as unknown as { find(text: string, caseSensitive: boolean, backwards: boolean, wrap: boolean): boolean }).find("ViewportFindAnchor40", false, false, true));
  expect(found).toBe(true);
  await page.locator('.pdf-strip[data-page="fixture-40"]').evaluate(strip => strip.scrollIntoView({ block: "center" }));
  await expect(page.locator('.pdf-strip[data-page="fixture-40"] .pdf-glyph').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("ViewportFindAnchor40");
  expect(await allText()).toEqual(original);
  const alignment = await page.locator('.pdf-strip[data-page="fixture-40"]').evaluate(strip => {
    const box = strip.getBoundingClientRect(), selected = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { left: (selected.left - box.left) * 600 / box.width, right: (selected.right - box.left) * 600 / box.width };
  });
  expect(alignment.left).toBeCloseTo(20, 0);
  expect(alignment.right).toBeCloseTo(20 + "ViewportFindAnchor40".length * 6, 0);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const backwards = await page.locator('.pdf-strip[data-page="fixture-20"]').evaluate(strip => {
    const lines = strip.querySelectorAll('.pdf-line-preview'), from = lines[0].firstChild!, to = lines[1].firstChild!;
    const selected = window.getSelection()!;
    selected.setBaseAndExtent(to, to.textContent!.length - 2, from, 5);
    return selected.toString();
  });
  await page.locator('.pdf-strip[data-page="fixture-20"]').evaluate(strip => strip.scrollIntoView({ block: "center" }));
  await expect(page.locator('.pdf-strip[data-page="fixture-20"] .pdf-glyph').first()).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(backwards);
  expect(await page.evaluate(() => {
    const selected = window.getSelection()!;
    return Boolean(selected.anchorNode!.compareDocumentPosition(selected.focusNode!) & Node.DOCUMENT_POSITION_PRECEDING);
  })).toBe(true);
  expect(await allText()).toEqual(original);
});
test("expanding a selected compact line preserves its boundaries and copy text", async ({ page }) => {
  const equation = "w(v) = |left(v)|.";
  await page.route("**/rounds/1", async route => {
    const response = await route.fetch(), detail = await response.json();
    const line = (text: string, left: number) => ({ text,
      chars: Array.from(text, (text, i) => ({ text, rect: [left + i * 8, 20, left + i * 8 + 8, 34] })),
    });
    detail.sections.unshift({ node: "copy-fixture", title: "Copy fixture", number: "", blocks: [
      { kind: "context", image: { src: "copy-fixture.svg", clean: "copy-fixture.svg", width: 600, height: 2000, page: 1, label: "copy-spacer", text: [] } },
      { kind: "context", image: { src: "copy-fixture.svg", clean: "copy-fixture.svg", width: 600, height: 60, page: 2, label: "copy-equation", text: [line(equation, 100), line("(1)", 500)] } },
    ] });
    await route.fulfill({ json: detail });
  });
  await page.route("**/copy-fixture.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 60"/>' }));
  await page.reload();
  const strip = page.locator('.pdf-strip[data-page="copy-equation"]');
  for (const backwards of [false, true]) {
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.locator("#paper").evaluate(paper => { paper.scrollTop = 0; });
    await expect(strip.locator(".pdf-line-preview")).toHaveCount(2);
    const selected = await strip.locator(".pdf-text-line").first().evaluate((line, backwards) => {
      const selection = window.getSelection()!, end = line.childNodes.length;
      selection.setBaseAndExtent(line, backwards ? end : 0, line, backwards ? 0 : end);
      return selection.toString();
    }, backwards);
    expect(selected).toBe(equation);
    await strip.evaluate(strip => strip.scrollIntoView({ block: "center" }));
    await expect(strip.locator(".pdf-glyph").first()).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(equation);
    expect(await page.evaluate(() => {
      const selection = window.getSelection()!;
      return selection.anchorNode === selection.focusNode && selection.anchorOffset > selection.focusOffset;
    })).toBe(backwards);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(equation);
  }
});
test("ordinary copy returns selected PDF text and shortcuts do not decide it", async ({
  page,
}) => {
  const block = page
    .locator(".change")
    .filter({ has: page.locator(".pdf-text") })
    .first();
  await block.scrollIntoViewIfNeeded();
  const expected = await block
    .locator(".pdf-text-line")
    .first()
    .evaluate((line) => {
      const selection = window.getSelection()!,
        range = document.createRange();
      range.selectNodeContents(line);
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
  expect(expected.trim().length).toBeGreaterThan(2);
  await page.keyboard.press("a");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    expected,
  );
  await expect(block).toHaveAttribute("data-state", "pending");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+c" : "Control+c",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    expected,
  );
  await page.screenshot({ path: ".cache/browser-selection.png" });
});
test("mouse drag selects visible PDF glyphs at desktop and narrow widths", async ({
  page,
}) => {
  for (const width of [1440, 780]) {
    await page.setViewportSize({ width, height: 1000 });
    const line = page
      .locator(".change .pdf-text-line")
      .filter({ hasText: "rope" })
      .first();
    const glyphs = line.locator(".pdf-glyph");
    // The line wrapper has no layout box; its glyphs are absolutely positioned.
    // Center the actual text so a sticky change toolbar cannot cover it.
    await glyphs
      .first()
      .evaluate((glyph) =>
        glyph.scrollIntoView({ block: "center", behavior: "instant" }),
      );
    await expect
      .poll(() =>
        glyphs.first().evaluate((glyph) => {
          const box = glyph.getBoundingClientRect();
          return (
            document
              .elementFromPoint(box.left + 1, box.top + box.height / 2)
              ?.closest(".pdf-glyph") === glyph
          );
        }),
      )
      .toBe(true);
    const first = await glyphs.first().boundingBox(),
      last = await glyphs.last().boundingBox();
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    await page.mouse.move(first!.x + 1, first!.y + first!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      last!.x + last!.width - 1,
      last!.y + last!.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    const selected = await page.evaluate(() =>
      window.getSelection()?.toString(),
    );
    expect(selected).toContain("rope");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
  }
});
test("double-click selects a word and a drag past a line's end stays on that line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const line = page
    .locator(".change .pdf-text-line")
    .filter({ hasText: "Inserting text into a rope" })
    .first();
  const glyphs = line.locator(".pdf-glyph");
  await glyphs
    .first()
    .evaluate((glyph) =>
      glyph.scrollIntoView({ block: "center", behavior: "instant" }),
    );
  const text = (await line.textContent())!.trim();
  // Whole pixels: Chromium may not start a drag selection at a fractional point.
  const box = async (index: number) => (await glyphs.nth(index).boundingBox())!;
  const inWord = await glyphs.evaluateAll((all) => {
    let offset = 0;
    const start = all.map((glyph) => glyph.textContent!).join("").indexOf("Inserting");
    return all.findIndex((glyph) => (offset += glyph.textContent!.length) > start + 2);
  });
  const word = await box(inWord);
  await page.mouse.dblclick(
    Math.round(word.x + word.width / 2),
    Math.round(word.y + word.height / 2),
  );
  expect(
    (await page.evaluate(() => window.getSelection()?.toString()))?.trim(),
  ).toBe("Inserting");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const first = await box(0),
    last = (await glyphs.last().boundingBox())!,
    y = Math.round(first.y + first.height / 2);
  await page.mouse.move(Math.round(first.x + 1), y);
  await page.mouse.down();
  await page.mouse.move(Math.round(last.x + last.width + 60), y, { steps: 10 });
  await page.mouse.up();
  expect(
    (await page.evaluate(() => window.getSelection()?.toString()))?.trim(),
  ).toBe(text);
});
test("Copy reference preserves selection and adds file, lines and page", async ({
  page,
}) => {
  const block = page
    .locator(".change")
    .filter({ has: page.locator(".pdf-text") })
    .first();
  const selected = await block
    .locator(".pdf-text-line")
    .first()
    .evaluate((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(range);
      return s.toString();
    });
  await block
    .getByRole("button", { name: "Copy reference", exact: true })
    .click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Round 1 · Change");
  expect(copied).toContain("paper/sections/design.tex:");
  expect(copied).toContain("p.");
  expect(copied).toContain(selected.trim());
});
test("source diff shows TeX and local accept can be undone", async ({
  page,
}) => {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const block = page.locator(".change.current");
  await block.getByRole("button", { name: "LaTeX", exact: true }).click();
  await expect(block.locator(".source-code").first()).toBeVisible();
  await block.getByRole("button", { name: /^Accept/ }).click();
  await expect(page.locator('.change[data-state="accepted"]')).toHaveCount(1);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(page.locator('.change[data-state="accepted"]')).toHaveCount(0);
});
test("a decided change offers no decisions, only the way to the next undecided one", async ({
  page,
}) => {
  const total = await totalUnits(page);
  const first = page.locator(".change.current");
  await first.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: `1 of ${total} decided`, exact: true })).toBeVisible();
  await expect(page.locator(".bar .history")).toHaveCount(0);
  await page.goto(`${page.url()}&history=1`);
  const accepted = page.locator('.change[data-state="accepted"]');
  await accepted.click();
  await expect(accepted).toHaveClass(/current/);
  for (const name of ["Accept", "Reject", "Comment"])
    await expect(accepted.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(accepted.getByRole("button", { name: "Next undecided", exact: true })).toBeVisible();
  // The review server is shared by every test; leave the round undecided.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(page.getByRole("progressbar", { name: `0 of ${total} decided`, exact: true })).toBeVisible();
});
test("Accept all acts once for the full round and one undo restores every change", async ({
  page,
}) => {
  const total = await totalUnits(page);
  await page
    .getByRole("button", { name: `Accept all (${total})`, exact: true })
    .click();
  await expect(page.getByRole("progressbar", { name: `${total} of ${total} decided`, exact: true })).toBeVisible();
  await expect(page.locator('.change[data-state="pending"]')).toHaveCount(0);
  await expect(
    page.locator('.change-map-mark[data-state="pending"]'),
  ).toHaveCount(0);
  await expectMapAligned(page);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(page.getByRole("progressbar", { name: `0 of ${total} decided`, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Accept all (${total})`, exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator('.change-map-mark[data-state="accepted"]'),
  ).toHaveCount(0);
  await expectMapAligned(page);
});

test("Reject all decides only undecided changes and one undo restores the batch", async ({
  page,
}) => {
  const total = await totalUnits(page);
  const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";
  await page
    .locator(".change.current")
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await expect(page.locator('.change[data-state="accepted"]')).toHaveCount(1);
  const rejectAll = page.getByRole("button", { name: /^Reject all \(\d+\)$/ });
  const undecided = Number(
    await rejectAll.locator(".batch-count").textContent(),
  );
  expect(undecided).toBeGreaterThan(0);
  expect(undecided).toBeLessThan(total);
  await expect(
    page.getByRole("button", {
      name: `Accept all (${undecided})`,
      exact: true,
    }),
  ).toBeVisible();
  await rejectAll.click();
  await expect(page.getByRole("progressbar", { name: `${total} of ${total} decided`, exact: true })).toBeVisible();
  await expect(page.locator('.change[data-state="accepted"]')).toHaveCount(1);
  await expect(page.locator('.change[data-state="pending"]')).toHaveCount(0);
  await expect(rejectAll).toHaveCount(0);
  await page.keyboard.press(undo);
  await expect(
    page.getByRole("progressbar", { name: `${total - undecided} of ${total} decided`, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.change[data-state="accepted"]')).toHaveCount(1);
  await expect(page.locator('.change[data-state="rejected"]')).toHaveCount(0);
  await page.keyboard.press(undo);
  await expect(page.getByRole("progressbar", { name: `0 of ${total} decided`, exact: true })).toBeVisible();
});

test("the last undecided change is decided from its own bar, without batch buttons", async ({
  page,
}) => {
  const total = await totalUnits(page);
  for (let decided = 1; decided < total; decided++) {
    const next = page
      .locator(".change.current")
      .getByRole("button", { name: "Next undecided", exact: true });
    if (await next.isVisible()) await next.click();
    const block = page.locator(".change.current"), accept = block.locator('.dock button.accept');
    if (/\(\d+\)/.test(await accept.textContent() || '')) {
      // One PDF block can hold several independent source edits. Use its
      // per-unit action so this test still leaves exactly one undecided unit.
      if (!await block.locator('.source').isVisible()) await block.getByRole('button', { name: /LaTeX$/ }).click();
      await block.locator('.unit-actions button.accept').first().click();
    } else await accept.click();
    await expect(
      page.getByRole("progressbar", { name: `${decided} of ${total} decided`, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: /^(Accept|Reject) all/ }),
  ).toHaveCount(0);
  await page.locator('.change.current .dock').getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(total));
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(total - 1));
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(page.getByRole("progressbar", { name: `${total - 2} of ${total} decided`, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept all (2)", exact: true }),
  ).toBeVisible();
  // The review server is shared by every test; leave the round undecided.
  for (let decided = total - 3; decided >= 0; decided--) {
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect(
      page.getByRole("progressbar", { name: `${decided} of ${total} decided`, exact: true }),
    ).toBeVisible();
  }
});
test("comments retain drafts and reach agent feedback with their source location", async ({
  page,
}) => {
  const comment =
    "请保留这里的技术含义。\nExplain why this bound is necessary.";
  await page
    .locator(".change.current")
    .getByRole("button", { name: "Comment", exact: true })
    .click();
  await page.getByRole("textbox", { name: /^Comment on change/ }).fill(comment);
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await expect(
    page.getByRole("textbox", { name: /^Comment on change/ }),
  ).toHaveValue(comment);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator('.change[data-state="commented"]')).toHaveCount(1);
  await expect(
    page.locator('.change-map-mark[data-state="commented"]'),
  ).toHaveCount(0);
  const response = await page.request.get(
    "/api/tasks/tighten-design/feedback?after=0",
  );
  expect(response.ok()).toBe(true);
  const feedback = (await response.json()) as Feedback;
  const delivered = feedback.feedback.find(
    (item) => item.kind === "comment" && item.text === comment,
  );
  expect(delivered?.changes).toEqual([
    expect.objectContaining({
      file: "paper/sections/design.tex",
      lines: expect.any(Array),
      old: expect.any(String),
      new: expect.any(String),
    }),
  ]);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(page.locator('.change[data-state="commented"]')).toHaveCount(0);
});

test("review controls remain usable on narrow screens", async ({
  page,
}) => {
  const total = await totalUnits(page);
  await expect(page.getByText("Your turn", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Message.*agent/ }),
  ).toHaveCount(0);
  for (const width of [1440, 780, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(
      page.getByRole("button", { name: `Accept all (${total})`, exact: true }),
    ).toBeInViewport();
    await expect(
      page
        .locator(".change.current")
        .getByRole("button", { name: "Comment", exact: true }),
    ).toBeInViewport();
    const overflow = await page
      .locator("#paper")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.cache/browser-paper-${width}.png` });
  }
});

async function expectMapAligned(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("#paper")!,
          track = document.querySelector<HTMLElement>(".change-map")!,
          articles = [...root.querySelectorAll<HTMLElement>("[data-stop]")],
          marks = [...track.querySelectorAll<HTMLElement>(".change-map-mark")];
        return Math.max(
          0,
          ...marks.map((mark) => {
            const article = articles.find(
              (article) => article.dataset.stop === mark.dataset.stopIndex,
            )!;
            const documentPosition =
              (article.getBoundingClientRect().top -
                root.getBoundingClientRect().top +
                root.scrollTop) /
              root.scrollHeight;
            const mapPosition =
              (mark.getBoundingClientRect().top -
                track.getBoundingClientRect().top -
                track.clientTop) /
              track.clientHeight;
            return (
              Math.abs(documentPosition - mapPosition) * track.clientHeight
            );
          }),
        );
      }),
    )
    .toBeLessThan(2);
}

test("change map navigates with pointer and keyboard and follows review layout changes", async ({
  page,
}) => {
  const map = page.getByRole("navigation", { name: "Change map" }),
    marks = map.getByRole("button"),
    changes = page.locator(".change");
  await expect(marks).toHaveCount(await changes.count());
  await expectMapAligned(page);
  const last = (await marks.count()) - 1;
  await marks.last().click();
  await expect(page.locator(".change.current")).toHaveAttribute(
    "data-stop",
    String(last),
  );
  await expect(marks.last()).toHaveAttribute("aria-current", "location");
  await expect(changes.last()).toBeInViewport();
  await marks.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(marks.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".change.current")).toHaveAttribute(
    "data-stop",
    "1",
  );

  await marks.first().click();
  await changes
    .first()
    .getByRole("button", { name: "LaTeX", exact: true })
    .click();
  await expect(changes.first().locator(".source")).toBeVisible();
  await expectMapAligned(page);
  await changes
    .first()
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await expect(marks).toHaveCount(last);
  await expect(changes.first().locator(".change-head")).toBeHidden();
  await expect(marks.first()).toHaveAttribute("data-stop-index", "1");
  await expectMapAligned(page);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await expect(marks.first()).toHaveAttribute("data-state", "pending");
  await expectMapAligned(page);

  for (const width of [780, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(map).toBeInViewport();
    await expectMapAligned(page);
  }
  // A publishing notice moves existing content without resizing the document.
  await page.route("**/api/tasks/tighten-design/state*", async (route) => {
    const response = await route.fetch(),
      state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        state: "building",
        job: { status: "running", phase: "render" },
      },
    });
  });
  await expect(
    page.getByText("Updating changes…", { exact: true }),
  ).toBeVisible();
  await expectMapAligned(page);
});

test("change map viewport follows scrolling and can be dragged", async ({
  page,
}) => {
  const track = page.locator(".change-map"),
    thumb = page.locator(".change-map-viewport"),
    root = page.locator("#paper");
  await expectMapAligned(page);
  const rail = (await track.boundingBox())!,
    viewport = (await thumb.boundingBox())!;
  await page.mouse.move(rail.x + 2, viewport.y + viewport.height / 2);
  await page.mouse.down();
  await page.mouse.move(rail.x + 2, rail.y + rail.height * 0.8, { steps: 20 });
  await page.mouse.up();
  await expect
    .poll(() =>
      root.evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight)),
    )
    .toBeGreaterThan(0.6);
  await expect
    .poll(() =>
      thumb.evaluate((el) => parseFloat((el as HTMLElement).style.top)),
    )
    .toBeGreaterThan(rail.height * 0.5);
  await root.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await expect
    .poll(() =>
      thumb.evaluate((el) => parseFloat((el as HTMLElement).style.top)),
    )
    .toBe(0);
  await expectMapAligned(page);
  await page.screenshot({ path: ".cache/browser-change-map.png" });
});
test("an edit that prints in two changes names the other and goes there", async ({ page }) => {
  await page.route("**/rounds/1", async route => {
    const response = await route.fetch(), detail = await response.json();
    const section = detail.sections.find((s: { blocks: { kind: string }[] }) => s.blocks.filter(b => b.kind === "change").length >= 2);
    const [first, second] = section.blocks.filter((b: { kind: string }) => b.kind === "change");
    // The second change also carries the first change's edit, printed there too.
    const unit = first.units[0];
    second.units = [...second.units, unit];
    first.linked = [{ unit, reason: "places" }];
    second.linked = [{ unit, reason: "places" }];
    await route.fulfill({ response, json: detail });
  });
  await page.reload();
  const firstLink = page.locator('.change[data-stop="0"] .change-linked');
  await expect(firstLink).toHaveText(/Same edit as change \d+/);
  await expect(firstLink).toHaveAttribute("title", "The same edit prints in several places in the PDF.");
  const target = Number((await firstLink.innerText()).match(/\d+/)![0]) - 1;
  await firstLink.click();
  await expect(page.locator(".change.current")).toHaveAttribute("data-stop", String(target));
  await expect(page.locator(`.change[data-stop="${target}"] .change-linked`)).toHaveText("Same edit as change 1");
});
test("a whitespace edit beside visible ones does not call the change invisible", async ({ page }) => {
  let mixed = -1, invisible = -1, handled!: () => void;
  const rewritten = new Promise<void>(resolve => { handled = resolve; });
  await page.route("**/rounds/1", async route => {
    const response = await route.fetch(), detail = await response.json();
    const blocks = detail.sections.flatMap((s: { blocks: { kind: string; units: string[] }[] }) => s.blocks.filter(b => b.kind === "change"));
    const unit = (id: string) => detail.units.find((u: { id: string }) => u.id === id);
    // The first change gets the second change's edit too, which only swapped
    // a space for a line break; the third change has no visible edit at all.
    const [first, second, third] = blocks;
    first.units = [...first.units, ...second.units];
    for (const section of detail.sections) section.blocks = section.blocks.filter((b: object) => b !== second);
    for (const id of first.units) unit(id).visual = "text";
    for (const id of second.units) unit(id).visual = "identical";
    for (const id of third.units) unit(id).visual = "identical";
    mixed = 0; invisible = 1;
    await route.fulfill({ response, json: detail });
    handled();
  });
  await page.reload();
  await rewritten;
  await expect(page.locator(`.change[data-stop="${mixed}"] .change-head`)).toBeVisible();
  await expect(page.locator(`.change[data-stop="${mixed}"] .change-kind`)).toHaveCount(0);
  await expect(page.locator(`.change[data-stop="${invisible}"] .change-kind`)).toHaveText("No visible change");
});

test("identical and strip-free changes stay out of inline source until explicitly requested", async ({ page }) => {
  let identicalStop = -1, unmappedStop = -1, effectsStop = -1, binaryStop = -1;
  await page.route("**/rounds/1", async route => {
    const response = await route.fetch(), detail = await response.json();
    const blocks = detail.sections.flatMap((s: { blocks: { kind: string; units: string[]; before: unknown[]; after: unknown[]; identical?: boolean }[] }) =>
      s.blocks.filter(b => b.kind === "change"));
    const byId = new Map(detail.units.map((u: { id: string }) => [u.id, u]));
    const textBlocks = blocks.filter((b: { units: string[] }) =>
      b.units.every(id => {
        const u = byId.get(id) as { kind: string; status: string; text_ops?: unknown[] };
        return u.kind === "text" && u.status !== "deleted" && Boolean(u.text_ops?.length);
      }));
    expect(textBlocks.length).toBeGreaterThanOrEqual(4);
    const [identicalBlock, unmappedBlock, effectsBlock, binaryBlock] = textBlocks;
    identicalStop = blocks.indexOf(identicalBlock);
    unmappedStop = blocks.indexOf(unmappedBlock);
    effectsStop = blocks.indexOf(effectsBlock);
    binaryStop = blocks.indexOf(binaryBlock);
    const sampleStrip = identicalBlock.after[0] ?? identicalBlock.before[0];

    // 1. Identical rendered output with a PDF strip.
    identicalBlock.identical = true;
    identicalBlock.before = [];
    identicalBlock.after = sampleStrip ? [sampleStrip] : [];
    for (const id of identicalBlock.units) (byId.get(id) as { visual: string }).visual = "identical";

    // 2. Unmapped source change with no PDF strips and no indirect effects.
    unmappedBlock.identical = false;
    unmappedBlock.before = [];
    unmappedBlock.after = [];
    for (const id of unmappedBlock.units) {
      const unit = byId.get(id) as { visual: string; effects?: unknown };
      unit.visual = "unmapped";
      delete unit.effects;
    }

    // 3. Unmapped source change with related PDF effects elsewhere.
    effectsBlock.identical = false;
    effectsBlock.before = [];
    effectsBlock.after = [];
    const effectUnit = byId.get(effectsBlock.units[0]) as { visual: string; effects?: unknown };
    effectUnit.visual = "unmapped";
    effectUnit.effects = {
      total: 1,
      verified: true,
      shown: [{ page: "1", section: "1 Design", before: [], after: sampleStrip ? [sampleStrip] : [] }],
    };

    // 4. Strip-free binary file change.
    binaryBlock.identical = false;
    binaryBlock.before = [];
    binaryBlock.after = [];
    binaryBlock.units = [binaryBlock.units[0]];
    const binaryUnit = byId.get(binaryBlock.units[0]) as { kind: string; visual: string; effects?: unknown };
    binaryUnit.kind = "binary";
    binaryUnit.visual = "unmapped";
    delete binaryUnit.effects;

    await route.fulfill({ response, json: detail });
  });

  await page.reload();
  await expect(page.locator(".change").first()).toBeVisible();
  // No inline source card opens automatically for any of the four cases.
  await expect(page.locator(".change .source")).toHaveCount(0);

  const identicalCard = page.locator(`.change[data-stop="${identicalStop}"]`);
  await expect(identicalCard.locator('.comparison-notice[data-reason="identical"]')).toContainText("No visible change in the PDF.");
  await expect(identicalCard.locator('.side.after.identical')).toBeVisible();
  const identicalSourceButton = identicalCard.locator('.comparison-notice').getByRole("button", { name: "Show LaTeX source", exact: true });
  await expect(identicalSourceButton).toBeVisible();

  const unmappedCard = page.locator(`.change[data-stop="${unmappedStop}"]`);
  await expect(unmappedCard.locator('.comparison-notice[data-reason="unmapped"]')).toContainText("No PDF preview for this source change.");
  await expect(unmappedCard.locator('.comparison-notice').getByRole("button", { name: "Show LaTeX source", exact: true })).toBeVisible();

  const effectsCard = page.locator(`.change[data-stop="${effectsStop}"]`);
  await expect(effectsCard.locator('.comparison-notice')).toHaveCount(0);
  await expect(effectsCard.locator('.effects')).toBeVisible();
  await expect(effectsCard.locator('.source')).toHaveCount(0);

  const binaryCard = page.locator(`.change[data-stop="${binaryStop}"]`);
  await expect(binaryCard.locator('.comparison-notice[data-reason="binary"]')).toContainText("Binary file changed. No PDF comparison is available.");
  await expect(binaryCard.locator('.comparison-notice button')).toHaveCount(0);

  // Explicit source inspection opens inline source in standalone mode and toggles back cleanly.
  await identicalSourceButton.click();
  await expect(identicalCard.locator(".source")).toBeVisible();
  await expect(identicalCard.locator('.comparison-notice').getByRole("button", { name: "Hide LaTeX source", exact: true })).toBeVisible();
  await identicalCard.locator('.comparison-notice').getByRole("button", { name: "Hide LaTeX source", exact: true }).click();
  await expect(identicalCard.locator(".source")).toHaveCount(0);

  // When a host intercepts OPEN_SOURCE_EVENT, explicit requests route there without opening inline source.
  await page.evaluate(() => {
    (window as unknown as { openedSources?: unknown[] }).openedSources = [];
    window.addEventListener("latex-review:open-source", (event) => {
      event.preventDefault();
      (window as unknown as { openedSources: unknown[] }).openedSources.push((event as CustomEvent).detail);
    });
  });
  await unmappedCard.locator('.comparison-notice').getByRole("button", { name: "Show LaTeX source", exact: true }).click();
  await expect(unmappedCard.locator(".source")).toHaveCount(0);
  expect(await page.evaluate(() => ((window as unknown as { openedSources?: unknown[] }).openedSources ?? []).length)).toBe(1);

  // Pending decisions remain discoverable and work cleanly with Accept and Undo.
  const total = await totalUnits(page);
  await unmappedCard.click();
  await expect(unmappedCard).toHaveClass(/\bcurrent\b/);
  await unmappedCard.locator(".dock button.accept").click();
  await expect(unmappedCard).toHaveAttribute("data-state", "accepted");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(page.getByRole("progressbar", { name: `0 of ${total} decided`, exact: true })).toBeVisible();
  await expect(unmappedCard.locator('.comparison-notice[data-reason="unmapped"]')).toBeVisible();

  // Check desktop & mobile layouts without horizontal overflow.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.locator("#paper").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.cache/unavailable-notices-${width}.png` });
  }
});

for (const width of [1440, 390]) test(`inline source selects its change before keyboard decisions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1200 });
  await page.route("**/rounds/1", async route => {
    const response = await route.fetch(), detail = await response.json();
    const units = detail.units.slice(0, 2);
    await route.fulfill({ response, json: { ...detail, units, sections: [], loose: units.map((unit: { id: string }) => ({ kind: "change", units: [unit.id], before: [], after: [], identical: true })) } });
  });
  await page.reload();
  const first = page.locator('.change[data-stop="0"]'), second = page.locator('.change[data-stop="1"]');
  await expect(first).toHaveClass(/current/);
  await second.locator('.source-toggle').click();
  await expect(second.locator('.source')).toBeVisible();
  await expect(second).toHaveClass(/current/);
  await expect(first).not.toHaveClass(/current/);
  const chosen = (await second.getAttribute('data-units'))!.split(' ');
  const request = page.waitForRequest(request => request.url().endsWith('/decide') && request.method() === 'POST');
  await second.focus();
  await page.keyboard.press('a');
  expect((await request).postDataJSON()).toMatchObject({ action: 'accept', changes: chosen });
  await expect(second).toHaveAttribute('data-state', 'accepted');
  await expect(first).toHaveAttribute('data-state', 'pending');
  // The suite shares its review server; restore the decision before the next case.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(second).toHaveAttribute('data-state', 'pending');
});

test("baseline-failed sourceOnly and failed-comparison states show recovery actions without auto-opening source", async ({ page }) => {
  let mode: "sourceOnly" | "pending" | "failed" | "failed-commented" | "ready" = "sourceOnly";
  let publishRequests = 0;
  const currentRound = 1;
  let renderJob = "initial-render";

  await page.route("**/api/tasks/tighten-design/state*", async route => {
    const response = await route.fetch({ url: route.request().url().replace(/([?&]round=)\d+/, "$11") });
    const state = await response.json();
    state.round = currentRound;
    state.latest = currentRound;
    state.renderJob = renderJob;
    if (mode === "pending") {
      state.state = "building";
      state.rendering = "pending";
      state.waiting = Object.keys(state.decisions);
    } else if (mode === "failed" || mode === "failed-commented") {
      state.state = "build_failed";
      state.rendering = "failed";
      state.waiting = Object.keys(state.decisions);
      if (mode === "failed-commented") {
        const firstId = Object.keys(state.decisions)[0];
        if (firstId) {
          state.decisions[firstId] = "commented";
          state.comments[firstId] = "Check baseline compile error";
        }
      }
    }
    await route.fulfill({ response, json: state });
  });
  await page.route("**/api/tasks/tighten-design/rounds/*", async route => {
    const response = await route.fetch({ url: route.request().url().replace(/\/rounds\/\d+$/, "/rounds/1") });
    const detail = { ...(await response.json()), round: currentRound, renderJob };
    if (mode === "sourceOnly") {
      const units = detail.units.slice(0, 1).map((u: object) => ({ ...u, visual: "unmapped", pages: [], section: null, effects: undefined }));
      await route.fulfill({
        response,
        json: {
          ...detail,
          units,
          sections: [],
          loose: [{ kind: "change", units: [units[0].id], identical: false, before: [], after: [] }],
          sourceOnly: true,
          baselineErrors: ["main.tex:2: File `missing.tex' not found."],
          pdf: undefined,
        },
      });
      return;
    }
    if (mode === "pending" || mode === "failed" || mode === "failed-commented") {
      const units = detail.units.slice(0, 1).map((u: object) => ({ ...u, waiting: true, effects: undefined }));
      await route.fulfill({
        response,
        json: {
          ...detail,
          rendering: mode === "pending" ? "pending" : "failed",
          units,
          sections: [],
          loose: [{ kind: "change", units: [units[0].id], identical: false, before: [], after: [], waiting: true }],
          pdf: undefined,
        },
      });
      return;
    }
    await route.fulfill({ response, json: detail });
  });
  await page.route("**/api/tasks/tighten-design/publish", async route => {
    publishRequests++;
    // A cached retry can finish between polls, without a new source revision
    // or an observed pending state. Its render job still invalidates the PDF.
    renderJob = `retry-${publishRequests}`;
    mode = "ready";
    await route.fulfill({ json: { ok: true } });
  });

  // 1. Baseline-failed sourceOnly round: no auto source card, clear banner + card notice + actions.
  await page.reload();
  await expect(page.locator(".change").first()).toBeVisible();
  await expect(page.locator(".change .source")).toHaveCount(0);
  await expect(page.locator("summary").filter({ hasText: "No PDF comparison: the text before these changes could not be compiled." })).toBeVisible();
  const bannerRetry = page.locator(".banner-with-action").getByRole("button", { name: "Retry comparison", exact: true });
  await expect(bannerRetry).toBeVisible();
  const card = page.locator('.change[data-stop="0"]');
  await expect(card.locator('.comparison-notice[data-reason="baseline-failed"]')).toContainText("No PDF comparison because the previous version could not be compiled.");
  await expect(card.locator('.comparison-notice').getByRole("button", { name: "Show LaTeX source", exact: true })).toBeVisible();
  await expect(card.locator(".dock button.accept")).toBeEnabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.locator("#paper").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.cache/source-only-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await bannerRetry.click();
  await expect.poll(() => publishRequests).toBe(1);
  await expect(page.locator(".pdf-strip img").first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".change .source")).toHaveCount(0);

  // 2. Comparison preparing (pending): waiting indicator, no auto source card, decisions gated.
  mode = "pending";
  await page.reload();
  await expect(page.locator('.comparison-waiting[data-state="pending"]')).toContainText("PDF comparison in progress");
  await expect(page.locator(".change .source")).toHaveCount(0);
  await expect(page.locator('.change[data-stop="0"] button.accept')).toHaveCount(0);

  // 3. Commented waiting/failed change collapses cleanly without leaving an orphaned waiting bar.
  mode = "failed-commented";
  await page.reload();
  await expect(page.locator('.change[data-stop="0"]')).toHaveClass(/reviewed-change/);
  await expect(page.locator('.change[data-stop="0"] .comparison-waiting')).toBeHidden();

  // 4. Comparison failed -> explicit Show LaTeX source works on demand, and Retry comparison recovers to full PDF strips.
  mode = "failed";
  await page.reload();
  const failed = page.locator('.comparison-waiting[data-state="failed"]');
  await expect(failed).toContainText("PDF comparison failed");
  await expect(page.locator(".change .source")).toHaveCount(0);
  await failed.getByRole("button", { name: "Show LaTeX source", exact: true }).click();
  await expect(page.locator('.change[data-stop="0"] .source')).toBeVisible();
  await failed.getByRole("button", { name: "Hide LaTeX source", exact: true }).click();
  await expect(page.locator('.change[data-stop="0"] .source')).toHaveCount(0);
  await failed.getByRole("button", { name: "Retry comparison", exact: true }).click();
  await expect.poll(() => publishRequests).toBe(2);
  await expect(page.locator(".pdf-strip img").first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".change .source")).toHaveCount(0);
});

test("top-bar change navigator steps between changes and re-centers the current one", async ({ page }) => {
  const nav = page.locator(".bar .change-nav");
  await expect(nav).toBeVisible();
  const prev = nav.getByRole("button", { name: "Previous change", exact: true });
  const next = nav.getByRole("button", { name: "Next change", exact: true });
  const pos = nav.locator(".change-nav-position");
  const total = await page.locator("article.change").count();
  expect(total).toBeGreaterThan(1);
  // Only one visible Previous/Next change control exists at a time.
  await expect(page.getByRole("button", { name: "Previous change", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Next change", exact: true })).toHaveCount(1);
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(pos).toHaveAccessibleName(`Change 1 / ${total}`);
  expect(await pos.innerText()).toBe(`Change 1 / ${total}`);
  await next.click();
  await expect(page.locator(".change.current")).toHaveAttribute("data-stop", "1");
  await expect(prev).toBeEnabled();
  await expect(pos).toHaveAccessibleName(`Change 2 / ${total}`);
  expect(await pos.innerText()).toBe(`Change 2 / ${total}`);
  await prev.click();
  await expect(page.locator(".change.current")).toHaveAttribute("data-stop", "0");
  await expect(prev).toBeDisabled();
  await expect(pos).toHaveAccessibleName(`Change 1 / ${total}`);
  // Scrolling away and clicking the counter re-centers Change 1.
  await page.locator("#paper").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await pos.click();
  await expect(page.locator('.change[data-stop="0"]')).toBeInViewport();
  // Switching to phone dock hands prev/next off cleanly without duplicating buttons.
  await page.evaluate(() => document.documentElement.setAttribute("data-papilot-phone", ""));
  await expect(page.locator(".bar .change-nav")).toHaveCount(0);
  await expect(page.locator(".change.current .dock .nav")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Previous change", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Next change", exact: true })).toHaveCount(1);
});

test("clicking individual highlights in a multi-unit card lets you accept one edit and reject another directly on the PDF", async ({ page }) => {
  const svg = (label: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="40" viewBox="0 0 500 40"><rect width="500" height="40" fill="#fff"/><text x="16" y="25" font-size="14" fill="#111">${label}</text></svg>`;
  const decisions: Record<string, "pending" | "accepted" | "rejected" | "commented"> = {
    u1: "pending",
    u2: "pending",
  };
  const decideCalls: { action: string; changes: string[] }[] = [];
  await page.route("**/files/before.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg("Old first and old second.") }),
  );
  await page.route("**/files/before-clean.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg("Old first and old second.") }),
  );
  await page.route("**/files/after.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg("New first and new second.") }),
  );
  await page.route("**/files/after-clean.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg("New first and new second.") }),
  );
  await page.route("**/mixed-files/unit-pick/1/k1/mixed.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg("New first and old second.") }),
  );
  const mixedCalls: Array<{ units: string[]; accepted: string[] }> = [];
  await page.route("**/rounds/1/mixed", async (route) => {
    const body = route.request().postDataJSON() as { units: string[]; accepted: string[] };
    mixedCalls.push(body);
    await route.fulfill({
      json: {
        files: "/mixed-files/unit-pick/1/k1/",
        strips: [
          {
            src: "mixed.svg",
            clean: "mixed.svg",
            width: 500,
            height: 40,
            page: 1,
            label: "1",
            top: 100,
          },
        ],
      },
    });
  });
  const statePayload = (extra: Record<string, unknown> = {}) => ({
    task: "unit-pick",
    title: "Per-unit PDF decisions",
    state: "reviewing",
    latest: 1,
    round: 1,
    closed: false,
    decisions: { ...decisions },
    comments: {},
    csrf: "tok",
    undo: decideCalls.length
      ? { id: `d-${decideCalls.length}`, kind: decideCalls.at(-1)!.action, changes: decideCalls.at(-1)!.changes }
      : null,
    history: [{ number: 1, created: 1700000000 }],
    ...extra,
  });
  await page.route("**/state**", (route) => route.fulfill({ json: statePayload() }));
  await page.route("**/rounds/1", (route) =>
    route.fulfill({
      json: {
        task: "unit-pick",
        round: 1,
        before: "b",
        after: "a",
        files: "/files/",
        warnings: [],
        units: [
          {
            id: "u1",
            file: "main.tex",
            status: "modified",
            kind: "text",
            whole_file: false,
            truncated: false,
            old_start: 10,
            old_end: 10,
            new_start: 10,
            new_end: 10,
            old_text: "Old first",
            new_text: "New first",
            ops: [],
          },
          {
            id: "u2",
            file: "main.tex",
            status: "modified",
            kind: "text",
            whole_file: false,
            truncated: false,
            old_start: 10,
            old_end: 10,
            new_start: 10,
            new_end: 10,
            old_text: "old second",
            new_text: "new second",
            ops: [],
          },
        ],
        sections: [
          {
            node: "intro",
            number: "1",
            title: "Intro",
            blocks: [
              {
                kind: "change",
                units: ["u1", "u2"],
                identical: false,
                before: [
                  {
                    src: "before.svg",
                    clean: "before-clean.svg",
                    width: 500,
                    height: 40,
                    page: 1,
                    label: "1",
                    top: 100,
                    marks: [
                      { unit: "u1", kind: "removed", rect: [16, 10, 90, 28] },
                      { unit: "u2", kind: "removed", rect: [140, 10, 230, 28] },
                    ],
                  },
                ],
                after: [
                  {
                    src: "after.svg",
                    clean: "after-clean.svg",
                    width: 500,
                    height: 40,
                    page: 1,
                    label: "1",
                    top: 100,
                    marks: [
                      { unit: "u1", kind: "added", rect: [16, 10, 90, 28] },
                      { unit: "u2", kind: "added", rect: [140, 10, 230, 28] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        loose: [],
      },
    }),
  );
  await page.route("**/decide", async (route) => {
    const body = route.request().postDataJSON() as { action: "accept" | "reject" | "comment"; changes: string[] };
    decideCalls.push({ action: body.action, changes: body.changes });
    const nextState = body.action === "accept" ? "accepted" : body.action === "reject" ? "rejected" : "commented";
    for (const id of body.changes) decisions[id] = nextState;
    await route.fulfill({ json: statePayload() });
  });

  await page.route("**/undo", async (route) => {
    const last = decideCalls.pop();
    if (last) for (const id of last.changes) decisions[id] = "pending";
    await route.fulfill({ json: statePayload({ restored: last?.changes ?? [] }) });
  });

  await page.goto("/?task=unit-pick");
  const card = page.locator('.change[data-stop="0"]');
  await expect(card).toBeVisible();
  // Explicit multi-edit mode: unified state chips in header (zero duplicate stepper)
  // and only ONE Accept/Reject control layer inside the card.
  const group = card.locator(".change-head .unit-focus-group");
  const chips = card.locator(".change-head .unit-chips .unit-chip");
  await expect(group).toBeVisible();
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toHaveAttribute("data-unit", "u1");
  await expect(chips.nth(0)).toHaveAttribute("data-state", "pending");
  await expect(chips.nth(0)).toHaveAttribute("data-active", "true");
  await expect(chips.nth(1)).toHaveAttribute("data-unit", "u2");
  await expect(chips.nth(1)).toHaveAttribute("data-state", "pending");
  await expect(chips.nth(1)).not.toHaveAttribute("data-active", "true");
  await expect(card.locator('.pdf-unit-marks g[data-unit="u1"][data-active="true"]')).toHaveCount(2);
  await expect(card.locator(".block-batch-actions")).toHaveCount(0);
  await expect(card.locator(".change-head").getByRole("button", { name: "Accept", exact: true })).toHaveCount(1);
  await page.screenshot({ path: ".cache/plan-b-explicit-multi.png" });

  // Clicking u2 directly on the PDF jumps focus to chip 2; clicking chip 1 returns focus to u1.
  const afterStrip = card.locator(".side.after .pdf-strip");
  const box = (await afterStrip.boundingBox())!;
  await page.mouse.move(box.x + (185 / 500) * box.width, box.y + (19 / 40) * box.height);
  await expect(afterStrip).toHaveAttribute("data-unit-hover", "true");
  await page.mouse.click(box.x + (185 / 500) * box.width, box.y + (19 / 40) * box.height);
  await expect(chips.nth(1)).toHaveAttribute("data-active", "true");
  await chips.nth(0).click();
  await expect(chips.nth(0)).toHaveAttribute("data-active", "true");

  // Accept ONLY u1; chip 1 turns accepted and focus advances to chip 2.
  await group.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => decideCalls.length).toBe(1);
  expect(decideCalls[0]).toEqual({ action: "accept", changes: ["u1"] });
  expect(mixedCalls).toHaveLength(0);
  await expect(chips.nth(0)).toHaveAttribute("data-state", "accepted");
  await expect(chips.nth(1)).toHaveAttribute("data-state", "pending");
  await expect(chips.nth(1)).toHaveAttribute("data-active", "true");
  await expect(card.locator('.pdf-unit-marks g[data-unit="u1"][data-state="accepted"]')).toHaveCount(2);
  await expect(card.locator('.pdf-unit-marks g[data-unit="u2"][data-active="true"]')).toHaveCount(2);

  // Clicking back on accepted chip 1 shows its decided state pill in the header.
  await chips.nth(0).click();
  await expect(chips.nth(0)).toHaveAttribute("data-active", "true");
  await expect(group.locator('.unit-focus-state[data-state="accepted"]')).toBeVisible();
  await chips.nth(1).click();

  // Reject ONLY u2; block finishes with mixed decisions and triggers ONE mixed compile.
  await group.getByRole("button", { name: "Reject", exact: true }).click();
  await expect.poll(() => decideCalls.length).toBe(2);
  expect(decideCalls[1]).toEqual({ action: "reject", changes: ["u2"] });
  await expect(group).toHaveCount(0);
  await expect.poll(() => mixedCalls.length).toBe(1);
  expect(mixedCalls[0]).toEqual({ units: ["u1", "u2"], accepted: ["u1"] });
  await expect(card).toHaveAttribute("data-state", "mixed");
  await expect(card).toHaveAttribute("data-resolved", "mixed");
  await expect(card.locator(".side.after.mixed-resolved")).toBeVisible();
  await expect(card.locator(".side.before")).toBeHidden();
  await expect(card.locator(".side.after:not(.mixed-resolved)")).toBeHidden();

  // Undo restores the Before/After strips and chips immediately.
  const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z";
  await page.keyboard.press(undoKey);
  await expect(card).not.toHaveAttribute("data-resolved", "mixed");
  await expect(chips.nth(0)).toHaveAttribute("data-state", "accepted");
  await expect(chips.nth(1)).toHaveAttribute("data-state", "pending");
  await expect(card.locator(".side.before")).toBeVisible();
  await expect(card.locator(".side.after:not(.mixed-resolved)")).toBeVisible();
});
