import { afterEach, beforeEach, expect, it } from "vitest";
import { Fixture, METHOD, fakeRound } from "./helpers.ts";
import { applyUnits, diffUnits, revertUnits } from "../../src/core/changes.ts";
import { merge3Async } from "../../src/core/git.ts";
import { consolidateRewrites, mergeText, textEdits, textTokens } from "../../src/core/text-edits.ts";
import { wordDiff } from "../../src/web/model.ts";
import { mergeUnitMarks, resolveUnitMarks } from "../../src/web/PdfStrip.tsx";
let f: Fixture;
beforeEach(() => {
  f = new Fixture();
});
afterEach(async () => f.close());

it("applies every subset of independent edits on the same source line exactly", () => {
  const old =
      "The method is fast, the estimate is stable, and the result is useful.\n",
    next =
      "The method is efficient, the estimate is robust, and the result is practical.\n";
  f.write(METHOD, old);
  const before = f.repo.snapshot(["paper"]);
  f.write(METHOD, next);
  const after = f.repo.snapshot(["paper"]),
    units = diffUnits(f.repo, before, after);
  expect(units.map((u) => [u.old_text, u.new_text])).toEqual([
    ["fast", "efficient"],
    ["stable", "robust"],
    ["useful", "practical"],
  ]);
  for (let mask = 0; mask < 8; mask++) {
    const selected = units.filter((_, i) => mask & (1 << i));
    let expected = old;
    for (const unit of selected)
      expected = expected.replace(unit.old_text, unit.new_text);
    expect(
      applyUnits(Buffer.from(old), Buffer.from(next), selected)?.toString(),
    ).toBe(expected);
    expect(
      revertUnits(
        Buffer.from(old),
        Buffer.from(next),
        units.filter((u) => !selected.includes(u)),
      )?.toString(),
    ).toBe(expected);
  }
});

it("keeps math and nested command arguments atomic and handles CJK prose", () => {
  expect(
    textTokens(
      String.raw`A \textbf{fast and {stable}} result $x + y$ is useful.`,
    ),
  ).toContain(String.raw`\textbf{fast and {stable}}`);
  expect(
    textEdits(
      String.raw`Use $x + y$ and $a + b$.`,
      String.raw`Use $x - y$ and $a - b$.`,
    ),
  ).toHaveLength(2);
  expect(
    textEdits("方法很快，结果稳定。", "方法高效，结果可靠。"),
  ).toHaveLength(2);
});

it("keeps prose line rewrapping together without exposing unchanged words as deletions", () => {
  const old = 'The editor keeps an undo\nhistory for every version, with a pointer\nto an older root.\n';
  const next = 'The editor keeps an\nundo history for every version, with a\npointer to an older root.\n';
  f.write(METHOD, old);
  const before = f.repo.snapshot(['paper']);
  f.write(METHOD, next);
  const after = f.repo.snapshot(['paper']), units = diffUnits(f.repo, before, after);
  expect(units).toHaveLength(1);
  expect(units[0].old_text.replace(/\s+/g, ' ').trim()).toBe(units[0].new_text.replace(/\s+/g, ' ').trim());
  expect(applyUnits(Buffer.from(old), Buffer.from(next), units)?.toString()).toBe(next);
  expect(revertUnits(Buffer.from(old), Buffer.from(next), units)?.toString()).toBe(old);
});

