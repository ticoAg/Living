// Entries (记录) are written in a small Markdown: a subset of CommonMark plus a few GitHub additions. The
// parser turns the text into a plain tree that Markdown.tsx renders as React elements and text nodes, so
// nothing is ever injected as HTML: HTML in an entry is shown literally, like any other text.
//
// Blocks: # headings, paragraphs (a single line break stays a line break, as in GitHub comments), > quotes,
// - and 1. lists with [ ] tasks, ``` and ~~~ code, and --- breaks. Not supported, so they stay text: setext
// headings, indented code, tables, footnotes, HTML, entities and reference links.
// Inline: \ escapes, `code`, *em* and _em_, **strong**, ~~del~~, [links](url), <autolinks> and bare http(s)
// addresses. ![images](url) become links to the image: an entry never loads a remote image (no tracking pixels).
// Links go only to http(s), mailto and paths on this site; anything else shows just its label.
// Hostile input cannot hang it: no regex can backtrack badly, emphasis is matched in linear time, and quotes,
// lists and emphasis nest at most MAX_DEPTH deep (deeper markers stay text).

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

// Every href has passed `safeHref`: http(s) and mailto links are external, a path on this site is not.
// An image is shown as a link to it, its `alt` falling back to the address.
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'break' }
  | { type: 'em' | 'strong' | 'del'; children: Inline[] }
  | { type: 'link'; href: string; external: boolean; children: Inline[] }
  | { type: 'image'; href: string; external: boolean; alt: string };

export interface ListItem {
  /** null for an ordinary item, else whether the task is done */
  checked: boolean | null;
  children: Block[];
}

// `level` is the Markdown level (# is 1); the renderer shifts it, since the page's <h1> is the entry title.
// A tight list's items show their paragraphs without <p>.
export type Block =
  | { type: 'heading'; level: HeadingLevel; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'hr' };

/** Quotes and lists nest at most this deep, and so does emphasis; deeper markers stay text. */
const MAX_DEPTH = 12;

export function parseMarkdown(src: string): Block[] {
  if (!src) return [];
  const lines = src
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replaceAll('\0', '\uFFFD')
    .split('\n');
  return parseBlocks(lines, 0).blocks;
}

const isBlank = (line: string) => !line.trim();
const unindent = (line: string) => line.replace(/^[ \t]+/, '');

/** Leading whitespace in columns; a tab counts as 4. */
function indentOf(line: string): number {
  let col = 0;
  for (const ch of line) {
    if (ch === ' ') col++;
    else if (ch === '\t') col += 4;
    else break;
  }
  return col;
}

/** The line without its first `cols` columns of indentation (fewer if it has fewer); a tab cut in half leaves spaces. */
function dedent(line: string, cols: number): string {
  let col = 0;
  let k = 0;
  while (col < cols && (line[k] === ' ' || line[k] === '\t')) col += line[k++] === '\t' ? 4 : 1;
  return (col > cols ? ' '.repeat(col - cols) : '') + line.slice(k);
}

/** Blocks from lines; `gap` tells a list item whether a blank line separates two of its blocks (a loose list). */
function parseBlocks(lines: string[], depth: number): { blocks: Block[]; gap: boolean } {
  const blocks: Block[] = [];
  let gap = false;
  let blank = false;
  const add = (block: Block | null) => {
    if (!block) return;
    if (blank && blocks.length) gap = true;
    blank = false;
    blocks.push(block);
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      blank = true;
      i++;
      continue;
    }
    const fence = openFence(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !closesFence(lines[i], fence); i++) body.push(dedent(lines[i], fence.indent));
      // an unclosed fence runs to the end of its container
      add({ type: 'code', lang: fence.lang, text: body.join('\n') });
      i++;
      continue;
    }
    const head = heading(line);
    if (head) {
      const children = inline(head.text);
      add(children.length ? { type: 'heading', level: head.level, children } : null);
      i++;
      continue;
    }
    if (isBreak(line)) {
      add({ type: 'hr' });
      i++;
      continue;
    }
    if (depth < MAX_DEPTH && QUOTE.test(line)) {
      // no lazy continuation: the quote ends at the first line without >
      const body: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) body.push(lines[i].replace(QUOTE, ''));
      add({ type: 'quote', children: parseBlocks(body, depth + 1).blocks });
      continue;
    }
    const marker = depth < MAX_DEPTH ? listMarker(line) : null;
    if (marker) {
      const list = parseList(lines, i, marker, depth);
      add(list.block);
      i = list.end;
      continue;
    }
    // a paragraph; indentation is dropped (there is no indented code), but not 全角 spaces, which indent Chinese text
    const start = i++;
    while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines[i], depth)) i++;
    const children = inline(
      lines
        .slice(start, i)
        .map((l) => unindent(l).trimEnd())
        .join('\n')
    );
    add(children.length ? { type: 'paragraph', children } : null);
  }
  return { blocks, gap };
}

