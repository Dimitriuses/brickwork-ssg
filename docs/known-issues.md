# Known issues & structural inconsistencies

A running log of bugs and structural inconsistencies, so they aren't forgotten. Add new (open)
entries at the top; keep each short — symptom, why it matters, a sketch of the fix, status. Resolved
entries stay as a record, marked ✅ Fixed.

> The block of open entries below is from a **2026-07-07 audit** (engine ≈ v0.7.0) — ordered
> most-severe first. Each was verified against the code (and, where marked *reproduced*, against a
> live fixture build).

## ✅ A mis-set `dirs.output` deletes site source — the wipe is unvalidated *(fixed)*

**Symptom.** The build wipes `BUILD_DIR` blind (`fs.rmSync(BUILD_DIR, { recursive: true })`,
build.js ~840) and `lib/dirs.js` does no validation of `dirs.output`. *Reproduced:* a site with
`"dirs": { "output": "pages" }` **deleted its own `pages/` source tree**, built 0 pages, and
reported "Build completed successfully" (exit 0). `"output": "."` would delete the whole site
including `.git`; `".."` the parent folder.

**Why it matters.** One config typo destroys un-committed work irrecoverably. The build is
documented as destructive, but the destructive *target* is user-configurable with zero guarding —
the sharpest edge in the project.

**Fix.** ✅ Done. New `outputDirError(siteRoot, config)` in [lib/dirs.js](../lib/dirs.js): the
resolved output dir is rejected (a `path.resolve` prefix check) when it **equals the site root**,
**escapes the site root**, or **contains** any source dir (`pages`/`components`/`generators`/
`assets`/`test`), the `database` file, the `admin` folder, or `config.json`. `build.js` calls it
**before** the `rmSync` and aborts loudly (a real error → non-zero exit, FAILED summary) instead of
wiping. Smoke builds a site with `output` set to `pages` / `.` / `..` and asserts each fails with
its message *and the source survives*, plus a valid `dist` still builds.

**Status.** ✅ Fixed.

## ✅ `log.error` doesn't fail the build — some errors exit 0 as "completed successfully" *(fixed)*

**Symptom.** `build.js` keys the exit code and the summary verdict off its own `buildErrors`
counter, not the logger's tally — and not every `log.error` call site increments it. *Reproduced:* a
collection whose `source` folder is missing prints `[ERROR] ghost: Source not found`, then "Build
completed successfully", exit **0**. (`lib/log.js` exposes `errorCount` precisely for this — the
terminal-UX plan says "the logger owns the error tally → it drives the process exit code" — but
nothing reads it.) Relatedly, `resolveCollectionItems` on a missing source silently returns `[]`,
so a template page "successfully" builds zero pages.

**Why it matters.** CI ships a site with no products and a green build. Two parallel error tallies
is exactly the drift the log module was built to end.

**Fix.** ✅ Done. `build.js` now reconciles at the end:
`const errorCount = Math.max(buildErrors, log.errorCount)`, and both the summary verdict and the
exit code key off `errorCount`. The logger's tally is the source of truth, so **any** `log.error`
fails the build even if a call site forgot to bump the local counter (belt-and-suspenders that also
guards future error sites). Smoke builds a site with a missing collection source and asserts a
non-zero exit + a FAILED verdict.

**Status.** ✅ Fixed.

## ✅ No page-config validation — a config without `page` ships `build/undefined.html` *(fixed)*

**Symptom.** `buildPage` uses `pageData.page` unchecked: a page `.json` missing the `page` field
writes **`build/undefined.html`** (*reproduced*, exit 0, no warning). The auto-content lookup also
keys off `pageData.page` (`undefined.html` was looked for), so the page body silently comes up
empty. And since `findPageFiles` collects **every** `.json` under `pages/` (any filename), a stray
data/notes JSON dropped in a page folder becomes a "page" too.

**Why it matters.** The engine's stated philosophy is loud build-time validation (template pages
get it; data models get it) — normal pages, the most common material, get none.

**Fix.** ✅ Done. The classification loop in `build.js` now rejects a non-template, non-excluded
config that lacks a non-empty string `page`: a **loud build error with the file path** (and a hint
to prefix a non-page JSON with `_`) instead of `undefined.html`. Foreign JSON dropped in `pages/` is
caught by name; the `_`-prefix escape hatch still excludes intentional non-page JSON. Smoke asserts
a page-less config fails (no `undefined.html`), a `_`-prefixed one is excluded, and a valid page
still builds.

**Status.** ✅ Fixed.

## ✅ Page-folder assets: nested pages ignored, excluded `_` folders still copied, `_`-strip collides *(fixed)*

**Symptom.** Three related holes in the page-asset pass (`collectComponentAssets` /
`copyComponentAssets`):
1. Page discovery is **recursive** (`pages/blog/post/post.json` builds), but the asset pass only
   handles **top-level** `pages/<dir>/` — a nested page's `style.css`/`script.js` is silently
   neither copied nor linked (*reproduced*).
2. A `_`-prefixed page folder is **excluded from the build**, but its `style.css`/`script.js` is
   still copied into `build/assets/*/pages/`.
3. Output names strip the leading `_`, so `pages/_shop/style.css` and `pages/shop/style.css` both
   emit `pages/shop.css` — *reproduced:* the **excluded draft folder's CSS silently overwrote the
   real page's**, in filesystem-enumeration order (platform-dependent which one wins).

**Why it matters.** "Comment out a page with `_`" can silently restyle the live page it shadowed;
nested pages half-work (HTML yes, assets no) with no message.

