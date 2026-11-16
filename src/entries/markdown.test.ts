import { describe, expect, it } from 'vite-plus/test';
import { parseMarkdown, type Block, type HeadingLevel, type Inline, type ListItem } from './markdown';

// The tree is compared node by node. The helpers build the expected nodes; a bare string stands for a text node.

type Part = Inline | string;
const nodes = (parts: Part[]): Inline[] => parts.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x));
const br: Inline = { type: 'break' };
const code = (text: string): Inline => ({ type: 'code', text });
const em = (...parts: Part[]): Inline => ({ type: 'em', children: nodes(parts) });
const strong = (...parts: Part[]): Inline => ({ type: 'strong', children: nodes(parts) });
const del = (...parts: Part[]): Inline => ({ type: 'del', children: nodes(parts) });
/** External unless it is a path on this site; labelled with its address unless parts are given. */
const link = (href: string, ...parts: Part[]): Inline => ({
  type: 'link',
  href,
  external: !href.startsWith('/'),
  children: nodes(parts.length ? parts : [href])
});
const image = (href: string, alt: string): Inline => ({ type: 'image', href, external: !href.startsWith('/'), alt });

const p = (...parts: Part[]): Block => ({ type: 'paragraph', children: nodes(parts) });
const h = (level: HeadingLevel, ...parts: Part[]): Block => ({ type: 'heading', level, children: nodes(parts) });
const quote = (...children: Block[]): Block => ({ type: 'quote', children });
const pre = (lang: string, text: string): Block => ({ type: 'code', lang, text });
const hr: Block = { type: 'hr' };
const li = (...children: Block[]): ListItem => ({ checked: null, children });
const task = (checked: boolean, ...children: Block[]): ListItem => ({ checked, children });
const ul = (items: ListItem[], tight = true): Block => ({ type: 'list', ordered: false, start: 1, tight, items });
const ol = (start: number, items: ListItem[], tight = true): Block => ({ type: 'list', ordered: true, start, tight, items });

/** The inline content of a document that is one paragraph. */
function inline(src: string): Inline[] {
  const blocks = parseMarkdown(src);
  const [only] = blocks;
  if (blocks.length !== 1 || only.type !== 'paragraph') throw new Error(`expected one paragraph, got ${JSON.stringify(blocks)}`);
  return only.children;
}

const ENTRY = [
  '# 西湖一日',
  '',
  '　　早上**七点**出发，沿着*苏堤*走到~~断桥~~白堤。',
  '照片在 https://example.com/album。',
  '',
  '> 欲把西湖比西子',
  '> 淡妆浓抹总相宜',
  '',
  '1. [x] 苏堤',
  '2. [ ] 灵隐寺',
  '   - 门票 `75` 元',
  '',
  '```js',
  "console.log('<b>');",
  '```',
  '',
  '---',
  '详见[攻略](/e/abc)。'
].join('\n');

describe('parseMarkdown', () => {
  it('reads a typical entry', () => {
    expect(parseMarkdown(ENTRY)).toEqual([
      h(1, '西湖一日'),
      p(
        '　　早上',
        strong('七点'),
        '出发，沿着',
        em('苏堤'),
        '走到',
        del('断桥'),
        '白堤。',
        br,
        '照片在 ',
        link('https://example.com/album'),
        '。'
      ),
      quote(p('欲把西湖比西子', br, '淡妆浓抹总相宜')),
      ol(1, [task(true, p('苏堤')), task(false, p('灵隐寺'), ul([li(p('门票 ', code('75'), ' 元'))]))]),
      pre('js', "console.log('<b>');"),
      hr,
      p('详见', link('/e/abc', '攻略'), '。')
    ]);
  });

  it('returns plain data, which survives a JSON round trip', () => {
    const blocks = parseMarkdown(ENTRY);
    expect(JSON.parse(JSON.stringify(blocks))).toEqual(blocks);
  });

  it('is empty for empty or blank text', () => {
    for (const blank of ['', ' ', '\n\n', ' \t \n \r\n', '　\n']) expect(parseMarkdown(blank), JSON.stringify(blank)).toEqual([]);
  });

  it('reads any line ending style', () => {
    for (const src of ['a\nb\n\nc', 'a\r\nb\r\n\r\nc', 'a\rb\r\rc', 'a\r\nb\n\rc']) {
      expect(parseMarkdown(src), JSON.stringify(src)).toEqual([p('a', br, 'b'), p('c')]);
    }
  });

  it('turns NUL characters into U+FFFD', () => {
    expect(parseMarkdown('a\0b')).toEqual([p('a\uFFFDb')]);
  });
});

describe('paragraphs', () => {
  it('are split by blank lines, and a single line break stays a line break', () => {
    expect(parseMarkdown('第一行\n第二行\n\n\n第二段')).toEqual([p('第一行', br, '第二行'), p('第二段')]);
  });

  it('lose the spaces and tabs around each line, but keep 全角 indentation', () => {
    expect(parseMarkdown('  a  \n\t b\t')).toEqual([p('a', br, 'b')]);
    expect(parseMarkdown('　　今天天气很好。\n　　我们去了西湖。')).toEqual([p('　　今天天气很好。', br, '　　我们去了西湖。')]);
    expect(parseMarkdown('  　　缩进')).toEqual([p('　　缩进')]);
  });

  it('take indented lines as text: there is no indented code', () => {
    expect(parseMarkdown('    const a = 1;\n\tb')).toEqual([p('const a = 1;', br, 'b')]);
  });

  it('end lines with a backslash or two spaces without showing them', () => {
    expect(parseMarkdown('a\\\nb')).toEqual([p('a', br, 'b')]);
    expect(parseMarkdown('a  \nb')).toEqual([p('a', br, 'b')]);
    // no line break follows the last line, so its backslash is text
    expect(parseMarkdown('C:\\')).toEqual([p('C:\\')]);
  });

  it('take lines of whitespace, 全角 spaces included, as blank', () => {
    expect(parseMarkdown('a\n　 \nb')).toEqual([p('a'), p('b')]);
  });

  it('drop the line breaks that lines rendering as nothing leave at either end', () => {
    expect(parseMarkdown('[](javascript:x)\nfoo\n[](javascript:y)')).toEqual([p('foo')]);
    expect(parseMarkdown('[](javascript:x)')).toEqual([]);
  });
});

