import { it, expect } from "vitest";
import { buildDate } from "../../src/core/build.ts";
import { attribute } from "../../src/core/publish.ts";
import {
  compareDocuments,
  differences,
  furniture,
  type Words,
} from "../../src/render/effects.ts";
import type { Build } from "../../src/render/locate.ts";
import { mupdf, PdfDocument } from "../../src/render/pdf.ts";
import type { Rect, Unit } from "../../src/types.ts";

// One printed line of words.
const words = (text: string) => {
  const tokens = text
    .split(" ")
    .map((t, i) => ({ text: t, start: i, end: i + 1 }));
  return { glyphs: [], tokens, lines: [[0, tokens.length]] } as Words;
};

it.each([
  {
    name: "a complete rewrite",
    before: "alpha beta gamma delta",
    after: "one two three four",
    expected: [{ old: [0, 4], new: [0, 4] }],
  },
  {
    name: "edits on both sides of an equal passage",
    before: "old a b c d e f g h i j tail",
    after: "new a b c d e f g h i j end",
    expected: [
      { old: [0, 1], new: [0, 1] },
      { old: [11, 12], new: [11, 12] },
    ],
  },
])(
  "finds every change in $name",
  ({ before, after, expected }) => {
    expect(differences(words(before), words(after))).toEqual(expected);
  },
);

it("treats a run that moves elsewhere as moved, both where it left and where it arrived", () => {
  // Either run can be the one that moves; both are long enough to tell.
  const caption = "Figure 2 shows the architecture of the whole system",
    text = "gamma delta epsilon zeta eta theta";
  expect(
    differences(
      words(`alpha ${caption} ${text} omega`),
      words(`alpha ${text} ${caption} omega`),
    ),
  ).toEqual([]);
  // Numbers shifted by one are changes, however often each number recurs.
  expect(
    differences(
      words("see ( 3 ) and ( 4 ) here"),
      words("see ( 4 ) and ( 5 ) here"),
    ),
  ).toHaveLength(2);
});

it("marks only the words an edit changed inside a moved run", () => {
  // The sentence moves past a longer passage, which therefore stays put, and
  // one of its words changes on the way.
  const moved =
      "the closure keeps its environment until an argument value arrives",
    edited =
      "the closure keeps its environment until a type annotation arrives",
    passage =
      "beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau";
  const a = words(`alpha ${moved} ${passage} omega`),
    b = words(`alpha ${passage} ${edited} omega`),
    changes = differences(a, b)!,
    text = (w: Words, [i, j]: [number, number]) =>
      w.tokens
        .slice(i, j)
        .map((t) => t.text)
        .join(" ");
  expect(
    changes
      .map((c) => text(a, c.old))
      .filter(Boolean)
      .join(" "),
  ).toBe("an argument value");
  expect(
    changes
      .map((c) => text(b, c.new))
      .filter(Boolean)
      .join(" "),
  ).toBe("a type annotation");
});
it("leaves out page numbers and running heads but keeps text at the top of a page", () => {
  const line = (text: string, top: number): { text: string; rect: Rect } => ({
    text,
    rect: [100, top, 300, top + 10],
  });
  const pages = [
    [line("3 THE MODEL", 40), line("A heading at the top", 80), line("3", 700)],
    [line("4 THE MODEL", 40), line("Another first line", 80), line("4", 700)],
    [line("Only text, then its number", 80), line("5", 700)],
    // Section numbers that open pages are text, though they look alike.
    [line("1.3", 80), line("Heading", 80), line("6", 700)],
    [line("2.7", 80), line("Another heading", 80), line("7", 700)],
  ];
  const document = {
    length: pages.length,
    page: (n: number) => ({ lines: pages[n], label: String(n + 3), lineRulers: new Set() }),
  } as unknown as Parameters<typeof furniture>[0];
  expect(furniture(document)).toEqual([
    [pages[0][0].rect, pages[0][2].rect],
    [pages[1][0].rect, pages[1][2].rect],
    [pages[2][1].rect],
    [pages[3][2].rect],
    [pages[4][2].rect],
  ]);
});

