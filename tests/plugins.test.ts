import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveConfig, type PluginContext } from "../engine/config";
import { createMarkdown, newEnv } from "../engine/markdown";
import { includePlugin } from "../engine/plugins/include";
import { listingPlugin } from "../engine/plugins/listing";
import { notesPlugin } from "../engine/plugins/notes";
import { quizPlugin, validateQuiz } from "../engine/plugins/quiz";
import { runnablePlugin } from "../engine/plugins/runnable";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "book-test-"));
const config = resolveConfig({ title: "Test" }, tmp);

function setup() {
  const md = createMarkdown();
  for (const p of [notesPlugin, runnablePlugin]) p.extendMarkdown?.(md, config);
  const ctx: PluginContext = {
    config,
    md,
    page: { title: "Page", path: "page.md", url: "page.html" },
    file: path.join(tmp, "src", "page.md"),
    buildState: new Map(),
  };
  const render = (src: string) => md.render(src, newEnv("page.md"));
  return { md, ctx, render };
}

describe("markdown", () => {
  it("rewrites .md links and gives headings unique ids", () => {
    const { render } = setup();
    const html = render("# Intro\n\n## Intro\n\n[next](ch02.md#top) [ext](https://x.md)");
    expect(html).toContain('id="intro"');
    expect(html).toContain('id="intro-1"');
    expect(html).toContain('href="ch02.html#top"');
    expect(html).toContain('href="https://x.md"');
  });

  it("puts info-string flags on <pre> and hides // @hide lines", () => {
    const { render } = setup();
    const html = render("```ts,does_not_compile\nsecret(); // @hide\nconst x: number = 'a';\n```");
    expect(html).toContain('class="code-block does_not_compile"');
    expect(html).not.toContain("secret");
  });
});

describe("notes", () => {
  it("turns Note/Tip/Warning blockquotes into sections", () => {
    const { render } = setup();
    expect(render("> Note: hi")).toContain('<section class="note note-note" role="note">');
    expect(render("> Warning: careful\n> more")).toContain("note-warning");
    expect(render("> Just a quote")).toContain("<blockquote>");
  });
});

describe("listing", () => {
  it("wraps code in a numbered figure with caption and file name", () => {
    const { ctx, render } = setup();
    const src = listingPlugin.preprocess!(
      '<Listing number="2-1" file-name="main.ts" caption="A *nice* one">\n\n```ts\nlet a = 1;\n```\n\n</Listing>',
      ctx
    ) as string;
    const html = render(src);
    expect(html).toContain('<figure class="listing" id="listing-2-1">');
    expect(html).toContain("Filename: main.ts");
    expect(html).toContain("Listing 2-1: A <em>nice</em> one");
    expect(html).toContain('class="code-block"');
  });
});

describe("include", () => {
  it("includes whole files and line ranges", () => {
    const { ctx } = setup();
    fs.mkdirSync(path.join(tmp, "code"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "code", "f.ts"), "l1\nl2\nl3\nl4\n");
    const run = (s: string) => includePlugin.preprocess!(s, ctx);
    expect(run("{{#include ../code/f.ts}}")).toBe("l1\nl2\nl3\nl4");
    expect(run("{{#include ../code/f.ts:2:3}}")).toBe("l2\nl3");
    expect(run("{{#include ../code/f.ts:3}}")).toBe("l3\nl4");
    expect(() => run("{{#include ../code/missing.ts}}")).toThrow(/not found/);
  });
});

describe("runnable", () => {
  it("compiles TypeScript into data-runnable", () => {
    const { render } = setup();
    const html = render("```ts,runnable\nconst n: number = 1;\nconsole.log(n);\n```");
    expect(html).toMatch(/data-runnable="const n = 1;/);
  });

  it("fails the build on syntax errors and unsupported languages", () => {
    const { render } = setup();
    expect(() => render("```ts,runnable\nconst = ;\n```")).toThrow(/does not compile/);
    expect(() => render("```python,runnable\nprint(1)\n```")).toThrow(/only works for ts\/js/);
    expect(() => render("```ts,runnable,editable\nlet a = 1\n```")).toThrow(/editable/);
  });
});

describe("quiz", () => {
  const mc = (id: string, extra = "") => `[[questions]]
id = "${id}"
type = "MultipleChoice"
prompt.prompt = "Q?"
answer.answer = "A"
prompt.distractors = ["B"]
${extra}`;
  const parse = (toml: string) => validateQuiz(require_toml(toml), "q.toml");

  it("accepts valid questions", () => {
    expect(parse(mc("1") + "\n" + mc("2"))).toHaveLength(2);
  });

  it("rejects duplicate ids, Tracing, and missing pieces", () => {
    expect(() => parse(mc("1") + "\n" + mc("1"))).toThrow(/already used/);
    expect(() => parse(`[[questions]]\nid = "t"\ntype = "Tracing"\nprompt.program = "x"`)).toThrow(/Rust-specific/);
    expect(() => parse(`[[questions]]\nid = "x"\ntype = "MultipleChoice"\nprompt.prompt = "Q"\nanswer.answer = "A"`)).toThrow(/distractor/);
    expect(() => parse(mc("1", 'multipart = "nope"'))).toThrow(/multipart/);
    expect(() => parse(`title = "no questions"`)).toThrow(/at least one/);
  });

  it("embeds rendered quiz data in the page", () => {
    const { ctx } = setup();
    fs.mkdirSync(path.join(tmp, "quizzes"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "quizzes", "q.toml"), mc("abc"));
    const out = quizPlugin.preprocess!("{{#quiz ../quizzes/q.toml}}", ctx) as string;
    expect(out).toContain('data-quiz="quizzes/q"');
    const json = JSON.parse(/<script type="application\/json">(.*)<\/script>/.exec(out)![1]!);
    expect(json.questions[0]).toMatchObject({ id: "abc", type: "MultipleChoice", multi: false });
    expect(json.questions[0].options).toHaveLength(2);
  });
});

import { parse as parseToml } from "smol-toml";
function require_toml(s: string) {
  return parseToml(s);
}
