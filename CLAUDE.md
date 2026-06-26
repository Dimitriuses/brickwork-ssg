# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Build the site (runs `node cli.js build`) into build/
npm test               # Build + smoke test (asserts output invariants; non-zero exit on any page failure)
npm run admin          # Install admin deps + start the admin panel on http://localhost:3000
npm run admin:start    # Start the admin panel without reinstalling deps
```

The engine is invoked through a small CLI, [cli.js](cli.js): `ssg build|admin|test [--site <dir>]`. A **site** is a directory containing `config.json`, `pages/`, `assets/`, `shared/`; the default site is the current directory, so `node cli.js build` ≡ `node build.js`. The npm scripts operate on this repo's own site.

There is no linter or watch mode. After changing anything under `components/`, `generators/`, `pages/`, `assets/`, `config.json`, or `shared/`, re-run `npm run build` (or `npm test`) and open `build/index.html` (or serve `build/` with `python -m http.server 8000`).

The builder has **zero runtime dependencies** — `node build.js` runs on a clean checkout. Only the admin panel needs Express + Multer, installed into `shared/admin/node_modules/` by `npm run admin:install`.

> **v0.2 — site extensibility:** a site can author its own components, generators, and tests — site-first per-file resolution (+ `components/registry.json`), declarative sub-components, a generic `generate(ctx)` generator contract, build-script helpers, and `ssg test`. See [docs/extensibility.md](docs/extensibility.md).

## Architecture

A custom static-site generator. The build is driven by [build.js](build.js) (entered via [cli.js](cli.js)), run top-to-bottom. There is no framework. Understanding the build order in `build.js` is the key to everything else, because several behaviors depend on it.

### Engine vs. site roots

`build.js` resolves two roots so one engine can build many sites:
- **`ENGINE_ROOT`** (`__dirname`) — shared code: `components/`, `generators/`, `lib/`, the `_layout`, and `shared/admin/`.
- **`SITE_ROOT`** (`process.cwd()`) — per-site: `config.json`, `pages/`, `assets/`, `shared/` data, and the `build/` output.

Components resolve **site-first, then engine**, **per file** (`resolveComponentFile`): a site can override just `header/header.html` and keep the engine's `header.build.js`, or ship a whole new component. A site `components/registry.json` may map a component name to a folder. The `ssg` CLI chdir's into the requested `--site` so `SITE_ROOT` = cwd.

### Build pipeline (order matters)

1. Load `config.json` and `shared/database.json` (under `SITE_ROOT`).
2. **Flatten config** into uppercase template vars: nested keys join with `_` (e.g. `site.contact.email` → `{{SITE_CONTACT_EMAIL}}`), plus convenience aliases (`{{SITE_NAME}}`, `{{CONTACT_EMAIL}}`, `{{YEAR}}`, …). Arrays (e.g. the top-level `nav`) are kept as-is under their uppercase key (`{{NAV}}`) for build scripts to expand.
3. Wipe and recreate `build/` (the build is **destructive** every run).
4. Copy `assets/images/`, then each engine component's `style.css`/`script.js` into `build/assets/css|js/<component>.css|js`, then site page-specific `style.css`/`script.js`, then the engine's `generators/product-detail.css|js` (shared by generated product pages) into `build/assets/css|js/pages/`.
5. **Copy collections** (see below) into `build/<destination>`.
6. Run generators in **`generators/*.build.js`** (engine) — they write page JSON into a build scratch dir, `build/_generated-pages/`.
7. Recursively find `.json` files under `pages/` (**skipping underscore-prefixed files/folders**) and build each — plus the generated pages from step 6 — into `build/<page>.html`. Remove the scratch dir. Any generator or page failure increments an error count and makes the process **exit non-zero**.

Non-obvious constraints:
- Generators and the products component read from **`build/products`**, not `shared/products` — i.e. after collections are copied (step 5 before 6/7). This is why `PRODUCTS_DIR` defaults to `build/products`.
- `findPageFiles` **skips `_`-prefixed files and folders** (`_example`, `_faq-example`, …), so templates/examples are not built as pages. Generated pages live only in the temp `build/_generated-pages/` and are built then deleted — they never pollute the `pages/` source tree.
- A `{{COMPONENT:name}}` sitting inside an HTML comment is left untouched (not expanded).

### Components (`components/<name>/`)

A component is a folder. Recognized files:
- `<name>.html` — template with `{{VAR}}` and `{{COMPONENT:other}}` placeholders.
- `style.css` / `script.js` — auto-copied and auto-linked only on pages that use the component.
- `<name>.json` — optional; `{ "dependencies": [...], "subComponents": [...] }`.
- `<name>.build.js` — optional custom logic; **its presence overrides** plain template rendering.

**Build script contract:** `module.exports = { build }` where
`build(vars, loadComponent, replaceVariables, helpers) => htmlString` (`helpers = { slugify, escapeHtml, raw }`).
See [components/products/products.build.js](components/products/products.build.js) and [components/contactIcons/contactIcons.build.js](components/contactIcons/contactIcons.build.js) for the pattern. `header`/`footer` are config-driven: their nav links come from the top-level `nav` array and the logo from `site.logo` (via [components/header/header.build.js](components/header/header.build.js) / [components/footer/footer.build.js](components/footer/footer.build.js)).

**Rendering rules** (in `buildComponent`):
- `{{COMPONENT:name}}` is resolved recursively with circular-dependency protection (a cycle emits an HTML comment instead of looping).
- `replaceVariables` (in `build.js`, backed by [lib/html.js](lib/html.js)) **HTML-escapes string/number values by default** and uses a function replacer (so `$` sequences in values are literal). Wrap pre-built HTML in `raw(...)` to insert it verbatim — build scripts do this for assembled fragments (carousels, lists, icons, the page body, css/js link tags). It also **skips arrays** — a list (e.g. `FAQ_ITEMS`) must be expanded by a `.build.js`.
- Sub-components (e.g. `faqItem`→`faq`, `productCard`→`products`) are **declared** in the parent's `<name>.json` (`"subComponents": ["faqItem"]`); the engine scans every component config across both roots to build the map.
- `header` and `footer` render on **every** page regardless of a page's `components` list. `footer` pulls in `contactIcons` via its dependency + a `{{COMPONENT:contactIcons}}` placeholder.

### Pages (`pages/<name>/<name>.json`)

Fields: `page` (output filename), `title`, `description`, `header_theme` (`"dark"`/`"light"` → `<body data-header-mode>`), `layout` (default `_layout`), and `components: [{ name, vars }]`.

Content body resolution order: explicit `content_file` → inline `content` string → auto-load `<page>.html` from the same folder.

Component **placement**: if the content body contains `{{COMPONENT:name}}`, that component is injected there; otherwise it is prepended to the top of the page. The master template is [components/_layout/_layout.html](components/_layout/_layout.html), which slots in `{{HEADER}}`, `{{CONTENT}}`, `{{FOOTER}}`, and the auto-collected CSS/JS links (`{{HEAD_EXTRA}}`/`{{BODY_EXTRA}}`). Just before write, `normalizeWebPaths` rewrites backslashes to `/` inside `src`/`href`/`url(...)`. Bootstrap 5.3 + Bootstrap Icons load from CDN in the layout.

### Collections & product pages

`shared/database.json` lists collections (`{ name, source, destination, enabled }`); enabled ones are copied from `source` (under `SITE_ROOT`) into `build/<destination>`. A product is a folder containing `product.json` (`name`, `price`, `description`, `details`) plus image files (`.jpg/.png/.gif/.webp`); the first image is the primary.

The generators [generators/generate-products.build.js](generators/generate-products.build.js) (scans `build/products`) and [generators/generate-custom.build.js](generators/generate-custom.build.js) (scans `build/custom`) fill the engine templates [generators/_product-detail-template.html](generators/_product-detail-template.html) / [generators/_custom-detail-template.html](generators/_custom-detail-template.html), slugify the folder name into a selector-/URL-safe id (via [lib/slugify.js](lib/slugify.js)), and write one `_generated-product-<id>.json` into the temp `build/_generated-pages/`, which step 7 builds into `product-<id>.html`. Pages whose name starts with `product-` pick up the engine's `generators/product-detail.css|js`. Generators read the product **data** from the site (`build/...`) but their **template** from the engine (`__dirname`). They use the contract `module.exports = { generate(ctx) }` and run from both `generators/` and `SITE_ROOT/generators` (engine first). See [docs/generator-migration.md](docs/generator-migration.md) for the contract; the pre-0.2 `generateProductPages(outputDir)` export was **removed in v0.2.1**.

**Products pagination & image loading.** The `products` component takes a `PRODUCTS_PER_PAGE` var (in a page's component `vars`): a positive integer paginates the grid, `0`/unset/invalid disables it. Pagination is **client-side** — every card is rendered at build time; [components/products/script.js](components/products/script.js) reads `data-products-per-page` and slices `.products-grid` into pages with Bootstrap pager controls. All product/detail `<img>` tags carry `loading="lazy" decoding="async"` so off-screen/paginated-away images don't download until shown. The HTML text still scales linearly with product count; per-page HTML splitting is a not-yet-built option.

### Admin panel (`shared/admin/`)

[shared/admin/server.js](shared/admin/server.js) is an Express REST API (port 3000) for CRUD on products and image uploads (Multer), launched via `ssg admin [--site <dir>]`. It manages the site at the **working directory** (`ROOT_DIR = process.cwd()`) — reading `shared/database.json` to resolve collection sources and **writing directly into the site's `shared/<source>/`** — while serving its own UI from the engine (`__dirname`). Untrusted `:id`/`:filename`/upload-name params are validated against path traversal. It does not touch `build/` or run the builder; run `npm run build` afterward to regenerate the site.
