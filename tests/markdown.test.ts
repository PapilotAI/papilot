import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, MarkdownView, hasMath, normalizeMath } from '../src/web/markdown.tsx';
import { math } from '../src/web/math-plugins.ts';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

test('Markdown renders blocks, nested styles and code without losing content', () => {
  const result = render('## Summary\n\nUpdated **two *important*** files in `main.tex`.\n\n3. One\n   - Nested _change_\n4. Two\n\n```tex\n\\section{A}\n```\n\n> Quoted\n\n---');
  assert.match(result, /<h4>Summary<\/h4>/);
  assert.match(result, /<strong>two <em>important<\/em><\/strong>/);
  assert.match(result, /<ol start="3">[\s\S]*<ul>[\s\S]*Nested <em>change<\/em>/);
  assert.match(result, /<code class="language-tex">\\section\{A\}/);
  assert.match(result, /<blockquote>[\s\S]*Quoted/);
  assert.match(result, /<hr\/>/);
});

test('Markdown supports tables, task lists, deletion and reference links', () => {
  const result = render('| File | Status |\n| --- | --- |\n| `main.tex` | **Done** |\n\n- [x] Finished\n- [ ] Next\n\n~~Old~~ [Docs][ref]\n\n[ref]: https://example.com/docs');
  assert.match(result, /class="markdown-table"><table>/);
  assert.match(result, /<td><strong>Done<\/strong><\/td>/);
  assert.match(result, /type="checkbox" disabled="" checked=""/);
  assert.match(result, /<del>Old<\/del>/);
  assert.match(result, /href="https:\/\/example.com\/docs"/);
});

test('local file references render compactly, including spaces and line numbers', () => {
  const result = render('已润色 [acknowledgments.tex](/Users/chen/thesis-tasks/p-123/main/frontmatter/acknowledgments.tex:26)。 [Other](<main/my file.tex:3>)');
  assert.match(result, /class="file-reference" title="\/Users\/chen\/thesis-tasks\/p-123\/main\/frontmatter\/acknowledgments.tex:26"/);
  assert.match(result, />acknowledgments.tex<\/button>/);
  assert.match(result, /title="main\/my%20file.tex:3"/);
  assert.doesNotMatch(result, /href="\/Users|\[acknowledgments/);
});

test('Markdown never executes HTML or unsafe URLs and preserves literal math', () => {
  const result = render('<img src=x onerror=alert(1)>\n\n[safe](https://example.com/a_(b)) [unsafe](javascript:alert(1)) [data](data:text/html,bad) [protocol](//evil.test)\n\n$a_t$ and file_name stay literal');
  assert.doesNotMatch(result, /<img|href="(?:javascript|data|\/\/)/);
  assert.match(result, /&lt;img/);
  assert.match(result, /href="https:\/\/example.com\/a_\(b\)"/);
  assert.match(result, /\$a_t\$ and file_name stay literal/);
});

test('mathematics is typeset with KaTeX in every LaTeX delimiter, but never inside code', () => {
  const text = 'Inline $O(n \\log n)$ and \\(\\alpha_t\\).\n\n\\[\n\\sum_{i=1}^n x_i\n\\]\n\n$$E = mc^2$$\n\n`$HOME` stays code.\n\n```latex\n\\(kept\\)\n```';
  const result = renderToStaticMarkup(createElement(MarkdownView, { text, math }));
  assert.equal((result.match(/class="katex"/g) || []).length, 4);
  assert.match(result, /class="katex-display"/);
  assert.match(result, /<code>\$HOME<\/code>/);
  assert.match(result, /\\\(kept\\\)/);
  assert.equal(hasMath('Use `$x$` in code'), false);
  assert.equal(hasMath('Cost of $x$'), true);
  assert.equal(normalizeMath('a \\(x\\) b `\\(y\\)`'), 'a $x$ b `\\(y\\)`');
});

test('a formula KaTeX cannot read keeps the rest of the message', () => {
  const result = renderToStaticMarkup(createElement(MarkdownView, { text: 'Bad $\\frac{1}{$ but **bold** stays.', math }));
  assert.match(result, /<strong>bold<\/strong>/);
});

test('LaTeX delimiters keep lists, quotes and tables intact, and a line break is not math', () => {
  const html = (text: string) => renderToStaticMarkup(createElement(MarkdownView, { text, math }));
  assert.match(html('- Item: \\[x=1\\] and more\n- Next'), /<ul>\n<li>Item: <span class="katex">[\s\S]*and more<\/li>\n<li>Next<\/li>\n<\/ul>/);
  assert.match(html('> quote \\[x\\] here'), /<blockquote>\n<p>quote <span class="katex">[\s\S]*here<\/p>\n<\/blockquote>/);
  assert.match(html('| a | b |\n| --- | --- |\n| \\[x\\] | y |'), /<td><span class="katex">[\s\S]*<\/td><td>y<\/td>/);
  assert.match(html('1. First\n   \\[\n   a+b\n   \\]\n2. Second'), /^<ol>\n<li>First\n<span class="katex-display">[\s\S]*<\/li>\n<li>Second<\/li>\n<\/ol>$/);
  assert.doesNotMatch(html('Use \\\\[4pt] between rows, then \\] ends nothing.'), /katex/);
});

test('prices stay literal while formulas beside them are typeset', () => {
  const html = (text: string) => renderToStaticMarkup(createElement(MarkdownView, { text, math }));
  const prices = html('It costs $5 and the tax is $2.');
  assert.doesNotMatch(prices, /katex/);
  assert.match(prices, /It costs \$5 and the tax is \$2\./);
  const mixed = html('Between $5 and $10 per month, where $x$ is the count and $2x$ the total.');
  assert.equal((mixed.match(/class="katex"/g) || []).length, 2);
  assert.match(mixed, /Between \$5 and \$10 per month/);
});