it("does not turn unchanged words into delete+insert edits when prose rewraps next to a substantive edit", () => {
  const old = [
    "\\item {\\bfseries A declarative bidirectional type system} with predicative implicit",
    "bounded quantification and impredicative explicit",
    "type applications. The declarative type system guesses monotypes.",
    "Monotypes are unconventional in that they require a non-syntactic",
    "formulation due to the presence of \\mbox{bounds in type variables.}",
    "",
  ].join("\n");
  const next = [
    "\\item {\\bfseries A declarative bidirectional type system} with predicative",
    "implicit bounded quantification and impredicative explicit type",
    "applications. The declarative type system guesses monotypes using a",
    "non-syntactic formulation that depends on type-variable bounds.",
    "",
  ].join("\n");
  f.write(METHOD, old);
  const before = f.repo.snapshot(["paper"]);
  f.write(METHOD, next);
  const after = f.repo.snapshot(["paper"]),
    units = diffUnits(f.repo, before, after),
    substantive = units.filter((u) => !(/^[\t \r\n]+$/.test(u.old_text) && /^[\t \r\n]+$/.test(u.new_text)));
  // Only the rewritten clauses around unchanged "a non-syntactic formulation"
  // are substantive; rewrapped "implicit" and "type" stay untouched.
  expect(substantive).toHaveLength(2);
  for (const unit of substantive) {
    expect(unit.old_text).not.toContain("implicit");
    expect(unit.new_text).not.toContain("implicit");
    expect(unit.old_text).not.toContain("applications");
    expect(unit.new_text).not.toContain("applications");
  }
  expect(applyUnits(Buffer.from(old), Buffer.from(next), units)?.toString()).toBe(next);
  expect(revertUnits(Buffer.from(old), Buffer.from(next), units)?.toString()).toBe(old);

  // Blank-line paragraph boundaries stay anchored even when adjacent tokens on both sides change.
  const headingAndPara = textEdits(
    "\\section{Old Title}\n\nFirst sentence stays.\n",
    "\\section{New Title}\n\nSecond sentence stays.\n",
  );
  expect(headingAndPara).toHaveLength(2);
  const crlfAdj = textEdits(
    "First alpha beta\r\n\r\nSecond gamma delta.\r\n",
    "First one two\r\n\r\nThird three four.\r\n",
  );
  expect(crlfAdj).toHaveLength(2);
  // A single line followed by a trailing blank line stays a single-line diff.
  expect(
    textEdits("Method sentence 2.\n\n", "Accepted manuscript sentence.\n\n"),
  ).toHaveLength(1);
});

it("applies insertions and deletions precisely, while older line-based units still work", () => {
  const old = "A quick model is very useful.\r\nUnchanged.\r\n",
    next = "A new quick model is useful.\r\nUnchanged.\r\n";
  f.write(METHOD, old);
  const before = f.repo.snapshot(["paper"]);
  f.write(METHOD, next);
  const after = f.repo.snapshot(["paper"]),
    units = diffUnits(f.repo, before, after);
  expect(units).toHaveLength(2);
  expect(
    applyUnits(Buffer.from(old), Buffer.from(next), [units[0]])?.toString(),
  ).toBe(old.replace("A quick", "A new quick"));
  expect(
    applyUnits(Buffer.from(old), Buffer.from(next), [units[1]])?.toString(),
  ).toBe(old.replace("very ", ""));
  expect(
    revertUnits(Buffer.from(old), Buffer.from(next), units)?.toString(),
  ).toBe(old);
  const legacy = {
    ...units[0],
    text_ops: undefined,
    ops: [["replace", 0, 1, 0, 1] as const],
  };
  expect(
    applyUnits(Buffer.from(old), Buffer.from(next), [
      { ...legacy, ops: [["replace", 0, 1, 0, 1]] },
    ])?.toString(),
  ).toBe(next);
});

it("preserves empty source sides in the legacy line coordinates", () => {
  const old = 'Following line.\n', next = 'Inserted line.\n' + old;
  f.write(METHOD, old);
  const before = f.repo.snapshot(['paper']);
  f.write(METHOD, next);
  const after = f.repo.snapshot(['paper']);
  for (const [a, b] of [[before, after], [after, before]]) {
    const units = diffUnits(f.repo, a, b);
    expect(units).toHaveLength(1);
    const text = units[0].text_ops![0], lines = units[0].ops[0];
    expect(text[1] === text[2]).toBe(lines[1] === lines[2]);
    expect(text[3] === text[4]).toBe(lines[3] === lines[4]);
  }
});

