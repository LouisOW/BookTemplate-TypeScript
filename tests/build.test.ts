import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { build } from "../engine/build";
import { resolveConfig } from "../engine/config";

function makeBook(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "book-build-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

describe("build", () => {
  it("builds the bundled template book", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "book-out-"));
    const config = resolveConfig((await import("../book.config")).default, path.resolve(__dirname, ".."));
    config.out = out;
    const result = await build(config);
    expect(result.pages).toBeGreaterThan(5);
    for (const f of ["index.html", "404.html", "assets/book.js", "assets/book.css", "assets/feedback.js", "assets/search-index.json", "assets/badges/throws.svg", "img/placeholder.svg"]) {
      expect(fs.existsSync(path.join(out, f)), f).toBe(true);
    }
    const page = fs.readFileSync(path.join(out, "ch01-01-section-title.html"), "utf8");
    expect(page).toContain('class="quiz"');
    expect(page).toContain("data-runnable");
    expect(page).toContain('class="active" aria-current="page"');
  }, 30000);

  it("creates missing pages, writes redirects, and respects disabled features", async () => {
    const root = makeBook({
      "src/SUMMARY.md": "- [One](one.md)\n  - [Nested](sub/two.md)\n",
      "src/one.md": "# One\n\n{{#quiz ../q.toml}}\n",
    });
    const config = resolveConfig(
      { title: "T", features: { quizzes: false, highlights: false, search: false }, redirects: { "old.html": "one.html" } },
      root
    );
    await build(config);
    const out = path.join(root, "book");
    expect(fs.readFileSync(path.join(root, "src/sub/two.md"), "utf8")).toBe("# Nested\n");
    expect(fs.readFileSync(path.join(out, "sub/two.html"), "utf8")).toContain('href="../assets/book.css"');
    expect(fs.readFileSync(path.join(out, "old.html"), "utf8")).toContain("url=one.html");
    expect(fs.readFileSync(path.join(out, "one.html"), "utf8")).not.toContain("quiz");
    expect(fs.existsSync(path.join(out, "assets/feedback.js"))).toBe(false);
    expect(fs.existsSync(path.join(out, "assets/search-index.json"))).toBe(false);
  }, 30000);

  it("keeps the previous output when a page has an error", async () => {
    const root = makeBook({ "src/SUMMARY.md": "- [One](one.md)\n", "src/one.md": "# One\n" });
    const config = resolveConfig({ title: "T" }, root);
    await build(config);
    fs.writeFileSync(path.join(root, "src/one.md"), "{{#quiz ../missing.toml}}\n");
    await expect(build(config)).rejects.toThrow(/quiz file not found/);
    expect(fs.existsSync(path.join(root, "book/one.html"))).toBe(true);
  }, 30000);
});