describe('headings', () => {
  it('take one to six #s and a space', () => {
    expect(parseMarkdown('# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六')).toEqual([
      h(1, '一'),
      h(2, '二'),
      h(3, '三'),
      h(4, '四'),
      h(5, '五'),
      h(6, '六')
    ]);
  });

  it('leave #tag, seven #s and an escaped # as text', () => {
    expect(parseMarkdown('#tag')).toEqual([p('#tag')]);
    expect(parseMarkdown('#旅行 #杭州')).toEqual([p('#旅行 #杭州')]);
    expect(parseMarkdown('####### 七')).toEqual([p('####### 七')]);
    expect(parseMarkdown('\\# 不是标题')).toEqual([p('# 不是标题')]);
  });

  it('lose a closing run of #s, but only after a space', () => {
    expect(parseMarkdown('## 标题 ##')).toEqual([h(2, '标题')]);
    expect(parseMarkdown('## 标题 #####   ')).toEqual([h(2, '标题')]);
    expect(parseMarkdown('# C#')).toEqual([h(1, 'C#')]);
    expect(parseMarkdown('# a #b')).toEqual([h(1, 'a #b')]);
    expect(parseMarkdown('# 结尾 \\#')).toEqual([h(1, '结尾 #')]);
  });

  it('may be indented and use tabs, and lose the spaces around their text', () => {
    expect(parseMarkdown('   #\t标题\t')).toEqual([h(1, '标题')]);
  });

  it('are dropped when empty, still ending the paragraph above', () => {
    expect(parseMarkdown('#\n##   \n### ###')).toEqual([]);
    expect(parseMarkdown('a\n#\nb')).toEqual([p('a'), p('b')]);
  });

  it('end a paragraph and hold inline formatting', () => {
    expect(parseMarkdown('正文\n## **重点** `x`\n正文')).toEqual([p('正文'), h(2, strong('重点'), ' ', code('x')), p('正文')]);
  });
});

describe('thematic breaks', () => {
  it('are three or more -, * or _, spaces allowed', () => {
    expect(parseMarkdown('---\n***\n___\n- - -\n * * * *\n_\t_ _\n-- -')).toEqual([hr, hr, hr, hr, hr, hr, hr]);
  });

  it('need one character three times and nothing else', () => {
    expect(parseMarkdown('--')).toEqual([p('--')]);
    expect(parseMarkdown('--- a')).toEqual([p('--- a')]);
    expect(parseMarkdown('-*-')).toEqual([p('-*-')]);
  });

  it('end a paragraph instead of underlining it: there are no setext headings', () => {
    expect(parseMarkdown('标题\n---\n正文')).toEqual([p('标题'), hr, p('正文')]);
    expect(parseMarkdown('标题\n===')).toEqual([p('标题', br, '===')]);
  });

  it('win over a list item, while - item and ***text*** keep their meaning', () => {
    expect(parseMarkdown('- - -')).toEqual([hr]);
    expect(parseMarkdown('* * *')).toEqual([hr]);
    expect(parseMarkdown('- item')).toEqual([ul([li(p('item'))])]);
    expect(parseMarkdown('***强调***')).toEqual([p(em(strong('强调')))]);
  });
});

describe('block quotes', () => {
  it('take lines starting with >, with or without a space after it', () => {
    expect(parseMarkdown('> 第一行\n>第二行\n  > 第三行')).toEqual([quote(p('第一行', br, '第二行', br, '第三行'))]);
  });

  it('hold any blocks', () => {
    expect(parseMarkdown('> # 标题\n>\n> - a\n> - b\n>\n> ```\n> code\n> ```')).toEqual([
      quote(h(1, '标题'), ul([li(p('a')), li(p('b'))]), pre('', 'code'))
    ]);
  });

  it('nest', () => {
    expect(parseMarkdown('> a\n> > b\n> c')).toEqual([quote(p('a'), quote(p('b')), p('c'))]);
    expect(parseMarkdown('>>> 三层')).toEqual([quote(quote(quote(p('三层'))))]);
  });

  it('end at the first line without > (no lazy continuation)', () => {
    expect(parseMarkdown('> 引用\n不是引用')).toEqual([quote(p('引用')), p('不是引用')]);
  });

  it('split in two at a blank line', () => {
    expect(parseMarkdown('> a\n\n> b')).toEqual([quote(p('a')), quote(p('b'))]);
  });

  it('end a paragraph', () => {
    expect(parseMarkdown('正文\n> 引用')).toEqual([p('正文'), quote(p('引用'))]);
  });

  it('may be empty', () => {
    expect(parseMarkdown('>')).toEqual([quote()]);
  });
});

