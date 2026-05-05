// obsidian-plugin/src/lib/detect.ts
//
// Client-side identifier detection for the Obsidian plugin. Patterns
// vendored from src/lib/ingest/detect.ts (the canonical source of truth);
// scripts/sync-detect.mjs verifies the vendored copy matches the upstream
// regex literals and fails the build on drift.
//
// Server-side detection in /api/format is authoritative — this module
// only exists to avoid an HTTP roundtrip when the user runs "Replace
// identifier at cursor" without a selection. We ship a minimal
// orchestration (single best match around an offset) rather than
// re-implementing the full detect pipeline.

// ── Regex constants (mirror src/lib/ingest/detect.ts:11-35) ──────────
//
// Keep these literal-identical to the upstream source. The drift
// detector compares the canonical string form of each RegExp.

export const DOI_URL_RE = /\bhttps?:\/\/(?:dx\.)?doi\.org\/([^?#\s<>"']+)/gi;
export const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
export const PMID_RE = /\bPMID\s*[:#-]?\s*(\d+)\b/gi;
export const PUBMED_WORD_RE = /\bpubmed\s*[:#-]?\s*(\d{3,9})\b/gi;
export const PUBMED_URL_RE = /\bhttps?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?\b/i;
export const PMCID_RE = /\bPMC\d+\b/gi;
export const PMC_NCBI_URL_RE =
  /\bhttps?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\/(PMC\d+)\b/i;
export const ISBN_RE =
  /\bISBN(?:-?1[03])?:?\s*((?:97[89][- ]?)?\d{1,5}[- ]?\d+[- ]?\d+[- ]?[\dXx])\b/gi;
export const ARXIV_PREFIX_TOKEN_RE =
  /\barxiv\s*:\s*([A-Za-z-]+(?:\.[A-Za-z.-]{2,12})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/gi;
export const RE_ISSN_DASHED = /\b(\d{4})\s*-\s*([0-9]{3}[0-9Xx])\b/g;

// ── Public types ─────────────────────────────────────────────────────

export type IdentifierType = "doi" | "pmid" | "pmcid" | "isbn" | "arxiv" | "issn";

export interface IdentifierMatch {
  type: IdentifierType;
  value: string; // canonical/raw string suitable for /api/format input
  start: number; // inclusive char offset in source text
  end: number; // exclusive char offset
}

// ── Detection ────────────────────────────────────────────────────────

interface PatternSpec {
  type: IdentifierType;
  re: RegExp;
  // Some regexes wrap the canonical value in a capture group; this
  // index says which group holds it. 0 = use the whole match.
  group: number;
}

// Order matters only for tie-breaking when offsets overlap. URL forms
// come first so a DOI URL beats the bare DOI inside it.
const PATTERNS: PatternSpec[] = [
  { type: "doi", re: cloneGlobal(DOI_URL_RE), group: 1 },
  { type: "doi", re: cloneGlobal(DOI_RE), group: 0 },
  { type: "pmid", re: cloneGlobal(PUBMED_URL_RE, "gi"), group: 1 },
  { type: "pmid", re: cloneGlobal(PMID_RE), group: 1 },
  { type: "pmid", re: cloneGlobal(PUBMED_WORD_RE), group: 1 },
  { type: "pmcid", re: cloneGlobal(PMC_NCBI_URL_RE, "gi"), group: 1 },
  { type: "pmcid", re: cloneGlobal(PMCID_RE), group: 0 },
  { type: "isbn", re: cloneGlobal(ISBN_RE), group: 1 },
  { type: "arxiv", re: cloneGlobal(ARXIV_PREFIX_TOKEN_RE), group: 1 },
  { type: "issn", re: cloneGlobal(RE_ISSN_DASHED), group: 0 },
];

function cloneGlobal(re: RegExp, flagsOverride?: string): RegExp {
  const flags = flagsOverride ?? (re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return new RegExp(re.source, flags);
}

/** Find every identifier in `text`, in source order. Useful for batch / export commands. */
export function findAllIdentifiers(text: string): IdentifierMatch[] {
  if (!text) return [];
  const out: IdentifierMatch[] = [];
  const seen = new Set<string>();
  for (const spec of PATTERNS) {
    spec.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = spec.re.exec(text)) !== null) {
      const value = (spec.group === 0 ? m[0] : m[spec.group])?.trim();
      if (!value) continue;
      const start = m.index + (spec.group === 0 ? 0 : Math.max(0, m[0].indexOf(value)));
      const end = start + (spec.group === 0 ? m[0].length : value.length);
      const key = `${spec.type}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: spec.type, value, start, end });
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Find the identifier under or nearest to a cursor offset. Prefers
 * matches that contain the offset; otherwise the closest neighbour
 * within `radius` chars. Returns null if nothing is plausibly nearby.
 */
export function findIdentifierAt(
  text: string,
  offset: number,
  radius = 64,
): IdentifierMatch | null {
  const all = findAllIdentifiers(text);
  if (all.length === 0) return null;

  let containing: IdentifierMatch | null = null;
  let nearest: IdentifierMatch | null = null;
  let nearestDist = Infinity;

  for (const m of all) {
    if (offset >= m.start && offset <= m.end) {
      if (!containing || m.end - m.start < containing.end - containing.start) {
        containing = m;
      }
    } else {
      const dist = offset < m.start ? m.start - offset : offset - m.end;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = m;
      }
    }
  }

  if (containing) return containing;
  if (nearest && nearestDist <= radius) return nearest;
  return null;
}
