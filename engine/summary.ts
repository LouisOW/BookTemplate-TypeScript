import { BookError, type Page } from "./config";

export type TocItem =
  | { kind: "page"; title: string; path: string | null; number?: string; children: TocItem[] }
  | { kind: "part"; title: string }
  | { kind: "separator" };

export interface Summary {
  title?: string;
  items: TocItem[];
  /** Every page that has a file, in reading order. */
  pages: Page[];
}

const LINK = /^\[(.+)\]\((.*)\)\s*$/;
const LIST_ITEM = /^(\s*)[-*]\s+(.*)$/;

/**
 * Parses `SUMMARY.md` (same format as mdBook):
 *
 *   # Book Title                 <- optional, first line only
 *   [Preface](preface.md)        <- unnumbered page
 *   - [Chapter](ch01.md)         <- numbered page ("1")
 *     - [Section](ch01-01.md)    <- nested numbered page ("1.1"), indent 2+ spaces
 *   - [Draft]()                  <- listed but not built yet
 *   # Part Title                 <- part heading (after the first line)
 *   ---                          <- separator
 */
export function parseSummary(text: string, file = "SUMMARY.md"): Summary {
  const items: TocItem[] = [];
  let title: string | undefined;
  // Stack of open list levels: indent width + the children array to push into.
  let stack: { indent: number; children: TocItem[]; counter: number[] }[] = [];
  const topCounter: number[] = [0];
  let sawContent = false;

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\t/g, "    ");
    const lineNo = i + 1;
    if (line.trim() === "" || line.trim().startsWith("<!--")) return;

    const heading = /^#\s+(.+)$/.exec(line);
    if (heading) {
      if (!sawContent && title === undefined) title = heading[1]!.trim();
      else {
        items.push({ kind: "part", title: heading[1]!.trim() });
        stack = [];
      }
      sawContent = true;
      return;
    }
    sawContent = true;

    if (/^-{3,}\s*$/.test(line)) {
      items.push({ kind: "separator" });
      stack = [];
      return;
    }

    const listItem = LIST_ITEM.exec(line);
    if (listItem) {
      const indent = listItem[1]!.length;
      const link = LINK.exec(listItem[2]!.trim());
      if (!link) throw new BookError(`line ${lineNo}: expected "- [Title](file.md)"`, file);

      while (stack.length && stack[stack.length - 1]!.indent > indent) stack.pop();
      let level = stack[stack.length - 1];
      if (!level || indent > level.indent) {
        // Going one level deeper: children go under the last page at the current level.
        const parentList = level ? level.children : items;
        const parent = [...parentList].reverse().find(it => it.kind === "page");
        if (level && !parent) throw new BookError(`line ${lineNo}: nested item has no parent`, file);
        const children = level && parent && parent.kind === "page" ? parent.children : items;
        const counter = level && parent && parent.kind === "page" ? [...level.counter, 0] : topCounter;
        level = { indent, children, counter };
        stack.push(level);
      }

      level.counter[level.counter.length - 1]! += 1;
      const number = level.counter.join(".");
      level.children.push({
        kind: "page",
        title: link[1]!,
        path: link[2]!.trim() || null,
        number,
        children: [],
      });
      return;
    }

    const link = LINK.exec(line.trim());
    if (link) {
      items.push({ kind: "page", title: link[1]!, path: link[2]!.trim() || null, children: [] });
      stack = [];
      return;
    }

    throw new BookError(`line ${lineNo}: unrecognised line "${line.trim()}"`, file);
  });

  const pages: Page[] = [];
  const seen = new Set<string>();
  const walk = (list: TocItem[]) => {
    for (const item of list) {
      if (item.kind !== "page") continue;
      if (item.path) {
        if (!item.path.endsWith(".md")) {
          throw new BookError(`"${item.path}" must be a .md file`, file);
        }
        if (seen.has(item.path)) throw new BookError(`"${item.path}" is listed twice`, file);
        seen.add(item.path);
        pages.push({
          title: item.title,
          path: item.path,
          url: item.path.replace(/\.md$/, ".html"),
          number: item.number,
        });
      }
      walk(item.children);
    }
  };
  walk(items);

  return { title, items, pages };
}
