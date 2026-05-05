# Build instructions

## Prerequisites

- Node.js ≥ 20.19
- npm ≥ 10

## Build

```bash
npm install
npm run build           # tsc + esbuild production → main.js
```

## Develop locally

1. Build once: `npm run build`.
2. Symlink the directory into a test vault:
   ```bash
   ln -s "$PWD" "/path/to/vault/.obsidian/plugins/scholar-sidekick"
   ```
3. In Obsidian: *Settings → Community plugins → Reload* and enable
   "Scholar Sidekick — Cite from any identifier".
4. Run `npm run dev` for incremental rebuilds; reload the plugin in
   Obsidian after each rebuild (or use the Hot-Reload community plugin).

## Source of truth

This repository is a release mirror. Active development happens in
the [`obsidian-plugin/`](https://github.com/mlava/scholar-sidekick/tree/main/obsidian-plugin)
directory of the canonical Scholar Sidekick repo, where the
identifier-detection regexes are kept in sync with the API source
via a build-time drift detector. File issues against either repo;
PRs prefer the canonical repo so the drift check can run.