**Fix.** ✅ Done. Page assets are now named by a `pageAssetName(relFolder)` helper — each source
folder segment (relative to `PAGES_DIR`) has a cosmetic leading `_` stripped, then joined with `-`
(`blog/post` → `blog-post`, `_custom-detail` → `custom-detail`) — so nested pages are distinct and
never collide with a top-level leaf of the same name. A new `copyPageAssets(pageFolders)` is driven
by the **built-page set** (normal + template folders, computed after classification), not a blind
`readdir`: an excluded `_`-page's asset never ships (fixing #2 and the #3 overwrite), and nested
pages are covered (#1). Both `collectComponentAssets` (the link) and `copyPageAssets` (the file) use
the page's real source folder, so a page whose folder name differs from its `page` value also
resolves. A genuine output-name collision is now a **loud build error**, not a silent overwrite.
Smoke covers nested copy+link, the excluded-`_` non-ship, and the collision error.

**Status.** ✅ Fixed.

## ✅ Placeholder re-substitution — `{{X}}` inside a *value* is expanded (order-dependent) *(fixed)*

**Symptom.** `replaceVariables` loops over vars and re-scans the whole accumulated result for each
key, so a **value** containing placeholder-looking text is substituted by any var processed later.
*Reproduced:* component vars `{ "AAA": "user typed {{ZZZ}} here", "ZZZ": "SECRET" }` render
`AAA` as `user typed SECRET here`. In `buildPage`'s `pageVars`, `CSS_LINKS`/`JS_SCRIPTS`/
`HEAD_EXTRA`/`BODY_EXTRA` are inserted **after** `CONTENT` — so untrusted collection data (fed into
content via `map`/generator vars) containing e.g. `{{JS_SCRIPTS}}` gets the real script tags
injected. HTML-escaping doesn't help: `{{…}}` survives it.

**Why it matters.** It's a data→template injection channel (admin-editable `product.json` text can
pull build internals into the page) and makes rendering depend on object key order — a classic
latent heisenbug.

**Fix.** ✅ Done. `replaceVariables` now builds one regex — `\{\{(k1|k2|…)\}\}`, keys regex-escaped
and longest-first — and does a **single `template.replace`** with a callback lookup, so only the
template's own placeholders are filled and inserted values are never re-scanned. Arrays still stay
literal (build scripts expand them); the callback form keeps `$`-sequences literal. Semantics are
unchanged for every legitimate template. Smoke asserts a `{{ZZZ}}` inside `AAA`'s value renders
literally while `ZZZ` itself still resolves.

**Status.** ✅ Fixed.

## ✅ A component's vars depend on *how* it was placed — three different scopes *(fixed)*

**Symptom.** The same component renders with different data depending on the mechanism: **declared**
in `components: []` → only its own `vars` (`buildComponent(comp.name, comp.vars || {})` — no config
vars; *reproduced:* `{{SITE_NAME}}` in a declared component stays literal and only surfaces via the
unresolved-var warning); **inline** `{{COMPONENT:x}}` in content → the full `flatConfig` (and *no*
page component vars, even if the same component is also declared with vars); **layout dependency**
(header/footer) → all of `pageVars` (flatConfig + layout vars + chrome).

**Why it matters.** "Why does `{{SITE_NAME}}` work in the header but not in my card component?" has
a three-branch answer. It also blocks a component from being moved between placement styles without
re-plumbing its vars.

**Fix.** ✅ Done. `buildPage` now builds a declared component with
`{ ...flatConfig, ...(comp.vars || {}) }` — site config as the base, the component's own vars on top
— matching the scope an inline `{{COMPONENT:x}}` and a layout dependency already get. So a component
renders identically however it is placed, and `{{SITE_NAME}}` fills in a declared card. **Behavior
change** (a declared component now sees config vars it didn't before; its own vars still win) —
release-noted. Both first-party sites build unchanged; smoke asserts the base+override scope.

**Status.** ✅ Fixed.

## ✅ `ssg test` hardcodes `build/` — a site with a relocated `dirs.output` can never pass *(fixed)*

**Symptom.** `lib/test-runner.js:30` does `path.join(siteRoot, 'build')` while the build honors
`dirs.output` (and the same file resolves `dirs.test` two lines later). *Reproduced:* a site with
`"output": "dist"` builds fine, then every engine check fails with `FAIL build/ directory exists`
(or worse, checks a *stale* old `build/`, silently validating the wrong output). Site tests get the
same wrong `ctx.buildDir`.

**Why it matters.** The README sells `dirs` as covering the whole workspace; the test command is
the one consumer that didn't get the memo — and it's the verification layer, where a stale-dir
false-positive is most costly.

**Fix.** ✅ Done. `runSiteTests` now resolves `const buildDir = siteDirs(siteRoot).output;` — so the
engine checks and each site test's `ctx.buildDir` point at the real (possibly relocated) output. The
`dirs.output` smoke fixture now also runs `ssg test` and asserts the checks pass against `dist/`.

**Status.** ✅ Fixed.

## ✅ Admin: file routes aren't scoped to the part, and writes are CSRF-able *(fixed)*

**Symptom.** Two related holes in `catalog/admin/server.js`:
1. `DELETE …/parts/:part/files/:filename` validates only that the part *exists*, then unlinks any
   safe-segment filename in the item folder — so `DELETE …/parts/images/files/product.json`
   **deletes the object part's data file** through the image manager. `GET /files/:collection/:id/
   :filename` similarly serves any item file regardless of part.
2. There's no auth *and no CSRF/Origin defense*: `express.urlencoded` + multer accept cross-origin
   form posts, so while the server binds `127.0.0.1`, any web page the user visits can fire
   create-item / upload-file POSTs at `http://127.0.0.1:3000` from their own browser (classic
   local-dev-server CSRF / DNS-rebinding surface).