describe('lists', () => {
  it('take -, * and + bullets, which may mix', () => {
    expect(parseMarkdown('- a\n* b\n+ c')).toEqual([ul([li(p('a')), li(p('b')), li(p('c'))])]);
  });

  it('take numbers with . or ) and keep the first number', () => {
    expect(parseMarkdown('1. a\n2. b')).toEqual([ol(1, [li(p('a')), li(p('b'))])]);
    expect(parseMarkdown('3) c\n9) d')).toEqual([ol(3, [li(p('c')), li(p('d'))])]);
    expect(parseMarkdown('0. 零')).toEqual([ol(0, [li(p('零'))])]);
    expect(parseMarkdown('2019. 那年夏天')).toEqual([ol(2019, [li(p('那年夏天'))])]);
    expect(parseMarkdown('123456789. 九位')).toEqual([ol(123456789, [li(p('九位'))])]);
    expect(parseMarkdown('1234567890. 十位')).toEqual([p('1234567890. 十位')]);
  });

  it('need a space after the marker, or the end of the line', () => {
    expect(parseMarkdown('-foo')).toEqual([p('-foo')]);
    expect(parseMarkdown('+1')).toEqual([p('+1')]);
    expect(parseMarkdown('1.5 公里')).toEqual([p('1.5 公里')]);
    expect(parseMarkdown('2026.11.16')).toEqual([p('2026.11.16')]);
    expect(parseMarkdown('*强调*')).toEqual([p(em('强调'))]);
  });

  it('start a new list when bullets turn into numbers or back', () => {
    expect(parseMarkdown('- a\n1. b\n- c')).toEqual([ul([li(p('a'))]), ol(1, [li(p('b'))]), ul([li(p('c'))])]);
  });

  it('are tight unless a blank line separates two items, or two blocks of an item', () => {
    expect(parseMarkdown('- a\n- b')).toEqual([ul([li(p('a')), li(p('b'))])]);
    expect(parseMarkdown('- a\n\n- b')).toEqual([ul([li(p('a')), li(p('b'))], false)]);
    expect(parseMarkdown('- a\n\n\n- b')).toEqual([ul([li(p('a')), li(p('b'))], false)]);
    expect(parseMarkdown('1. a\n\n   第二段\n2. b')).toEqual([ol(1, [li(p('a'), p('第二段')), li(p('b'))], false)]);
    expect(parseMarkdown('- a\n\n  - b')).toEqual([ul([li(p('a'), ul([li(p('b'))]))], false)]);
  });

  it('stay tight for blank lines that belong to something else', () => {
    // inside a nested list, which is loose itself
    expect(parseMarkdown('- a\n  - b\n\n  - c\n- d')).toEqual([ul([li(p('a'), ul([li(p('b')), li(p('c'))], false)), li(p('d'))])]);
    // inside fenced code
    expect(parseMarkdown('- a\n  ```\n  x\n\n  y\n  ```\n- b')).toEqual([ul([li(p('a'), pre('', 'x\n\ny')), li(p('b'))])]);
    // after the last item
    expect(parseMarkdown('- a\n- b\n\n正文')).toEqual([ul([li(p('a')), li(p('b'))]), p('正文')]);
  });

  it('nest by indentation: two columns past the marker, for bullets and numbers alike', () => {
    expect(parseMarkdown('- a\n  - b\n    - c\n- d')).toEqual([ul([li(p('a'), ul([li(p('b'), ul([li(p('c'))]))])), li(p('d'))])]);
    expect(parseMarkdown('1. a\n   - 三格\n2. b\n  - 两格')).toEqual([
      ol(1, [li(p('a'), ul([li(p('三格'))])), li(p('b'), ul([li(p('两格'))]))])
    ]);
    expect(parseMarkdown('10. a\n    1. b')).toEqual([ol(10, [li(p('a'), ol(1, [li(p('b'))]))])]);
    // one space is not enough: a sibling
    expect(parseMarkdown('- a\n - b')).toEqual([ul([li(p('a')), li(p('b'))])]);
    // a tab counts as four columns
    expect(parseMarkdown('- a\n\t- b')).toEqual([ul([li(p('a'), ul([li(p('b'))]))])]);
  });

  it('continue an item on the lines indented under it, losing up to its text column of indentation', () => {
    expect(parseMarkdown('- 第一项\n  续行\n- 第二项')).toEqual([ul([li(p('第一项', br, '续行')), li(p('第二项'))])]);
    expect(parseMarkdown('1. a\n   ```js\n   const x = 1;\n     y();\n   ```')).toEqual([
      ol(1, [li(p('a'), pre('js', 'const x = 1;\n  y();'))])
    ]);
  });

  it('end at a line indented less, with no lazy continuation', () => {
    expect(parseMarkdown('- 买菜\n- 做饭\n今天很累')).toEqual([ul([li(p('买菜')), li(p('做饭'))]), p('今天很累')]);
    expect(parseMarkdown('- 买菜\n\n今天很累')).toEqual([ul([li(p('买菜'))]), p('今天很累')]);
  });

  it('end at a thematic break', () => {
    expect(parseMarkdown('- a\n***\n- b')).toEqual([ul([li(p('a'))]), hr, ul([li(p('b'))])]);
    expect(parseMarkdown('- a\n- - -')).toEqual([ul([li(p('a'))]), hr]);
  });

  it('end a paragraph with a bullet or a 1, but not with another number or an empty item', () => {
    expect(parseMarkdown('清单：\n- a')).toEqual([p('清单：'), ul([li(p('a'))])]);
    expect(parseMarkdown('步骤：\n1. a')).toEqual([p('步骤：'), ol(1, [li(p('a'))])]);
    expect(parseMarkdown('那一年\n2019. 夏天')).toEqual([p('那一年', br, '2019. 夏天')]);
    expect(parseMarkdown('a\n-\nb')).toEqual([p('a', br, '-', br, 'b')]);
  });

  it('allow empty items, and text that starts on the next line', () => {
    expect(parseMarkdown('-\n  foo\n- \n- bar')).toEqual([ul([li(p('foo')), li(), li(p('bar'))])]);
  });

  it('hold any block, a heading, a break and a quote included', () => {
    expect(parseMarkdown('- # 标题\n- ***\n- > 引用')).toEqual([ul([li(h(1, '标题')), li(hr), li(quote(p('引用')))])]);
    expect(parseMarkdown('- - a')).toEqual([ul([li(ul([li(p('a'))]))])]);
  });

  it('take any spacing after the marker', () => {
    expect(parseMarkdown('-      远')).toEqual([ul([li(p('远'))])]);
    expect(parseMarkdown('-\tfoo')).toEqual([ul([li(p('foo'))])]);
    expect(parseMarkdown('1.\tfoo')).toEqual([ol(1, [li(p('foo'))])]);
  });
});

