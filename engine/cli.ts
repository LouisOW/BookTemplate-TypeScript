import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "./build";
import { BookError, resolveConfig, type BookConfig, type ResolvedConfig } from "./config";

const USAGE = `Usage:
  npm run build              build the book into ./book
  npm run dev [-- --port N]  build, serve on http://localhost:3000 and rebuild on change`;

async function loadConfig(root: string): Promise<ResolvedConfig> {
  const file = path.join(root, "book.config.ts");
  if (!fs.existsSync(file)) throw new BookError("missing book.config.ts");
  const mod = (await import(pathToFileURL(file).href)) as { default: BookConfig };
  return resolveConfig(mod.default, root);
}

function report(e: unknown) {
  if (e instanceof BookError) console.error(`\x1b[31merror\x1b[0m ${e.message}`);
  else console.error(e);
}

async function runBuild(root: string) {
  const config = await loadConfig(root);
  const { pages, ms } = await build(config, { log: m => console.log(m) });
  console.log(`Built ${pages} pages into ${config.out}/ in ${ms} ms`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function runDev(root: string, port: number) {
  const config = await loadConfig(root);
  const outDir = path.resolve(root, config.out);
  const clients = new Set<http.ServerResponse>();

  const rebuild = async () => {
    try {
      const { pages, ms } = await build(config, { dev: true, log: m => console.log(m) });
      console.log(`Rebuilt ${pages} pages in ${ms} ms`);
      for (const c of clients) c.write("data: reload\n\n");
    } catch (e) {
      report(e);
    }
  };
  await rebuild();

  http
    .createServer((req, res) => {
      const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      if (url === "/__livereload") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      let file = path.join(outDir, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!file.startsWith(outDir) || !fs.existsSync(file)) {
        res.writeHead(404, { "Content-Type": MIME[".html"] });
        res.end(fs.existsSync(path.join(outDir, "404.html")) ? fs.readFileSync(path.join(outDir, "404.html")) : "Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, () => console.log(`Serving on http://localhost:${port}  (Ctrl+C to stop)`));

  let timer: NodeJS.Timeout | undefined;
  const watch = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, 100);
    });
  };
  for (const dir of [config.src, "quizzes", "client", "shared", "theme"]) watch(path.resolve(root, dir));
  for (const file of ["book.config.ts", "engine"]) {
    const p = path.resolve(root, file);
    if (fs.existsSync(p)) {
      fs.watch(p, { recursive: true }, () => console.log(`${file} changed: restart \`npm run dev\` to pick it up`));
    }
  }
}

const [command, ...rest] = process.argv.slice(2);
const portFlag = rest.indexOf("--port");
const port = portFlag >= 0 ? Number(rest[portFlag + 1]) : 3000;

const run = command === "build" ? runBuild(process.cwd()) : command === "dev" ? runDev(process.cwd(), port) : null;
if (!run) {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
run.catch(e => {
  report(e);
  process.exit(1);
});
