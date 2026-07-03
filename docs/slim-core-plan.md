# `ssg add`, slim core & `ssg init` — draft plan (for discussion)

> **Status: Phase 1 built on `feat/deploy` (additive; pre-release).** `ssg add` is a **scaffolding
> command** (à la `ng generate`) that creates new material with starter stubs — with *copying an
> existing engine material* as one **kind** (`material`, the earlier deploy work). All five kinds
> (`page` / `component` / `generator` / `builder` / `material`) plus `material --all-used` are
> implemented (R1–R4 below — smoke 119/0). **Phase 2** (slim core: relocate defaults to `catalog/`,
> not-installed error, `ssg init`) is the remaining breaking release. Detail:
> [tooling-and-distribution-plan.md](tooling-and-distribution-plan.md) §1–2.

## The problem

Today the engine **ships default components** (`header`, `footer`, `hero`, `products` +
`productCard`, `faq` + `faqItem`, `contactIcons`, `carousel`, `_layout`) and a site **inherits** any
it doesn't override, via **site-first per-file resolution**. Overriding means **hand-copying** a file
into the site's `components/`.

The **slim core** goal: the engine stops shipping those defaults; materials are **deployed by name**
into a site instead (`ssg add`). That fixes three real pains (phantom example output; override =
dig-and-copy; silent drift on engine update). But it's a **breaking change**: the moment the engine
drops a default, every inheriting site loses that component and the build fails to resolve it.

