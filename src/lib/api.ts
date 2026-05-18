// obsidian-plugin/src/lib/api.ts
//
// HTTP client for the Scholar Sidekick API. Forked from
// extension/src/lib/api.ts (browser-extension client) with three deltas:
//   1. formatBatch — POST /api/format with `lines: string[]`
//   2. exportCitations — POST /api/export to download BibTeX/RIS
//   3. Optional ?provenance=1 (Phase 12a opt-in; harmless on pre-Phase-12 servers)
//
// HTTP transport: Obsidian's `requestUrl()` rather than the renderer's
// `fetch()`. requestUrl bypasses the renderer's CORS layer and does not
// inject browser-only headers like `Origin: app://obsidian.md`.
//
// Auth: requests carry an X-Scholar-Client handshake header that opts the
// caller into the anonymous tier (per-IP rate limit). Without it the API
// auth guard cannot distinguish Obsidian from an unidentified origin-less
// caller and rejects with 401 AUTH_MISSING. See src/lib/auth/guard.ts
// (isTrustedClient + TRUSTED_CLIENT_ALLOWLIST) for the server side.

import { requestUrl, type RequestUrlResponse } from "obsidian";

export const DEFAULT_BASE = "https://scholar-sidekick.com";
export const CLIENT_TAG = "scholar-sidekick-obsidian/0.2.0";

const TIMEOUT_MS = 15_000;
const STYLES_TIMEOUT_MS = 6_000;
const EXPORT_TIMEOUT_MS = 30_000;
const MAX_INPUT_BYTES = 64_000;

export const BUILTIN_STYLES = ["vancouver", "apa", "ama", "ieee", "cse"] as const;
export type BuiltinStyle = (typeof BUILTIN_STYLES)[number];

export type OutputMode = "text" | "html" | "json";
export type CheckKind = "retraction" | "oa";

export interface FormatOptions {
  baseUrl?: string;
  output?: OutputMode;
  provenance?: boolean;
  checks?: CheckKind[];
  signal?: AbortSignal;
}

export type FormatItemRetraction = {
  status: "ok" | "retracted" | "concern" | "correction" | "unknown";
  notices?: Array<{ type?: string; label?: string; date?: string | null }>;
  error?: { code?: string; message?: string };
};

export type FormatItemOpenAccess = {
  status: "open" | "closed" | "unknown";
  oa_status?: "gold" | "green" | "hybrid" | "bronze" | "closed";
  best_url?: string;
  license?: string | null;
  version?: string | null;
  error?: { code?: string; message?: string };
};

export type FormatItem = {
  idx?: number;
  _checks?: {
    retraction?: FormatItemRetraction;
    open_access?: FormatItemOpenAccess;
  };
};

export type FormatResult =
  | {
      ok: true;
      text: string;
      styleUsed: string;
      warnings: string[];
      requestId: string | null;
      transformVersion: string | null;
      items?: FormatItem[];
    }
  | { ok: false; status: number; message: string; retryAfterSec?: number };

export type BatchResult =
  | {
      ok: true;
      texts: string[];
      styleUsed: string;
      warnings: string[];
      requestId: string | null;
      transformVersion: string | null;
      items?: FormatItem[];
    }
  | { ok: false; status: number; message: string; retryAfterSec?: number };

export type RetractionPayload = {
  doi: string | null;
  resolvedFrom?: { type: string; value: string };
  result: {
    isRetracted: boolean;
    hasCorrections: boolean;
    hasConcern: boolean;
    notices: Array<{
      type: string;
      label: string;
      doi: string | null;
      date: string | null;
      source: string | null;
    }>;
    title: string | null;
  } | null;
  reason?: "no_doi";
  requestId?: string | null;
};