/** Whether a line ends the paragraph above it. There are no setext headings: --- under text is a break. */
function interrupts(line: string, depth: number): boolean {
  if (openFence(line) || heading(line) || isBreak(line)) return true;
  if (depth >= MAX_DEPTH) return false;
  if (QUOTE.test(line)) return true;
  // as in CommonMark, an empty item or a number other than 1 does not start a list mid-paragraph (2024. 年 stays text)
  const m = listMarker(line);
  return !!m && !!m.rest && (!m.ordered || m.start === 1);
}

const QUOTE = /^[ \t]*> ?/;

/** --- or *** or ___ (spaces allowed in between), and nothing else on the line. */
const isBreak = (line: string) => /^([-*_])\1{2,}$/.test(line.replace(/[ \t]+/g, ''));

function heading(line: string): { level: HeadingLevel; text: string } | null {
  const body = unindent(line);
  let level = 0;
  while (level < 7 && body[level] === '#') level++;
  // #tag is text: the #s need a space (or the end of the line) after them
  const after = body[level];
  if (!level || level > 6 || (after !== undefined && after !== ' ' && after !== '\t')) return null;
  let text = body.slice(level).trim();
  // an optional closing run of #s, after a space: `## 标题 ##`
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  if (!end) text = '';
  else if (end < text.length && (text[end - 1] === ' ' || text[end - 1] === '\t')) text = text.slice(0, end).trimEnd();
  return { level: level as HeadingLevel, text };
}

interface Fence {
  ch: string;
  len: number;
  /** the opening fence's indentation, removed from the code lines too */
  indent: number;
  lang: string;
}

function openFence(line: string): Fence | null {
  const body = unindent(line);
  const ch = body[0];
  if (ch !== '`' && ch !== '~') return null;
  let len = 1;
  while (body[len] === ch) len++;
  const info = body.slice(len).trim();
  // ```a``` at the start of a line is inline code, not a fence
  if (len < 3 || (ch === '`' && info.includes('`'))) return null;
  const lang = (/^\S*/.exec(info)?.[0] ?? '').replace(/[^\w+-]/g, '').slice(0, 20);
  return { ch, len, indent: indentOf(line), lang };
}

function closesFence(line: string, fence: Fence): boolean {
  const body = unindent(line);
  let len = 0;
  while (body[len] === fence.ch) len++;
  return len >= fence.len && isBlank(body.slice(len));
}

interface Marker {
  ordered: boolean;
  start: number;
  /** columns before the marker */
  indent: number;
  /** the column the item's text starts at: continuation lines lose up to this much indentation */
  content: number;
  /** the rest of the first line */
  rest: string;
}

const MARKER = /^([ \t]*)([-*+]|(\d{1,9})[.)])([ \t]*)/;
const TASK = /^\[([ xX])\](?:[ \t]+|$)/;

function listMarker(line: string): Marker | null {
  const m = MARKER.exec(line);
  if (!m) return null;
  const [all, lead, mark, digits, space] = m;
  const rest = line.slice(all.length);
  // the marker needs a space after it, or the end of the line: -foo and 1.5 are text
  if (!space && rest) return null;
  const indent = indentOf(lead);
  const width = indentOf(space);
  return {
    ordered: digits !== undefined,
    start: digits === undefined ? 1 : Number(digits),
    indent,
    content: indent + mark.length + (rest && width <= 4 ? width : 1),
    rest
  };
}

