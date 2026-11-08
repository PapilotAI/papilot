import fs from "node:fs";
import path from "node:path";
import { it, expect } from "vitest";
import { Fixture } from "./helpers.ts";
import { buildOutline } from "../../src/core/outline.ts";
import { which } from "../../src/core/process.ts";
import type { Strip } from "../../src/types.ts";

it("finds body files without requiring section headings", () => {
  const files: Record<string, string> = {
    "main.tex":
      "\\input{theme}\n\\begin{document}\nIntro.\n\\input{slides}\n\\end{document}",
    "theme.tex": "Preamble definitions.",
    "slides.tex": "\\begin{frame}\nContent.\n\\end{frame}",
  };
  const outline = buildOutline((name) => files[name], "main.tex");
  expect(outline.nodes).toEqual([]);
  expect(outline.files).toEqual(["main.tex", "slides.tex"]);
});

const tex = Boolean(which("latexmk") && which("pdflatex"));
interface Scenario {
  name: string;
  preamble: string;
  body: string;
  from: string;
  to: string;
  pages: number[];
  beforePages?: number[];
  slides?: boolean;
  beforeText?: string;
  afterText?: string;
  packages?: Record<string, string>;
  document?: string;
  fragment?: string;
}
const cases: Scenario[] = [
  {
    name: "a long frame wrapper defined through local packages",
    preamble: "\\documentclass{beamer}\n\\usepackage{slides}",
    packages: {
      "slides.sty": "\\RequirePackage{frames}",
      "frames.sty":
        "\\NewDocumentEnvironment{slide}{m +b}{\\begin{frame}{#1}#2\\end{frame}}{}",
    },
    body:
      "\\begin{slide}{Previous sentinel}\nUnchanged.\n\\end{slide}\n\\begin{slide}{Changed title}\nThe oldvalue is here.\n" +
      "More frame content.\n".repeat(12) +
      "\\end{slide}",
    from: "oldvalue",
    to: "newvalue",
    pages: [2],
    beforePages: [2],
    slides: true,
  },
  {
    name: "deleting all frames from an included file preserves neighboring frames",
    preamble: "\\documentclass{beamer}",
    document:
      "\\begin{frame}{Previous sentinel}\nUnchanged.\n\\end{frame}\n\\input{content}",
    body: "\\begin{frame}{Changed title}\nThe oldvalue is here.\n\\end{frame}",
    from: "\\begin{frame}{Changed title}\nThe oldvalue is here.\n\\end{frame}\n",
    to: "",
    pages: [],
    beforePages: [2],
    afterText: "",
    slides: true,
  },
  {
    name: "inserting a complete frame without changing its successor",
    preamble: "\\documentclass{beamer}",
    body: String.raw`\begin{frame}{Following sentinel}
Keep this frame unchanged.
\end{frame}`,
    from: "\\begin{frame}{Following sentinel}",
    to: String.raw`\begin{frame}{Changed title}
The newvalue is here.
\end{frame}
\begin{frame}{Following sentinel}`,
    pages: [1],
    beforePages: [],
    beforeText: "",
    slides: true,
  },
  {
    name: "deleting a complete frame without changing its successor",
    preamble: "\\documentclass{beamer}",
    body: String.raw`\begin{frame}{Changed title}
The oldvalue is here.
\end{frame}
\begin{frame}{Following sentinel}
Keep this frame unchanged.
\end{frame}`,
    from: String.raw`\begin{frame}{Changed title}
The oldvalue is here.
\end{frame}
`,
    to: "",
    pages: [],
    beforePages: [1],
    afterText: "",
    slides: true,
  },
  {
    name: "inserting text inside a frame retains both versions",
    preamble: "\\documentclass{beamer}",
    body: String.raw`\begin{frame}{Changed title}
The oldvalue is here.
\end{frame}`,
    from: "\\end{frame}",
    to: "The newvalue is here.\n\\end{frame}",
    pages: [1],
    beforePages: [1],
    slides: true,
  },
  ...["frame", "slide"].map((env) => ({
    name: `a ${env} inside a grouping environment`,
    preamble: String.raw`\documentclass{beamer}
\newenvironment{slidegroup}{}{}
\NewDocumentEnvironment{slide}{m +b}{\begin{frame}{#1}#2\end{frame}}{}`,
    body: `\\begin{slidegroup}\n\\begin{${env}}{Changed title}\nThe oldvalue is here.\n\\end{${env}}\n\\begin{${env}}{Following sentinel}\nKeep this frame unchanged.\n\\end{${env}}\n\\end{slidegroup}`,
    from: "oldvalue",
    to: "newvalue",
    pages: [1],
    beforePages: [1],
    slides: true,
    beforeText: undefined,
    afterText: undefined,
  })),
  {
    name: "deleting text inside a frame retains both versions",
    preamble: "\\documentclass{beamer}",
    body: String.raw`\begin{frame}{Changed title}
The oldvalue is here.
The newvalue is here.
\end{frame}`,
    from: "The oldvalue is here.\n",
    to: "",
    pages: [1],
    beforePages: [1],
    slides: true,
  },
  ...["insert", "delete"].map((operation) => ({
    name: `${operation} text in an included frame body`,
    preamble: "\\documentclass{beamer}",
    body: String.raw`\begin{frame}{Previous sentinel}
Keep this frame unchanged.
\end{frame}
\begin{frame}{Changed title}
\input{inner}
\end{frame}`,
    fragment:
      operation === "insert"
        ? "The oldvalue is here.\n"
        : "The oldvalue is here.\nThe newvalue is here.\n",
    from: "The oldvalue is here.\n",
    to:
      operation === "insert"
        ? "The oldvalue is here.\nThe newvalue is here.\n"
        : "",
    pages: [2],
    beforePages: [2],
    slides: true,
    beforeText: undefined,
    afterText: undefined,
  })),
  {
    name: "an article without sections",
    preamble: "\\documentclass{article}",
    body: "First paragraph.\n\nThe oldvalue is here.",
    from: "oldvalue",
    to: "newvalue",
    pages: [1],
  },
  {
    name: "a body-capturing Beamer wrapper with overlay artwork",
    preamble: String.raw`\documentclass[aspectratio=169]{beamer}
\usepackage{tikz}
\setbeamertemplate{footline}[frame number]
\NewDocumentEnvironment{slide}{m +b}{\begin{frame}{#1}
\begin{tikzpicture}[remember picture,overlay]
\node at (current page.center) {#2};
\draw[blue,thick] (current page.south west) -- (current page.north east);
\end{tikzpicture}\end{frame}}{}`,
    body: String.raw`\begin{slide}{Unchanged sentinel}
Previous frame.
\end{slide}
\begin{slide}{Changed title}
The oldvalue is here.
\end{slide}
\begin{slide}{Following sentinel}
Next frame.
\end{slide}`,
    from: "oldvalue",
    to: "newvalue",
    pages: [2],
    slides: true,
  },
  {
    name: "deleting a slide while revising its successor",
    preamble: "\\documentclass{beamer}",
    body: String.raw`\begin{frame}{Obsolete slide}
Redundant explanation.
\end{frame}
\begin{frame}{Changed title}
The oldvalue is here.
\end{frame}`,
    from: String.raw`\begin{frame}{Obsolete slide}
Redundant explanation.
\end{frame}
\begin{frame}{Changed title}
The oldvalue is here.`,
    to: String.raw`\begin{frame}{Changed title}
The newvalue is here.`,
    pages: [1],
    beforePages: [1, 2],
    slides: true,
  },
  {
    name: "all overlays of an ordinary Beamer frame",
    preamble: "\\documentclass{beamer}",
    body: String.raw`\begin{frame}{Unchanged sentinel}
Previous frame.
\end{frame}
\begin{frame}{Changed title}
The oldvalue is here.
\pause
The second overlay is here.
\end{frame}
\begin{frame}{Following sentinel}
Next frame.
\end{frame}`,
    from: "oldvalue",
    to: "newvalue",
    pages: [2, 3],
    slides: true,
  },
];
for (const scenario of cases)
  it.skipIf(!tex)(scenario.name, async () => {
    const f = new Fixture();
    try {
      f.write(
        "paper/main.tex",
        `${scenario.preamble}\n\\begin{document}\n${scenario.document ?? "\\input{content}"}\n\\end{document}\n`,
      );
      if (scenario.packages)
        for (const [file, text] of Object.entries(scenario.packages))
          f.write("paper/" + file, text);
      f.write("paper/content.tex", scenario.body + "\n");
      if (scenario.fragment !== undefined)
        f.write("paper/inner.tex", scenario.fragment);
      f.repo.run(["add", "."]);
      f.repo.run(["commit", "-qm", "sectionless document"]);
      const app = f.app(),
        task = app.tasks.create("slides");
      f.edit(
        task,
        scenario.fragment !== undefined
          ? "paper/inner.tex"
          : "paper/content.tex",
        scenario.from,
        scenario.to,
      );
      const job = app.publisher.submit(task.name, undefined, false);
      await app.publisher.join();
      const result = app.publisher.job(job.id);
      expect(result.status, JSON.stringify(result.result)).toBe("done");
      const detail = app.review.roundDetail(task.name, 1);
      expect(detail.units[0].visual).toBe("text");
      const before = detail.loose.flatMap((b) => b.before),
        after = detail.loose.flatMap((b) => b.after),
        text = (strips: Strip[]) =>
          strips.flatMap((s) => s.text?.map((l) => l.text) ?? []).join(" ");
      if (scenario.beforeText === "") expect(before).toEqual([]);
      else expect(text(before)).toContain("oldvalue");
      if (scenario.afterText === "") expect(after).toEqual([]);
      else expect(text(after)).toContain("newvalue");
      expect(after.map((s) => s.page)).toEqual(scenario.pages);
      if (scenario.beforePages)
        expect(before.map((s) => s.page)).toEqual(scenario.beforePages);
      if (scenario.slides) {
        if (after.length) expect(text(after)).toContain("Changed title");
        expect(text([...before, ...after])).not.toContain("sentinel");
        for (const strip of [...before, ...after]) {
          expect(strip.width).toBeGreaterThan(350);
          expect(strip.height).toBeGreaterThan(250);
          expect(
            fs.existsSync(path.join(app.state, "rounds/slides/001", strip.src)),
          ).toBe(true);
        }
      }
    } finally {
      await f.close();
    }
  });
