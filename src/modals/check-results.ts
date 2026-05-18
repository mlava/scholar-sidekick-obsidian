// obsidian-plugin/src/modals/check-results.ts
//
// Read-only modal listing per-identifier retraction or open-access status
// after a note-wide scan. Always read-only — the user must opt in via
// "Append summary at caret" to mutate the note.
//
// Post-resolution dedupe: rows that resolve to the same DOI (e.g. a DOI
// and a PMID for the same paper) are merged into a single row. Source
// identifiers are listed together in the identifier cell so the user can
// see which note tokens were grouped.

import { App, Editor, Modal, Notice } from "obsidian";

import { describeCheckReason, type OaPayload, type RetractionPayload } from "../lib/api";
import type { IdentifierMatch } from "../lib/detect";

export type CheckKind = "retraction" | "oa";

export type RetractionRow = {
  identifier: IdentifierMatch;
  result: { ok: true; data: RetractionPayload } | { ok: false; status: number; message: string };
};

export type OaRow = {
  identifier: IdentifierMatch;
  result: { ok: true; data: OaPayload } | { ok: false; status: number; message: string };
};

type Rows = { kind: "retraction"; rows: RetractionRow[] } | { kind: "oa"; rows: OaRow[] };

type MergedRetractionRow = {
  identifiers: IdentifierMatch[];
  result: RetractionRow["result"];
};

type MergedOaRow = {
  identifiers: IdentifierMatch[];
  result: OaRow["result"];
};

type MergedRows =
  | { kind: "retraction"; rows: MergedRetractionRow[] }
  | { kind: "oa"; rows: MergedOaRow[] };

export class CheckResultsModal extends Modal {
  private readonly merged: MergedRows;

