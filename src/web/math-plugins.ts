import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { PluggableList } from 'unified';

// Agents write mathematics as LaTeX: $…$, $$…$$, \(…\) and \[…\] (see normalizeMath).
// A formula KaTeX cannot read is shown as its source rather than failing the message.
export interface MathPlugins { remark: PluggableList; rehype: PluggableList }
export const math: MathPlugins = {
  remark: [[remarkMath, { singleDollarTextMath: true }]],
  rehype: [[rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false }]],
};