export type OaPayload = {
  doi: string | null;
  resolvedFrom?: { type: string; value: string };
  result: {
    isOa: boolean;
    oaStatus: "gold" | "green" | "hybrid" | "bronze" | "closed";
    title: string | null;
    bestLocation: {
      url: string;
      hostType: string;
      license: string | null;
      version: string | null;
    } | null;
    locations: Array<{
      url: string;
      hostType: string;
      license: string | null;
      version: string | null;
    }>;
  } | null;
  reason?: "no_doi";
  requestId?: string | null;
};

export type VerifyVerdict = "matched" | "mismatch" | "not_found" | "ambiguous" | "parsing_error";
export type VerifyConfidence = "high" | "medium" | "low";

export type VerifyAuthor = { family: string; given?: string };

export type VerifyClaim = {
  title?: string;
  authors?: VerifyAuthor[];
  year?: number;
  container?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  isbn?: string;
  arxiv?: string;
  issn?: string;
  ads?: string;
  whoIrisUrl?: string;
};

export type VerifyMismatch = {
  field: "title" | "first_author" | "year" | "container";
  claimed: string | number | null;
  resolved: string | number | null;
  similarity: number;
};

export type VerifyCandidate = {
  item: Record<string, unknown> & {
    title?: string;
    authors?: Array<{ family?: string; given?: string }>;
    issued?: { year?: number };
    container?: { title?: string };
    identifiers?: Array<{ type: string; value: string }>;
  };
  registries: string[];
  score: number;
};

export type VerifyProvenance = {
  stages_run: Array<"compare" | "search" | "llm_screen">;
  resolved_via: string | null;
  registries_searched?: Array<{ registry: string; ok: boolean; count: number; reason?: string }>;
  llm_screen?: {
    applied: boolean;
    model?: string;
    prompt_version?: string;
    verdict?: string;
    reasoning?: string;
    cost_usd?: number;
    reason?: string;
  };
  skipped_reason?: "insufficient_claim";
};

export type VerifyPayload = {
  verdict: VerifyVerdict;
  confidence: VerifyConfidence;
  matched: VerifyCandidate["item"] | null;
  mismatches: VerifyMismatch[];
  candidates?: VerifyCandidate[];
  _provenance: VerifyProvenance;
  requestId?: string | null;
};

export type CheckResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; retryAfterSec?: number };

export type ExportResult =
  | { ok: true; body: string; contentType: string; filename: string; requestId: string | null }
  | { ok: false; status: number; message: string; retryAfterSec?: number };

export interface StyleEntry {
  id: string;
  title: string;
  titleShort?: string;
  bundled?: boolean;
  engineSupported?: boolean;
  aliasFor?: string;
}

export type ExportFormat = "bib" | "ris" | "csv" | "csl" | "endnote-xml";

const EXPORT_FILENAME: Record<ExportFormat, string> = {
  bib: "citations.bib",
  ris: "citations.ris",
  csv: "citations.csv",
  csl: "citations.csl.json",
  "endnote-xml": "citations.endnote.xml",
};

function trimToBytes(text: string): string {
  return text.length > MAX_INPUT_BYTES ? text.slice(0, MAX_INPUT_BYTES) : text;
}

