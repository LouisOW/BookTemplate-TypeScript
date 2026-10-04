import fs from "node:fs";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import { normaliseAnswer, type QuizData, type QuizQuestion } from "../../shared/quiz";
import { BookError, type Plugin, type PluginContext } from "../config";

const QUIZ_DIRECTIVE = /^\{\{#quiz\s+([^}\s]+)\s*\}\}\s*$/gm;

/**
 * `{{#quiz ../quizzes/name.toml}}` -> an interactive quiz.
 *
 * Quiz files use the same TOML format as mdbook-quiz, minus the Rust-only
 * `Tracing` question type. See `quizzes/ch01-01-section-title.toml`.
 */
export const quizPlugin: Plugin = {
  name: "quiz",
  preprocess(source, ctx) {
    if (!ctx.config.features.quizzes) return source.replace(QUIZ_DIRECTIVE, "");
    return source.replace(QUIZ_DIRECTIVE, (_m, rel: string) => {
      const file = path.resolve(path.dirname(ctx.file), rel);
      const data = loadQuiz(file, ctx);
      const json = JSON.stringify(data).replace(/</g, "\\u003c");
      return (
        `<div class="quiz" data-quiz="${data.name}">` +
        `<script type="application/json">${json}</script>` +
        `<noscript>This quiz needs JavaScript.</noscript></div>\n`
      );
    });
  },
};

export function loadQuiz(file: string, ctx: PluginContext): QuizData {
  const display = path.relative(ctx.config.root, file);
  if (!fs.existsSync(file)) throw new BookError(`quiz file not found: ${display}`, ctx.page.path);

  let raw: unknown;
  try {
    raw = parseToml(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new BookError(`invalid TOML: ${(e as Error).message}`, display);
  }

  // Quiz ids must be unique across the whole book, because answers are cached by id.
  let ids = ctx.buildState.get("quiz:ids") as Map<string, string> | undefined;
  if (!ids) ctx.buildState.set("quiz:ids", (ids = new Map()));

  const questions = validateQuiz(raw, display, ids).map(q => renderQuestion(q, raw, ctx));
  return {
    name: display.replace(/\\/g, "/").replace(/\.toml$/, ""),
    fullscreen: ctx.config.quiz.fullscreen,
    cacheAnswers: ctx.config.quiz.cacheAnswers,
    questions,
  };
}

/** A question as written in TOML, after validation. */
export type SourceQuestion =
  | {
      id: string;
      type: "MultipleChoice";
      prompt: { prompt: string; distractors: string[]; sortAnswers?: boolean };
      answer: { answer: string | string[] };
      context?: string;
      multipart?: string;
    }
  | {
      id: string;
      type: "ShortAnswer";
      prompt: { prompt: string };
      answer: { answer: string; alternatives?: string[] };
      context?: string;
      multipart?: string;
    };

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks a parsed quiz file and returns its questions, or throws a helpful BookError. */
export function validateQuiz(raw: unknown, file: string, seenIds = new Map<string, string>()): SourceQuestion[] {
  const fail = (msg: string): never => {
    throw new BookError(msg, file);
  };
  if (!isObj(raw) || !Array.isArray(raw.questions) || raw.questions.length === 0) {
    fail("needs at least one [[questions]] entry");
  }
  const root = raw as { questions: unknown[]; multipart?: unknown };
  const multipart = isObj(root.multipart) ? root.multipart : {};

  return root.questions.map((q, i) => {
    const where = `question ${i + 1}`;
    if (!isObj(q)) return fail(`${where}: not a table`);
    if (!isStr(q.id) || q.id.trim() === "") return fail(`${where}: missing "id" (generate one with \`uuidgen\`)`);
    const prev = seenIds.get(q.id);
    if (prev) fail(`${where}: id "${q.id}" is already used in ${prev}`);
    seenIds.set(q.id, file);

    if (q.type === "Tracing") {
      fail(`${where}: "Tracing" questions are Rust-specific. Use MultipleChoice or ShortAnswer instead`);
    }
    const prompt = isObj(q.prompt) ? q.prompt : fail(`${where}: missing prompt.prompt`);
    const answer = isObj(q.answer) ? q.answer : fail(`${where}: missing answer.answer`);
    if (!isStr(prompt.prompt)) fail(`${where}: prompt.prompt must be a string`);
    if (q.context !== undefined && !isStr(q.context)) fail(`${where}: context must be a string`);
    if (q.multipart !== undefined) {
      if (!isStr(q.multipart) || !isStr(multipart[q.multipart])) {
        fail(`${where}: multipart = "${String(q.multipart)}" has no matching entry under [multipart]`);
      }
    }

    switch (q.type) {
      case "MultipleChoice": {
        const distractors = prompt.distractors ?? [];
        if (!isStrArray(distractors)) fail(`${where}: prompt.distractors must be a list of strings`);
        const a = answer.answer;
        if (!(isStr(a) || (isStrArray(a) && a.length > 0))) {
          fail(`${where}: answer.answer must be a string, or a non-empty list for select-all questions`);
        }
        if (isStr(a) && (distractors as string[]).length === 0) {
          fail(`${where}: a single-answer question needs at least one distractor`);
        }
        break;
      }
      case "ShortAnswer":
        if (!isStr(answer.answer)) fail(`${where}: answer.answer must be a string`);
        if (answer.alternatives !== undefined && !isStrArray(answer.alternatives)) {
          fail(`${where}: answer.alternatives must be a list of strings`);
        }
        break;
      default:
        fail(`${where}: unknown type "${String(q.type)}" (expected MultipleChoice or ShortAnswer)`);
    }
    return q as unknown as SourceQuestion;
  });
}

function renderQuestion(q: SourceQuestion, raw: unknown, ctx: PluginContext): QuizQuestion {
  const md = (s: string) => ctx.md.render(s);
  const mdInline = (s: string) => ctx.md.renderInline(s);
  const multipartSrc = q.multipart ? ((raw as { multipart: Record<string, string> }).multipart[q.multipart] ?? "") : undefined;
  const base = {
    id: q.id,
    prompt: md(q.prompt.prompt),
    multipart: multipartSrc ? md(multipartSrc) : undefined,
    context: q.context ? md(q.context) : undefined,
  };
  if (q.type === "MultipleChoice") {
    const answers = Array.isArray(q.answer.answer) ? q.answer.answer : [q.answer.answer];
    return {
      ...base,
      type: "MultipleChoice",
      multi: Array.isArray(q.answer.answer),
      sortAnswers: q.prompt.sortAnswers ?? false,
      options: [
        ...answers.map(a => ({ html: mdInline(a), correct: true })),
        ...(q.prompt.distractors ?? []).map(d => ({ html: mdInline(d), correct: false })),
      ],
    };
  }
  return {
    ...base,
    type: "ShortAnswer",
    accepted: [q.answer.answer, ...(q.answer.alternatives ?? [])].map(normaliseAnswer),
    display: q.answer.answer,
  };
}