// An item owns the lines after it that are indented at least two columns past its marker (blank lines in
// between included), whatever the marker's width, so `1.` takes a child list indented by two or by three. Each
// loses up to the item's content column of indentation. There is no lazy continuation: the first line indented
// less ends the item, and the list unless it is the next item. Bullets and numbers do not mix in one list.
function parseList(lines: string[], i: number, first: Marker, depth: number): { block: Block; end: number } {
  const items: ListItem[] = [];
  let tight = true;
  for (let marker = first; ;) {
    const body = [marker.rest];
    let k = i + 1;
    for (; k < lines.length; k++) {
      const line = lines[k];
      if (isBlank(line)) body.push('');
      else if (indentOf(line) >= marker.indent + 2) body.push(dedent(line, marker.content));
      else break;
    }
    // blank lines at the end separate this item from what follows
    let trailing = 0;
    while (body.length > 1 && body[body.length - 1] === '') {
      body.pop();
      trailing++;
    }
    const task = TASK.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    const inner = parseBlocks(body, depth + 1);
    if (inner.gap) tight = false;
    items.push({ checked: task ? task[1] !== ' ' : null, children: inner.blocks });
    const next = k < lines.length && !isBreak(lines[k]) ? listMarker(lines[k]) : null;
    if (!next || next.ordered !== first.ordered) {
      return { block: { type: 'list', ordered: first.ordered, start: first.start, tight, items }, end: k - trailing };
    }
    // a blank line between two items makes the whole list loose
    if (trailing) tight = false;
    marker = next;
    i = k;
  }
}

/** Inline content without line breaks at either end (a line that renders as nothing would leave one). */
function inline(src: string): Inline[] {
  const nodes = parseInline(src);
  let from = 0;
  let to = nodes.length;
  while (from < to && nodes[from].type === 'break') from++;
  while (to > from && nodes[to - 1].type === 'break') to--;
  return from || to < nodes.length ? nodes.slice(from, to) : nodes;
}

type Kind = 'em' | 'strong' | 'del';

/** A run of * _ or ~~ that may open or close emphasis. */
interface Delim {
  t: 'delim';
  ch: string;
  /** characters not matched (yet); they stay text */
  n: number;
  orig: number;
  open: boolean;
  close: boolean;
  /** what the run closes and opens, innermost first */
  closes: Kind[];
  opens: Kind[];
}

type Token =
  | { t: 'text'; s: string }
  | { t: 'node'; node: Inline }
  // a bare address: a link, unless it turns out to be inside a link label
  | { t: 'url'; url: string }
  | { t: 'bracket'; image: boolean }
  | Delim;

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const isEscapable = (ch: string | undefined) => ch !== undefined && ESCAPABLE.includes(ch);
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);
const text = (s: string): Inline => ({ type: 'text', text: s });