function parseRetryAfter(header: string | null | undefined): number {
  const n = Number(header ?? "30");
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function withQuery(base: string, path: string, params?: Record<string, string>): string {
  const url = new URL(path, base);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function formatQueryParams(opts: FormatOptions): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  if (opts.provenance) params.provenance = "1";
  if (opts.checks?.length) params.checks = opts.checks.join(",");
  return Object.keys(params).length ? params : undefined;
}

function header(res: RequestUrlResponse, name: string): string | null {
  const direct = res.headers?.[name];
  if (direct) return direct;
  // requestUrl normalises some headers to lowercase, but we defensively
  // try a few common casings before giving up.
  const lower = res.headers?.[name.toLowerCase()];
  if (lower) return lower;
  return null;
}

function rateLimitedError(res: RequestUrlResponse): {
  ok: false;
  status: 429;
  message: string;
  retryAfterSec: number;
} {
  return {
    ok: false,
    status: 429,
    message: "Rate-limited. Try again shortly.",
    retryAfterSec: parseRetryAfter(header(res, "Retry-After")),
  };
}

function readError(res: RequestUrlResponse): string {
  if (res.status === 404) return "We couldn't find a record for that identifier.";
  if (res.status === 401 || res.status === 403) {
    return "The Scholar Sidekick API rejected the request. Try again later.";
  }
  if (res.status >= 500) return `Scholar Sidekick is having trouble (HTTP ${res.status}).`;
  try {
    const json = res.json as { error?: { message?: string } | string; message?: string };
    const msg =
      typeof json?.error === "string"
        ? json.error
        : typeof json?.error === "object"
          ? json.error?.message
          : json?.message;
    return msg ?? `Request failed (HTTP ${res.status}).`;
  } catch {
    return `Request failed (HTTP ${res.status}).`;
  }
}

interface RequestOptions {
  method: "GET" | "POST";
  url: string;
  body?: string;
  contentType?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

async function doRequest(
  opts: RequestOptions,
): Promise<
  RequestUrlResponse | { __error: "abort" } | { __error: "timeout" } | { __error: "network" }
> {
  // Obsidian's requestUrl does not natively support AbortController. We
  // simulate timeout/cancel by racing the request against a sentinel.
  let cancelled = false;
  let timer: number | null = null;
  const onAbort = () => {
    cancelled = true;
  };
  if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });

  const timeoutPromise = new Promise<{ __error: "timeout" }>((resolve) => {
    timer = window.setTimeout(() => resolve({ __error: "timeout" }), opts.timeoutMs);
  });

  console.debug("[scholar-sidekick] →", opts.method, opts.url);
  try {
    const headers: Record<string, string> = { "X-Scholar-Client": CLIENT_TAG };
    if (opts.contentType) headers["Content-Type"] = opts.contentType;
    const reqPromise = requestUrl({
      url: opts.url,
      method: opts.method,
      body: opts.body,
      headers,
      throw: false,
    });
    const result = await Promise.race([reqPromise, timeoutPromise]);
    if (cancelled) {
      console.debug("[scholar-sidekick] ← cancelled");
      return { __error: "abort" };
    }
    if (isResponse(result)) {
      console.debug("[scholar-sidekick] ←", result.status, opts.url, {
        headers: result.headers,
        bodyPreview: typeof result.text === "string" ? result.text.slice(0, 400) : "(no body)",
      });
    } else {
      console.debug("[scholar-sidekick] ← timeout");
    }
    return result;
  } catch (err) {
    console.error("[scholar-sidekick] requestUrl threw despite throw:false", err);
    return { __error: "network" };
  } finally {
    if (timer) window.clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
}

function isResponse(r: RequestUrlResponse | { __error: string }): r is RequestUrlResponse {
  return !("__error" in r);
}

/** Format a single identifier (or freeform text containing one). */
export async function formatCitation(
  text: string,
  style: string,
  opts: FormatOptions = {},
): Promise<FormatResult> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const output = opts.output ?? "text";
  const trimmed = trimToBytes(text);

  const url = withQuery(base, "/api/format", formatQueryParams(opts));
  const res = await doRequest({
    method: "POST",
    url,
    body: JSON.stringify({ text: trimmed, style, output }),
    contentType: "application/json",
    timeoutMs: opts.checks?.length ? EXPORT_TIMEOUT_MS : TIMEOUT_MS,
    signal: opts.signal,
  });

  if (!isResponse(res)) {
    if (res.__error === "abort") return { ok: false, status: 0, message: "Request cancelled." };
    if (res.__error === "timeout")
      return { ok: false, status: 0, message: "Timed out. Try again." };
    return {
      ok: false,
      status: 0,
      message: "Couldn't reach scholar-sidekick.com — check your connection.",
    };
  }
  if (res.status === 429) return rateLimitedError(res);
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, message: readError(res) };
  }

  const json = res.json as {
    ok: boolean;
    text?: string;
    html?: string;
    styleUsed?: string;
    warnings?: string[];
    items?: FormatItem[];
  };
  // Builtin formatters (vancouver/ama/apa/ieee/cse) only emit text; the CSL
  // engine emits both. Prefer whichever was requested, but fall back so an
  // HTML request against a builtin style still produces a citation rather
  // than a generic "couldn't format" error.
  const body = output === "html" ? (json.html ?? json.text) : (json.text ?? json.html);
  if (!json.ok || !body) {
    return { ok: false, status: res.status, message: "Couldn't format that selection." };
  }
  return {
    ok: true,
    text: body,
    styleUsed: json.styleUsed ?? style,
    warnings: json.warnings ?? [],
    requestId: header(res, "x-request-id"),
    transformVersion: header(res, "x-scholar-transform-version"),
    items: Array.isArray(json.items) ? json.items : undefined,
  };
}