**Why it matters.** The admin edits *real source data* (the private site's gitignored collections).
Path traversal was hardened; part-scoping and browser-mediated requests weren't.

**Fix.** ✅ Done. **(1)** New `model.filePart(parts, filename)` returns the servable (non-`object`)
part a filename belongs to, or `null`. The `GET /files/…` route now serves only files matching a
non-object part, and the `DELETE …/files/:filename` route rejects `object` parts and requires
`part.regex.test(filename)` — so neither can touch the data file. **(2)** A new pure module
[catalog/admin/lib/security.js](../catalog/admin/lib/security.js) provides `hostAllowed` (loopback
Host only — the DNS-rebinding guard, applied when bound localhost-only) and `crossOriginBlocked`
(refuse a state-changing request whose `Origin` is cross-site — the CSRF guard); a first middleware
in `server.js` enforces both, and the startup banner notes it. Smoke unit-tests `filePart` and both
predicates.

**Status.** ✅ Fixed.

## ✅ Admin ↔ engine data-model parity gaps (nested matches, schema features, image order) *(fixed)*

**Symptom.** The admin re-implements item resolution and drifts from the engine in ways the docs
don't admit:
- **Flat vs recursive matching:** the engine matches `data_model` globs against **recursive**
  relative paths (`listFilesRelative` — `gallery/*.jpg` works); the admin's `model.partFiles` lists
  **immediate files only**, so a nested part builds fine but shows empty (and uploads flat) in the
  admin. (The plan said "reuse the engine's reader — factor `resolveCollectionItems` into `lib/`";
  what shipped is a self-contained near-copy.)
- **Documented schema features that don't exist:** the admin plan's "Decided (final)" lists
  per-field `default`, `validation` (min/max/pattern) and field-level `hide: true` — none are
  implemented in `fieldTypes.js`/`app.js`. `orderable` is forwarded to the client
  (server.js:83) but **no reorder endpoint or UI exists anywhere**.
- **Image order is filename order** (the build sorts part files), the first image is the primary —
  so the one ordering that matters (the primary product photo) cannot be controlled from the admin
  at all, dead `orderable` knob notwithstanding.

**Why it matters.** The admin's whole pitch is "the data model, rendered" — silent divergence from
the build's semantics undermines it, and the unimplemented-but-documented knobs cost users real
debugging time.

**Fix.** ✅ Done, in three parts. **Recursive parity:** the admin's `model.listFiles` is now recursive
with relative posix paths (mirrors the engine's `listFilesRelative`), so `partFiles`/`filePart`/
`readItemParts` match a `gallery/*.jpg` part the same way the build does; the file `GET`/`DELETE`
routes accept a safe relative subpath (new `security.safeRelPath`, resolved segment-by-segment inside
`resolveWithin`), and object writes `mkdir -p` their target. (A plain `*.png` still stays root-only —
`[^/]*` never crosses `/` — so simple parts are unchanged; uploads to a nested part fail cleanly via
the filename filter, a documented limitation.) **Schema features implemented:** `default` (seeds a
missing form value, via `FT.initialValue`), per-field `validation` — number `min`/`max`, string/text
`minLength`/`maxLength`/`pattern` — in the field-type registry (validated server-side too), and
field-level `hide: true` (not rendered, its stored value preserved on save). **Dead knob removed:**
`orderable` is dropped from the server's `publicPartConfig` and struck from the admin plan; a real
reorder (rename-based or a `data.primary` convention) is noted there as future work. Smoke unit-tests
recursion, `safeRelPath`, the validation rules, and `initialValue`.

**Status.** ✅ Fixed (reorder left as documented future work).

## ✅ Products grid hardcodes the detail-page link pattern *(fixed)*

**Symptom.** `catalog/products/products.build.js` emits `PRODUCT_LINK: \`product-${id}.html\`` —
but the detail page's name is owned by the *template page*'s `generatorOptions.pageName`. Rename
the pattern (`item-{slug}`) or point the grid at another collection and every card links to a 404.
`lib/checks.js` compounds it by only link-checking `href="product-*.html"` (a content-specific
pattern in the "content-agnostic" checks).

**Why it matters.** Two materials are coupled through an implicit string convention with no single
source of truth — exactly the class of drift the data-model work was meant to end.

**Fix.** ✅ Done. The grid now takes a `LINK_PATTERN` component var (default `product-{slug}.html`),
substituting `{slug}` per item — so the page config that owns the detail template's `pageName` can
pass the matching pattern (e.g. `item-{slug}.html`). And `lib/checks.js` dropped the `product-`
special case: it now verifies **every** local `.html` `href` resolves under `build/` (external /
anchor / scheme targets skipped), so a grid whose link pattern drifts from its template — or any nav
typo — is caught by the always-on checks. Smoke unit-tests both the default and overridden pattern,
and that a dangling local link is flagged.

**Status.** ✅ Fixed.

## ✅ Carousel component is single-instance-per-page (hardcoded id) *(fixed)*

**Symptom.** `catalog/carousel/carousel.html` hardcodes `id="productCarousel"`, and the build
script's thumbnails all target `#productCarousel`. Two carousels on one page (e.g. a future gallery
section, or two collections) produce duplicate DOM ids and thumbnails that all drive the *first*
carousel.

**Why it matters.** It's the flagship "computed output as a component" material — and it silently
breaks the first time it's composed twice, the main thing components are for.

**Fix.** ✅ Done. The template is `id="{{CAROUSEL_ID}}"` and `carousel.build.js` computes a
selector-safe per-instance id: an explicit `CAROUSEL_ID` if given, else `carousel-<slugified ALT>`
(ALT is usually the item name), else a short stable hash of the image paths. The thumbnails point
`data-bs-target` at that id. `script.js` already read each carousel's own `id` when injecting
controls, so it needed no change. Smoke unit-tests two carousels getting distinct ids + thumbnail
targets, and the explicit-id override. (A count-based fallback was avoided: `buildComponent`
cache-busts each build script, so module state wouldn't persist across instances — the
ALT/hash derivation is order-independent.)

**Status.** ✅ Fixed.

## ✅ `--all-used` detection is narrower than the build — nested/odd-named pages are missed *(fixed)*

**Symptom.** `lib/used-materials.js` scans only **top-level** `pages/<dir>/<dir>.json` +
`<dir>.html`. The build finds pages recursively, with any `.json` filename, and content via
`content_file` — so a component referenced only from a nested page (`pages/blog/post/post.json`),
a config whose name differs from its folder, or a `content_file` body is invisible to
`ssg add material --all-used`.

**Why it matters.** This is the slim-core plan's own named sharp edge ("'used' false negatives…
slim core breaks that site") realized in code: the bridge under-detects, and the miss surfaces
later as a `not installed` build failure — or not at all until a page is added.

**Fix.** ✅ Done. `usedComponentNames` now discovers page configs the way the build does: a recursive
walk of **every** `.json` under `pages/` (so `pages/blog/post/post.json` counts), applying the same
classification (a `_`-excluded non-template page is skipped, template pages counted regardless of
`_`). For each config it adds `components[].name` + the `layout` name and scans the **resolved**
content body — `content_file` → inline `content` → auto `<page>.html`/`<basename>.html` — for inline
`{{COMPONENT:x}}`. Smoke adds a nested-page fixture (a component in a nested `components: []` and an
inline `{{COMPONENT}}` in its nested content) and asserts both are found.

**Status.** ✅ Fixed.

## ✅ Generated pages hardcode the `data` part + can't map `title`; a missing template HTML is silent *(fixed)*

**Symptom.** Two gaps in `expandTemplatePage`:
1. The built-in path derives page `<title>`/description/slug-override from a part literally named
   `data` (`item.data.name`, `item.data.description`, `item.data.slug` — and `resolveCollectionItems`
   hardcodes `item.data.slug` too). A model whose object part is named anything else silently gets
   slug-derived titles, and `map` has no way to set `PAGE_TITLE`/`PAGE_DESCRIPTION` (they're not
   template placeholders).
2. A template page without its `<name>.html` builds one **empty-content** page per item —
   `templateHtml` silently defaults to `''` while every other template-page misconfiguration fails
   loud.

**Why it matters.** The `data_model` pitch is "name your parts freely"; the built-in path quietly
disagrees. And "50 blank pages, exit 0" is the kind of silence the Phase-4 validation was built to
kill.

**Fix.** ✅ Done. **(1)** The built-in descriptor now honours **reserved `map` keys**: if the `map`
resolves `PAGE_TITLE` / `PAGE_DESCRIPTION`, those drive the page title/description (from *any* part,
e.g. `"PAGE_TITLE": "$meta.headline"`); the `data`-part `name`/`description` remain the default
fallback. **(2)** A template whose `<name>.html` is **absent** now fails loud when it declares a
`map` (placeholders with nowhere to go); with no `map`, a components-only template is legitimate so
it just warns. (The slug default stays folder-name / `item.data.slug`, documented as the convention.)
Smoke asserts a `PAGE_TITLE`-mapped title from a non-`data` part and the missing-HTML build failure.

**Status.** ✅ Fixed.

## ✅ Every component's assets ship regardless of use (docs say otherwise) + `global` name collision *(fixed)*

**Symptom.** `copyComponentAssets` copies **every** component folder's `style.css`/`script.js`
(via `allComponentNames()`) into `build/assets/css|js/` — only the *linking* is per-page. CLAUDE.md
and the README both say assets are "auto-copied and auto-linked **only on pages that use the
component**". A site with retired/experimental components ships their dead CSS/JS forever. Bonus
edge: a component named `global` emits `assets/css/global.css`, clobbering the site's real
`global.css` (and `allComponentNames` also picks up intermediate registry folders like `blocks/`
as phantom "components").

**Why it matters.** Leak control was the headline of v0.4 (`copy: false`) — the asset side quietly
violates the same principle, plus a docs/behavior mismatch.

**Fix.** ✅ Done. `collectComponentAssets` now records each component it links into a module-level
`usedAssetComponents` set as pages build; a new `copyUsedComponentAssets()` (run **after** all pages
build, when the set is complete) copies only those — so a retired/experimental component's dead
CSS/JS never ships, making the docs' "linked only where used" true for the copy too. `global.css`/
`global.js` are copied separately up front (`copyGlobalAssets`), and a component **named `global`**
is refused with a warning (its assets skipped) so it can't clobber the site global. Because copying
is driven by the used set rather than `allComponentNames()`, phantom registry folders like `blocks/`
are never copied. Smoke asserts a dead component's CSS is absent while a used one's ships.

**Status.** ✅ Fixed.

## ✅ `slugify` collapses non-Latin names to `item` — guaranteed collisions *(fixed)*

**Symptom.** `lib/slugify.js` keeps only `[a-z0-9]`, so a wholly non-Latin item name (e.g.
Ukrainian «Цегла червона») slugs to the fallback `item`. Two such items collide: page names crash
into the loud collision error at best; the products grid emits duplicate `carousel-item` DOM ids
and identical `product-item.html` links at worst (no collision check there).

**Why it matters.** Collections are the user-data surface; a non-English catalog (a plausible
first-party use case) can't produce distinct URLs without adding a per-item `data.slug` by hand,
and the failure reads as a mysterious "page name collision", not "your names transliterate to
nothing".

**Fix.** ✅ Done. `slugify` now normalizes (`NFKC`), lowercases, and keeps any Unicode letter/number
(`[^\p{L}\p{N}]+` → `-`, with the `u` flag) instead of only `[a-z0-9]` — so «Цегла червона» →
`цегла-червона` and «Цегла жовта» → `цегла-жовта` are **distinct, readable** ids (valid in URLs, CSS
selectors, and filenames). ASCII output is byte-for-byte unchanged (`Product 005 (30)` →
`product-005-30`), so the example/sites are unaffected. The `item` fallback now fires only for a name
with **no** letters or numbers at all; a genuine collision there still surfaces as the build's loud
page-name-collision error and is resolved with a per-item `data.slug`. Smoke covers ASCII stability,
non-Latin distinctness, accents, and the punctuation-only fallback.

**Status.** ✅ Fixed (the rare all-punctuation collision stays a loud build error, per design).

## ✅ `contactIcons`: unescaped hrefs, re-reads `config.json`, and depends on an undeployed image *(fixed)*

**Symptom.** Three quality gaps in the catalog material: (1) `href="${url}"` is emitted
**unescaped** (every other build script escapes attribute values); (2) it re-reads `config.json`
from disk instead of using vars — necessary only because `flattenConfig` keeps top-level *arrays*
(`nav` → `{{NAV}}`) but flattens *objects* away (`social` → `SOCIAL_*` scalars), so no structured
`SOCIAL` object reaches components; (3) the Viber branch hardcodes
`assets/images/viber-brands-solid-full.svg` — a **site** asset that `ssg add material contactIcons`
does not deploy, so a fresh adopting site gets a broken image.

**Why it matters.** (2) is the interesting one: the config-flattening asymmetry forces any
component needing a structured config object to bypass the var pipeline, which breaks the "one data
path" story (and any future non-root config). (3) is a hole in the material model itself —
materials can't declare non-component asset dependencies.

**Fix.** ✅ Done. **(2)** `flattenConfig` now **also keeps each top-level (and nested) object under
its uppercase key** (`SOCIAL`, `SITE`, `SITE_CONTACT`, …) alongside the flattened scalars — the way
arrays were already kept — and `replaceVariables` skips array/plain-object values (so a stray
`{{SOCIAL}}` stays literal, never `"[object Object]"`). `contactIcons.build.js` reads `vars.SOCIAL`
instead of re-reading `config.json`. **(1)** It now `escapeHtml`s the href (and adds `rel="noopener"`
to the `target=_blank` links). **(3)** The Viber branch renders a **self-contained inline SVG** (a
currentColor glyph) — no external image to deploy. Smoke asserts the escaped href, the inline Viber
SVG, an unknown platform skipped, `{{SOCIAL}}` staying literal, and no `[object Object]`. (The general
"materials with external asset deps" gap remains a noted deploy-model limitation.)

**Status.** ✅ Fixed.

## ✅ Catalog `_layout` bakes hero-specific fonts + CDN into every page *(fixed)*

**Symptom.** The default `_layout.html` hardloads Bootstrap CSS/JS *and* Google Fonts
(`Cinzel`/`Montserrat`, commented "for Hero") on **every page of every adopting site** — whether or
not the hero (or Bootstrap-dependent components at all) is used; plus a commented-out font link
left in. There's no mechanism for a component to contribute `<head>` resources, which is why the
hero's fonts got globalized into the layout.

**Why it matters.** Contradicts the per-component asset philosophy ("linked only where used"),
costs every page third-party requests, and couples the neutral layout to one catalog component's
design choices.

**Fix.** ✅ Done — the **longer-term** fix (the clean home). A component's `<name>.json` may now
declare a **`head`** array of raw HTML strings (font links, preloads, meta); `collectComponentHead`
walks the same graph as the assets (base + page components + deps/sub-components), dedupes, and the
layout injects them via a new **`{{HEAD_LINKS}}`** placeholder — so a component's `<head>` resources
load **only on pages that use it**. The catalog `_layout.html` dropped the hero fonts (and the stray
commented font link) and now places `{{HEAD_LINKS}}`; the fonts moved to `catalog/hero/hero.json`
`head`. The `ssg init` layout stub gained `{{HEAD_LINKS}}`. Smoke asserts the fonts load on the
example's hero page but not on `about`, and (fixture) a component's `head` appears only where used. A
site with its own `_layout.html` opts in by adding `{{HEAD_LINKS}}` (non-breaking — without it, it
just doesn't receive component head resources).

**Status.** ✅ Fixed.

## ✅ Version & scaffold drift: package.json says 0.4.0, stubs emit removed fields, stale paths *(fixed)*

**Symptom.** A bundle of drift a release pass should sweep:
- `package.json` `version` is **0.4.0** and the README opens "Status: **v0.4.0**" (pin example
  `checkout v0.4.0`) while known-issues records v0.6.4/v0.6.5 shipping — the one version number a
  user sees is three minors stale.
- `package.json` `files` still lists `components/` (gone; the catalog moved) — an npm publish would
  ship a phantom dir and miss nothing else only by luck.
- `ssg add page` stubs a top-level `"header_theme": ""` — the field v0.6.5 **removed** (layout vars
  own it now), so every fresh page starts on a dead knob; the `builder` stub's comment documents
  the helpers as `{ slugify, escapeHtml, raw }`, omitting `collection`/`log`.
- `build.js` still defines `COMPONENTS_DIR = ENGINE_ROOT/components` (dead) and `loadComponent`'s
  flat-form fallback probes the nonexistent engine `components/`; `lib/generators.js` warns via
  bare `console.log` (the one message that bypasses `--quiet`/the file sink).
- CLAUDE.md's own slim-core note admits "a full pass is pending".

**Why it matters.** Individually small; together they make the project's self-description
unreliable at exactly the places (version, scaffolds, first-run files) newcomers meet first.

**Fix.** ✅ Done. `package.json` → **`version: 0.7.0`** and `files` drops the phantom `components/`;
the README status line + the submodule-pin example → **v0.7.0**. The `ssg add page` stub drops the
removed top-level `header_theme` and emits the grouped **`layout: { name, vars }`** form; the
`builder` stub comment lists the full helpers (`… raw, collection, log`). `build.js` deletes the dead
`COMPONENTS_DIR` and the nonexistent-engine-`components/` flat-form probe; `lib/generators.js` routes
its parse warning through **`lib/log`** (so `--quiet`/the file sink apply). CLAUDE.md gained a **v0.7
audit note** documenting the new engine behaviors + the `head` component file (a full architectural
`components/`→`catalog/` rewrite of the older prose remains its own documentation task, still flagged
in the doc). Smoke asserts the page stub is the grouped form with no `header_theme`.

**Status.** ✅ Fixed (concrete drift swept; the broader CLAUDE.md prose rewrite stays a separate docs task).

## Hot-path caching: component configs and files re-resolved per page × component

**Symptom.** The per-page loops re-do filesystem work that never changes within a build:
`readComponentConfig` re-reads + re-parses each component's `.json` on **every**
`collectComponentAssets` call (twice per component per asset kind per page);
`resolveComponentFile` probes up to four `existsSync` candidates per file per use; every
`buildComponent` with a build script does `delete require.cache` + `require` **per component
instance**; the generator registry is re-read per template page; the unresolved-`{{VAR}}` scan
re-reads every built HTML at the end. For the current sites (~50 pages) this is milliseconds — but
cost grows O(pages × components × fs-call), and it's the build's main scaling term now that
generation is declarative.

**Why it matters.** "Builds in well under a second" is a stated selling point; a few-hundred-page
site with a dozen components each would spend most of its build in redundant stat/read/parse. All
of it is trivially memoizable because the build is single-shot (nothing mutates components
mid-run).

**Fix (sketch).** Memoize `readComponentConfig` and `resolveComponentFile` in
`lib/components.js` (per-factory `Map`, like the existing `_siteRegistry`/`_subcomponentMap`
caches); require each build script once per build (the cache-bust is only needed *across* builds in
a future watch mode — scope it there); read the generator registry once.

**Status.** Open.

## ✅ Page config flat-mixes page identity, layout params, and content *(fixed)*

**Symptom.** A page's `<name>.json` puts everything at the top level: `page` (the output name /
identity), `title` + `description` (page metadata), `header_theme` (a layout-appearance param), `layout`
(the wrapper name), and `components` (the content). So `header_theme` — which only configures the layout
— sits next to `page`, ungrouped; the three concerns (identity/metadata, layout + its params, content)
are one flat bag.

**Why it matters.** Structurally muddy — a reader can't tell which fields configure the layout vs
identify the page. It's also inconsistent: content `components` are `{ name, vars }`, but the layout
(also a component) is a bare `layout: "_layout"` string with its params scattered as sibling keys.

**Fix.** ✅ Done. `buildPage` accepts `layout` as a **string** *or* a **`{ name, vars }`** object (same
shape as a `components` entry), so layout params group under it:
`"layout": { "name": "_layout", "vars": { "header_theme": "dark" } }`. `title`/`description` stay
page-level (page metadata / future SEO — resolved to `PAGE_TITLE`/`PAGE_DESCRIPTION`). Shipped in two
steps: **v0.6.4** added the grouped form (with a temporary top-level `header_theme` fallback); **v0.6.5**
completed it — both sites migrated their pages to `layout.vars`, the deprecated fallback was **removed**,
and `header_theme` is now processed **entirely by `_layout`**: `buildPage` just forwards `layout.vars`
(the `...layoutVars` spread — the build does no layout-specific processing) and the `_layout` build
script reads `vars.header_theme` → `HEADER_MODE`. (The same audit found + fixed a latent `used-materials`
crash on an object-form `layout` under `ssg add material --all-used`.) Smoke covers both forms.

**Status.** ✅ Fixed (grouped form in v0.6.4; sites migrated, fallback dropped, `header_theme` fully
layout-handled in v0.6.5).

## ✅ `{{COMPONENT:x}}` in page CONTENT is expanded by the layout pass (commented / undeclared too) — v0.6.0 regression *(fixed)*

**Symptom.** A `{{COMPONENT:name}}` that appears in a page's **content** but isn't resolved during the
content build — because `name` isn't in the page's `components` array, or the placeholder is **commented
out** (`<!-- {{COMPONENT:faq}} -->`) — is now **expanded anyway**. Since v0.6.0 the layout renders through
`buildComponent`, whose `{{COMPONENT:…}}` scan runs over the layout HTML *after* the page content has been
injected into `{{CONTENT}}` — so leftover `{{COMPONENT:x}}` in the content get picked up and built. At
v0.5.1 the layout was filled with `replaceVariables` (no `{{COMPONENT}}` scan), so those leftovers stayed
literal/inert. Found migrating the private site to v0.6.0: `<!-- {{COMPONENT:faq}} -->` (faq deliberately
disabled on that page) rendered the faq, and the faq HTML's own `<!-- … -->` comments closed the author's
comment early — exposing unfilled `{{FAQ_*}}` vars (a failing `ssg test`).

**Why it matters.** "Comment out a component to disable it" silently breaks, and an undeclared inline
`{{COMPONENT:x}}` renders `x` without the page's vars. It's a behavior change from v0.5.1 that can turn a
clean site into broken output on the v0.6.0 bump.

**Fix.** ✅ Done (`fix/known-issues`). `buildComponent`'s `{{COMPONENT:…}}` pass is now **comment-aware**,
mirroring the content pass in `buildPage`: it skips any placeholder inside an `<!-- … -->` range, so a
commented-out reference stays literal (disabled) even after the layout injects it via `{{CONTENT}}`. The
pass also switched from collect-then-string-replace to a single callback replace — which additionally
prevents a live `{{COMPONENT:x}}` from being resolved into an *earlier* commented one of the same name.
The layout's own (non-commented) `{{COMPONENT:header/footer}}` still resolve. A smoke check builds a page
with a live + a commented `{{COMPONENT}}` and asserts only the live one (and the layout's) render. The
site workarounds (neutralized comments) remain harmless.

**Status.** ✅ Fixed.

## ✅ `ssg build` doesn't catch unresolved `{{VAR}}` / `{{COMPONENT}}` — only `ssg test` does *(fixed)*

**Symptom.** When a template leaves a placeholder unresolved — e.g. a custom `_layout.html` still
using `{{HEADER}}` after that var was removed — the literal `{{HEADER}}` ships in the output HTML and
`ssg build` **exits 0** with no warning. The "no unresolved `{{VAR}}`" / "no leftover `{{COMPONENT:..}}`"
invariants live in the always-on checks (`lib/checks.js`, lines 26–27 / 46–47), which run only via
`ssg test` (through `lib/test-runner.js`). (Discovered building the private site against the
header/footer-deps engine: 51 pages "built", output held literal `{{HEADER}}`/`{{FOOTER}}` and zero
`<header>`/`<footer>`, exit 0.)

**Why it matters.** A broken migration — or any typo'd placeholder — produces visibly broken pages
that a plain `npm run build` + deploy ships without complaint; the failure only surfaces if the site
also runs `ssg test`. A sharp edge for the header/footer migration below, and for `ssg init`-scaffolded
sites that may not have wired up tests yet.

**Fix (sketch).** Run the unresolved-placeholder scan during `build` too — either always (fail the
build, matching "the build exits non-zero on any page/generator failure") or as a **warning** through
`lib/log.js` (non-fatal: `build` stays lenient but noisy). Leaning warning-by-default with an opt-in
strict mode, so `build` doesn't suddenly start failing sites that tolerate a stray placeholder. Reuse
`checks.js`'s `visible` scan (it strips HTML comments) — but note it does **not** strip code samples,
so a literal `{{VAR}}` in visible `<pre>`/`<code>` is a known false-positive to scope out first.

**Fix.** ✅ Done in two parts. **`{{COMPONENT}}`** (Phase 2 B): a visible unresolved `{{COMPONENT:x}}`
now fails the build — `buildComponent` resolves it and an unowned component throws `is not installed —
run ssg add material x` (non-zero exit). **`{{VAR}}`** (`fix/known-issues`): after the build, `build.js`
scans the output HTML (comments stripped, as in `checks.js`) and **warns** on any remaining
`{{VAR}}` — non-fatal by design (`build` stays lenient), listing the vars + pages; `ssg test` still
**fails** on them (the enforcement path). So `ssg build` is no longer silent. A smoke check builds a
site with an unresolved `{{VAR}}` and asserts the warning + a clean exit (and that a commented-out
placeholder is ignored). Note kept from the sketch: the scan strips comments but **not** code samples,
so a literal `{{VAR}}` in visible `<pre>`/`<code>` would warn (rare; a future opt-in strict mode could
fail the build).

**Status.** ✅ Fixed (`{{COMPONENT}}` build-fatal; `{{VAR}}` warns at build, fails at test).

## ✅ Rename the layout's built-asset vars `{{HEAD_EXTRA}}` / `{{BODY_EXTRA}}` *(fixed)*

**Symptom.** The layout placeholders `{{HEAD_EXTRA}}` (in `<head>`) and `{{BODY_EXTRA}}` (end of
`<body>`) don't say what they hold: the engine fills them with the **built component CSS `<link>`
tags** and **JS `<script>` tags** respectively (`build.js`: `HEAD_EXTRA: raw(cssLinks)`,
`BODY_EXTRA: raw(jsScripts)`). "EXTRA" reads like an open-ended slot, not "the bundled styles/scripts".

**Why it matters.** Clarity for layout authors — the names should reflect that these are the collected
CSS/JS link/script tags, not arbitrary extra markup.

**Fix.** ✅ Done (`fix/known-issues`) — **non-breaking**, via the "both names for one release" path.
`buildPage` now fills **`{{CSS_LINKS}}`** and **`{{JS_SCRIPTS}}`** (the self-describing names, matching
the internal `cssLinks`/`jsScripts`) and keeps `{{HEAD_EXTRA}}`/`{{BODY_EXTRA}}` as **deprecated
aliases** (same value). The engine's shipped templates — the catalog `_layout.html` and the `ssg init`
layout stub — use the new names; the test fixtures (and the sites) stay on the old names to prove the
aliases still fill. So nothing breaks; sites migrate at leisure. A smoke check asserts a layout using
*both* names fills both. **To finish later:** migrate the sites' `_layout.html` to the new names, then
drop the aliases in a future (breaking) release.

**Status.** ✅ Fixed (new names shipped; old names deprecated-but-working).

## ✅ Build crashes hard if a site has no `assets/images/` *(fixed)*

**Symptom.** `build.js` runs `copyDirectory(path.join(ASSETS_DIR, 'images'), …)` unconditionally at
startup; if the site has no `assets/images/` folder, `fs.readdirSync` throws `ENOENT` and the whole
build aborts with a stack trace instead of a clean message. (Found while building a minimal
scaffolded site.)

**Why it matters.** A fresh/minimal site — exactly what `ssg init` will produce — may not have an
images folder yet, so the first build crashes ungracefully. It also makes minimal test fixtures
awkward (they must create an empty `assets/images/`).

**Fix.** ✅ Done (`feat/slim-core`). The copy is guarded — `if (fs.existsSync(imagesDir)) copyDirectory(...)`
— so a site with no `assets/images/` builds cleanly (skips the copy + its log line). Surfaced while
building an `ssg init` blank site; a smoke check now builds a blank `ssg init` site (no images) to guard it.

**Status.** ✅ Fixed.

## ✅ Catalog build scripts `require('../../lib/...')` — broke once deployed into a site *(fixed)*

**Symptom.** The engine's component `*.build.js` scripts pulled helpers via
`const { raw, escapeHtml } = require('../../lib/html')`. That relative path only resolves while the
script lives in the engine tree; the moment a site **owns** a copy (a hand-copy, or `ssg add material`
deploying it from the catalog), `../../lib/html` resolves against the *site's* non-existent `lib/` and
the build dies with `Cannot find module '../../lib/html'`.

**Why it matters.** It made the engine's own catalog materials **not actually deployable** — defeating
the whole point of the slim-core `catalog/` + `ssg add`. The example self-deploy (Phase 2 A) hit it on
the first build. (CLAUDE.md had already documented the private site's hand-copies working around this.)

**Fix.** ✅ Done (`feat/slim-core`, Phase 2 A). The five catalog scripts that required `lib/html`
(`contactIcons`, `faq`, `footer`, `header`, `products`) now take `raw`/`escapeHtml` from the 4th
`helpers` argument `buildComponent` always passes — self-contained, so a deployed copy runs anywhere.
Same pattern the private site already used.

**Status.** ✅ Fixed.

## ✅ `componentFolder` ignored the site `registry.json` remap *(fixed)*

**Symptom.** `lib/components.js`'s `componentFolder(name)` returned `subcomponentMap()[name] || name`
— it honoured sub-component → parent-folder mapping but **not** a site `components/registry.json` remap,
even though `resolveComponentFile` *did* apply that remap for the site path. So for a component the site
relocates (e.g. `pricing` → `blocks/pricing`), `componentFolder` disagreed with where the files actually
resolve. Surfaced with `ssg add builder <name>` on a `--folder`'d component: the build script landed in
`components/<name>/` instead of the remapped folder.

**Why it matters.** Two helpers in the same module gave inconsistent answers for the same name — a
latent trap for anything using `componentFolder` (the deploy-folder set in `--all-used`, the `builder`
scaffolder).

**Fix.** ✅ Done (`feat/deploy`, with the `ssg add` R1–R3 rework). `componentFolder` now applies the
site registry remap too (`siteComponentRegistry()[folder] || folder`), agreeing with
`resolveComponentFile`. Safe for its callers: `used-materials` (a remapped component is site-owned,
skipped by `--all-used`) and `build.js` (destructures but never calls it).

**Status.** ✅ Fixed.

## ✅ Header/footer are hard-wired globally, not linked to `_layout` *(fixed)*

**Symptom.** `header` and `footer` are separate components, but nothing *declares* that the layout
uses them — the wiring is hardcoded in two places: (1) **rendering** — `buildPage` always does
`buildComponent("header"/"footer")` and injects the result as the `{{HEADER}}`/`{{FOOTER}}` *vars* the
layout references; (2) **assets** — `ASSET_KINDS.base` hardcodes `['header','footer']` (css) /
`['header']` (js) so their CSS/JS always bundle. So `_layout.html` using `{{HEADER}}`/`{{FOOTER}}` is a
naming coincidence, not a real dependency; there is no `_layout.json`.

**Why it matters.** Same shape as the `_layout` inconsistency (now fixed): "always-on" components are
special-cased rather than declared. A layout that doesn't want a header/footer still gets them built +
bundled, and a layout can't express "I depend on header + footer" the way any other component declares
`dependencies`/`subComponents`.

**Fix.** ✅ Done (branch `fix/header-footer-deps`). The engine `_layout.html` now places
`{{COMPONENT:header}}` / `{{COMPONENT:footer}}` and declares `"dependencies": ["header","footer"]` in a
new `_layout.json`; `buildPage` no longer builds header/footer or injects `{{HEADER}}`/`{{FOOTER}}`
vars, and `ASSET_KINDS.base` is now `['_layout']` (header/footer bundle via the layout's dependencies).
The per-page `header_theme` still reaches the header, and the mode derivation moved out of `buildPage`
into a new **`_layout.build.js`**: `buildPage` passes the raw `HEADER_THEME`, the layout script
derives `HEADER_MODE` (default `light`) and sets it on `vars`, so both the body attribute and the
nested `{{COMPONENT:header}}` — resolved with those same vars — fill from it. Output is
**content-identical** for the example (a whole-tree diff shows no change but working-tree line
endings). A smoke check guards that the header receives the theme.

**⚠️ Breaking for sites with a custom `_layout.html`.** A site override that still uses
`{{HEADER}}`/`{{FOOTER}}` gets literal placeholders (no header/footer) once it bumps to this engine —
and `ssg build` won't flag it (the unresolved-`{{VAR}}` check only runs in `ssg test`). **Both sites**
(private + demo) override `_layout.html`, so each needs a one-line-each swap
(`{{HEADER}}`→`{{COMPONENT:header}}`, `{{FOOTER}}`→`{{COMPONENT:footer}}`) in the same commit that
bumps their engine submodule. See **[docs/layout-migration.md](layout-migration.md)** for the full
per-site steps.

**Status.** ✅ Fixed on branch `fix/header-footer-deps` (pending merge). Enabled by the
`_layout`-as-component fix; deliberately not bundled into it.

## ✅ `_layout` is applied specially, not as a component *(fixed)*

**Symptom.** The layout is the one "component" wired into a page *outside* the component pipeline. The
build loads it directly (`loadComponent(pageData.layout || '_layout')`) and fills it from a hand-built
`pageVars` object via `replaceVariables(layout, pageVars)` (build.js ~238 and ~338–352) —
`{{CONTENT}}`, `{{HEADER}}`, `{{FOOTER}}`, `{{PAGE_TITLE}}`, `{{HEAD_EXTRA}}`, `{{BODY_EXTRA}}`, …. So
`_layout` never goes through `buildComponent`: it can't have a `_layout.build.js`, declared
`subComponents`, dependencies, or per-item component `vars` like every other component.

**Why it matters.** It's a special case that surprises — `_layout` *looks* like a component (lives in
`components/_layout/`, has `_layout.html`) but doesn't *behave* like one. It complicates the mental
model and blocks treating the layout with the same tools (a layout build script, a layout
sub-component with bundled assets, etc.). It also makes the slim-core "`_layout` is a deployable
component" decision slightly leaky: deployable, but not *rendered* like one.

**Fix (sketch, later).** Render the layout through the normal component pipeline: `_layout` becomes a
regular component whose **`CONTENT` is a variable holding the page's built HTML**, with
`HEADER`/`FOOTER`/`PAGE_TITLE`/head+body extras passed as its component `vars` (exactly how page
components already receive `vars`). The special `replaceVariables(layout, pageVars)` path in the page
builder then collapses into "build the layout component with these vars", and the layout gains
`.build.js` / `subComponents` / dependencies for free.

**Status.** ✅ **Fixed** (branch `fix/layout-as-component`). The page builder now renders the layout
via `buildComponent(layoutName, pageVars)` — the same path `header`/`footer` use — so `_layout` is a
first-class component with `CONTENT` + chrome as its vars, and a `_layout.build.js` / `subComponents`
/ `{{COMPONENT}}` now work. Output is **byte-identical** for a layout without a build script (the
common case), verified against the example, the private site, and a diff of the whole build tree; a
smoke check exercises a layout build script running.