it("keeps multiline math and arguments together even across unchanged source lines", () => {
  const old =
      "Text is fast.\n\\begin{align}\na &= x + y \\\\\n b &= c \\\\\n d &= p + q\n\\end{align}\n\\textbf{The result\nis useful\nand stable}\n",
    next = old
      .replace("fast", "efficient")
      .replace("x + y", "x - y")
      .replace("p + q", "p - q")
      .replace("useful", "practical")
      .replace("stable", "robust");
  f.write(METHOD, old);
  const before = f.repo.snapshot(["paper"]);
  f.write(METHOD, next);
  const after = f.repo.snapshot(["paper"]),
    units = diffUnits(f.repo, before, after);
  expect(units).toHaveLength(3);
  expect(units[1].old_text).toContain("\\begin{align}");
  expect(units[1].old_text).toContain("\\end{align}");
  expect(units[2].old_text).toBe("\\textbf{The result\nis useful\nand stable}");
  expect(
    applyUnits(Buffer.from(old), Buffer.from(next), units)?.toString(),
  ).toBe(next);
});

it("keeps a rewritten display's nested environment separate from surrounding prose", () => {
  const old = 'A small example.\n\\[\\begin{aligned}x &= 1 \\\\ y &= 2\\end{aligned}\\]\nThe result is useful.\n';
  const next = old.replace('small', 'short').replace('y &= 2', 'y &= 3').replace('useful', 'practical');
  f.write(METHOD, old);
  const before = f.repo.snapshot(['paper']);
  f.write(METHOD, next);
  const units = diffUnits(f.repo, before, f.repo.snapshot(['paper']));
  expect(units).toHaveLength(3);
  expect(units[1].old_text).toBe('\\[\\begin{aligned}x &= 1 \\\\ y &= 2\\end{aligned}\\]');
  expect(applyUnits(Buffer.from(old), Buffer.from(next), [units[0]])?.toString()).toBe(old.replace('small', 'short'));
  expect(applyUnits(Buffer.from(old), Buffer.from(next), [units[2]])?.toString()).toBe(old.replace('useful', 'practical'));
});

for (const [label, oldBody, newBody] of [
  ['remove a list', '\\begin{enumerate}\n\\item A fast result.\n\\item A stable estimate.\n\\end{enumerate}', 'A fast result.\nA stable estimate.'],
  ['add a list', 'A fast result.\nA stable estimate.', '\\begin{enumerate}\n\\item A fast result.\n\\item A stable estimate.\n\\end{enumerate}'],
  ['rename a list', '\\begin{enumerate}\n\\item A fast result.\n\\item A stable estimate.\n\\end{enumerate}', '\\begin{itemize}\n\\item A fast result.\n\\item A robust estimate.\n\\end{itemize}'],
  ['remove a nested list', '\\begin{quote}\n\\begin{itemize}\n\\item A fast result.\n\\end{itemize}\n\\end{quote}', 'A fast result.'],
]) it(`groups only the affected environment when edits ${label}`, () => {
  const old = `A small example.\n\n${oldBody}\n\nThe result is useful.\n`;
  const next = old.replace('small', 'short').replace(oldBody, newBody).replace('useful', 'practical');
  f.write(METHOD, old);
  const before = f.repo.snapshot(['paper']);
  f.write(METHOD, next);
  const units = diffUnits(f.repo, before, f.repo.snapshot(['paper']));
  expect(units).toHaveLength(3);
  for (let mask = 0; mask < 8; mask++) {
    const selected = units.filter((_, index) => mask & (1 << index));
    let expected = old;
    if (mask & 1) expected = expected.replace('small', 'short');
    if (mask & 2) expected = expected.replace(oldBody, newBody);
    if (mask & 4) expected = expected.replace('useful', 'practical');
    expect(applyUnits(Buffer.from(old), Buffer.from(next), selected)?.toString()).toBe(expected);
    expect(revertUnits(Buffer.from(old), Buffer.from(next), units.filter(unit => !selected.includes(unit)))?.toString()).toBe(expected);
  }
});