  constructor(
    app: App,
    private readonly rows: Rows,
    private readonly editor: Editor | null,
  ) {
    super(app);
    this.merged = mergeRows(rows);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("scholar-sidekick-check-modal");
    this.modalEl.addClass("scholar-sidekick-check-modal-wide");

    contentEl.createEl("h2", {
      text:
        this.rows.kind === "retraction" ? "Retraction check results" : "Open access check results",
    });

    if (this.merged.rows.length === 0) {
      contentEl.createEl("p", { text: "No identifiers found in this note." });
      return;
    }

    contentEl.createEl("p", {
      text:
        this.rows.kind === "retraction"
          ? "Status from Crossref + Retraction Watch. Click a DOI to open the source record."
          : "Status from Unpaywall. Click a best-copy link to open the legal open-access version.",
      cls: "scholar-sidekick-check-subtitle",
    });

    const table = contentEl.createEl("table", { cls: "scholar-sidekick-check-table" });
    const colgroup = table.createEl("colgroup");
    colgroup.createEl("col", { cls: "identifier" });
    colgroup.createEl("col", { cls: "status" });
    colgroup.createEl("col", { cls: "doi" });
    colgroup.createEl("col", { cls: "detail" });

    const thead = table.createEl("thead").createEl("tr");
    if (this.rows.kind === "retraction") {
      thead.createEl("th", { text: "Identifier" });
      thead.createEl("th", { text: "Status" });
      thead.createEl("th", { text: "DOI" });
      thead.createEl("th", { text: "Title / notice" });
    } else {
      thead.createEl("th", { text: "Identifier" });
      thead.createEl("th", { text: "Status" });
      thead.createEl("th", { text: "DOI" });
      thead.createEl("th", { text: "Best legal copy" });
    }

    const tbody = table.createEl("tbody");
    if (this.merged.kind === "retraction") {
      for (const row of this.merged.rows) this.renderRetractionRow(tbody, row);
    } else {
      for (const row of this.merged.rows) this.renderOaRow(tbody, row);
    }

    const summary = this.summarise();
    contentEl.createEl("p", { text: summary, cls: "scholar-sidekick-check-summary" });

    const buttonRow = contentEl.createDiv({ cls: "scholar-sidekick-button-row" });
    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.onclick = () => this.close();

    if (this.editor) {
      const appendBtn = buttonRow.createEl("button", {
        text: "Append summary at caret",
        cls: "mod-cta",
      });
      appendBtn.onclick = () => this.appendSummary();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderIdentifierCell(tr: HTMLElement, identifiers: IdentifierMatch[]) {
    const cell = tr.createEl("td");
    for (const id of identifiers) {
      const line = cell.createDiv();
      line.setText(`${id.type.toUpperCase()}: ${id.value}`);
    }
  }

  private renderRetractionRow(tbody: HTMLElement, row: MergedRetractionRow) {
    const tr = tbody.createEl("tr");
    this.renderIdentifierCell(tr, row.identifiers);

    const statusCell = tr.createEl("td");
    if (!row.result.ok) {
      statusCell.appendChild(buildPill("unknown"));
      tr.createEl("td", { text: "—" });
      tr.createEl("td", { text: row.result.message });
      return;
    }
    const payload = row.result.data;
    if (!payload.result) {
      statusCell.appendChild(buildPill("unknown"));
      tr.createEl("td", { text: "—" });
      tr.createEl("td", { text: describeCheckReason(payload.reason) });
      return;
    }
    const r = payload.result;
    let status: "ok" | "retracted" | "concern" | "correction" = "ok";
    if (r.isRetracted) status = "retracted";
    else if (r.hasConcern) status = "concern";
    else if (r.hasCorrections) status = "correction";
    statusCell.appendChild(buildPill(status));

    const doiCell = tr.createEl("td");
    if (payload.doi) {
      const a = doiCell.createEl("a", {
        text: payload.doi,
        href: `https://doi.org/${encodeURIComponent(payload.doi)}`,
      });
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      doiCell.setText("—");
    }

    const titleCell = tr.createEl("td");
    const firstNotice = r.notices[0];
    if (firstNotice) {
      const dateBit = firstNotice.date ? ` (${firstNotice.date})` : "";
      titleCell.setText(`${firstNotice.label}${dateBit}`);
    } else if (r.title) {
      titleCell.setText(r.title);
    } else {
      titleCell.setText("No notices.");
    }
  }

  private renderOaRow(tbody: HTMLElement, row: MergedOaRow) {
    const tr = tbody.createEl("tr");
    this.renderIdentifierCell(tr, row.identifiers);

    const statusCell = tr.createEl("td");
    if (!row.result.ok) {
      statusCell.appendChild(buildPill("unknown"));
      tr.createEl("td", { text: "—" });
      tr.createEl("td", { text: row.result.message });
      return;
    }
    const payload = row.result.data;
    if (!payload.result) {
      statusCell.appendChild(buildPill("unknown"));
      tr.createEl("td", { text: "—" });
      tr.createEl("td", { text: describeCheckReason(payload.reason) });
      return;
    }
    const r = payload.result;
    statusCell.appendChild(buildPill(r.isOa ? "open" : "closed"));

    const doiCell = tr.createEl("td");
    if (payload.doi) {
      const a = doiCell.createEl("a", {
        text: payload.doi,
        href: `https://doi.org/${encodeURIComponent(payload.doi)}`,
      });
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      doiCell.setText("—");
    }

    const linkCell = tr.createEl("td");
    if (r.bestLocation?.url) {
      const a = linkCell.createEl("a", {
        text: `${r.oaStatus.toUpperCase()}${r.bestLocation.license ? ` · ${r.bestLocation.license}` : ""}`,
        href: r.bestLocation.url,
      });
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      linkCell.setText(r.oaStatus.toUpperCase());
    }
  }

  private summarise(): string {
    if (this.merged.kind === "retraction") {
      let retracted = 0;
      let concern = 0;
      let correction = 0;
      let unknown = 0;
      for (const row of this.merged.rows) {
        if (!row.result.ok || !row.result.data.result) {
          unknown += 1;
          continue;
        }
        const r = row.result.data.result;
        if (r.isRetracted) retracted += 1;
        else if (r.hasConcern) concern += 1;
        else if (r.hasCorrections) correction += 1;
      }
      const parts: string[] = [];
      if (retracted) parts.push(`${retracted} retracted`);
      if (concern) parts.push(`${concern} expression of concern`);
      if (correction) parts.push(`${correction} correction`);
      if (unknown) parts.push(`${unknown} unresolved`);
      const ok = this.merged.rows.length - retracted - concern - correction - unknown;
      if (ok) parts.unshift(`${ok} OK`);
      return parts.length ? parts.join(" · ") : "No notices.";
    }
    let open = 0;
    let closed = 0;
    let unknown = 0;
    for (const row of this.merged.rows) {
      if (!row.result.ok || !row.result.data.result) {
        unknown += 1;
        continue;
      }
      if (row.result.data.result.isOa) open += 1;
      else closed += 1;
    }
    const parts: string[] = [];
    if (open) parts.push(`${open} open`);
    if (closed) parts.push(`${closed} closed`);
    if (unknown) parts.push(`${unknown} unresolved`);
    return parts.length ? parts.join(" · ") : "No results.";
  }

  private appendSummary(): void {
    if (!this.editor) return;
    const lines = this.buildSummaryLines();
    this.editor.replaceSelection(lines.join("\n") + "\n");
    new Notice("Summary inserted at caret.");
    this.close();
  }

  private buildSummaryLines(): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const heading =
      this.merged.kind === "retraction"
        ? `## Retraction check (Scholar Sidekick · ${today})`
        : `## Open access check (Scholar Sidekick · ${today})`;
    const out: string[] = [heading, ""];
    if (this.merged.kind === "retraction") {
      for (const row of this.merged.rows) out.push(`- ${formatRetractionMarkdown(row)}`);
    } else {
      for (const row of this.merged.rows) out.push(`- ${formatOaMarkdown(row)}`);
    }
    return out;
  }
}

/**
 * Collapse rows whose resolved DOI is the same. A note that mentions a paper
 * by both DOI and PMID hits the API twice but represents one paper — the
 * user wants one row showing both source identifiers. Rows with no resolved
 * DOI stay separate (we can't prove they're the same paper).
 */
function mergeRows(rows: Rows): MergedRows {
  if (rows.kind === "retraction") {
    return { kind: "retraction", rows: mergeBy(rows.rows, retractionDoiOf) };
  }
  return { kind: "oa", rows: mergeBy(rows.rows, oaDoiOf) };
}

function retractionDoiOf(row: RetractionRow): string | null {
  return row.result.ok ? (row.result.data.doi ?? null) : null;
}

function oaDoiOf(row: OaRow): string | null {
  return row.result.ok ? (row.result.data.doi ?? null) : null;
}

function mergeBy<R extends RetractionRow | OaRow>(
  rows: R[],
  doiOf: (row: R) => string | null,
): Array<{ identifiers: IdentifierMatch[]; result: R["result"] }> {
  const seen = new Map<string, { identifiers: IdentifierMatch[]; result: R["result"] }>();
  const out: Array<{ identifiers: IdentifierMatch[]; result: R["result"] }> = [];
  for (const row of rows) {
    const doi = doiOf(row);
    if (doi) {
      const key = `doi:${doi.toLowerCase()}`;
      const existing = seen.get(key);
      if (existing) {
        existing.identifiers.push(row.identifier);
        continue;
      }
      const entry = { identifiers: [row.identifier], result: row.result };
      seen.set(key, entry);
      out.push(entry);
      continue;
    }
    out.push({ identifiers: [row.identifier], result: row.result });
  }
  return out;
}

function buildPill(status: string): HTMLElement {
  const span = document.createElement("span");
  const { className, label } = pillFor(status);
  span.addClass("scholar-sidekick-pill", `scholar-sidekick-${className}`);
  span.setText(label);
  return span;
}

function pillFor(status: string): { className: string; label: string } {
  switch (status) {
    case "ok":
    case "open":
      return { className: "status-ok", label: status.toUpperCase() };
    case "retracted":
    case "concern":
      return { className: "status-bad", label: status.toUpperCase() };
    case "correction":
    case "closed":
      return { className: "status-warn", label: status.toUpperCase() };
    default:
      return { className: "status-unknown", label: "UNKNOWN" };
  }
}

function identifiersLabel(ids: IdentifierMatch[]): string {
  return ids.map((i) => `${i.type.toUpperCase()}: ${i.value}`).join(" / ");
}

function formatRetractionMarkdown(row: MergedRetractionRow): string {
  const id = identifiersLabel(row.identifiers);
  if (!row.result.ok) return `${id} — error: ${row.result.message}`;
  if (!row.result.data.result) return `${id} — ${describeCheckReason(row.result.data.reason)}`;
  const r = row.result.data.result;
  if (r.isRetracted) {
    const n = r.notices[0];
    const date = n?.date ? ` (${n.date})` : "";
    return `${id} — RETRACTED: ${n?.label ?? "retraction"}${date}`;
  }
  if (r.hasConcern) return `${id} — EXPRESSION OF CONCERN`;
  if (r.hasCorrections) return `${id} — CORRECTION published`;
  return `${id} — OK · no notices`;
}

function formatOaMarkdown(row: MergedOaRow): string {
  const id = identifiersLabel(row.identifiers);
  if (!row.result.ok) return `${id} — error: ${row.result.message}`;
  if (!row.result.data.result) return `${id} — ${describeCheckReason(row.result.data.reason)}`;
  const r = row.result.data.result;
  if (r.isOa && r.bestLocation?.url) {
    const license = r.bestLocation.license ? ` · ${r.bestLocation.license}` : "";
    return `${id} — OPEN (${r.oaStatus}${license}) → ${r.bestLocation.url}`;
  }
  if (r.isOa) return `${id} — OPEN (${r.oaStatus})`;
  return `${id} — CLOSED`;
}
