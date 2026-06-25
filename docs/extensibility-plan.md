# v0.2 Extensibility — Implementation Plan

_Implementation plan for [extensibility.md](extensibility.md). Target release: **v0.2.0** (non-breaking minor). Branch: `feat/v0.2-extensibility`._

## Guiding rules

- **Non-breaking gate:** at every step, an engine-only site (no `SITE_ROOT/components`, `/generators`, or `/test`) builds byte-identically to v0.1.x, and the engine `npm test` stays green. Verify with the existing `example/` build before/after each phase.
- **Fixtures-driven:** each capability is proven by a small fixture under `example/` (or a dedicated `test/fixtures/` site) exercised by the smoke test — not just by manual checks.
- **Independently shippable:** phases land in order; each is a coherent, releasable increment.

## Shared primitive (land first)

A single resolver used by components, assets, and generators:

```js
// roots are [SITE_ROOT, ENGINE_ROOT]; first existing wins
function resolveAcrossRoots(relPath) { /* -> absolute path or null */ }
function rootsFor(kind) { /* 'components' | 'generators' -> [siteDir, engineDir] */ }
```

This centralizes "site-first, engine-fallback" so the four feature phases share one implementation and one set of edge-case decisions (name clash = site wins; missing = engine).

---

## Phase A — Component search paths + per-file site resolution

**Goal:** a site can add a full component (template + `.build.js` + assets), and override any single file of an engine component.

**Changes (`build.js`):**
- Introduce `COMPONENT_ROOTS = [SITE_ROOT/components, ENGINE_ROOT/components]`.
- `loadComponent`: already site-first for `.html`; re-express via `resolveAcrossRoots`.
- `buildComponent`: resolve `<name>.build.js` and `<name>.json` via the roots (today hardcoded to `COMPONENTS_DIR` = engine). A site `.build.js` now runs; an engine one still runs for engine components.
- `collectComponentAssets` / `copyComponentAssets`: enumerate component dirs from **both** roots (union by component name, site wins) so a site component's `style.css`/`script.js` are copied and linked.

**Fixture & verification:** add `example/components/pricing/` (template + `pricing.build.js` + `style.css`). Smoke: `pricing` renders, its CSS is copied to `build/assets/css/pricing.css` and linked on the page that uses it; an engine-only build is unchanged.

**Risk:** asset enumeration must dedupe by name (site over engine) and not double-link. Decision recorded: per-file resolution (site template + engine logic is allowed).

---

## Phase B — Declarative sub-components

**Goal:** remove the hardcoded `subComponentMappings`; site components can declare sub-components.

**Changes (`build.js` `loadComponent`):**
- Build the sub-component → parent map by scanning every component `.json` across both roots for `"subComponents": [...]`.
- Seed built-in defaults (`faqItem→faq`, `productCard→products`) so existing engine components work without yet declaring them; then add the declarations to `faq.json` / `products.json` and drop the seed. (`header-light/dark` already removed.)

**Fixture & verification:** a site component with its own sub-component (e.g. `gallery` + `galleryItem`) resolves. Engine-only build unchanged.

**Risk:** map must be built once per build (not per `loadComponent` call) for perf; cache it.

---

## Phase C — Generic generator contract + build-script helpers

**Goal:** sites add their own generators (neutral contract), and **both** generators and component `.build.js` scripts get a shared **helper surface** so site code never reaches into the engine's `lib/` by relative path.

**Shared helper surface (define once):** `{ slugify, escapeHtml, raw }` — the helpers the demo's and the private site's generators/components actually use (per the v0.2 decision on `ctx.lib`). Exposed as `ctx.lib` to generators and as a `helpers` argument to component build scripts. Keep it small; widen only as a concrete generator/test needs it.

**Changes — generators (`build.js` generator loop + `generators/*`):**
- New contract: `module.exports = { generate(ctx) }`, `ctx = { siteRoot, engineRoot, buildDir, outputDir, lib }`, returns written page-JSON paths.
- Scan `GENERATOR_ROOTS = [SITE_ROOT/generators, ENGINE_ROOT/generators]`. Run **engine first, then site** (so a site can shadow a page by re-emitting its `page` name; warn on collision).
- Back-compat shim: if a module exports `generate`, call it; else if it exports the legacy `generateProductPages`, call that. Then migrate the two built-ins to `generate(ctx)` (use `ctx.lib` instead of `require('../lib/...')`).

**Changes — component build scripts (`build.js` `buildComponent`):**
- Extend the contract from `build(vars, loadComponent, replaceVariables)` to `build(vars, loadComponent, replaceVariables, helpers)`, where `helpers` is the same `{ slugify, escapeHtml, raw }` surface. Backward-compatible: existing 3-arg scripts (all engine components) ignore the 4th arg.
- This closes the gap flagged in Phase A: a site `.build.js` can now escape text and emit HTML safely (`helpers.raw(...)`, `helpers.escapeHtml(...)`) instead of manual string assembly + `.replace`.

**Fixture & verification:** `example/generators/news.build.js` emits a `news-*` page from `example` data; the `example` `pricing` component's `.build.js` is refactored to use `helpers.raw`/`escapeHtml` (instead of manual `.replace`) to prove build scripts receive the helpers. Smoke: the news page is built, the pricing component still renders, built-ins still produce product pages, engine-only build unchanged.

**Risk:** keep the legacy generator shim until built-ins are migrated, then it's optional to retain (document either way). The 4th build-script arg is additive, so no component needs changing.

---

## Phase D — Site-authored tests

**Goal:** `ssg test` runs reusable checks + a site's own tests.

**Changes:**
- Extract the invariant checks from `test/smoke.js` into `lib/checks.js` → `standardChecks(buildDir) -> failures[]`.
- Re-point `test/smoke.js` at `lib/checks.js` (engine self-test unchanged in behavior).
- Add `ssg test [--site <dir>]` to `cli.js`: build the site → run `standardChecks(build/)` → discover and run `SITE_ROOT/test/*.test.js`, each `module.exports = (ctx) => {}` with `ctx = { siteRoot, buildDir, read(file), check(name, cond), standardChecks }` → exit non-zero on any failure.

**Fixture & verification:** `example/test/example.test.js` asserts a couple of example-specific facts (passes); a temporary deliberately-failing assertion proves non-zero exit; no `test/` ⇒ `ssg test` runs only standard checks.

**Risk:** test files run arbitrary Node (same trust as build scripts — documented). Keep discovery simple (`test/*.test.js`, non-recursive).

---

## Phase E — Showcase, docs, release

- **Demo:** `brickwork-demo` ships one custom component, one custom generator, and one `test/*.test.js`, exercising all of v0.2 end-to-end.
- **Docs:** update `README.md` (Theming-style section for "Custom components / generators / tests"), `CLAUDE.md`, and mark items ✅ in `extensibility.md`.
- **Release:** bump `package.json` to `0.2.0`, tag `v0.2.0`, push. Sites bump their `engine/` submodule when they want the features (optional — non-breaking).

---

## Suggested order & PRs

A → B → C → D → E, one PR each (each green on `npm test`). A and the shared resolver are the foundation; B/C/D are independent given A; E is last.

## Open decisions to confirm before coding

1. **Resolution unit** — per-file (site template + engine logic allowed) vs per-component-dir ownership. Plan assumes per-file.
2. **Legacy generator shim** — keep `generateProductPages` support indefinitely, or remove after migrating built-ins (a tiny breaking change for any external generator).
3. **`ctx.lib` surface** — exactly which helpers to expose to generators/tests (`slugify`, `escapeHtml`, `raw`, maybe `loadComponent`).