it("keeps changed numbers in a regular series outside the prose", () => {
  function page(first: number) {
    const raw = new mupdf.PDFDocument();
    const font = new mupdf.Font("Helvetica");
    const ref = raw.addSimpleFont(font);
    const rows = Array.from({ length: 8 }, (_, i) => {
      const y = 500 - 18 * i;
      return `BT /F 6 Tf 30 ${y} Td (${first + i}) Tj ET\n` +
        `BT /F 12 Tf 100 ${y} Td (A fixed reading of the scientific sample) Tj ET`;
    });
    const page = raw.addPage([0, 0, 600, 600], 0, { Font: { F: ref } }, rows.join("\n"));
    raw.insertPage(-1, page);
    const buffer = raw.saveToBuffer("");
    const document = new PdfDocument(buffer.asUint8Array());
    buffer.destroy();
    page.destroy();
    ref.destroy();
    font.destroy();
    raw.destroy();
    return document;
  }
  const old = page(1);
  const next = page(21);
  try {
    expect(old.page(0).lineRulers.size).toBe(8);
    expect(next.page(0).lineRulers.size).toBe(8);
    const comparison = compareDocuments({ document: old } as Build, { document: next } as Build);
    const changed = (side: "old" | "new") => comparison.changes.flatMap(
      (effect) => comparison[side].tokens.slice(...effect[side]).map((token) => token.text),
    );
    expect(changed("old")).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(changed("new")).toEqual(["21", "22", "23", "24", "25", "26", "27", "28"]);
  } finally {
    old.close();
    next.close();
  }
});

const unit = (id: string) => ({ id }) as Unit;

it("finds the edit behind each change by compiling halves, and lists edits needed together", async () => {
  const units = ["c001", "c002", "c003", "c004"].map(unit);
  // Change 0 comes from c003 alone; change 1 needs c001 and c004 together.
  const shown = async (group: Unit[]) => {
    const ids = group.map((u) => u.id);
    return [ids.includes("c003"), ids.includes("c001") && ids.includes("c004")];
  };
  expect(
    await attribute(units, [{ within: [] }, { within: [] }], [], shown),
  ).toEqual([["c003"], ["c001", "c002", "c003", "c004"]]);
});

it("resolves causes beyond sixteen silent edits without an arbitrary build cutoff", async () => {
  const units = Array.from({ length: 21 }, (_, i) =>
    unit(`c${String(i + 1).padStart(3, "0")}`),
  );
  let builds = 0;
  const causes = await attribute(
    units,
    [{ within: [] }],
    units.slice(0, 20).map((u) => u.id),
    async (group) => {
      builds++;
      return [group.some((u) => u.id === "c021")];
    },
  );
  expect(builds).toBeGreaterThan(16);
  expect(causes[0]).toEqual(["c021"]);
});

it("keeps individually ineffective edits available for joint attribution", async () => {
  const units = ["gate", "value"].map(unit);
  expect(
    await attribute(
      units,
      [{ within: [] }],
      ["gate", "value"],
      async (group) => [
        group.some((u) => u.id === "gate") &&
          group.some((u) => u.id === "value"),
      ],
    ),
  ).toEqual([["gate", "value"]]);
});
it.each([{ within: [] }, { within: ["A"] }])(
  "finds every independent cause even when another edit already explains or shows the effect ($within)",
  async ({ within }) => {
    const units = ["A", "B"].map(unit);
    expect(
      await attribute(units, [{ within }], ["A"], async (group) => [
        group.some((u) => u.id === "A" || u.id === "B"),
      ]),
    ).toEqual([["A", "B"]]);
  },
);

