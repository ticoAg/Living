import { Fragment, type ReactNode } from 'react';

// Plain text → paragraphs. Nothing is ever injected as HTML: React escapes every text node, blank
// lines split paragraphs, single line breaks stay line breaks, and http(s) addresses become links.

// An address runs until whitespace or a CJK quote / bracket / full stop.
const URL_RE = /https?:\/\/[^\s<>"'`，。；：！？、“”‘’（）【】《》「」『』]+/gi;

const count = (s: string, ch: string) => s.split(ch).length - 1;

/** Drop trailing punctuation (and unbalanced closing brackets) that belongs to the sentence, not the address. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (last && '.,;:!?*~'.includes(last)) url = url.slice(0, -1);
    else if (last === ')' && count(url, '(') < count(url, ')')) url = url.slice(0, -1);
    else if (last === ']' && count(url, '[') < count(url, ']')) url = url.slice(0, -1);
    else return url;
  }
}

function renderLine(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of line.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (url.length < 10) continue;
    const start = m.index ?? 0;
    if (start > at) out.push(line.slice(at, start));
    out.push(
      <a key={start} href={url} target="_blank" rel="noopener noreferrer nofollow">
        {url}
      </a>
    );
    at = start + url.length;
  }
  if (at < line.length) out.push(line.slice(at));
  return out;
}

/** Paragraphs of lines, from raw text with any line-ending style. */
export function toParagraphs(text: string | null | undefined): string[][] {
  if (!text) return [];
  return (
    text
      .replace(/\r\n?/g, '\n')
      // drop blank lines around the text, but keep a first line's own indentation (全角空格)
      .replace(/^\s*\n/, '')
      .replace(/\s+$/, '')
      .split(/\n\s*\n/)
      .map((p) => p.split('\n').map((l) => l.trimEnd()))
      .filter((lines) => lines.some((l) => l.trim()))
  );
}

export default function Prose({ text, className }: { text: string | null | undefined; className?: string }) {
  const paras = toParagraphs(text);
  if (!paras.length) return null;
  return (
    <div className={`th-prose${className ? ` ${className}` : ''}`}>
      {paras.map((lines, i) => (
        <p key={i}>
          {lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {renderLine(line)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