// One pass left to right. Code spans, autolinks and bare addresses are read whole; [ and ] are paired as they
// come, CommonMark style, so a label's emphasis cannot leak out of it; emphasis is matched last (`build`).
function parseInline(src: string): Inline[] {
  const tokens: Token[] = [];
  // indices in `tokens` of the [ and ![ still waiting for their ]
  const brackets: number[] = [];
  // a [ below this point in `brackets` is inside a link that has formed, and links do not nest
  let floor = 0;
  let closingRun: ((len: number, from: number) => number) | null = null;
  let buf = '';
  const flush = () => {
    if (buf) tokens.push({ t: 'text', s: buf });
    buf = '';
  };
  const push = (token: Token) => {
    flush();
    tokens.push(token);
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    switch (c) {
      case '\\': {
        const next = src[i + 1];
        // the line break is a <br> anyway; a backslash at the end of a line just must not show
        if (next === '\n' || isEscapable(next)) {
          if (next === '\n') push({ t: 'node', node: { type: 'break' } });
          else buf += next;
          i += 2;
          continue;
        }
        break;
      }
      case '\n':
        push({ t: 'node', node: { type: 'break' } });
        i++;
        continue;
      case '`': {
        let j = i + 1;
        while (src[j] === '`') j++;
        closingRun ??= backtickRuns(src);
        const end = closingRun(j - i, j);
        if (end < 0) buf += src.slice(i, j);
        else push({ t: 'node', node: { type: 'code', text: codeText(src.slice(j, end)) } });
        i = end < 0 ? j : end + (j - i);
        continue;
      }
      case '*':
      case '_':
      case '~': {
        let j = i + 1;
        while (src[j] === c) j++;
        const before = src[i - 1];
        const after = src[j];
        // simpler than CommonMark's flanking rules, and kind to CJK text (这是**重点**内容): an opener needs text
        // after it and a closer text before it, and _ never opens or closes inside an ASCII word (snake_case_name)
        let open = !isSpace(after);
        let close = !isSpace(before);
        if (c === '_') {
          open &&= !isWordChar(before);
          close &&= !isWordChar(after);
        }
        // only ~~ strikes through: a single ~ is a range (3~5 天)
        const n = j - i;
        if ((open || close) && (c !== '~' || n === 2)) push({ t: 'delim', ch: c, n, orig: n, open, close, closes: [], opens: [] });
        else buf += src.slice(i, j);
        i = j;
        continue;
      }
      case '!':
      case '[': {
        const image = c === '!';
        if (image && src[i + 1] !== '[') break;
        push({ t: 'bracket', image });
        brackets.push(tokens.length - 1);
        i += image ? 2 : 1;
        continue;
      }
      case ']': {
        const at = brackets.pop();
        if (at === undefined) break;
        const opener = tokens[at] as { t: 'bracket'; image: boolean };
        const dest = opener.image || brackets.length >= floor ? linkDest(src, i + 1) : null;
        floor = Math.min(floor, brackets.length);
        // without a (destination) the brackets are text
        if (!dest) break;
        flush();
        const label = build(tokens, at + 1, true);
        tokens.length = at;
        const target = safeHref(dest.url);
        if (opener.image) {
          const alt = plainText(label).trim();
          if (target) tokens.push({ t: 'node', node: { type: 'image', ...target, alt: alt || target.href } });
          else if (alt) tokens.push({ t: 'text', s: alt });
        } else {
          // links do not nest: no [ before this one may open a link any more
          floor = brackets.length;
          // an empty label shows the address; a refused address leaves just the label
          const children = target && !plainText(label).trim() ? [text(target.href)] : label;
          if (target) tokens.push({ t: 'node', node: { type: 'link', ...target, children } });
          else for (const node of label) tokens.push({ t: 'node', node });
        }
        i = dest.end;
        continue;
      }
      case '<': {
        AUTOLINK.lastIndex = i;
        const m = AUTOLINK.exec(src);
        const target = m && safeHref(m[1]);
        if (!m || !target) break;
        push({ t: 'node', node: { type: 'link', ...target, children: [text(m[1])] } });
        i += m[0].length;
        continue;
      }
      case 'h':
      case 'H': {
        const url = bareUrl(src, i);
        if (!url) break;
        push({ t: 'url', url });
        i += url.length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return build(tokens, 0, false);
}

/** Looks up the run of exactly `len` backticks that closes a code span opened before `from`, or -1. Linear overall. */
function backtickRuns(src: string): (len: number, from: number) => number {
  const runs = new Map<number, number[]>();
  for (let k = 0; k < src.length; k++) {
    if (src[k] !== '`') continue;
    const start = k;
    while (src[k + 1] === '`') k++;
    const list = runs.get(k - start + 1);
    if (list) list.push(start);
    else runs.set(k - start + 1, [start]);
  }
  // callers ask with growing `from`, so each list is walked once
  const seen = new Map<number, number>();
  return (len, from) => {
    const list = runs.get(len) ?? [];
    let q = seen.get(len) ?? 0;
    while (q < list.length && list[q] < from) q++;
    seen.set(len, q);
    return q < list.length ? list[q] : -1;
  };
}

/** Code span text: line breaks become spaces, and one space comes off each end when both have one (`` `x` ``). */
function codeText(raw: string): string {
  const s = raw.replaceAll('\n', ' ');
  return s.length > 2 && s[0] === ' ' && s[s.length - 1] === ' ' && /[^ ]/.test(s) ? s.slice(1, -1) : s;
}

/**
 * CommonMark's "process emphasis", minus the flanking subtleties: each closer pairs with the nearest opener of
 * the same character, and the runs in between stay text. Linear, as in the spec: a closer that found nothing
 * records where its search ended, so the next closer of its kind does not search there again.
 */
function matchEmphasis(delims: Delim[]): void {
  const count = delims.length;
  const prev = delims.map((_, k) => k - 1);
  const next = delims.map((_, k) => k + 1);
  const unlink = (k: number) => {
    if (prev[k] >= 0) next[prev[k]] = next[k];
    if (next[k] < count) prev[next[k]] = prev[k];
  };
  const bottom = new Map<string, number>();
  let k = 0;
  while (k < count) {
    const closer = delims[k];
    if (!closer.close) {
      k = next[k];
      continue;
    }
    const key = `${closer.ch}${closer.open}${closer.orig % 3}`;
    const floor = bottom.get(key) ?? -1;
    let o = prev[k];
    while (o > floor && !pairs(delims[o], closer)) o = prev[o];
    if (o <= floor) {
      bottom.set(key, prev[k]);
      const after = next[k];
      if (!closer.open) unlink(k);
      k = after;
      continue;
    }
    const opener = delims[o];
    const kind: Kind = closer.ch === '~' ? 'del' : opener.n >= 2 && closer.n >= 2 ? 'strong' : 'em';
    const used = kind === 'em' ? 1 : 2;
    opener.n -= used;
    closer.n -= used;
    opener.opens.push(kind);
    closer.closes.push(kind);
    next[o] = k;
    prev[k] = o;
    if (!opener.n) unlink(o);
    if (!closer.n) {
      const after = next[k];
      unlink(k);
      k = after;
    }
  }
}

/** Whether `closer` may close `opener`, with CommonMark's rule of three: *a**b** stays emphasis around strong. */
function pairs(opener: Delim, closer: Delim): boolean {
  if (opener.ch !== closer.ch || !opener.open) return false;
  const mixed = opener.close || closer.open;
  return !(mixed && (opener.orig + closer.orig) % 3 === 0 && (opener.orig % 3 !== 0 || closer.orig % 3 !== 0));
}

/** Matches the emphasis in tokens[from..] and nests them into a tree. In a link label, links and images become text. */
function build(tokens: Token[], from: number, label: boolean): Inline[] {
  const delims: Delim[] = [];
  for (let k = from; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.t === 'delim') delims.push(token);
  }
  matchEmphasis(delims);
  const root: Inline[] = [];
  // open emphasis; past MAX_DEPTH a pair keeps its marks as text and adds no level ("flat")
  const stack: { children: Inline[]; mark: string; flat: boolean }[] = [];
  let out = root;
  let depth = 0;
  for (let k = from; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.t === 'text') addText(out, token.s);
    else if (token.t === 'bracket') addText(out, token.image ? '![' : '[');
    else if (token.t === 'url') {
      const target = label ? null : safeHref(token.url);
      if (target) out.push({ type: 'link', ...target, children: [text(token.url)] });
      else addText(out, token.url);
    } else if (token.t === 'node') {
      const node = token.node;
      if (label && node.type === 'link') for (const child of node.children) add(out, child);
      else if (label && node.type === 'image') addText(out, node.alt);
      else add(out, node);
    } else {
      for (let q = 0; q < token.closes.length; q++) {
        const frame = stack.pop()!;
        out = stack.length ? stack[stack.length - 1].children : root;
        if (frame.flat) addText(out, frame.mark);
        else depth--;
      }
      addText(out, token.ch.repeat(token.n));
      for (let q = token.opens.length - 1; q >= 0; q--) {
        const kind = token.opens[q];
        const mark = kind === 'em' ? token.ch : token.ch + token.ch;
        if (depth >= MAX_DEPTH) {
          addText(out, mark);
          stack.push({ children: out, mark, flat: true });
        } else {
          const node = { type: kind, children: [] as Inline[] };
          out.push(node);
          stack.push({ children: node.children, mark, flat: false });
          out = node.children;
          depth++;
        }
      }
    }
  }
  return root;
}

function add(out: Inline[], node: Inline): void {
  if (node.type === 'text') addText(out, node.text);
  else out.push(node);
}

function addText(out: Inline[], s: string): void {
  if (!s) return;
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text += s;
  else out.push(text(s));
}

const plainText = (nodes: Inline[]): string =>
  nodes
    .map((n) =>
      n.type === 'text' || n.type === 'code' ? n.text : n.type === 'break' ? ' ' : n.type === 'image' ? n.alt : plainText(n.children)
    )
    .join('');

/** The `(url "title")` after a link's ], or null when there is none. The title is read and dropped. */
function linkDest(src: string, at: number): { url: string; end: number } | null {
  if (src[at] !== '(') return null;
  let i = skipSpace(src, at + 1);
  let url = '';
  if (src[i] === '<') {
    // <url> may hold anything but < > and line breaks
    for (i++; src[i] !== '>'; i++) {
      if (src[i] === undefined || src[i] === '<' || src[i] === '\n') return null;
      if (src[i] === '\\' && isEscapable(src[i + 1])) i++;
      url += src[i];
    }
    i++;
  } else {
    // a bare url ends at a space; parentheses in it must balance, as in Foo_(bar)
    let depth = 0;
    for (; i < src.length; i++) {
      let c = src[i];
      if (c === '\\' && isEscapable(src[i + 1])) c = src[++i];
      else if (c === '(') depth++;
      else if (c === ')') {
        if (!depth) break;
        depth--;
      } else if (/[\s\p{Cc}]/u.test(c)) break;
      // CommonMark's limit, which also bounds the work a run of unclosed ( can cause
      if (depth > 32) return null;
      url += c;
    }
    if (depth) return null;
  }
  const afterUrl = i;
  i = skipSpace(src, i);
  const quote = src[i];
  if (i > afterUrl && (quote === '"' || quote === "'" || quote === '(')) {
    const close = quote === '(' ? ')' : quote;
    for (i++; src[i] !== close; i++) {
      if (src[i] === undefined || (quote === '(' && src[i] === '(')) return null;
      if (src[i] === '\\') i++;
    }
    i = skipSpace(src, i + 1);
  }
  return src[i] === ')' ? { url, end: i + 1 } : null;
}

function skipSpace(src: string, i: number): number {
  while (src[i] === ' ' || src[i] === '\t' || src[i] === '\n') i++;
  return i;
}

/**
 * Where a link may point: http(s) and mailto (external), or a path on this site. Anything else is null: other
 * schemes (javascript:, data:, vbscript:...), `//host` and `/\host` (both leave the site), relative paths, and
 * anything with whitespace or control characters in it, which browsers would quietly drop.
 */
function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (!href || /[\s\p{Cc}\p{Cf}]/u.test(href)) return null;
  if (href[0] === '/') return href[1] === '/' || href[1] === '\\' ? null : { href, external: false };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1].toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? { href, external: true } : null;
}

