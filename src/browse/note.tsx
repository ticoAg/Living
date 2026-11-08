import { Fragment, type ReactNode } from 'react';

// Photo notes are plain text: blank lines separate paragraphs, single newlines stay line breaks, bare
// http(s) URLs become links. Everything is emitted as React text nodes, so HTML in a note is shown
// literally (escaped) and can never execute.

// URL characters only (RFC 3986), so a link stops at the first CJK character or space
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
const TRAILING = /[.,;:!?'")\]]/;

/** Drop sentence punctuation from the end of a matched URL; keep ")" when the URL opens a "(". */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING.test(url[end - 1])) {
    if (url[end - 1] === ')') {
      const body = url.slice(0, end);
      const open = (body.match(/\(/g) ?? []).length;
      const close = (body.match(/\)/g) ?? []).length;
      if (open >= close) break;
    }
    end--;
  }
  return url.slice(0, end);
}

function autolink(line: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = trimUrl(m[0]);
    if (!url) continue;
    if (start > last) out.push(line.slice(last, start));
    out.push(
      <a key={`${keyBase}-${i++}`} href={url} className="bw-hydro" target="_blank" rel="noopener noreferrer nofollow ugc">
        {url}
      </a>
    );
    last = start + url.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function NoteText({ text, className }: { text: string; className?: string }) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim());
  if (!paragraphs.length) return null;
  return (
    <div className={className}>
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n');
        return (
          <p key={pi}>
            {lines.map((line, li) => (
              <Fragment key={li}>
                {autolink(line, `${pi}-${li}`)}
                {li < lines.length - 1 && <br />}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