it("does not couple prose edits because of delimiters inside comments or literal examples", () => {
  const old = 'A small example.\n% \\begin{enumerate}\nA useful result.\n\\verb|\\end{enumerate}|\nA stable estimate.\n';
  const next = old.replace('small', 'short').replace('% \\begin{enumerate}', '% \\begin{itemize}').replace('useful', 'practical').replace('stable', 'robust');
  f.write(METHOD, old);
  const before = f.repo.snapshot(['paper']);
  f.write(METHOD, next);
  const units = diffUnits(f.repo, before, f.repo.snapshot(['paper']));
  expect(units).toHaveLength(4);
  expect(applyUnits(Buffer.from(old), Buffer.from(next), [units[2]])?.toString()).toBe(old.replace('useful', 'practical'));
});

it("does not attach a comment to another change on the same source line", async () => {
  const old = "The method is fast and the result is useful.\n";
  f.write(METHOD, old);
  const app = f.app(),
    task = app.tasks.create("history", "History", [], ["paper"]);
  f.edit(
    task,
    METHOD,
    old,
    old.replace("fast", "efficient").replace("useful", "practical"),
  );
  const first = fakeRound(app, task.name);
  await app.review.decide(task.name, {
    action: "comment",
    changes: ["c001"],
    id: "comment",
    round: first.number,
    body: "Try another word.",
  });
  f.edit(task, METHOD, "efficient", "quick");
  const next = fakeRound(app, task.name),
    history = app.review.history(task.name, next);
  expect(history.c001).toHaveLength(1);
  expect(history.c002).toBeUndefined();
});

it("accepts, rejects and undoes same-line edits without losing other decisions or user edits", async () => {
  const old =
    "The method is fast, the estimate is stable, and the result is useful.\n";
  f.write(METHOD, old);
  const app = f.app(),
    task = app.tasks.create("fine", "Fine diff", [], ["paper"]);
  f.edit(
    task,
    METHOD,
    old,
    old
      .replace("fast", "efficient")
      .replace("stable", "robust")
      .replace("useful", "practical"),
  );
  const round = fakeRound(app, task.name);
  const decide = (action: "accept" | "reject", change: string, id: string) =>
    app.review.decide(task.name, {
      action,
      changes: [change],
      id,
      round: round.number,
    });
  f.write(METHOD, old.replace("The method", "Our method"));
  await decide("accept", "c001", "first");
  await decide("accept", "c003", "third");
  expect(f.read(METHOD)).toBe(
    old
      .replace("The method", "Our method")
      .replace("fast", "efficient")
      .replace("useful", "practical"),
  );
  await decide("reject", "c002", "second");
  expect(f.read(METHOD, task.worktree)).toBe(
    old.replace("fast", "efficient").replace("useful", "practical"),
  );
  await app.review.undo(task.name, "second");
  expect(f.read(METHOD, task.worktree)).toContain("robust");
  await app.review.undo(task.name, "third");
  expect(f.read(METHOD)).toBe(
    old.replace("The method", "Our method").replace("fast", "efficient"),
  );
});

it("merges disjoint same-line edits but preserves real overlap conflicts", async () => {
  const b = Buffer.from;
  expect(
    await merge3Async(
      b("fast and useful"),
      b("slow and useful"),
      b("slow and practical"),
    ),
  ).toEqual([b("fast and practical"), false]);
  expect(
    (await merge3Async(b("fast result"), b("slow result"), b("quick result")))[1],
  ).toBe(true);
  expect(
    (await merge3Async(b("a new result"), b("a result"), b("a better result")))[1],
  ).toBe(true);
  expect(
    (
      await merge3Async(
        b(String.raw`\textbf{fast stable}`),
        b(String.raw`\textbf{slow stable}`),
        b(String.raw`\textbf{slow robust}`),
      )
    )[1],
  ).toBe(true);
});

