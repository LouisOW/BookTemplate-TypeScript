import fs from "node:fs";
import path from "node:path";

import { BookError, type Plugin } from "../config";

const INCLUDE = /\{\{#include\s+([^}\s:]+)(?::(\d*))?(?::(\d*))?\s*\}\}/g;

/**
 * `{{#include ../code/example.ts}}`        whole file
 * `{{#include ../code/example.ts:5}}`      line 5 to the end
 * `{{#include ../code/example.ts:5:10}}`   lines 5-10 (1-based, inclusive)
 * `{{#include ../code/example.ts::10}}`    lines 1-10
 *
 * Paths are relative to the page. Keeping code in real files lets you run and
 * test it with your normal tooling.
 */
export const includePlugin: Plugin = {
  name: "include",
  preprocess(source, ctx) {
    return source.replace(INCLUDE, (_m, rel: string, start?: string, end?: string) => {
      const file = path.resolve(path.dirname(ctx.file), rel);
      if (!fs.existsSync(file)) throw new BookError(`{{#include}} file not found: ${rel}`, ctx.page.path);
      const lines = fs.readFileSync(file, "utf8").replace(/\n$/, "").split("\n");
      const from = start ? Number(start) - 1 : 0;
      const to = end ? Number(end) : lines.length;
      return lines.slice(from, to).join("\n");
    });
  },
};
