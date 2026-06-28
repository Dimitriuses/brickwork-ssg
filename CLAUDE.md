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

> **v0.2 — site extensibility:** a site can author its own components, generators, and tests — site-first per-file resolution (+ `components/registry.json`), declarative sub-components, data-only generators driven by **template pages** and resolved by name (`generators/registry.json`), build-script helpers, and `ssg test`. See [docs/extensibility.md](docs/extensibility.md).

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
4. Copy `assets/images/`, then each engine component's `style.css`/`script.js` into `build/assets/css|js/<component>.css|js`, then each **page folder's** `style.css`/`script.js` into `build/assets/css|js/pages/<page>.css|js` (a leading `_` is stripped). Template-driven pages link their template folder's asset from here.
5. **Copy collections** (see below) into `build/<destination>`.
6. Recursively find `.json` configs under `pages/` and **classify** each: a config carrying a `generatorOptions` object is a **template page** (expanded per item by its named generator — see *Generators* — and **not** built literally); a `_`-prefixed **non-template** config is excluded; the rest are normal pages. Build every normal page and every generated page into `build/<page>.html`. Any failure (including build-time validation) increments an error count and makes the process **exit non-zero**.

Non-obvious constraints:
- A generator (and the products component) reads its collection from **`build/<destination>`** (e.g. `build/products`), not `shared/` — i.e. after collections are copied (step 5 before 6). This is why `PRODUCTS_DIR` defaults to `build/products` and a generator gets `ctx.collection.dir`.
- `findPageFiles` collects **all** `.json` configs; classification (step 6) decides what builds. A template page (has `generatorOptions`) is found regardless of any leading `_`; a `_`-prefixed **non-template** page is excluded. Generated pages are assembled in memory and built directly — there is no scratch dir.
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

A collection may add a **`data_model`** to control which item files reach `build/` (leak control). It is an object keyed by part name, each `{ match, copy, required }`: `match` is an item-relative glob (`*`, `**`, `?`, `{a,b,c}`; see [lib/glob.js](lib/glob.js)), `copy` (default **`true`**) decides whether matching files are copied, and `required: true` makes a missing match a **build error**. So `"data": { "match": "product.json", "copy": false }` keeps the raw data out of `build/`. Files matching no part are copied (permissive). A collection **without** a `data_model` copies the whole folder (back-compat) and warns. `data_model` shape is validated at build time (bad glob, non-boolean `copy`/`required`, missing required → loud error). *(Mechanism only for now — `copy` default flips to `false` once generators read data from source.)*

Generation is **declared by template pages**, not auto-run. A **template page** (`pages/<name>/<name>.json` carrying a `generatorOptions` object — see [docs/generator-migration.md](docs/generator-migration.md)) names a generator and how to drive it. The engine resolves the name via `generators/registry.json` (engine defaults + a site's `generators/registry.json`, site wins; the mapped file then resolves site-first), runs its **data-only** `generate(ctx, options)` once for a list of `{ slug, title, description, vars }` descriptors, and assembles one page per item: the name comes from `generatorOptions.pageName` (substituting `{slug}`), the template's `<name>.html` is filled with the item's `vars`, and the template's `layout`/`header_theme`/`components` are inherited, then built via the normal page pipeline. `ctx.collection = { dir, webPath }` is resolved from `generatorOptions.source` (a collection in `shared/database.json`), so a generator reads item data from `build/<destination>` and links images under that web path; the folder name is slugified into a selector-/URL-safe id via [lib/slugify.js](lib/slugify.js). The built-in [generators/generate-detail.js](generators/generate-detail.js) (registered under both `products` and `custom`) turns a collection of item folders into product/custom detail pages; its template + detail-page CSS/JS live in the **site** (a `pages/<name>/` template page), not the engine. The build **fails loud** on a malformed `generatorOptions`, an unknown generator, a missing/disabled source collection, or a `<page>.html` name collision. (History: the pre-0.2 `generateProductPages(outputDir)` export and the interim v0.2 auto-run `generate(ctx)` dispatch were both removed.)

**Products pagination & image loading.** The `products` component takes a `PRODUCTS_PER_PAGE` var (in a page's component `vars`): a positive integer paginates the grid, `0`/unset/invalid disables it. Pagination is **client-side** — every card is rendered at build time; [components/products/script.js](components/products/script.js) reads `data-products-per-page` and slices `.products-grid` into pages with Bootstrap pager controls. All product/detail `<img>` tags carry `loading="lazy" decoding="async"` so off-screen/paginated-away images don't download until shown. The HTML text still scales linearly with product count; per-page HTML splitting is a not-yet-built option.

### Admin panel (`shared/admin/`)

[shared/admin/server.js](shared/admin/server.js) is an Express REST API (port 3000) for CRUD on products and image uploads (Multer), launched via `ssg admin [--site <dir>]`. It manages the site at the **working directory** (`ROOT_DIR = process.cwd()`) — reading `shared/database.json` to resolve collection sources and **writing directly into the site's `shared/<source>/`** — while serving its own UI from the engine (`__dirname`). Untrusted `:id`/`:filename`/upload-name params are validated against path traversal. It does not touch `build/` or run the builder; run `npm run build` afterward to regenerate the site.