**Concrete stakes (measured):** the **demo** owns only `carousel` + `testimonials` and **inherits
~8** materials (`header`, `footer`, `hero`, `products`/`productCard`, `faq`/`faqItem`, `contactIcons`,
`_layout`). Under a naive slim core it would break outright. (The **private** site already owns every
component it uses — it copied them all during the v0.4 migration — so it's the "already-ejected" case.)

## `ssg add <kind> <name>` — the command model (revised)

`ssg add` is a **scaffolding + adoption** command. The **kind** picks the behaviour — mental model:
**author new** (`page` / `component` / `generator` / `builder` / `test`, created with starter stubs)
vs **adopt existing** (`material`, copied from the engine catalog — the Phase-1 work).

| kind | creates | registry | flags |
|---|---|---|---|
| **`page <name>`** | `pages/<name>/<name>.{html,css,js,json}` (stubs); `.json` = `{ "page":"<name>", "title":"", "description":"", "header_theme":"", "layout":"_layout", "components":[] }` | — | `--layout=<x>` → sets `"layout":"<x>"` |
| **`component <name>`** | `components/<name>/<name>.{html,css,js,json}` (minimal-placeholder stubs) | `--register` writes a `components/registry.json` entry (name → folder) | `--register`, `--folder=<dir>` |
| **`generator <name>`** | `generators/generate-<name>.js` (a `generate(ctx, options)` stub) | **registers** in `generators/registry.json` (`<name> → generate-<name>.js`) | — |
| **`builder <name>`** | `<name>.build.js` in the **existing** component `<name>`'s folder (a `build(vars, loadComponent, replaceVariables, helpers)` stub); **errors if the component doesn't exist** | — | — |
| **`test <name>`** | `test/<name>.test.js` (a `(ctx) => { ctx.check(...) }` stub; discovered by folder, run by `ssg test`) | — | — |
| **`material <name>`** | **copies** the engine-catalog material into the site — all files, per-file gap-fill, drift-aware (*Phase 1, already built*) | — | `--all-used`, `--force`, `--dry-run` |

**Starter stub contents (tunable):**
- `generator`: `module.exports = { generate(ctx, options) { /* return [{ slug, title, description, vars }] per item */ return []; } };`
- `builder`: `function build(vars, loadComponent, replaceVariables, helpers) { /* return the component's HTML */ return replaceVariables(loadComponent('<name>'), vars); }` + `module.exports = { build };`
- `page`/`component` `.html` a one-line placeholder/comment, `.css`/`.js` empty-or-comment, `.json` as above (`component`: `{}` or `{ "dependencies": [] }`).

**`component` — `--register` + `--folder`** *(decided)*: `--folder=<dir>` places the component at
`components/<dir>/` (instead of `components/<name>/`) and `--register` writes the
`components/registry.json` entry `{ "<name>": "<dir>" }` so the build resolves it — the declaration
knob you wanted for explicit control (and the seed of the §3 declared-materials registry). Without
them a plain `component <name>` uses `components/<name>/` (discovered by folder, no entry needed).

**Rules across kinds** (like `ng generate`): **never overwrite** an existing file unless `--force`;
report each created/copied file + a summary through the logger; the tool **never commits**.
Discovery: `page`/`builder` are found by folder/filename (no registry); `generator` **must** register
(generators resolve by registry name); `component` registers only with `--register`.

> **What this changes for the built code.** The Phase-1 commits are the **`material` kind**:
> `lib/deploy.js` (copy + drift), `lib/components.js` (shared resolver), `lib/used-materials.js`, and
> `ssg add --all-used`. The rework: make `ssg add` **dispatch on the kind** (`ssg add material <name>`
> / `ssg add material --all-used`), and add `lib/scaffold.js` + the four author-new kinds. Everywhere
> below, "deploy / the bridge / `ssg add`" now means the **`material`** kind.

## Your idea: an eject bridge that becomes the install command — endorsed

Ship a **bridge release** that *still* includes all defaults **and** adds a command that, when run,
**copies every component a site uses-but-inherits into the site**. After running it a site **owns**
everything, so the *next* release can drop the defaults with **zero breakage**. The command is
obsolete once nothing is inherited, so it can be removed in the slim release.

This is the right shape — it's the "eject" pattern (à la create-react-app), scoped and automated for
one transition. Why it works and what to sharpen:

- **It inverts the risk.** Instead of "remove defaults and hope sites coped," sites take **ownership
  first**, verifiably, while the safety net (the defaults) is still in place. The breaking release
  then only affects sites that ignored the bridge.
- **Reuse the build's own resolution for "used" — don't re-invent it.** The engine already walks the
  component graph (for asset bundling) and already resolves each file **site-first** via
  `resolveComponentFile(name, file)`. Eject = *(used component set)* × *(its files)*, and for every
  file that **resolves to an engine path while the site has no local copy**, copy it to the site.
  That's the ground truth of what the build actually pulls from the engine — no guessing.
- **Per-file gap-fill, never clobber.** Resolution is per-file, so a site may own `header/header.html`
  but inherit `header/header.build.js`. Eject must copy **only the files the site lacks**, preserving
  partial overrides. Idempotent + safe to re-run.
- **Copy whole folders for nested materials.** A component's **nested sub-component folders**
  (`faq/faq_item/…`) and **bundled `style.css`/`script.js`** must come along (the C1/C2 structure),
  or the ejected component is half-copied.
- **Report through the new logger.** Each copied file → `log.info` (phase `eject`); a skipped
  already-owned file → `log.debug`; a component that couldn't be resolved → `log.warn`. `--dry-run`
  prints the plan without writing. (Nice cohesion with the v0.5 terminal-UX work.)
- **It doesn't commit.** It writes files; the site owner reviews + commits. The migration is a normal
  reviewable diff in the site repo.

One honest note: ejecting makes explicit the trade-off that already exists for hand-copied components
— **an owned component stops tracking engine updates.** That's the *point* (ownership), but the
command should say so in its summary.

**It's more than a bridge — keep it.** `--all-used` generalises into a permanent **material-install**
command: "for every material this site *uses* but doesn't have present, fetch it from its source and
drop it in." In Phase 1 the only source is the engine catalog (so it reads as "eject the defaults").
Once a **material registry** exists (tooling §3), the source can be an npm package / git repo / URL,
and the *same* command installs third-party materials — a lightweight `npm install` for materials.
So the two verbs settle into a clean split, both permanent:
- **`ssg add --all-used`** — *install* every used-but-missing material from its source (bulk, keeps
  attribution — you're a **user** of it).
- **`ssg add <name>`** — *vendor* one material into the repo to **own/edit** it (your copy from here).

This is why the origin/attribution stamp matters: a merely-*installed* material keeps its author's
credit in its `<name>.json`; the moment you `ssg add <name>` to edit it, it's your copy (still stamped
with where it came from). (Stamp mechanics live in §3 — see Notes.)

## Two phases

Illustrative versions: current **v0.5.1** → **Phase 1 = v0.6.0** (additive) → **Phase 2 = v0.7.0**
(breaking, loud migration note). Pre-1.0, so a minor carries the breaking change.

### Phase 1 — deploy commands + the `--all-used` bridge *(defaults still shipped; additive; ~v0.6.0)*

- **`ssg add <name>`** (component by default; `ssg add <kind> <name>` for others) — deploy a single
  material from the engine **catalog** into the site. `--force` to overwrite, `--dry-run` to preview.
  The **permanent** command.
- **`ssg add --all-used`** *(decided name)* — auto-detect the site's used-but-missing materials
  (in Phase 1, the engine-inherited components + `_layout`) and gap-fill them per file. Same copy path
  as single `add`, over the detected set. `--dry-run`; logger output (phase `add`). **Permanent** — it
  debuts here as the eject bridge and stays as the material-install command (see above).
- **"Used" = build resolution** *(decided)*: walk the site's component graph exactly as the build
  does — page `components` arrays + `{{COMPONENT:…}}` + declared `subComponents` + dependencies +
  the always-on `header`/`footer`/`_layout` — then, per file, check whether it **resolves to the
  engine while the site lacks a local copy** → copy it.
- The engine is otherwise **unchanged** (still ships every default) → opt-in and safe. Validate on
  the **demo** (`--all-used` → owns all 8 inherited → builds identically) and confirm the **private**
  site's run is a near-no-op (it already owns everything).

### Phase 2 — slim core + `ssg init` *(defaults removed; breaking; ~v0.7.0)*

- **Slim core.** Default materials move from the auto-resolved `components/` to an in-engine
  **`catalog/`** *(decided)* — shipped but **not** resolved during a build. The **core keeps the
  generation tools** (build pipeline, data model, template/`map` rendering, component resolution, the
  log system); the catalog holds **optional materials**. Using any is opt-in — themed / design-system
  variants are an **option, not a requirement** (they belong to the Phase-3 registry, below).
- Build resolution for a name the site doesn't own → a **clear "not installed — run `ssg add <name>`"
  error**, not a silent miss. `ssg add` now pulls from the catalog (its permanent home). **Keep
  `ssg add --all-used`** — it's no longer just an eject bridge but the standing material-install
  command (installs any used-but-missing material; source resolution grows with the §3 registry).
- **`_layout` is deployable too** *(decided)* — it lives in the catalog **as a component** (recommended
  over inventing a "page" material kind: it already resolves as a component and lives in
  `components/_layout/`). `ssg init` always installs it; existing sites get it via `--all-used`.
- **`ssg init [dir]`** — scaffold a **blank** project from scratch *(decided)*: `package.json`,
  `config.json`, `assets/css/global.css`, `assets/js/global.js`, `pages/index/index.{html,json}`
  (a welcome page), and `components/_layout/_layout.html`. **`ssg init --template demo`** copies the
  **demo** repo's *files* (history-stripped, engine re-pinned — see Notes).
- **Migration note (loud):** "v0.7 removes bundled defaults; on v0.6 run `ssg add --all-used` (or
  `ssg add` each material) so your site owns them first." The bump is gated on that.

