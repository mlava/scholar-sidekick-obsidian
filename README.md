# Scholar Sidekick — Cite from any identifier (Obsidian plugin)

Paste a DOI, PMID, ISBN, arXiv ID, ADS bibcode, or PMCID into a note and
replace it with a formatted citation. No reference manager required.

Backed by the public [Scholar Sidekick API](https://scholar-sidekick.com)
— a transparent, composable interface to authoritative scholarly metadata
sources (Crossref, NCBI, arXiv, Open Library, ADS, WHO IRIS).

> Already using a Zotero / BibTeX library inside Obsidian? The
> [Citations](https://github.com/hans/obsidian-citation-plugin) plugin is
> excellent for that workflow. Scholar Sidekick is for the case **before**
> you have a curated library — you want a citation now, from an identifier
> you have right now.

## Commands

| Command                                        | What it does                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Format selection as citation**               | Wraps the selected text (an identifier or text containing one) in a citation in your default style.                                     |
| **Replace identifier at cursor with citation** | Detects the identifier under or near the cursor and replaces it (or appends, by setting). No selection required.                        |
| **Insert citation…**                           | Opens a modal: type/paste an identifier, pick from 5 quick styles or search 10,000+ CSL styles, insert at cursor.                       |
| **Export note citations to BibTeX**            | Scans the active note for every identifier and saves a `.bib` file next to the note — ready to import into Zotero / Mendeley / EndNote. |
| **Export note citations to RIS**               | Same, but RIS format.                                                                                                                   |

## Supported identifiers

- DOI (bare or `doi.org` URL)
- PMID (bare, labelled, or `pubmed.ncbi.nlm.nih.gov` URL)
- PMCID (bare or `ncbi.nlm.nih.gov/pmc/articles/...` URL)
- ISBN (10 or 13)
- arXiv (modern `2301.07041` or legacy `cs.CL/0301001`)
- ISSN
- ADS bibcode (within the modal — server-side detection)

The detection regexes are vendored from the upstream API source, with a
build-time drift detector ensuring the vendored copy never falls out of
sync with the canonical patterns.

## Settings

- **Default citation style** — Vancouver, APA, AMA, IEEE, CSE built-in;
  the modal lets you persist any of 10,000+ styles.
- **Output format** — plain text or HTML. The five built-in styles
  emit text only; HTML applies to CSL styles selected via the search
  modal (those preserve italics, small caps, and other inline markup
  that survives in Obsidian's reading view). Selecting HTML with a
  built-in style falls back to text rather than failing.
- **Replace mode** — replace identifier in place, or append the citation
  after it.
- **Show sources & conflicts (experimental)** — sends `?provenance=1` to
  surface which upstream source supplied each field, once Phase 12 of the
  Scholar Sidekick API ships.
- **API base URL** — override only for staging or self-hosted instances.

## Privacy

- The plugin sends the identifier text you ask it to format directly to
  `https://scholar-sidekick.com/api/format` over HTTPS.
- No API key is required; the API treats the plugin as the anonymous
  rate-limited tier (60 requests / minute / IP).
- Inputs are not retained or used for training. See the API
  [privacy policy](https://scholar-sidekick.com/legal/privacy).

## Provenance

Every API call carries a `x-scholar-transform-version` header so you can
pin reproducibility. The plugin logs `x-request-id` and
`x-scholar-transform-version` to the developer console for diagnostic
support — open the Obsidian dev console (Cmd+Opt+I / Ctrl+Shift+I) to
view them.

## Build from source

See [BUILD.md](./BUILD.md).