/** Format a batch of identifiers in one request. Returns one citation per line. */
export async function formatBatch(
  lines: string[],
  style: string,
  opts: FormatOptions = {},
): Promise<BatchResult> {
  if (lines.length === 0) {
    return {
      ok: true,
      texts: [],
      styleUsed: style,
      warnings: [],
      requestId: null,
      transformVersion: null,
    };
  }
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const output = opts.output ?? "text";

  const url = withQuery(base, "/api/format", formatQueryParams(opts));
  const res = await doRequest({
    method: "POST",
    url,
    body: JSON.stringify({ lines, style, output }),
    contentType: "application/json",
    timeoutMs: EXPORT_TIMEOUT_MS,
    signal: opts.signal,
  });

  if (!isResponse(res)) {
    if (res.__error === "abort") return { ok: false, status: 0, message: "Request cancelled." };
    if (res.__error === "timeout")
      return { ok: false, status: 0, message: "Timed out. Try again." };
    return {
      ok: false,
      status: 0,
      message: "Couldn't reach scholar-sidekick.com — check your connection.",
    };
  }
  if (res.status === 429) return rateLimitedError(res);
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, message: readError(res) };
  }

  const json = res.json as {
    ok: boolean;
    text?: string;
    html?: string;
    styleUsed?: string;
    warnings?: string[];
    items?: FormatItem[];
  };
  if (!json.ok) return { ok: false, status: res.status, message: "Couldn't format the batch." };

  const body = output === "html" ? json.html : json.text;
  const texts = (body ?? "").split(/\r?\n/).filter((s) => s.length > 0);
  return {
    ok: true,
    texts,
    styleUsed: json.styleUsed ?? style,
    warnings: json.warnings ?? [],
    requestId: header(res, "x-request-id"),
    transformVersion: header(res, "x-scholar-transform-version"),
    items: Array.isArray(json.items) ? json.items : undefined,
  };
}

function filenameFromContentDisposition(headerVal: string | null, fallback: string): string {
  if (!headerVal) return fallback;
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(headerVal);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // fall through to the plain `filename=` form
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(headerVal);
  if (plain) return plain[1];
  return fallback;
}

/** Export a batch of identifiers as a downloadable file (BibTeX, RIS, etc). */
export async function exportCitations(
  lines: string[],
  format: ExportFormat,
  opts: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<ExportResult> {
  if (lines.length === 0) {
    return { ok: false, status: 400, message: "No identifiers to export." };
  }
  const base = opts.baseUrl ?? DEFAULT_BASE;

  const res = await doRequest({
    method: "POST",
    url: `${base}/api/export`,
    body: JSON.stringify({ text: lines.join("\n"), format }),
    contentType: "application/json",
    timeoutMs: EXPORT_TIMEOUT_MS,
    signal: opts.signal,
  });

  if (!isResponse(res)) {
    if (res.__error === "abort") return { ok: false, status: 0, message: "Request cancelled." };
    if (res.__error === "timeout")
      return { ok: false, status: 0, message: "Timed out. Try again." };
    return {
      ok: false,
      status: 0,
      message: "Couldn't reach scholar-sidekick.com — check your connection.",
    };
  }
  if (res.status === 429) return rateLimitedError(res);
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, message: readError(res) };
  }

  return {
    ok: true,
    body: res.text,
    contentType: header(res, "content-type") ?? "text/plain",
    filename: filenameFromContentDisposition(
      header(res, "content-disposition"),
      EXPORT_FILENAME[format],
    ),
    requestId: header(res, "x-request-id"),
  };
}

