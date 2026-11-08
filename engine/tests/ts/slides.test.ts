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
const cases = [
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
        `${scenario.preamble}\n\\begin{document}\n\\input{content}\n\\end{document}\n`,
      );
      f.write("paper/content.tex", scenario.body + "\n");
      f.repo.run(["add", "."]);
      f.repo.run(["commit", "-qm", "sectionless document"]);
      const app = f.app(),
        task = app.tasks.create("slides");
      f.edit(task, "paper/content.tex", scenario.from, scenario.to);
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
      expect(text(before)).toContain("oldvalue");
      expect(text(after)).toContain("newvalue");
      expect(after.map((s) => s.page)).toEqual(scenario.pages);
      if (scenario.beforePages)
        expect(before.map((s) => s.page)).toEqual(scenario.beforePages);
      if (scenario.slides) {
        expect(text(after)).toContain("Changed title");
        expect(text(after)).not.toContain("sentinel");
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
