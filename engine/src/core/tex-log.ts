export const LOG_WRAP = 79;
const utf8Length = (lead: number) => lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;

// TeX breaks every log line at 79 columns, even inside file names. pdfTeX
// counts bytes and may cut a character in two, LuaTeX breaks early rather than
// cut one, and XeTeX counts characters. Rejoin the pieces on the raw bytes,
// before decoding splits a character for good.
export function unwrapLog(input: string | Buffer) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input, raw: Buffer[] = [];
  for (let start = 0, i = 0; i <= bytes.length; i++) {
    if (i < bytes.length && bytes[i] !== 0x0a) continue;
    raw.push(bytes.subarray(start, i > start && bytes[i - 1] === 0x0d ? i - 1 : i)); start = i + 1;
  }
  const out: string[] = [];
  let parts: Buffer[] = [];
  for (let k = 0; k < raw.length; k++) {
    const line = raw[k], next = raw[k + 1], text = line.toString('utf8');
    parts.push(line);
    const wrapped = next !== undefined && (line.length === LOG_WRAP || [...text].length === LOG_WRAP
      || (line.length < LOG_WRAP && next.length > 0 && next[0] >= 0xc0 && line.length + utf8Length(next[0]) > LOG_WRAP)
      // Text decoded earlier keeps each half of a cut character as U+FFFD.
      || (text.endsWith('�') && next.toString('utf8').startsWith('�')));
    if (!wrapped) { out.push(parts.length === 1 ? text : Buffer.concat(parts).toString('utf8')); parts = []; }
  }
  if (parts.length) out.push(Buffer.concat(parts).toString('utf8'));
  return out;
}
