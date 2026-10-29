// What the Git panel leaves out of a commit unless chosen, and offers to add
// to .gitignore: LaTeX's build output, minted's cache and macOS folder files.
// Each file maps to the pattern that ignores every file of its kind.
const BUILD = /\.(aux|log|out|toc|lof|lot|lol|fls|fdb_latexmk|synctex(?:\.gz)?|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi|idx|ilg|ind|glo|gls|glg|ist|thm|loa)$/;
export function ignorePattern(file: string): string | null {
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (name === '.DS_Store') return '.DS_Store';
  if (/(?:^|\/)_minted[^/]*\//.test(file)) return '_minted*/';
  const build = BUILD.exec(name);
  return build ? `*.${build[1]}` : null;
}

// An agent's reply as a commit message: without a code fence, a label or
// quotes, a subject without a final period, and any body after a blank line.
export function commitMessageFrom(reply: string) {
  const text = reply.trim().replace(/^```[\w-]*\n([\s\S]*?)\n```$/, '$1').trim()
    .replace(/^(?:\*\*)?commit message(?:\*\*)?\s*:\s*(?:\*\*)?[ \t]*/i, '');
  const lines = text.split('\n'), first = lines.findIndex(line => line.trim());
  if (first < 0) return '';
  const subject = lines[first].trim().replace(/^#+\s+/, '').replace(/^\*\*(.+)\*\*$/, '$1').replace(/^(["'`])(.+)\1$/, '$2').replace(/\.$/, '').trim();
  const body = lines.slice(first + 1).join('\n').trim();
  return body ? `${subject}\n\n${body}` : subject;
}
