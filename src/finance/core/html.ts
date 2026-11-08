// A small HTML extraction layer.
//
// The scraping pipeline needs to read pages, not render them. This parses HTML into a tree
// with no third-party dependency and no script execution: tags are tokenised, text is
// decoded, and elements are found by tag, class or id.
//
// It is deliberately not a browser. It does not run JavaScript, follow resources, or
// interpret styles. A page whose content is rendered client-side will yield nothing here,
// and the caller reports that rather than guessing.

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  text: string;
  parent: HtmlNode | null;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Elements whose text content is never page content.
 *
 * `head` is not skipped: the <title> inside it is the page title, and dropping the whole
 * element loses it.
 */
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg']);

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', euro: '\u20ac',
  pound: '\u00a3', rupee: '\u20b9', deg: '\u00b0', times: '\u00d7',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/**
 * Parse a document into a tree.
 *
 * Malformed markup is tolerated: an unclosed tag is closed by its parent, and a stray
 * closing tag is ignored rather than throwing.
 */
export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#document', attrs: {}, children: [], text: '', parent: null };
  let current = root;
  let i = 0;
  const src = html;

  const pushText = (text: string) => {
    if (!text) return;
    const decoded = decodeEntities(text);
    if (!decoded.trim()) {
      // Keep a single space so words in adjacent elements do not run together.
      if (decoded.length && current.children.length) current.children.push({
        tag: '#text', attrs: {}, children: [], text: ' ', parent: current,
      });
      return;
    }
    current.children.push({ tag: '#text', attrs: {}, children: [], text: decoded, parent: current });
    current.text += decoded;
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { pushText(src.slice(i)); break; }
    if (lt > i) pushText(src.slice(i, lt));

    // Comments and doctype.
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    const close = src.indexOf('>', lt);
    if (close === -1) { pushText(src.slice(lt)); break; }
    const inner = src.slice(lt + 1, close);

    if (inner.startsWith('/')) {
      const tag = inner.slice(1).trim().toLowerCase();
      let node: HtmlNode | null = current;
      while (node && node.tag !== tag) node = node.parent;
      if (node && node.parent) current = node.parent;
      i = close + 1;
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const spaceAt = body.search(/[\s/]/);
    const tag = (spaceAt === -1 ? body : body.slice(0, spaceAt)).toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) { i = close + 1; continue; }
    const attrs = spaceAt === -1 ? {} : parseAttrs(body.slice(spaceAt));

    const node: HtmlNode = { tag, attrs, children: [], text: '', parent: current };
    current.children.push(node);
    i = close + 1;

    if (selfClosing || VOID_TAGS.has(tag)) continue;

    // Skip raw-text elements wholesale: their content is code, not page text.
    if (SKIP_TAGS.has(tag)) {
      const closeTag = `</${tag}`;
      const end = src.toLowerCase().indexOf(closeTag, i);
      if (end === -1) {
        // An unclosed <script> must not swallow the rest of the document: stop at the next
        // tag that could plausibly close the region, or carry on from just after it.
        const nextLt = src.indexOf('<', i);
        i = nextLt === -1 ? src.length : nextLt;
      } else {
        const gt = src.indexOf('>', end);
        i = gt === -1 ? src.length : gt + 1;
      }
      continue;
    }
    current = node;
  }
  return root;
}

function walk(node: HtmlNode, visit: (n: HtmlNode) => void): void {
  visit(node);
  for (const c of node.children) walk(c, visit);
}

/** Every element in the tree, in document order. */
export function allElements(root: HtmlNode): HtmlNode[] {
  const out: HtmlNode[] = [];
  walk(root, (n) => { if (!n.tag.startsWith('#')) out.push(n); });
  return out;
}

export interface FindOptions {
  tag?: string;
  className?: string;
  id?: string;
  /** Restrict the search to a subtree. */
  within?: HtmlNode;
}

export function findAll(root: HtmlNode, opts: FindOptions): HtmlNode[] {
  const out: HtmlNode[] = [];
  walk(opts.within ?? root, (n) => {
    if (n.tag.startsWith('#')) return;
    if (opts.tag && n.tag !== opts.tag) return;
    if (opts.id && n.attrs['id'] !== opts.id) return;
    if (opts.className) {
      const classes = (n.attrs['class'] ?? '').split(/\s+/);
      if (!classes.includes(opts.className)) return;
    }
    out.push(n);
  });
  return out;
}

export function findOne(root: HtmlNode, opts: FindOptions): HtmlNode | null {
  return findAll(root, opts)[0] ?? null;
}

/** The visible text of a node, with whitespace collapsed. */
export function textOf(node: HtmlNode | null): string {
  if (!node) return '';
  const parts: string[] = [];
  const collect = (n: HtmlNode) => {
    if (n.tag === '#text') { parts.push(n.text); return; }
    if (SKIP_TAGS.has(n.tag)) return;
    for (const c of n.children) collect(c);
  };
  collect(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Read a table into rows of cell text, keeping the header row separate. */
export function tableToRows(table: HtmlNode): { headers: string[]; rows: string[][] } {
  const headerCells = findAll(table, { tag: 'th' }).map(textOf);
  const bodyRows: string[][] = [];
  for (const tr of findAll(table, { tag: 'tr' })) {
    const cells = tr.children.filter((c) => c.tag === 'td');
    if (!cells.length) continue;
    bodyRows.push(cells.map(textOf));
  }
  return { headers: headerCells, rows: bodyRows };
}

/** Every link on the page, with its text and resolved href. */
export function links(root: HtmlNode, baseUrl: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  for (const a of findAll(root, { tag: 'a' })) {
    const href = a.attrs['href'];
    if (!href) continue;
    let resolved = href;
    try { resolved = new URL(href, baseUrl).toString(); } catch { /* keep raw */ }
    out.push({ href: resolved, text: textOf(a) });
  }
  return out;
}

/** Meta tags as a name/property to content map, plus the title. */
export function meta(root: HtmlNode): { title: string; tags: Record<string, string> } {
  const tags: Record<string, string> = {};
  for (const m of findAll(root, { tag: 'meta' })) {
    const key = m.attrs['name'] ?? m.attrs['property'];
    if (key && m.attrs['content']) tags[key.toLowerCase()] = m.attrs['content'];
  }
  const titleEl = findOne(root, { tag: 'title' });
  const og = tags['og:title'];
  return { title: (titleEl ? textOf(titleEl) : '') || og || '', tags };
}

/** Strip a page down to readable prose, dropping navigation and boilerplate. */
export function readableText(root: HtmlNode): string {
  const body = findOne(root, { tag: 'body' }) ?? findOne(root, { tag: 'article' }) ?? root;
  const article = findOne(body, { tag: 'article' });
  const main = article ?? findOne(body, { tag: 'main' }) ?? body;
  return textOf(main);
}

/** A count of how much text a page actually yielded, for an honest empty-page check. */
export function contentStats(root: HtmlNode): { elements: number; chars: number } {
  const els = allElements(root);
  return { elements: els.length, chars: readableText(root).length };
}