it("keeps a rewritten sentence intact instead of splitting on stray common words or hyphens", () => {
  const old =
      "This concise mechanism lets local type inference use type information from\n" +
      "arguments in any order without backtracking,\n" +
      "resolving a fundamental\n" +
      "tradeoff between order-irrelevance and higher-order expressiveness that\n" +
      "has persisted since \\citet{pierce-2000-local-type-inference} introduced\n" +
      "local type inference more than 25 years ago.\n" +
      "Moreover, because inference\n",
    next =
      "This concise mechanism lets local type inference use type information from\n" +
      "arguments in any order without backtracking. While prior contextual LTI\n" +
      "calculi and languages such as Scala, Java, and TypeScript already handle\n" +
      "many higher-order calls through left-to-right propagation or syntactic\n" +
      "deferral of bare lambdas, inference closures provide a general\n" +
      "order-irrelevance guarantee within a local, matching-based calculus even\n" +
      "for compound argument expressions and curried calls. Moreover, because inference\n";
  const edits = textEdits(old, next);
  expect(edits).toHaveLength(1);
  expect(old.slice(edits[0][1], edits[0][2])).toContain("and higher-order");
  expect(old.slice(edits[0][1], edits[0][2])).toContain("local type inference");
  expect(next.slice(edits[0][3], edits[0][4])).toContain("and TypeScript");
  expect(next.slice(edits[0][3], edits[0][4])).toContain("within a local");
  expect(wordDiff(old, next).filter((part) => part.type === "del")).toHaveLength(1);
  expect(wordDiff(old, next).filter((part) => part.type === "ins")).toHaveLength(1);

  const hyphen = textEdits("that is order-irrelevant yet", "that is order-irrelevance yet");
  expect(hyphen).toHaveLength(1);
  expect("that is order-irrelevant yet".slice(hyphen[0][1], hyphen[0][2])).toBe("order-irrelevant");
  expect("that is order-irrelevance yet".slice(hyphen[0][3], hyphen[0][4])).toBe("order-irrelevance");

  // CRLF paragraph breaks must never be absorbed across separate paragraphs.
  const crlf = textEdits(
    "First alpha beta.\r\n\r\nSecond gamma delta.\r\n",
    "First one two.\r\n\r\nSecond three four.\r\n",
  );
  expect(crlf).toHaveLength(2);
});

it("merges adjacent same-line marks per unit without merging across different units", () => {
  const merged = mergeUnitMarks([
    { unit: "u1", kind: "added", rect: [10, 12, 40, 22] },
    // Taller word on the same line (smaller y0) after a lowercase word must still merge.
    { unit: "u1", kind: "added", rect: [44, 9, 80, 22] },
    { unit: "u2", kind: "added", rect: [84, 10, 120, 22] },
    { unit: "u1", kind: "added", rect: [10, 28, 50, 40] },
  ]);
  expect(merged).toEqual([
    { unit: "u1", kind: "added", rect: [10, 9, 80, 22] },
    { unit: "u1", kind: "added", rect: [10, 28, 50, 40] },
    { unit: "u2", kind: "added", rect: [84, 10, 120, 22] },
  ]);
});

it("drops coarse fallback marks that duplicate a more-specific sibling unit's span", () => {
  const resolved = resolveUnitMarks([
    // Fallback math unit inherited both its own mark and sibling u1's exact span.
    { unit: "math", kind: "removed", rect: [10, 10, 50, 22] },
    { unit: "math", kind: "removed", rect: [80, 10, 110, 22] },
    { unit: "u1", kind: "removed", rect: [10, 10, 50, 22] },
  ]);
  expect(resolved).toEqual([
    { unit: "math", kind: "removed", rect: [80, 10, 110, 22] },
    { unit: "u1", kind: "removed", rect: [10, 10, 50, 22] },
  ]);
});