describe('task lists', () => {
  it('mark items that start with [ ] or [x]', () => {
    expect(parseMarkdown('- [ ] 买菜\n- [x] 做饭\n- [X] 洗碗\n- 散步')).toEqual([
      ul([task(false, p('买菜')), task(true, p('做饭')), task(true, p('洗碗')), li(p('散步'))])
    ]);
  });

  it('work in numbered and nested lists, and when empty', () => {
    expect(parseMarkdown('1. [x] a\n   - [ ] b\n2. [ ]')).toEqual([ol(1, [task(true, p('a'), ul([task(false, p('b'))])), task(false)])]);
  });

  it('keep the formatting of their text', () => {
    expect(parseMarkdown('- [x] **买** [菜](/e/1)')).toEqual([ul([task(true, p(strong('买'), ' ', link('/e/1', '菜')))])]);
  });

  it('need a space after the box, and a space or x inside it', () => {
    expect(parseMarkdown('- [x]done')).toEqual([ul([li(p('[x]done'))])]);
    expect(parseMarkdown('- [-] maybe')).toEqual([ul([li(p('[-] maybe'))])]);
    expect(parseMarkdown('- [  ] two')).toEqual([ul([li(p('[  ] two'))])]);
  });

  it('are list items only', () => {
    expect(parseMarkdown('[ ] 不是任务')).toEqual([p('[ ] 不是任务')]);
    expect(parseMarkdown('- a\n  [x] b')).toEqual([ul([li(p('a', br, '[x] b'))])]);
  });
});

describe('fenced code', () => {
  it('keeps its content verbatim, Markdown and HTML included', () => {
    expect(parseMarkdown('```\n**不加粗** <b>x</b>\n  缩进\t制表\n\n[a](javascript:x) https://example.com\n```')).toEqual([
      pre('', '**不加粗** <b>x</b>\n  缩进\t制表\n\n[a](javascript:x) https://example.com')
    ]);
  });

  it('takes ``` or ~~~, closed by a fence of the same character at least as long', () => {
    expect(parseMarkdown('~~~\n```\n~~\n~~~~')).toEqual([pre('', '```\n~~')]);
    expect(parseMarkdown('````\n```\n还是代码\n`````\nafter')).toEqual([pre('', '```\n还是代码'), p('after')]);
    expect(parseMarkdown('```\ncode\n   ```   \nafter')).toEqual([pre('', 'code'), p('after')]);
    expect(parseMarkdown('```\ncode\n``` x')).toEqual([pre('', 'code\n``` x')]);
  });

  it('may be empty', () => {
    expect(parseMarkdown('```\n```')).toEqual([pre('', '')]);
    expect(parseMarkdown('```')).toEqual([pre('', '')]);
  });

  it('runs to the end of the document when unclosed', () => {
    expect(parseMarkdown('正文\n```\nunclosed\n\n# 不是标题')).toEqual([p('正文'), pre('', 'unclosed\n\n# 不是标题')]);
  });

  it('takes its language from the first word of the info string, cleaned up', () => {
    expect(parseMarkdown('```js title="x"\n1\n```')).toEqual([pre('js', '1')]);
    expect(parseMarkdown('``` c++\n1\n```')).toEqual([pre('c++', '1')]);
    expect(parseMarkdown('```<script>alert(1)</script>\n1\n```')).toEqual([pre('scriptalert1script', '1')]);
    expect(parseMarkdown('~~~' + 'a'.repeat(30) + '\n1\n~~~')).toEqual([pre('a'.repeat(20), '1')]);
    expect(parseMarkdown('~~~ a`b\n1\n~~~')).toEqual([pre('ab', '1')]);
  });

  it('is not a fence with a backtick in its info string: that is inline code', () => {
    expect(parseMarkdown('```a```')).toEqual([p(code('a'))]);
    expect(parseMarkdown('``` a`b\nnot a fence```')).toEqual([p(code(' a`b not a fence'))]);
  });

  it('loses the opening fence’s indentation, and no more', () => {
    expect(parseMarkdown('  ```\n  a\n    b\nc\n  ```')).toEqual([pre('', 'a\n  b\nc')]);
  });

  it('ends a paragraph', () => {
    expect(parseMarkdown('正文\n```\ncode\n```\n正文')).toEqual([p('正文'), pre('', 'code'), p('正文')]);
  });

  it('ends with the quote or list item holding it', () => {
    expect(parseMarkdown('> ```\n> a\n\nb')).toEqual([quote(pre('', 'a')), p('b')]);
    expect(parseMarkdown('- ```\n  a\nb')).toEqual([ul([li(pre('', 'a'))]), p('b')]);
  });
});

describe('backslash escapes', () => {
  it('make ASCII punctuation literal', () => {
    expect(inline('\\*a\\* \\_b\\_ \\~~c\\~~ \\`d\\` \\[e\\](f) \\<g\\> \\# \\\\')).toEqual(nodes(['*a* _b_ ~~c~~ `d` [e](f) <g> # \\']));
    expect(inline('\\https://example.com')).toEqual(nodes(['\\', link('https://example.com')]));
  });

  it('leave a backslash before anything else', () => {
    expect(inline('C:\\Users\\新建文件夹 \\a \\中')).toEqual(nodes(['C:\\Users\\新建文件夹 \\a \\中']));
  });

  it('do not apply in code spans', () => {
    expect(inline('`\\*`')).toEqual([code('\\*')]);
  });
});