## Notes & suggestions

- **One copy path.** `ssg add --all-used` = "for each used-inherited material, do what `ssg add`
  does, per missing file." Build `ssg add <name>` as the primitive; `--all-used` orchestrates it over
  the detected set. Same code, one behaviour to test.
- **The catalog is the current `components/`, relocated.** Move `engine/components/*` (incl.
  `_layout`) → `engine/catalog/*` and stop resolving builds from it.
- **Keep the bundled `example/` site — don't delete it** *(per your note)*. It stops being "the
  engine's default-materials example" (there are no bundled defaults now) and becomes an explicit,
  self-deploying **catalog showcase**: it `ssg add`s the materials it uses, so the catalog is built +
  CI-tested every run and **can't silently rot** — and it's the natural seed for a future **Material
  Design themed demo**. So "make it non-functional for the site" = it no longer *auto-inherits*;
  it deploys what it uses, on purpose.
- **`--template demo` mechanism — git-clone, history-stripped.** Fetch the demo's *files* without its
  git history and **without touching the user's own git**: shallow-clone into a temp dir, copy
  everything except `.git` into the target, discard the temp (the "degit" pattern). The user may
  already have a repo in the target — never clobber their `.git`.
  **Engine-version drift** (the demo can lag the engine that runs `init`, e.g. mid-development): the
  robust fix is a **CI gate that builds the demo against the engine's `main`**, so the demo is never
  behind — then `init` can safely **re-pin the scaffold's engine submodule to the version that ran
  `ssg init`** (a matching pair). If the gate ever shows drift, fall back to scaffolding with the
  demo's *own* pinned (older, known-good) engine **+ a printed note that it was held back**, or refuse
  with "demo not yet migrated to `<engine>`". **Avoid** promising "the engine is always
  backward-compatible" — slim core is deliberately breaking, so that's not a promise we can keep.
