# Your Book Title

An interactive online book with quizzes, runnable code, reader highlights and
notes, code badges, callouts, numbered listings and full-text search.

Built with a small TypeScript static-site engine (`engine/`). **Only Node.js is
needed; there's no Rust toolchain.** The source format matches mdBook
(`SUMMARY.md`, `{{#quiz}}`, `{{#include}}`, `> Note:`, `<Listing>`), so content
can move between this and an mdBook-based book.

**See [GUIDE.md](GUIDE.md)** for how every element works, how to write content
with it, and how to build new ones.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000, rebuilds and reloads on save
```

| Command | What it does |
|---|---|
| `npm run dev` | Build, serve, and live-reload while you write |
| `npm run build` | Build the static site into `book/` |
| `npm test` | Unit and build tests (vitest) |
| `npm run typecheck` | Type-check the engine, client and tests |

Requires Node.js 20 or later.

## License

Template code is MIT / Apache-2.0 (see `COPYRIGHT`). Choose a license for your own content.