/** Search the CSL style index. */
export async function searchStyles(
  query: string,
  opts: { baseUrl?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<StyleEntry[]> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const limit = String(opts.limit ?? 30);

  const url = new URL("/api/csl/styles", base);
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("limit", limit);

  const res = await doRequest({
    method: "GET",
    url: url.toString(),
    timeoutMs: STYLES_TIMEOUT_MS,
    signal: opts.signal,
  });

  if (!isResponse(res) || res.status < 200 || res.status >= 300) return [];
  const json = res.json as { ok?: boolean; styles?: StyleEntry[] };
  if (!json.ok || !Array.isArray(json.styles)) return [];
  return json.styles;
}

async function postJsonCheck<T>(
  url: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CheckResult<T>> {
  const res = await doRequest({
    method: "POST",
    url,
    body: JSON.stringify(body),
    contentType: "application/json",
    timeoutMs,
    signal,
  });
  if (!isResponse(res)) {
    if (res.__error === "abort") return { ok: false, status: 0, message: "Request cancelled." };
    if (res.__error === "timeout") return { ok: false, status: 0, message: "Timed out. Try again." };
    return {
      ok: false,
      status: 0,
      message: "Couldn't reach scholar-sidekick.com — check your connection.",
    };
  }
  if (res.status === 429) return rateLimitedError(res);
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: res.status, message: readError(res) };
  }
  const json = res.json as { ok?: boolean } & T;
  if (!json?.ok) {
    return { ok: false, status: res.status, message: "Check returned no result." };
  }
  // Attach the request id so callers can log it the same way they log
  // format/export request ids.
  const rid = header(res, "x-request-id");
  return { ok: true, data: { ...(json as object), requestId: rid } as T };
}

/** Check whether a single identifier has been retracted, corrected, or flagged. */
export async function checkRetraction(
  id: string,
  opts: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<CheckResult<RetractionPayload>> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const trimmed = trimToBytes(id).slice(0, 500);
  return postJsonCheck<RetractionPayload>(
    `${base}/api/retraction-check`,
    { id: trimmed },
    TIMEOUT_MS,
    opts.signal,
  );
}

/** Check whether a single identifier is openly accessible (Unpaywall). */
export async function checkOpenAccess(
  id: string,
  opts: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<CheckResult<OaPayload>> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const trimmed = trimToBytes(id).slice(0, 500);
  return postJsonCheck<OaPayload>(
    `${base}/api/oa-check`,
    { id: trimmed },
    TIMEOUT_MS,
    opts.signal,
  );
}

/**
 * Verify a claimed citation against authoritative metadata. Single-claim
 * only — the server has no batch endpoint. `screen_with_llm` is gated to
 * paid / first-party callers and is not exposed by the plugin (anonymous
 * callers would receive a 400 LLM_SCREEN_FORBIDDEN).
 */
export async function verifyCitation(
  claimed: VerifyClaim,
  opts: { baseUrl?: string; bypassCache?: boolean; signal?: AbortSignal } = {},
): Promise<CheckResult<VerifyPayload>> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const body: { claimed: VerifyClaim; options?: { bypassCache?: boolean } } = { claimed };
  if (opts.bypassCache) body.options = { bypassCache: true };
  return postJsonCheck<VerifyPayload>(`${base}/api/verify`, body, EXPORT_TIMEOUT_MS, opts.signal);
}