- **Generators need nothing now.** The engine ships **no** default generators (`registry.json` is
  `{}`), so slim core is a *components*-only concern today. Keep `ssg add generator <name>` in the
  design for symmetry, but there's no generator inheritance to `--all-used`.
- **`ssg init` = a real blank project.** Not "copy a baseline set of catalog materials" — literally
  emit the files a working site needs: `package.json` (with `build`/`test`/`admin` scripts + the
  engine submodule reference), `config.json`, `assets/css/global.css` + `assets/js/global.js`,
  `pages/index/index.{html,json}` (a welcome page), and `components/_layout/_layout.html`. So a fresh
  `ssg init && npm run build` produces a page with no other materials needed. `--template demo` is the
  richer path — a copy of the demo repo.
- **Provenance / attribution stamp → the material's `.json`, deferred with the registry.** Decided
  location: the source (author / package / engine version) lives in the copied material's
  `<name>.json`. It doubles as **attribution** — a material you only *install* (`--all-used`) keeps its
  author's credit; `ssg add <name>` gives you an editable copy still stamped with its origin. The
  stamp *and* the tooling that reads it (list a site's materials + sources; a future `ssg update`;
  "who contributed the materials this build uses") move to **tooling §3 (plugins + registry)**;
  `ssg add`/`--all-used` stay plain copies until then. (Wrinkle for §3: materials with no `.json` —
  a template-only component, a `.js` generator — need a stamp home.)

## Caveats / watch-items

- **"Used" false negatives are the sharp edge.** If `--all-used` misses a material the site actually
  needs (e.g. referenced only dynamically, or via an unusual `registry.json` remap), slim core breaks
  that site. Mitigation: drive "used" from the **actual build resolution** (ground truth), and **warn
  loudly** on anything ambiguous rather than silently skipping. A good acceptance test: *after
  `--all-used`, a build with the engine's `components/` temporarily emptied still succeeds.*
- **Partial overrides must survive.** Gap-fill per file; never overwrite a site's existing file.
- **`components/registry.json` remaps.** If a site maps a name to a non-default folder, `add`/
  `--all-used` must respect the mapping when deciding source + destination paths.
- **Slim core is breaking — treat it like the `generate-detail.js` retire (v0.4).** Major-ish bump,
  loud migration note, and *the sites go first* (`--all-used` on demo + verify private) before the
  engine drops anything.
- **Catalog rot.** Once defaults aren't auto-built, they can break unnoticed. The `example/` showcase
  (deploying what it uses) must build every CI run — that's what keeps the catalog honest.
- **Idempotency + git hygiene.** `add`/`--all-used` write only; re-running is safe; the tool never
  commits.
- **Staged, not scope-crept.** Phase 1 `material --all-used` copies *local* engine-catalog materials
  only. The third-party/npm/registry generalisation is **deliberately §3**, not now — but design the
  Phase-1 source lookup with a **seam** (a `resolveSource(name) → path` step), so §3 can add
  npm/git/URL resolvers without rewriting it. Don't hardcode "the engine catalog" as the only source.
- **`component` (scaffold empty) vs `material` (copy engine) will confuse people.** Both make a
  `components/<name>/` folder — one *empty for you to author*, one *a real engine copy*. Document the
  split loudly (author-new vs adopt-existing), and have each command's summary say which it did.
- **Overwrite safety across all kinds.** A scaffolder must **refuse to clobber** an existing
  page/component/generator/builder file (clear error) unless `--force` — same rule as `material`
  drift. `ng generate` erroring on a clash is the model.