it("consolidates heavily rewritten paragraphs instead of splitting on coincidental common words", () => {
  const old = [
    "The long-distance constraints discussed at the end of Chapter 3 require information",
    "from one part of an expression to remain available elsewhere. Global inference",
    "represents unknown types with unification variables. The same variable can occur",
    "in judgments for different parts of the expression. This chapter develops such an",
    "algorithm for a polymorphic language with bounded quantification.",
    "",
    "Bounded quantification is an extension of parametric polymorphism, where type",
    "variables can have subtyping bounds. Mainstream object-oriented programming",
    "languages such as Java, Scala, or TypeScript have polymorphic type systems with",
    "subtyping and bounded quantification. The canonical calculus is kernel F-sub.",
    "",
  ].join("\n");
  const next = [
    "The inference closures of Chapter 3 make local type inference order-irrelevant for",
    "hard-to-synthesize arguments in curried calls. Constraints spanning multiple sites",
    "lie beyond local inference. Global type inference addresses such constraints by",
    "representing unknown types with unification variables that can appear across",
    "judgments for different parts of an expression. This chapter develops a global",
    "type-inference algorithm for a polymorphic language with bounded quantification.",
    "",
    "Mainstream object-oriented languages such as Java, Scala, and TypeScript combine",
    "parametric polymorphism with subtyping and bounded quantification, whose decidable",
    "core is kernel F-sub. Making bounded polymorphism practical requires implicit type",
    "inference rather than writing explicit type applications everywhere.",
    "",
  ].join("\n");
  const edits = consolidateRewrites(old, next, textEdits(old, next));
  // Two rewritten paragraphs separated by a blank line collapse to 2 semantic units,
  // not dozens of word-level fragments around shared stopwords like "the", "of", "with".
  expect(edits).toHaveLength(2);
  expect(old.slice(edits[0][1], edits[0][2])).toContain("long-distance constraints");
  expect(next.slice(edits[0][3], edits[0][4])).toContain("inference closures");
  expect(old.slice(edits[1][1], edits[1][2])).toContain("Bounded quantification");
  expect(next.slice(edits[1][3], edits[1][4])).toContain("explicit type applications");

  // Never merge across unchanged display math, comments (including \\%), or blank lines.
  const displayOld = "Old alpha beta gamma.\n\\[ x = 1 \\]\nOld delta epsilon zeta.\n";
  const displayNext = "New one two three.\n\\[ x = 1 \\]\nNew four five six.\n";
  expect(consolidateRewrites(displayOld, displayNext, textEdits(displayOld, displayNext))).toHaveLength(2);

  const commentOld = "Old alpha beta gamma.\\\\% keep comment\nOld delta epsilon zeta.\n";
  const commentNext = "New one two three.\\\\% keep comment\nNew four five six.\n";
  expect(consolidateRewrites(commentOld, commentNext, textEdits(commentOld, commentNext))).toHaveLength(2);

  // Leading/trailing whitespace rewraps must not swallow intervening unchanged words.
  const wrapOld = "Lead alpha\nbeta unchanged middle words stay.\nOld gamma delta epsilon and old zeta eta theta.\n";
  const wrapNext = "Lead alpha beta\nunchanged middle words stay.\nNew one two three and new four five six.\n";
  const wrapEdits = consolidateRewrites(wrapOld, wrapNext, textEdits(wrapOld, wrapNext));
  expect(wrapEdits.every(([, i, j]) => !wrapOld.slice(i, j).includes("unchanged middle words stay"))).toBe(true);

  // Low-level textEdits stays fine-grained so 3-way mergeText merges disjoint same-paragraph edits cleanly.
  const base = "One alpha two beta three gamma four.\n";
  const ours = "One A two B three C four.\n";
  const theirs = "One alpha TWO beta three gamma four.\n";
  expect(mergeText(Buffer.from(ours), Buffer.from(base), Buffer.from(theirs))?.toString()).toBe(
    "One A TWO B three C four.\n",
  );
});