// <https://example.com>, <mailto:a@example.com>: a scheme, then anything but spaces, controls and < >
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s\p{Cc}<>]*)>/uy;

// As in themes/Prose.tsx, an address runs until whitespace or a CJK quote / bracket / full stop. Square
// brackets end it too, so [https://a.example](https://a.example) keeps its label.
const URL_START = /https?:\/\//iy;
const URL_RUN = /[^\s\p{Cc}\p{Cf}<>"'`[\]，。；：！？、“”‘’（）【】《》「」『』]+/uy;

function bareUrl(src: string, at: number): string | null {
  URL_START.lastIndex = at;
  if (!URL_START.test(src)) return null;
  URL_RUN.lastIndex = at;
  const url = trimUrl(URL_RUN.exec(src)?.[0] ?? '');
  // the same floor as Prose: `http://` alone stays text
  return url.length < 10 ? null : url;
}

/** Drop trailing punctuation (and unbalanced closing parentheses) that belongs to the sentence, not the address. */
function trimUrl(url: string): string {
  let open = 0;
  let close = 0;
  for (const ch of url) {
    if (ch === '(') open++;
    else if (ch === ')') close++;
  }
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (last !== undefined && '.,;:!?*~_'.includes(last)) end--;
    else if (last === ')' && open < close) {
      end--;
      close--;
    } else return url.slice(0, end);
  }
}
