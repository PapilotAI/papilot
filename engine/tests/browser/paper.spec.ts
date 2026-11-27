import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { mupdf, PdfDocument } from "../../src/render/pdf.ts";
import { renderDocument, Strips } from "../../src/render/inline.ts";
import type { Build } from "../../src/render/locate.ts";
import type { ChangeBlock, Rect, RoundDetail } from "../../src/types.ts";

test("full-paper review preserves unchanged ink beside a column change", async ({
  page,
}) => {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "review-paper-columns-"),
  );
  const raw = new mupdf.PDFDocument(),
    font = new mupdf.Font("Helvetica"),
    resource = raw.addSimpleFont(font);
  let content = "";
  for (const [side, x] of [
    ["LEFT", 35],
    ["RIGHT", 335],
  ] as const)
    for (let row = 0; row < 14; row++)
      content += `BT /F1 10 Tf ${x} ${530 - row * 26} Td (${side} ROW ${String(row).padStart(2, "0")} must remain fully readable) Tj ET\n`;
  const sheet = raw.addPage(
    [0, 0, 600, 600],
    0,
    { Font: { F1: resource } },
    content,
  );
  raw.insertPage(-1, sheet);
  sheet.destroy();
  const bytes = raw.saveToBuffer("");
  fs.writeFileSync(path.join(folder, "paper.pdf"), bytes.asUint8Array());
  const document = new PdfDocument(bytes.asUint8Array());
  bytes.destroy();
  resource.destroy();
  font.destroy();
  raw.destroy();
  let block: ChangeBlock, unchanged: Rect;
  try {
    expect(document.page(0).twoColumns).toBe(true);
    const rect = document.page(0).search("LEFT ROW 05")[0];
    unchanged = document.page(0).search("RIGHT ROW 05")[0];
    const build = { document, outline: [] } as unknown as Build;
    block = renderDocument(
      build,
      build,
      [
        {
          id: "fixture",
          file: "paper.tex",
          comparison: "text",
          aligned: true,
          pairs: [
            {
              old: { page: 0, clip: rect, label: "1" },
              new: { page: 0, clip: rect, label: "1" },
              group: 0,
              before_marks: [],
              after_marks: [{ kind: "added", rect }],
            },
          ],
        },
      ],
      new Strips(folder),
      () => false,
    ).loose[0];
    expect(block.after[0].width).toBeLessThan(300);
  } finally {
    document.close();
  }
  try {
    await page.route("**/column-fixture/*", async (route) => {
      const name = path.basename(new URL(route.request().url()).pathname);
      await route.fulfill({
        body: fs.readFileSync(path.join(folder, name)),
        contentType: name.endsWith(".pdf")
          ? "application/pdf"
          : "image/svg+xml",
      });
    });
    await page.route(
      /\/api\/tasks\/tighten-design\/rounds\/\d+$/,
      async (route) => {
        const response = await route.fetch(),
          detail = (await response.json()) as RoundDetail;
        const unit = {
          ...detail.units[0],
          visual: "text" as const,
          effects: undefined,
        };
        await route.fulfill({
          json: {
            ...detail,
            units: [unit],
            sections: [],
            loose: [{ ...block, units: [unit.id] }],
            pdf: "/column-fixture/paper.pdf",
            files: "/column-fixture/",
            passes: undefined,
            references: undefined,
          },
        });
      },
    );
    await page.goto("/?task=tighten-design");
    await expect(page.locator(".paper .change")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".paper .change img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      // Read the actual PDF canvas: the adjacent unchanged word must have
      // a visible owner and dark ink, including after a responsive repaint.
      await expect
        .poll(async () =>
          page.locator(".paper-slice").evaluateAll((slices, rect) => {
            const x = (rect[0] + rect[2]) / 2,
              y = (rect[1] + rect[3]) / 2;
            for (const element of slices) {
              const box = element as HTMLElement,
                left = Number(box.dataset.left ?? 0),
                right = Number(box.dataset.right ?? 600),
                top = Number(box.dataset.top),
                bottom = Number(box.dataset.bottom);
              if (x < left || x >= right || y < top || y >= bottom) continue;
              const canvas = box.querySelector("canvas"),
                context = canvas?.getContext("2d");
              if (!canvas || !context || !canvas.width || !canvas.height)
                continue;
              const x0 = Math.max(
                  0,
                  Math.floor(
                    ((rect[0] - left) / (right - left)) * canvas.width,
                  ),
                ),
                y0 = Math.max(
                  0,
                  Math.floor(
                    ((rect[1] - top) / (bottom - top)) * canvas.height,
                  ),
                );
              const x1 = Math.min(
                  canvas.width,
                  Math.ceil(((rect[2] - left) / (right - left)) * canvas.width),
                ),
                y1 = Math.min(
                  canvas.height,
                  Math.ceil(((rect[3] - top) / (bottom - top)) * canvas.height),
                );
              if (x1 <= x0 || y1 <= y0) continue;
              const pixels = context.getImageData(
                x0,
                y0,
                x1 - x0,
                y1 - y0,
              ).data;
              let dark = 0;
              for (let i = 0; i < pixels.length; i += 4)
                if (pixels[i] < 128 && pixels[i + 3] > 0) dark++;
              if (dark > 10) return true;
            }
            return false;
          }, unchanged),
        )
        .toBe(true);
      await page.screenshot({
        path: `.cache/browser-paper-columns-${width}.png`,
      });
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("side by side shows both versions' whole pages, paired with a blank page, and a change's bar opens its decisions", async ({ page }) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "review-compare-pages-"));
  // The old version has one page; the new one rewords a line and adds a page.
  const write = (name: string, pages: string[][]) => {
    const raw = new mupdf.PDFDocument(), font = new mupdf.Font("Helvetica"), resource = raw.addSimpleFont(font);
    for (const lines of pages) {
      const content = lines.map((line, row) => `BT /F1 12 Tf 60 ${740 - row * 24} Td (${line}) Tj ET\n`).join("");
      const sheet = raw.addPage([0, 0, 612, 792], 0, { Font: { F1: resource } }, content);
      raw.insertPage(-1, sheet);
      sheet.destroy();
    }
    const bytes = raw.saveToBuffer("");
    fs.writeFileSync(path.join(folder, name), bytes.asUint8Array());
    const document = new PdfDocument(bytes.asUint8Array());
    bytes.destroy(); resource.destroy(); font.destroy(); raw.destroy();
    return document;
  };
  const lines = (changed: string) => Array.from({ length: 12 }, (_, row) => row === 5 ? changed : `Unchanged line ${row} of the paper`);
  const oldDocument = write("old.pdf", [lines("The OLD wording of this sentence")]),
    newDocument = write("new.pdf", [lines("The NEW wording of this sentence"), ["Appendix on a page of its own"]]);
  let block: ChangeBlock;
  try {
    const oldRect = oldDocument.page(0).search("OLD wording")[0], newRect = newDocument.page(0).search("NEW wording")[0];
    const line = (rect: Rect): Rect => [0, rect[1] - 4, 612, rect[3] + 4];
    block = renderDocument(
      { document: oldDocument, outline: [] } as unknown as Build,
      { document: newDocument, outline: [] } as unknown as Build,
      [{ id: "fixture", file: "paper.tex", comparison: "text", aligned: true, pairs: [{
        old: { page: 0, clip: line(oldRect), label: "1" }, new: { page: 0, clip: line(newRect), label: "1" }, group: 0,
        before_marks: [{ kind: "removed", rect: oldRect }], after_marks: [{ kind: "added", rect: newRect }],
      }] }],
      new Strips(folder),
      () => false,
    ).loose[0];
  } finally {
    oldDocument.close(); newDocument.close();
  }
  try {
    let oldRequests = 0;
    await page.route("**/compare-fixture/*", async (route) => {
      const name = path.basename(new URL(route.request().url()).pathname);
      if (name === "old.pdf") oldRequests++;
      await route.fulfill({ body: fs.readFileSync(path.join(folder, name)), contentType: name.endsWith(".pdf") ? "application/pdf" : "image/svg+xml" });
    });
    await page.route(/\/api\/tasks\/tighten-design\/rounds\/\d+$/, async (route) => {
      const detail = (await (await route.fetch()).json()) as RoundDetail;
      const unit = { ...detail.units[0], visual: "text" as const, effects: undefined },
        added = { ...detail.units[1], visual: "text" as const, effects: undefined };
      // A second change: the appendix the new version adds, on its own page.
      const appendix: ChangeBlock = { ...block, units: [added.id], before: [], after: [{ ...block.after[0], page: 2, label: "2", top: 40, height: 24 }] };
      await route.fulfill({ json: { ...detail, units: [unit, added], sections: [], loose: [{ ...block, units: [unit.id] }, appendix],
        pdf: "/compare-fixture/new.pdf", pdfBefore: "/compare-fixture/old.pdf", files: "/compare-fixture/", passes: undefined, references: undefined } });
    });
    await page.goto("/?task=tighten-design");
    await expect(page.locator(".paper .change").first()).toBeVisible();
    const toggle = page.getByRole("button", { name: "Side by side", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    // A review that stays stacked never asks for the old version.
    await expect.poll(() => page.locator(".paper-page canvas").count()).toBeGreaterThan(0);
    expect(oldRequests).toBe(0);
    // The workspace's page controls follow either layout and are never
    // cleared while switching.
    await page.evaluate(() => {
      const seen: (number | null)[] = [];
      (window as unknown as { readerStates: typeof seen }).readerStates = seen;
      window.addEventListener("papilot:review:pdf-reader-state", (event) => seen.push((event as CustomEvent<{ pages: number } | null>).detail?.pages ?? null));
    });
    await toggle.click();
    // Two rows of pages: the changed pages together, then the new appendix
    // beside a blank page.
    const rows = page.locator(".compare-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator(".compare-page:not(.compare-blank)")).toHaveCount(2);
    await expect(rows.nth(1).locator('.compare-blank')).toHaveCount(1);
    await expect(rows.nth(1).locator('.compare-page[data-side="after"]')).toHaveCount(1);
    await expect.poll(() => page.locator(".compare-page > canvas").count()).toBe(3);
    // The change is marked on both pages, level with each other.
    const marks = page.locator(".compare-mark");
    await expect(marks).toHaveCount(3);
    const [before, after] = await marks.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
    expect(Math.abs(before.top - after.top)).toBeLessThan(2);
    expect(before.right).toBeLessThan(after.left);
    // The review opens on the change, its lines shaded on both pages. A click
    // on its bar opens its decisions; another deselects it.
    const bar = page.getByRole("button", { name: "Change 1", exact: true }), decisions = page.locator(".compare-panel");
    await expect(page.locator(".compare-mark.current .compare-shade")).toHaveCount(2);
    await bar.click();
    for (const name of ["Accept", "Reject", "Comment", "Copy reference", "Show LaTeX source"])
      await expect(decisions.getByRole("button", { name, exact: true })).toBeVisible();
    await page.screenshot({ path: ".cache/browser-compare-pages.png" });
    await bar.click();
    await expect(page.locator(".compare-mark.current")).toHaveCount(0);
    await expect(decisions).toHaveCount(0);
    // Escape closes the help over the review before it deselects anything.
    await bar.click();
    await page.keyboard.press("?");
    await expect(page.locator(".help-backdrop")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".help-backdrop")).toHaveCount(0);
    await expect(decisions).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".compare-mark.current")).toHaveCount(0);
    await expect(decisions).toHaveCount(0);
    // With nothing selected, a shortcut decides nothing.
    await page.keyboard.press("a");
    await page.waitForTimeout(300);
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    // Reading on to the next change selects nothing: change 1 stays the
    // review's change while change 2 comes into view.
    await bar.click();
    await page.locator("#paper").evaluate((root) => root.scrollTo(0, root.scrollHeight));
    await expect(page.getByRole("button", { name: "Change 2", exact: true })).toBeInViewport();
    await page.waitForTimeout(300);
    await expect(page.locator(".compare-spot.current")).toHaveAttribute("data-stop", "0");
    await expect(page.locator(".change-nav-position")).toHaveAttribute("title", "Change 1");
    // Switching back and forth keeps the reader on the new version's pages.
    await toggle.click();
    await expect(page.locator(".paper-page")).toHaveCount(2);
    await toggle.click();
    await expect(page.locator(".compare-row")).toHaveCount(2);
    await page.waitForTimeout(300);
    const states = await page.evaluate(() => (window as unknown as { readerStates: (number | null)[] }).readerStates);
    expect(states.length).toBeGreaterThan(0);
    expect(states).toEqual(states.map(() => 2));
    // The choice is remembered; narrow windows keep the stacked layout.
    await page.reload();
    await expect(page.locator(".compare-row")).toHaveCount(2);
    await page.setViewportSize({ width: 600, height: 1000 });
    await expect(page.locator(".compare-row")).toHaveCount(0);
    await expect(toggle).toHaveCount(0);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
