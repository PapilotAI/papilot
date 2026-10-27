import type { ReactNode } from 'react';

// Codex replies use a small Markdown subset. Build React elements directly so
// message text is never interpreted as HTML, and only http(s) links are live.
const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(\S(?:[^*]*\S)?)\*\*|__(\S(?:[^_]*\S)?)__|\*(\S(?:[^*]*\S)?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function inline(text: string): ReactNode[] {
  const pattern = new RegExp(INLINE.source, 'g'), out: ReactNode[] = [];
  let last = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = out.length;
    if (match[1]) out.push(<code key={key}>{match[2]}</code>);
    else if (match[3] || match[4]) out.push(<strong key={key}>{inline(match[3] || match[4])}</strong>);
    else if (match[5]) out.push(<em key={key}>{inline(match[5])}</em>);
    else out.push(<a key={key} href={match[7]} target="_blank" rel="noreferrer">{match[6]}</a>);
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i], key = blocks.length;
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      i++; blocks.push(<pre key={key}><code>{body.join('\n')}</code></pre>); continue;
    }
    if (!line.trim()) { i++; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { const Tag = `h${Math.min(heading[1].length + 2, 6)}` as 'h3'; blocks.push(<Tag key={key}>{inline(heading[2])}</Tag>); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={key}/>); i++; continue; }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key}><Markdown text={quote.join('\n')}/></blockquote>); continue;
    }
    const first = LIST.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2]), items: string[] = [];
      for (; i < lines.length; i++) {
        const item = LIST.exec(lines[i]);
        if (item && /\d/.test(item[2]) === ordered) items.push(item[3]);
        else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) items[items.length - 1] += '\n' + lines[i].trim();
        else break;
      }
      const children = items.map((item, index) => <li key={index}>{inline(item)}</li>);
      blocks.push(ordered ? <ol key={key} start={Number.parseInt(first[2], 10) || 1}>{children}</ol> : <ul key={key}>{children}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    do paragraph.push(lines[i++]);
    while (i < lines.length && lines[i].trim() && !LIST.exec(lines[i]) && !/^(#{1,6}\s|\s*(```|~~~|>))/.test(lines[i]));
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return <>{blocks}</>;
}