it.each([1, 2, 3, 4])(
  "recognizes unchanged %i-word blocks inside compound moves",
  (length) => {
    const blocks = Array.from({ length: 5 }, (_, block) =>
      Array.from(
        { length },
        (_, word) => `block${block}word${word}withenoughletters`,
      ),
    );
    function* permutations(list: number[]): Generator<number[]> {
      if (!list.length) {
        yield [];
        return;
      }
      for (const first of list)
        for (const rest of permutations(list.filter((i) => i !== first)))
          yield [first, ...rest];
    }
    for (const order of permutations([0, 1, 2, 3, 4]))
      expect(
        differences(
          words(blocks.flat().join(" ")),
          words(order.flatMap((i) => blocks[i]).join(" ")),
        ),
      ).toEqual([]);
  },
);

it("retains short equal fragments on both sides of an edit inside a moved sentence", () => {
  const anchor =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo",
    a = words(`the cat sat and ate our red ham ${anchor}`),
    b = words(`${anchor} the cat sat and ate his red ham`);
  expect(
    differences(a, b).flatMap((e) =>
      a.tokens.slice(...e.old).map((t) => t.text),
    ),
  ).toEqual(["our"]);
  expect(
    differences(a, b).flatMap((e) =>
      b.tokens.slice(...e.new).map((t) => t.text),
    ),
  ).toEqual(["his"]);
});

it("gives every build of a day the date of that day", () => {
  const morning = new Date(2026, 9, 30, 0, 5),
    night = new Date(2026, 9, 30, 23, 55),
    date = buildDate(morning, {});
  expect(buildDate(night, {})).toEqual(date);
  expect(new Date(Number(date.SOURCE_DATE_EPOCH) * 1000).toISOString()).toBe(
    "2026-10-30T12:00:00.000Z",
  );
  expect(date.FORCE_SOURCE_DATE).toBe("1");
  expect(buildDate(morning, { SOURCE_DATE_EPOCH: "42" })).toEqual({
    SOURCE_DATE_EPOCH: "42",
  });
});

it("absorbs stray coincidental words inside a rewritten sentence and keeps hyphenated words whole", () => {
  const beforeAnchor = "This concise mechanism lets local type inference use type information from arguments in any order without backtracking",
    afterAnchor = "Moreover, because inference closures build on local matching, they retain support for higher-rank polymorphism.",
    a = words(
      `${beforeAnchor}, resolving a fundamental tradeoff between order-irrelevance and higher-order expressiveness that has persisted since Pierce and Turner introduced local type inference more than 25 years ago. ${afterAnchor}`,
    ),
    b = words(
      `${beforeAnchor}. While prior contextual LTI calculi and languages such as Scala, Java, and TypeScript already handle many higher-order calls through left-to-right propagation or syntactic deferral of bare lambdas, inference closures provide a general order-irrelevance guarantee within a local, matching-based calculus even for compound argument expressions and curried calls. ${afterAnchor}`,
    );
  const oldChanged = differences(a, b)
      .flatMap((e) => a.tokens.slice(...e.old).map((t) => t.text))
      .join(" "),
    newChanged = differences(a, b)
      .flatMap((e) => b.tokens.slice(...e.new).map((t) => t.text))
      .join(" ");
  expect(oldChanged).toContain("and higher-order");
  expect(oldChanged).toContain("local type inference");
  expect(newChanged).toContain("and TypeScript");
  expect(newChanged).toContain("many higher-order");
  expect(newChanged).toContain("within a local");

  const c = words("To our knowledge, we present the first local type inference that is order-irrelevant yet still accepts common higher-order programs."),
    d = words("To our knowledge, this is the first local type inference that guarantees order-irrelevance for arbitrary higher-order programs."),
    oldHyphen = differences(c, d).flatMap((e) => c.tokens.slice(...e.old).map((t) => t.text)),
    newHyphen = differences(c, d).flatMap((e) => d.tokens.slice(...e.new).map((t) => t.text));
  expect(oldHyphen.join(" ")).toContain("order-irrelevant");
  expect(newHyphen.join(" ")).toContain("order-irrelevance");
});
