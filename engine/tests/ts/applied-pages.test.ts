import { afterEach, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { paintAppliedPages } from "../../src/web/applied-pages.ts";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("leaves a failed page idle, paints other pages, and retries after the page reenters the viewport", async () => {
  let observe!: (entries: { target: unknown; isIntersecting: boolean }[]) => void;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof observe) { observe = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, className: "", remove() {} }) });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const pages = [0, 1].map((index) => ({
    dataset: { index: String(index) }, offsetTop: index * 800, clientWidth: 600,
    querySelectorAll: () => [], prepend: vi.fn(),
  }));
  const container = { querySelectorAll: () => pages } as unknown as HTMLElement;
  let failedCalls = 0, recovered = false;
  const pdf = {
    getPage: vi.fn(async (number: number) => {
      if (number === 1 && !recovered) {
        // Bound the fake failure so the broken implementation cannot starve
        // the test runner forever with its immediate retry loop.
        if (++failedCalls >= 10) return new Promise(() => {});
        throw new Error("This page cannot be rendered");
      }
      return {
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: Promise.resolve(), cancel() {} }),
      };
    }),
  } as unknown as PDFDocumentProxy;
  const stop = paintAppliedPages(container, pdf, null);
  try {
    observe(pages.map((target) => ({ target, isIntersecting: true })));
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(failedCalls).toBe(1);
    expect(pages[1].prepend).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
    recovered = true;
    observe([{ target: pages[0], isIntersecting: false }]);
    observe([{ target: pages[0], isIntersecting: true }]);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(pages[0].prepend).toHaveBeenCalledOnce();
  } finally { stop(); }
});

it("releases the retained canvas when a page leaves during a resize repaint", async () => {
  let observe!: (entries: { target: unknown; isIntersecting: boolean }[]) => void, resize!: () => void;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof observe) { observe = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: typeof resize) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  const mounted = new Set<HTMLCanvasElement>();
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0, className: "", remove() { mounted.delete(this as unknown as HTMLCanvasElement); },
  }) });
  const page = {
    dataset: { index: "0" }, offsetTop: 0, clientWidth: 600,
    querySelectorAll: () => [...mounted], prepend: (canvas: HTMLCanvasElement) => mounted.add(canvas),
  };
  const container = { clientWidth: 600, querySelectorAll: () => [page] };
  let renders = 0, reject!: (error: Error) => void;
  const cancel = vi.fn(() => reject(Object.assign(new Error("Cancelled"), { name: "RenderingCancelledException" })));
  const pdf = { getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ++renders === 1
      ? { promise: Promise.resolve(), cancel() {} }
      : { promise: new Promise<void>((_resolve, failed) => { reject = failed; }), cancel },
  }) } as unknown as PDFDocumentProxy;
  const stop = paintAppliedPages(container as unknown as HTMLElement, pdf, null);
  try {
    observe([{ target: page, isIntersecting: true }]);
    await vi.waitFor(() => expect(mounted.size).toBe(1));
    const old = [...mounted][0];
    expect(old.width).toBe(600);
    container.clientWidth = page.clientWidth = 900;
    resize();
    await vi.waitFor(() => expect(renders).toBe(2));
    expect(mounted.has(old)).toBe(true);
    observe([{ target: page, isIntersecting: false }]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mounted.size).toBe(0);
    expect([old.width, old.height]).toEqual([0, 0]);
  } finally { stop(); }
});
