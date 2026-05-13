# Obsidian community plugin submission

## Submission target

[`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
— a single PR adding one entry to `community-plugins.json`.

## Pre-submission checklist

- [ ] Plugin source lives in a public GitHub repo
      (`mlava/scholar-sidekick-obsidian`). The in-repo
      `obsidian-plugin/` directory is the source of truth; the public
      repo is populated from it for each release.
- [ ] `manifest.json` `id` is unique and matches the plugin directory
      name (`scholar-sidekick`).
- [ ] `manifest.json` `name` does not contain "obsidian" or "plugin"
      (per [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)).
- [ ] `manifest.json` `description` is ≤ 250 characters.
- [ ] `manifest.json` `author`, `authorUrl` are set.
- [ ] `versions.json` exists and maps each released version to a
      minimum Obsidian version.
- [ ] `README.md` explains what the plugin does (Section 1 of the
      submission requirements).
- [ ] Tagged release with version number matching `manifest.json`,
      attaching `manifest.json`, `main.js`, and `styles.css` as
      release assets.
- [ ] No telemetry, no analytics, no minified code that hides what
      it's doing — the bundle is unminified-ish (esbuild treeshakes
      but doesn't obfuscate).
- [ ] Plugin handles the case where the user is offline (Notice with
      a clear message; no spinner-of-death).

## Listing copy

**Name (manifest.name):**

> Scholar Sidekick — Cite from any identifier

**Short description (manifest.description, ≤ 250 chars):**

> Paste a DOI, PMID, ISBN, or arXiv ID and replace it with a formatted
> citation. 10,000+ CSL styles. No reference manager required.

**README opening paragraph:**

> Paste a DOI, PMID, ISBN, arXiv ID, ADS bibcode, or PMCID into a note
> and replace it with a formatted citation. No reference manager
> required.

**Positioning vs Citations plugin (defuses competitive friction):**

> Already using a Zotero / BibTeX library inside Obsidian? The
> [Citations](https://github.com/hans/obsidian-citation-plugin) plugin
> is excellent for that workflow. Scholar Sidekick is for the case
> _before_ you have a curated library — you want a citation now,
> from an identifier you have right now.

## PR template

```
## Plugin info

- Plugin name: Scholar Sidekick — Cite from any identifier
- Plugin id: scholar-sidekick
- Repo: https://github.com/mlava/scholar-sidekick-obsidian
- Author: Mark Lavercombe
- Description: Paste a DOI, PMID, ISBN, or arXiv ID and replace it with a formatted citation. 10,000+ CSL styles. No reference manager required.

## Compliance

- [x] I have read the plugin guidelines.
- [x] My plugin does not include analytics or telemetry.
- [x] My plugin does not load remote code.
- [x] My plugin handles all errors with user-visible Notices.
- [x] All HTTP requests are made to a single, documented endpoint
      (https://scholar-sidekick.com/api/{format,csl/styles,export}),
      explained in the README and Privacy section.
```

## Lint requirements (Obsidian review bot)

The community-plugin review bot runs
[`obsidianmd/eslint-plugin`](https://github.com/obsidianmd/eslint-plugin)
on every release tag. Some rules are surprising — capture the gotchas
here so they don't keep biting on every iteration.

### Reproducing the bot's checks locally

The plugin is **not published to npm**. To reproduce the bot:

```bash
git clone --depth=1 https://github.com/obsidianmd/eslint-plugin.git \
  /tmp/obsidian-eslint
cd /tmp/obsidian-eslint && npm install && npm run build  # builds dist/
```

Then point a flat config at it (`eslint.config.mjs`) and run
`npx eslint src/`. The recommended preset pulls in
`@typescript-eslint/recommended-type-checked` which crashes without
extra wiring; filter to keep only `obsidianmd/*` rules.

### Rule gotchas

- **`obsidianmd/ui/sentence-case`** — recommended preset sets
  `enforceCamelCaseLower: true`, which strips PascalCase/camelCase
  preservation. So `BibTeX` becomes `bibtex` and `RIS` becomes `ris`
  in command names; rephrase or accept the lowercase spelling.
- **Brand-list collision: "Cursor"** — added on 2026-04-30 (the AI
  editor). Any standalone `cursor` token in UI text is auto-capitalised
  to `Cursor`. Use **"caret"** for the text insertion point to avoid
  the collision.
- **Allowed acronyms** (preserved uppercase): `API`, `URL`, `ID`,
  `HTML`, `JSON`, `CSS`, `PDF`, `CSV`, `XML`, `SDK`, `CLI`, `GUI`,
  `LLM`, `AI`, `ML`, etc. See [`acronyms.ts`](https://github.com/obsidianmd/eslint-plugin/blob/master/lib/rules/ui/acronyms.ts).
- **Acronyms NOT in the list** (silently lowercased mid-sentence):
  `CSL`, `DOI`, `PMID`, `ISBN`, `ADS`, `arXiv`, `RIS`, `BibTeX`,
  `Phase`, `Scholar Sidekick`. Either drop the mention or rephrase
  so the acronym sits at the start of a sentence (where the rule
  doesn't fire) — except even then it gets `Doi`-cased. Drop is safer.
- **What the rule scans** (`obsidianmd/ui/sentence-case`):
  `addCommand({ name })`, `setName / setDesc / setButtonText /
setTooltip / setPlaceholder / setText / setTitle`,
  `createEl(tag, { text, title, attr: { 'aria-label' } })`,
  `setAttribute('aria-label', ...)`, `new Notice(...)`,
  `el.textContent / el.innerText / el.title` assignments, and
  `getDisplayText()` returns. Template literals with `${}` are skipped.
- **`obsidianmd/no-static-styles-assignment`** — bans `el.style.*` and
  `el.setAttribute('style', ...)`. Move every inline style into
  `styles.css` and apply via `cls:` / `addClass()`. There is a
  `setCssProps` helper for cases that genuinely need to vary at runtime.
- **Timer functions must use plain `window.setTimeout` /
  `window.clearTimeout`.** The earlier `prefer-active-window-timers`
  rule (which preferred `activeWindow.*`) has been reversed by the
  Obsidian community-store automated checker as of v0.1.2 — it now
  warns on `activeWindow.setTimeout` / `activeWindow.clearTimeout`
  and asks for `window.*` instead. TypeScript: `let timer: number |
  null = null` is still correct (the return type is `number` in
  browser context, not `NodeJS.Timeout`).
- **`obsidianmd/prefer-create-el`** — `el.createEl('div', opts)` should
  be `el.createDiv(opts)`. Same for `'span'` → `createSpan`.
- **`obsidianmd/rule-custom-message` (no-console)** — only
  `console.warn`, `console.error`, `console.debug` are allowed. No
  `console.log`.

### Release loop

The bot rescans within 6 hours of a new release tag on
`mlava/scholar-sidekick-obsidian`. To ship a fix:

1. Edit files in this in-repo `obsidian-plugin/` directory (canonical
   source).
2. Bump `manifest.json` `version` **and** add the new version to
   `versions.json` (the release script aborts if the tag already exists).
3. Run `npm run release` from `obsidian-plugin/`. It builds locally
   for sanity, clones the public repo, mirrors files (including the
   GitHub Actions release workflow at `.github/workflows/release.yml`
   and the committed `package-lock.json`), commits, tags, and pushes.
4. The release workflow in `mlava/scholar-sidekick-obsidian` runs on
   tag push: `npm ci` → `npm run build` → generate build-provenance
   attestation for `main.js` + `styles.css` via
   `actions/attest-build-provenance@v2` → `gh release create` with
   `main.js` / `manifest.json` / `styles.css` as assets. Attestations
   are what the obsidian-releases bot looks for when it warns about
   "release assets are missing a GitHub artifact attestation".
5. Wait for the bot to comment on the
   [`obsidian-releases` PR](https://github.com/obsidianmd/obsidian-releases).

Do **not** rebase the PR or open a new one — the reviewer handles that
on acceptance.

## Post-acceptance bot warnings (v0.1.1 → v0.1.2, 2026-05-13)

After v0.1.1 was accepted into the community store on 2026-05-13, the
automated checker raised three warnings/notices. v0.1.2 addresses all
three:

- **`builtin-modules` should be replaced.** `esbuild.config.mjs` now
  uses `import { builtinModules } from "node:module"` (the platform
  primitive that the `builtin-modules` package wrapped). The
  `builtin-modules` devDependency was removed.
- **2 release assets are missing a GitHub artifact attestation
  (`main.js`, `styles.css`).** Release creation moved out of the local
  sync script into a GitHub Actions workflow
  (`.github/workflows/release.yml`) in the public repo. That workflow
  rebuilds inside the Action and calls
  `actions/attest-build-provenance@v2` before creating the release.
- **No lockfile found.** `package-lock.json` is now mirrored into the
  public repo (added to `TOP_LEVEL_FILES` in `sync-to-public.mjs`).
  Regenerated after removing `builtin-modules`.

## Post-acceptance follow-ups

When the plugin is accepted:

- [ ] Add an "Also available for Obsidian" CTA on
      [`/extension`](https://scholar-sidekick.com/extension)
      (`app/extension/page.tsx`) matching the existing per-store
      pattern.
- [ ] Add the Obsidian community-plugin URL to the homepage
      "Featured on" strip (`app/page.tsx`).
- [ ] Add a sprint row to `docs/SEO_STRATEGY.md` noting the
      acceptance date and the 30-day baseline-rerun window.
- [ ] Update `docs/POSITIONING.md` with an Obsidian audience row.
- [ ] Update `docs/ROADMAP.md` (Phase 11c — Obsidian distribution).