describe('code spans', () => {
  it('keep their content verbatim', () => {
    expect(inline('`**x** <b> \\* [a](b) https://example.com`')).toEqual([code('**x** <b> \\* [a](b) https://example.com')]);
  });

  it('open and close with backtick runs of the same length', () => {
    expect(inline('``a ` b``')).toEqual([code('a ` b')]);
    expect(inline('`a``b`')).toEqual([code('a``b')]);
    expect(inline('`a` 和 ``b``')).toEqual(nodes([code('a'), ' 和 ', code('b')]));
  });

  it('lose one space at each end when both ends have one', () => {
    expect(inline('`` `x` ``')).toEqual([code('`x`')]);
    expect(inline('` a `')).toEqual([code('a')]);
    expect(inline('`  a  `')).toEqual([code(' a ')]);
    expect(inline('` a`')).toEqual([code(' a')]);
    expect(inline('`   `')).toEqual([code('   ')]);
  });

  it('turn line breaks into spaces', () => {
    expect(inline('`a\nb`')).toEqual([code('a b')]);
  });

  it('are text when unclosed', () => {
    expect(inline('`a')).toEqual(nodes(['`a']));
    expect(inline('``a`')).toEqual(nodes(['``a`']));
    expect(inline('a ``')).toEqual(nodes(['a ``']));
  });

  it('win over emphasis and links that overlap them', () => {
    expect(inline('*a `*` b*')).toEqual([em('a ', code('*'), ' b')]);
    expect(inline('[a `](b)` c')).toEqual(nodes(['[a ', code('](b)'), ' c']));
  });

  it('may follow an escaped backtick', () => {
    expect(inline('\\``code`')).toEqual(nodes(['`', code('code')]));
  });
});

describe('emphasis', () => {
  it('takes * and _ for em, ** and __ for strong, ~~ for del', () => {
    expect(inline('*a* _b_ **c** __d__ ~~e~~')).toEqual(nodes([em('a'), ' ', em('b'), ' ', strong('c'), ' ', strong('d'), ' ', del('e')]));
  });

  it('nests', () => {
    expect(inline('**bold *and italic***')).toEqual([strong('bold ', em('and italic'))]);
    expect(inline('***both***')).toEqual([em(strong('both'))]);
    expect(inline('*a **b** c*')).toEqual([em('a ', strong('b'), ' c')]);
    expect(inline('*a *b* c*')).toEqual([em('a ', em('b'), ' c')]);
    expect(inline('~~**a** _b_~~')).toEqual([del(strong('a'), ' ', em('b'))]);
  });

  it('follows the rule of three, so a run that both opens and closes pairs as expected', () => {
    expect(inline('*foo**bar**baz*')).toEqual([em('foo', strong('bar'), 'baz')]);
    expect(inline('*foo**bar*')).toEqual([em('foo**bar')]);
  });

  it('works next to CJK text and punctuation', () => {
    expect(inline('这是**重点**内容')).toEqual(nodes(['这是', strong('重点'), '内容']));
    expect(inline('这是*强调*，那是~~删除~~。')).toEqual(nodes(['这是', em('强调'), '，那是', del('删除'), '。']));
    expect(inline('**“引号”**内容')).toEqual(nodes([strong('“引号”'), '内容']));
    expect(inline('中文_强调_中文')).toEqual(nodes(['中文', em('强调'), '中文']));
    expect(inline('　　**重点**：内容')).toEqual(nodes(['　　', strong('重点'), '：内容']));
  });

  it('needs text right inside its markers', () => {
    expect(inline('a * b * c')).toEqual(nodes(['a * b * c']));
    expect(inline('** a**')).toEqual(nodes(['** a**']));
    expect(inline('**a **')).toEqual(nodes(['**a **']));
    expect(inline('~~ a~~')).toEqual(nodes(['~~ a~~']));
  });

  it('keeps _ inside ASCII words literal, but not *', () => {
    expect(inline('snake_case_name')).toEqual(nodes(['snake_case_name']));
    expect(inline('file_name.txt 与 x__y__z')).toEqual(nodes(['file_name.txt 与 x__y__z']));
    expect(inline('_a_b')).toEqual(nodes(['_a_b']));
    expect(inline('*intra*word 2*3*4')).toEqual(nodes([em('intra'), 'word 2', em('3'), '4']));
    expect(inline('__init__')).toEqual([strong('init')]);
  });

  it('leaves unmatched markers as text', () => {
    expect(inline('**unclosed')).toEqual(nodes(['**unclosed']));
    expect(inline('a*')).toEqual(nodes(['a*']));
    expect(inline('**a*')).toEqual(nodes(['*', em('a')]));
    expect(inline('*a**')).toEqual(nodes([em('a'), '*']));
    expect(inline('**')).toEqual(nodes(['**']));
    // a marker pairs only with its own character
    expect(inline('_a*')).toEqual(nodes(['_a*']));
    expect(inline('_a* *b_')).toEqual([em('a* *b')]);
  });

  it('strikes through with exactly two tildes: one is a range', () => {
    expect(inline('3~5 天，9:00~18:00')).toEqual(nodes(['3~5 天，9:00~18:00']));
    expect(inline('~x~ ~~~y~~~')).toEqual(nodes(['~x~ ~~~y~~~']));
    expect(inline('~~a~~b~~c~~')).toEqual(nodes([del('a'), 'b', del('c')]));
  });

  it('cannot reach across a link’s brackets', () => {
    expect(inline('*[a*](/b)')).toEqual(nodes(['*', link('/b', 'a*')]));
    expect(inline('[*a](/b)*')).toEqual(nodes([link('/b', '*a'), '*']));
    expect(inline('*[a](/b)*')).toEqual([em(link('/b', 'a'))]);
  });
});

