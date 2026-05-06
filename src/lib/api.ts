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
export const CLIENT_TAG = "scholar-sidekick-obsidian/0.1.0";

const TIMEOUT_MS = 15_000;
const STYLES_TIMEOUT_MS = 6_000;
const EXPORT_TIMEOUT_MS = 30_000;
const MAX_INPUT_BYTES = 64_000;

export const BUILTIN_STYLES = ["vancouver", "apa", "ama", "ieee", "cse"] as const;
export type BuiltinStyle = (typeof BUILTIN_STYLES)[number];

export type OutputMode = "text" | "html" | "json";

export interface FormatOptions {
  baseUrl?: string;
  output?: OutputMode;
  provenance?: boolean;
  signal?: AbortSignal;
}

export type FormatResult =
  | {
      ok: true;
      text: string;
      styleUsed: string;
      warnings: string[];
      requestId: string | null;
      transformVersion: string | null;
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
    }
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
    timer = activeWindow.setTimeout(() => resolve({ __error: "timeout" }), opts.timeoutMs);
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
    if (timer) activeWindow.clearTimeout(timer);
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

  const url = withQuery(base, "/api/format", opts.provenance ? { provenance: "1" } : undefined);
  const res = await doRequest({
    method: "POST",
    url,
    body: JSON.stringify({ text: trimmed, style, output }),
    contentType: "application/json",
    timeoutMs: TIMEOUT_MS,
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

  const url = withQuery(base, "/api/format", opts.provenance ? { provenance: "1" } : undefined);
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
