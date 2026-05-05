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
