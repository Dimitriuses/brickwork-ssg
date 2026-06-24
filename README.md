# brickwork-ssg

A tiny, zero-config **static-site generator**. Build pages from reusable HTML
components and content collections — no framework, no client runtime, and zero
runtime dependencies for the build itself.

> Status: **v0.1.0**. One engine builds many sites; a site embeds this engine
> as a **git submodule** and runs it.

## A site is a directory

```
my-site/
├── config.json          # site name, contact, social, nav, logo
├── pages/               # <name>/<name>.json (+ optional <name>.html)
├── assets/              # images, global.css, global.js
└── shared/              # database.json + collections (e.g. products/)
```

## Use it in a site (git submodule)

A site is a separate repo that embeds this engine as a submodule and runs it:

```bash
git submodule add <brickwork-ssg-repo-url> engine   # embed the engine at engine/
git submodule update --init --recursive

node engine/cli.js build                 # build the site (cwd) into build/
node engine/cli.js build --site path     # or build any site directory
node engine/cli.js admin                 # product admin on http://localhost:3000
```

Add scripts to your site's `package.json`:

```json
{
  "scripts": {
    "build": "node engine/cli.js build",
    "admin": "node engine/cli.js admin"
  }
}
```

The build needs **no dependencies**. The admin panel needs the engine's deps —
install them once into the submodule: `npm --prefix engine install`.

**Pin & update the engine** by checking out a release tag inside the submodule:

```bash
git -C engine fetch --tags && git -C engine checkout v0.1.0
git add engine && git commit -m "engine v0.1.0"
```

Clone a site with its engine in one step: `git clone --recurse-submodules <site-url>`.

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