describe('links', () => {
  it('go to http(s), mailto and paths on this site', () => {
    expect(inline('[a](https://example.com) [b](http://example.com/x?y=1#z) [c](mailto:me@example.com) [d](/e/123) [e](/)')).toEqual(
      nodes([
        link('https://example.com', 'a'),
        ' ',
        link('http://example.com/x?y=1#z', 'b'),
        ' ',
        link('mailto:me@example.com', 'c'),
        ' ',
        link('/e/123', 'd'),
        ' ',
        link('/', 'e')
      ])
    );
  });

  it('check the scheme ignoring case and surrounding spaces', () => {
    expect(inline('[a](HTTPS://EXAMPLE.COM)')).toEqual([link('HTTPS://EXAMPLE.COM', 'a')]);
    expect(inline('[b](MailTo:me@example.com)')).toEqual([link('MailTo:me@example.com', 'b')]);
    expect(inline('[c](  https://example.com  )')).toEqual([link('https://example.com', 'c')]);
    expect(inline('[d](< https://example.com >)')).toEqual([link('https://example.com', 'd')]);
  });

  it('show only their label for any other destination', () => {
    const refused = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '<javascript:alert(1)>',
      '<java\tscript:alert(1)>',
      '<java script:alert(1)>',
      'java&#x09;script:alert(1)',
      '\u200Bjavascript:alert(1)',
      'jav\0ascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/png;base64,iVBORw0KGgo=',
      'file:///etc/passwd',
      'ftp://example.com',
      'blob:https://example.com/x',
      '//evil.example',
      '/\\evil.example',
      '\\/\\/evil.example',
      '<https://exa mple.com>',
      'https://example.com/\u202Egpj.exe',
      'foo/bar',
      './x',
      '#top',
      '?q=1',
      ''
    ];
    for (const dest of refused) expect(inline(`前[标签](${dest})后`), dest).toEqual(nodes(['前标签后']));
  });

  it('drop their title', () => {
    expect(inline('[a](/x "标题") [b](/y \'t\') [c](/z (t)) [d](/w\n"t")')).toEqual(
      nodes([link('/x', 'a'), ' ', link('/y', 'b'), ' ', link('/z', 'c'), ' ', link('/w', 'd')])
    );
  });

  it('take <destinations>, escapes and balanced parentheses', () => {
    expect(inline('[a](https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([link('https://en.wikipedia.org/wiki/Foo_(bar)', 'a')]);
    expect(inline('[a](/p\\(q)')).toEqual([link('/p(q', 'a')]);
    expect(inline('[a](<https://example.com/(>)')).toEqual([link('https://example.com/(', 'a')]);
  });

  it('are text without a complete (destination)', () => {
    for (const src of ['[a]', '[a] (/b)', '[a](/b', '[a](/b "t)', '[a](/b c)', '[a](/b (t)', '[a](<b)', '[a](/b((c))']) {
      expect(inline(src), src).toEqual(nodes([src]));
    }
    // a <destination> cannot span lines
    expect(inline('[a](<b\nc>)')).toEqual(nodes(['[a](<b', br, 'c>)']));
  });

  it('read quotes right after the address as part of it: a title needs a space before it', () => {
    expect(inline('[a](/b"t")')).toEqual([link('/b"t"', 'a')]);
  });

  it('format their label but hold no other link', () => {
    expect(inline('[**粗** `c` _e_](/x)')).toEqual([link('/x', strong('粗'), ' ', code('c'), ' ', em('e'))]);
    expect(inline('[a [b](/c) d](/e)')).toEqual(nodes(['[a ', link('/c', 'b'), ' d](/e)']));
    expect(inline('[见 https://a.example/x](https://b.example/y)')).toEqual([link('https://b.example/y', '见 https://a.example/x')]);
    expect(inline('[<https://a.example>](/b)')).toEqual([link('/b', 'https://a.example')]);
    expect(inline('[![徽章](https://img.example/b.svg)](https://github.com/x)')).toEqual([link('https://github.com/x', '徽章')]);
  });

  it('show their address when the label is empty', () => {
    expect(inline('[](https://example.com)')).toEqual([link('https://example.com')]);
    expect(inline('[  ](/x)')).toEqual([link('/x')]);
  });

  it('keep a refused link’s label formatted', () => {
    expect(inline('[**粗**](javascript:x) 后')).toEqual(nodes([strong('粗'), ' 后']));
  });
});

describe('autolinks', () => {
  it('link <http(s)://…> and <mailto:…>', () => {
    expect(inline('<https://example.com/a?b=1> <mailto:me@example.com>')).toEqual(
      nodes([link('https://example.com/a?b=1'), ' ', link('mailto:me@example.com')])
    );
  });

  it('leave any other <…> as text, HTML included', () => {
    const src = '<javascript:alert(1)> <data:text/html,x> <b>粗</b> <script>alert(1)</script> <a href="x">';
    expect(inline(src)).toEqual(nodes([src]));
  });
});

describe('bare addresses', () => {
  it('become links', () => {
    expect(inline('见 https://example.com/a?b=1#c 和 HTTP://EXAMPLE.COM')).toEqual(
      nodes(['见 ', link('https://example.com/a?b=1#c'), ' 和 ', link('HTTP://EXAMPLE.COM')])
    );
  });

  it('end at CJK punctuation and lose the sentence’s punctuation', () => {
    expect(inline('链接https://example.com/路径。后文')).toEqual(nodes(['链接', link('https://example.com/路径'), '。后文']));
    expect(inline('看 https://example.com/a, https://example.com/b. 还有 https://example.com/c!')).toEqual(
      nodes(['看 ', link('https://example.com/a'), ', ', link('https://example.com/b'), '. 还有 ', link('https://example.com/c'), '!'])
    );
    expect(inline('（https://example.com/x）「https://example.com/y」')).toEqual(
      nodes(['（', link('https://example.com/x'), '）「', link('https://example.com/y'), '」'])
    );
  });

  it('keep balanced parentheses and lose an unbalanced closing one', () => {
    expect(inline('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([link('https://en.wikipedia.org/wiki/Foo_(bar)')]);
    expect(inline('(see https://example.com/a)')).toEqual(nodes(['(see ', link('https://example.com/a'), ')']));
  });

  it('end at whitespace, quotes, angle and square brackets', () => {
    expect(inline('"https://example.com/q" <https://example.com/r [https://example.com/s] https://example.com/t\u200Bu')).toEqual(
      nodes([
        '"',
        link('https://example.com/q'),
        '" <',
        link('https://example.com/r'),
        ' [',
        link('https://example.com/s'),
        '] ',
        link('https://example.com/t'),
        '\u200Bu'
      ])
    );
  });

  it('are not looked for in code spans and link labels, but are inside emphasis', () => {
    expect(inline('`https://example.com`')).toEqual([code('https://example.com')]);
    expect(inline('**https://example.com/a** ~~https://example.com/b~~ __https://example.com/c__')).toEqual(
      nodes([strong(link('https://example.com/a')), ' ', del(link('https://example.com/b')), ' ', strong(link('https://example.com/c'))])
    );
  });

  it('need an address after the scheme', () => {
    expect(inline('http:// https://a ftp://example.com')).toEqual(nodes(['http:// https://a ftp://example.com']));
  });
});

describe('images', () => {
  it('become links to the image, labelled with their alt text or address', () => {
    expect(inline('![西湖](https://example.com/a.jpg)')).toEqual([image('https://example.com/a.jpg', '西湖')]);
    expect(inline('![](/media/a.jpg)')).toEqual([image('/media/a.jpg', '/media/a.jpg')]);
    expect(inline('![ ](https://example.com/a.jpg "标题")')).toEqual([image('https://example.com/a.jpg', 'https://example.com/a.jpg')]);
  });

  it('flatten their alt text', () => {
    expect(inline('![**粗** `c` [l](/x)\n第二行](/img.png)')).toEqual([image('/img.png', '粗 c l 第二行')]);
  });

  it('show only their alt text, or nothing, for any other address', () => {
    expect(inline('![像素](data:image/gif;base64,R0lGOD) 后')).toEqual(nodes(['像素 后']));
    expect(inline('前 ![](javascript:alert(1)) 后')).toEqual(nodes(['前  后']));
    expect(inline('![x](//tracker.example/p.gif)')).toEqual(nodes(['x']));
  });

  it('are text without a destination', () => {
    expect(inline('![alt] !not ! [a]')).toEqual(nodes(['![alt] !not ! [a]']));
  });
});

describe('raw HTML', () => {
  it('is text, in blocks and inline', () => {
    expect(parseMarkdown('<div onclick="x">\n<script>alert(1)</script>\n</div>')).toEqual([
      p('<div onclick="x">', br, '<script>alert(1)</script>', br, '</div>')
    ]);
    expect(inline('a <img src=x onerror=alert(1)> &amp; &#60; <!-- c -->')).toEqual(
      nodes(['a <img src=x onerror=alert(1)> &amp; &#60; <!-- c -->'])
    );
  });
});

/** Every link and image address in the tree. */
function hrefs(blocks: Block[]): string[] {
  const out: string[] = [];
  const inlineNode = (n: Inline) => {
    if (n.type === 'link' || n.type === 'image') out.push(n.href);
    if ('children' in n) n.children.forEach(inlineNode);
  };
  const block = (b: Block) => {
    if (b.type === 'heading' || b.type === 'paragraph') b.children.forEach(inlineNode);
    else if (b.type === 'quote') b.children.forEach(block);
    else if (b.type === 'list') for (const item of b.items) item.children.forEach(block);
  };
  blocks.forEach(block);
  return out;
}

/** How deep quotes and lists nest. */
const blockDepth = (blocks: Block[]): number =>
  blocks.reduce(
    (most, b) =>
      Math.max(
        most,
        b.type === 'quote'
          ? 1 + blockDepth(b.children)
          : b.type === 'list'
            ? 1 + b.items.reduce((m, i) => Math.max(m, blockDepth(i.children)), 0)
            : 0
      ),
    0
  );

/** How deep emphasis and links nest. */
const inlineDepth = (nodes: Inline[]): number =>
  nodes.reduce((most, n) => Math.max(most, 'children' in n ? 1 + inlineDepth(n.children) : 0), 0);

const textOf = (nodes: Inline[]): string =>
  nodes.map((n) => (n.type === 'text' ? n.text : 'children' in n ? textOf(n.children) : '')).join('');

/** mulberry32: a seeded generator, so a failing input can be replayed. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

describe('hostile input', () => {
  const fill = (unit: string, length = 50_000) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  const HUGE: [string, string][] = [
    ['a run of 50,000 *', '*'.repeat(50_000)],
    ['*a again and again', fill('*a')],
    ['closers without openers', fill('a* ')],
    ['openers, then as many closers', fill(' *x', 25_000) + fill(' x*', 25_000)],
    ['_ inside words', fill('a_b ')],
    ['~~ again and again', fill('~~a')],
    ['unclosed [', '['.repeat(50_000)],
    ['unmatched ]', ']'.repeat(50_000)],
    ['[]( again and again', fill('[](')],
    ['[a]( again and again', fill('[a](')],
    ['unclosed titles', '[a](b "' + fill("[a](b '")],
    ['![ again and again', fill('![')],
    ['backslashes', '\\'.repeat(50_000)],
    ['a run of 50,000 backticks', '`'.repeat(50_000)],
    ['unclosed backtick runs of every length', Array.from({ length: 310 }, (_, k) => '`'.repeat(k + 1)).join(' ')],
    ['unclosed <', '<'.repeat(50_000)],
    ['<scheme: without >', fill('<a:')],
    ['http:// again and again', fill('http://')],
    ['an address of opening parentheses', 'https://a.example/' + '('.repeat(50_000)],
    ['an address of closing parentheses', 'https://a.example/' + ')'.repeat(50_000)],
    ['an address ending in 50,000 dots', 'https://a.example' + '.'.repeat(50_000)],
    ['a destination of opening parentheses', '[a](' + '('.repeat(50_000)],
    ['a destination that never ends', '[a](' + 'b'.repeat(50_000)],
    ['50,000 >', '>'.repeat(50_000)],
    ['> > > … on one line', fill('> ') + 'x'],
    ['- - - … on one line', fill('- ') + 'x'],
    ['1. 1. 1. … on one line', fill('1. ') + 'x'],
    ['50,000 #', '#'.repeat(50_000)],
    ['fences', fill('```\n')],
    ['short lines', fill('a\n')],
    ['blank lines', '\n'.repeat(50_000)],
    ['lines that render as nothing', fill('[](javascript:x)\n')],
    ['backslash line ends', fill('\\\n')],
    ['list items', fill('- [ ] a\n')],
    ['a nested list 220 levels deep', Array.from({ length: 220 }, (_, k) => '  '.repeat(k) + '- x').join('\n')],
    ['a mix of every marker', fill('*_~`[]()<>!\\h#-+> \n')]
  ];

  it.each(HUGE)('%s: parsed in linear time', (_, src) => {
    const start = performance.now();
    expect(Array.isArray(parseMarkdown(src))).toBe(true);
    // linear work takes milliseconds here; quadratic work on 50,000 characters takes seconds
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('nests quotes and lists at most 12 deep, keeping deeper markers as text', () => {
    const quotes = parseMarkdown('>'.repeat(5000) + ' 最深');
    expect(blockDepth(quotes)).toBe(12);
    let inner = quotes;
    for (let k = 0; k < 12; k++) inner = inner[0].type === 'quote' ? inner[0].children : [];
    expect(inner).toEqual([p('>'.repeat(4988) + ' 最深')]);

    expect(blockDepth(parseMarkdown('- '.repeat(5000) + 'x'))).toBe(12);
    expect(blockDepth(parseMarkdown('> - '.repeat(5000) + 'x'))).toBe(12);
    expect(blockDepth(parseMarkdown(Array.from({ length: 50 }, (_, k) => '  '.repeat(k) + '- x').join('\n')))).toBe(12);
  });

  it('nests emphasis at most 12 deep, keeping deeper markers as text', () => {
    const pairs = inline('*a '.repeat(20) + 'b' + ' a*'.repeat(20));
    expect(inlineDepth(pairs)).toBe(12);
    // the 8 innermost pairs stay as their 16 markers
    expect(textOf(pairs).split('*').length - 1).toBe(16);

    const runs = inline('*'.repeat(10_000) + 'a' + '*'.repeat(10_000));
    expect(inlineDepth(runs)).toBe(12);
    expect(textOf(runs)).toBe('*'.repeat(10_000 - 24) + 'a' + '*'.repeat(10_000 - 24));
  });

  it('copes with lone surrogates, byte order marks, bidi controls and other odd characters', () => {
    for (const src of [
      '\uD800',
      '\uDC00*\uD800*',
      '\u202Ejavascript:alert(1)',
      'a\u2028b\u2029c',
      '\u0085\f\v',
      '\u0000\u0001\u001F\u007F'
    ]) {
      expect(() => parseMarkdown(src), JSON.stringify(src)).not.toThrow();
    }
    expect(inline('😀**😀**😀')).toEqual(nodes(['😀', strong('😀'), '😀']));
    expect(parseMarkdown('\uFEFF# 标题')).toEqual([h(1, '标题')]);
  });

  it('never throws, and links only to allowed addresses, whatever the input', () => {
    const random = seeded(20261116);
    const pieces = [
      ...'*_~`[]()<>!\\#-+ \t\n\r"\'|',
      '**',
      '~~',
      '``',
      '\n\n',
      '# ',
      '- ',
      '1. ',
      '2) ',
      '> ',
      '[ ] ',
      '[x] ',
      '```',
      '~~~',
      '---',
      'a',
      '中',
      '　',
      'x_y',
      '\0',
      '\u200B',
      '&#106;',
      'https://e.example/p',
      'http://e.example/(a)',
      'javascript:alert(1)',
      'JaVaScRiPt:',
      'data:x',
      'vbscript:',
      '//evil.example',
      '/\\evil',
      '/ok',
      'mailto:a@b.example'
    ];
    for (let n = 0; n < 3000; n++) {
      let src = '';
      for (let k = 1 + Math.floor(random() * 40); k > 0; k--) src += pieces[Math.floor(random() * pieces.length)];
      for (const href of hrefs(parseMarkdown(src))) {
        expect(href, src).toMatch(/^(?:https?:|mailto:|\/(?![/\\]))/i);
        expect(href, src).not.toMatch(/[\s\p{Cc}\p{Cf}]/u);
      }
    }
  });
});