- **`ssg init` should reuse the scaffolders.** A blank `init` ≈ `add page index` + a `_layout` + a
  `config.json`/`package.json` seed. Build the scaffolders so `init` composes them rather than
  duplicating stub content.

## Decided

- **`ssg add <kind> <name>` is a scaffolding command** (`ng generate`-style) with six kinds —
  `page` / `component` / `generator` / `builder` / `test` create new material with stubs; **`material`**
  copies an engine-catalog material (the Phase-1 work). See the command-model section.
- **Bridge command:** **`ssg add material --all-used`** — a flag on the `material` kind, not a separate verb.
- **"Used" detection:** **build resolution** — the site's actual component graph, per file, site-first.
- **Scope:** **components + `_layout`** (the engine ships no default generators, so nothing else).
- **`_layout`:** a **deployable catalog component** (not kept in core; not a new "page" material kind).
- **Catalog:** **in-engine `catalog/`**; the core keeps the generation tools, the catalog holds
  optional materials + (later) themed variants.
- **`ssg init`:** emit a **blank** project (`package.json`, `config.json`, `global.css`/`global.js`,
  `pages/index` welcome page, `components/_layout`); **`--template demo`** copies the demo repo.
- **Provenance stamp:** in the material's `.json`, but **deferred to §3** (registry) with its display.
- **`--all-used` is permanent** — debuts as the eject bridge (Phase 1), stays as the material-install
  command (Phase 2+; source resolution grows with the §3 registry). *Not* removed.
- **`--template demo`:** git-clone the demo files (history-stripped, don't touch the user's git);
  re-pin the scaffold's engine to the version that ran `init`, backed by a CI gate that builds the
  demo against engine `main`; note-and-hold on drift/offline (see Notes).
