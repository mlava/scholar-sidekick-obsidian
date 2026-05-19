# Contributing

Thanks for your interest in Scholar Sidekick for Obsidian.

## Where to file issues and pull requests

This repository is a release mirror. Active development happens in the canonical Scholar Sidekick repo, where the identifier-detection regexes are kept in sync with the upstream API source via a build-time drift detector.

- **Bug reports and feature requests** — either repo is fine:
  - https://github.com/mlava/scholar-sidekick-obsidian/issues
  - https://github.com/mlava/scholar-sidekick/issues
- **Pull requests** — please open against the canonical repo:
  - https://github.com/mlava/scholar-sidekick
  - The Obsidian plugin source lives at [`obsidian-plugin/`](https://github.com/mlava/scholar-sidekick/tree/main/obsidian-plugin) in that tree. PRs filed here will be redirected so the drift check can run.

## Local development

See [BUILD.md](./BUILD.md) for the full workflow — Node prerequisites, build commands, symlinking the plugin into a test vault, and the incremental rebuild loop.

## What's in scope

- Bug fixes and UX improvements to the existing commands documented in the README.
- New identifier types or citation styles — please open an issue first so we can confirm the upstream API supports them before code review.
- Documentation, accessibility, and i18n improvements.

## What's out of scope

- Reference-manager features (PDF storage, library sync, collection management). Scholar Sidekick is intentionally a citation formatter that complements reference managers, not a replacement — see the README for the boundary.
- Vendoring large CSL style packages. The live API delivers any of 10,000+ styles on demand; bundling them would bloat the plugin and break the source-of-truth guarantee.

## Reporting a security issue

Please send security disclosures privately rather than filing a public issue. Contact details are on the [Scholar Sidekick privacy policy](https://scholar-sidekick.com/legal/privacy) page.

## License

By contributing you agree your contributions will be licensed under the [MIT License](./LICENSE), matching the project.
