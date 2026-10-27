import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/web/markdown.tsx';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

test('Codex Markdown renders common blocks and inline styles', () => {
  assert.equal(render('Updated **two** files in `main.tex`.\n\n- First\n- Second *change*'), '<p>Updated <strong>two</strong> files in <code>main.tex</code>.</p><ul><li>First</li><li>Second <em>change</em></li></ul>');
  assert.equal(render('## Summary\n1. One\n2. Two'), '<h4>Summary</h4><ol start="1"><li>One</li><li>Two</li></ol>');
  assert.equal(render('```tex\n\\section{A}\n```'), '<pre><code>\\section{A}</code></pre>');
  assert.equal(render('> Quoted\n\n---'), '<blockquote><p>Quoted</p></blockquote><hr/>');
});

test('Codex Markdown never renders HTML or non-web links', () => {
  assert.equal(render('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(render('[safe](https://example.com) [unsafe](javascript:alert(1))'), '<p><a href="https://example.com" target="_blank" rel="noreferrer">safe</a> [unsafe](javascript:alert(1))</p>');
  assert.equal(render('$a_t$ and file_name stay literal'), '<p>$a_t$ and file_name stay literal</p>');
});