- **`example/` kept** as a self-deploying catalog showcase (not deleted).
- **Drift is detected + reported** *(decided)*. `add`/`--all-used` compare each engine file against
  the site's copy: **missing** → copy (gap-fill); **present + identical** → skip; **present +
  differs** → **report drift** (don't silently overwrite; `--force` overwrites on purpose). So the
  run's summary is `copied / skipped / drifted` — the drifted list tells you which owned files have
  diverged from the engine.
- **Source = the engine catalog, for now** *(decided)*. `--all-used` stays a pure component-migration
  bridge until §3 adds external (`external-material-design`) sources; the source lookup is a seam §3
  plugs into, not built now.

## Decided (scaffolding kinds)

- **`--register` + `--folder`** *(decided)*: a declaration knob for `component`, for explicit control.
  `--folder=<dir>` sets the folder; `--register` writes the `components/registry.json` entry
  (`name → folder`). It's the seed of the §3 declared-materials registry. `generator` registering is
  *required* and separate (it writes `generators/registry.json`).
- **`page` default `layout` = `_layout`** *(decided)*, overridden by `--layout=<x>`.
- **Stubs are minimal visible placeholders** *(decided)* — a fresh `.html` renders *something*, not a
  blank file.
- **Keep `<name>.build.js`** *(decided)* — it's the build's search pattern today; the `builder` kind
  scaffolds exactly that file. (Reworking the build-script mechanism itself is a future, separate job.)
- **`--all-used` requires the kind** *(decided)*: `ssg add material --all-used` (consistency over the
  shorter bare form).
- **Stubs are built-in but centralised** *(decided)*: keep the templates inline in `lib/scaffold.js`,
  but in **one clearly-marked place** (a `STUBS`/`templates` map at the top) so "where do I change the
  starter content" has an obvious answer — no external `templates/` dir yet.

*(Remaining slim-core/registry questions are §3-time — the registry interface, no-`.json` stamp home,
trust boundary — parked in [tooling-and-distribution-plan.md](tooling-and-distribution-plan.md) §3.)*

## Implementation plan (commits)

`npm test` green after each. **Phase 1** is the actionable near-term work; **Phase 2** is a
coordinated breaking release, done *after* Phase 1 ships and the sites have run `--all-used`.

### Phase 1 — the full `ssg add <kind> <name>` command (~v0.6.0, additive)

**Already built on `feat/deploy` = the `material` kind** (`npm test` green each commit, 109 checks):
`lib/deploy.js` (copy + drift), the shared `lib/components.js` resolver, `lib/used-materials.js`, and
`ssg add --all-used`. Kept as-is; just re-homed under `material`.

**Rework + new kinds — ✅ done on `feat/deploy`** (smoke 119/0, example 10/0):

R1. ✅ **Kind dispatcher.** `ssg add <kind> <name>` in `cli.js` — `kind ∈ { page, component, generator,
   builder, material }`; positionals are `[kind, name]`. `material` keeps the existing deploy path
   (`ssg add material <name>` / `ssg add material --all-used`); unknown/missing kind → a usage error.
   `add` tests moved to the `material` form; new `--register`/`--folder`/`--layout` flags parsed.
R2. ✅ **`lib/scaffold.js` + `page` / `component`.** `scaffold(kind, name, { siteRoot, engineRoot, opts,
   dryRun })` writes stubs from a **centralised `STUBS` map**, never clobbering unless `--force`, honours
   `--dry-run`, returns `{ created, skipped, registered }`. `page` → `pages/<name>/`; `component` →
   `components/<dir>/` (`--folder` places, `--register` writes the `components/registry.json` remap).
   **Convention correction:** pages *and* components bundle `style.css` / `script.js` (the engine's
   asset source names), not `<name>.css` / `<name>.js` — so those are the asset stubs.
R3. ✅ **`generator` + `builder`.** `generator <name>` → `generators/generate-<name>.js` + a
   `generators/registry.json` entry; `builder <name>` → `<name>.build.js` in the existing component's
   folder (registry-remap-aware), **erroring if the component doesn't exist**. Also fixed
   `lib/components.js` `componentFolder` to honour the site registry remap (it agreed with
   `resolveComponentFile` only for sub-components before), so `builder` finds a `--folder`'d component.
R4. ✅ **Docs + README.** `README.md` documents `ssg add <kind> <name>` (all kinds + a table);
   Phase 1 marked done here, in the tooling draft §1, and in ROADMAP. (Running `material --all-used`
   on the real demo happens in the *sites* when they bump.)
R5. ✅ **`test` kind (follow-on).** Added `ssg add test <name>` — a sixth kind scaffolding a runnable
   `test/<name>.test.js` stub (folder-discovered, run by `ssg test`; green out of the box). `admin`
   was considered and **deferred** — it's a singleton server, not a named material; see ROADMAP
   *"Admin panel extension"*.

### Phase 2 — slim core + `ssg init` (~v0.7.0, breaking — after sites eject)

A. ✅ **Relocate defaults to `catalog/`** (`feat/slim-core`). Moved `engine/components/*` (incl.
   `_layout`) → `engine/catalog/*`; `add`/`--all-used` source from the catalog (`createComponents`
   takes an `engineComponentsDir`; build → `components/`, deploy → `catalog/`); the build no longer
   resolves engine defaults. The bundled `example/` is now a **self-deploying showcase** — smoke
   `ssg add material --all-used`s its catalog materials before building; deployed folders are
   gitignored (only authored `blocks/pricing` is committed). Catalog build scripts made self-contained
   (helpers from the 4th arg, no `require('../../lib/...')`) so deployed copies run anywhere.
B. ✅ **Not-installed error** (`feat/slim-core`). `loadComponent` on a miss now throws
   `Component "<name>" is not installed … run: ssg add material <name>`; the build already fails
   loudly on the throw. smoke covers it.
C. **`ssg init`.** The blank scaffold (files above) + `--template demo` (git-clone the demo files,
   history-stripped, engine re-pinned). Add the **CI gate** that builds the demo against engine `main`.
D. **Ship the breaking release.** Loud migration note; the bump; engine + both sites together (sites
   already own their materials from Phase 1). **`--all-used` stays** (it's the standing material-install
   command, not an eject-only bridge).

> **Follow-up (docs debt):** the engine `CLAUDE.md` still describes the pre-slim-core layout (default
> components under `components/`, and a stale `{{HEADER}}/{{FOOTER}}` layout note) — it needs a pass to
> point at `catalog/` and the `{{COMPONENT:header/footer}}` layout. Tracked, not done in A/B.
