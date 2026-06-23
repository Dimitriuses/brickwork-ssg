# brickwork

A tiny, zero-config **static-site generator**. Build pages from reusable HTML
components and content collections — no framework, no client runtime, and zero
runtime dependencies for the build itself.

> Status: **v0.1.0**. One engine builds many sites; a site is just a directory
> of content that depends on this package.

## Install

```bash
npm install --save-dev brickwork
```

## A site is a directory

```
my-site/
├── config.json          # site name, contact, social, nav, logo
├── pages/               # <name>/<name>.json (+ optional <name>.html)
├── assets/              # images, global.css, global.js
└── shared/              # database.json + collections (e.g. products/)
```

## Build & manage

```bash
npx ssg build            # build the site in the current directory into build/
npx ssg build --site .   # explicit; --site <dir> builds any site directory
npx ssg admin            # start the product admin panel on http://localhost:3000
```

Add scripts to your site's `package.json`:

```json
{
  "scripts": { "build": "ssg build", "admin": "ssg admin" },
  "devDependencies": { "brickwork": "^0.1.0" }
}
```

## What you get

- **Components** — a folder with `<name>.html` (template), optional `style.css`/
  `script.js` (auto-linked only where used), and optional `<name>.build.js` for
  custom logic. Engine ships `header`, `footer`, `hero`, `products`, `faq`,
  `contactIcons`, and a `_layout`.
- **Overrides** — drop a same-named file in your site's `components/` to override
  any engine component or the layout, without forking engine logic.
- **Collections** — `shared/database.json` maps data folders (e.g. `products/`)
  into the build; product detail pages are generated automatically.
- **Safe templating** — values are HTML-escaped by default (`raw()` opt-out),
  ids are slugified, and the build exits non-zero on any page failure.

See [CLAUDE.md](CLAUDE.md) for the full architecture and [docs/extensibility.md](docs/extensibility.md)
for the planned v0.2 (site-authored components & generators).

## Develop the engine

```bash
npm test                 # builds the bundled example/ site and asserts invariants
```

## License

MIT
