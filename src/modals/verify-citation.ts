// obsidian-plugin/src/modals/verify-citation.ts
//
// Manual verifier form. Pre-fills from selected text using a best-effort
// title + DOI heuristic, lets the user edit claim fields, calls
// /api/verify, and renders verdict + mismatches + candidates + provenance.
// `screen_with_llm` is intentionally not exposed: it's paid-tier gated.

import { App, Modal, Notice, Setting } from "obsidian";

import { DEFAULT_BASE, verifyCitation, type VerifyClaim, type VerifyPayload } from "../lib/api";
import { findAllIdentifiers } from "../lib/detect";
import type { ScholarSidekickSettings } from "../types";

type ClaimState = {
  title: string;
  family: string;
  given: string;
  year: string;
  container: string;
  identifierKind: VerifyIdentifierKind;
  identifierValue: string;
};

type VerifyIdentifierKind = "doi" | "pmid" | "pmcid" | "arxiv" | "isbn" | "issn" | "ads";

const IDENTIFIER_KIND_LABELS: Record<VerifyIdentifierKind, string> = {
  doi: "DOI",
  pmid: "PMID",
  pmcid: "PMCID",
  arxiv: "arXiv",
  isbn: "ISBN",
  issn: "ISSN",
  ads: "ADS bibcode",
};

export class VerifyCitationModal extends Modal {
  private claim: ClaimState;
  private busy = false;
  private resultsEl?: HTMLElement;
  private submitBtn?: HTMLButtonElement;

  constructor(
    app: App,
    private readonly settings: ScholarSidekickSettings,
    initialText = "",
  ) {
    super(app);
    this.claim = parseSelectionToClaim(initialText);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("scholar-sidekick-verify-modal");
    contentEl.createEl("h2", { text: "Verify citation" });
    contentEl.createEl("p", {
      text: "Enter the citation you want to check. The verifier cross-references the claimed title and identifier against Crossref, PubMed, and OpenAlex to detect fabricated or wrong-identifier citations.",
      cls: "scholar-sidekick-check-subtitle",
    });

    new Setting(contentEl)
      .setName("Claimed title")
      .setDesc("Required. The title as written in the citation.")
      .addTextArea((t) => {
        t.setValue(this.claim.title)
          .setPlaceholder("Effect of ... on ...")
          .onChange((v) => {
            this.claim.title = v;
          });
        t.inputEl.rows = 2;
        t.inputEl.addClass("scholar-sidekick-verify-textarea");
      });

    new Setting(contentEl).setName("First author").addText((t) => {
      t.setPlaceholder("Family name")
        .setValue(this.claim.family)
        .onChange((v) => {
          this.claim.family = v;
        });
      t.inputEl.addClass("scholar-sidekick-verify-family");
    });

    new Setting(contentEl)
      .setName("First author (given name)")
      .setDesc("Optional. Improves family ↔ given swap detection.")
      .addText((t) => {
        t.setPlaceholder("Given name")
          .setValue(this.claim.given)
          .onChange((v) => {
            this.claim.given = v;
          });
      });

    new Setting(contentEl).setName("Year").addText((t) => {
      t.setPlaceholder("2024")
        .setValue(this.claim.year)
        .onChange((v) => {
          this.claim.year = v;
        });
    });

    new Setting(contentEl).setName("Container / journal").addText((t) => {
      t.setPlaceholder("Nature, JAMA, ...")
        .setValue(this.claim.container)
        .onChange((v) => {
          this.claim.container = v;
        });
    });

    new Setting(contentEl)
      .setName("Identifier")
      .setDesc("Pick the kind, then paste the value. DOI is preferred when available.")
      .addDropdown((d) => {
        for (const k of Object.keys(IDENTIFIER_KIND_LABELS) as VerifyIdentifierKind[]) {
          d.addOption(k, IDENTIFIER_KIND_LABELS[k]);
        }
        d.setValue(this.claim.identifierKind).onChange((v) => {
          this.claim.identifierKind = v as VerifyIdentifierKind;
        });
      })
      .addText((t) => {
        t.setPlaceholder("10.1234/abcd")
          .setValue(this.claim.identifierValue)
          .onChange((v) => {
            this.claim.identifierValue = v;
          });
        t.inputEl.addClass("scholar-sidekick-verify-identifier");
      });

    const buttonRow = contentEl.createDiv({ cls: "scholar-sidekick-button-row" });
    const cancel = buttonRow.createEl("button", { text: "Close" });
    cancel.onclick = () => this.close();

    const openWeb = buttonRow.createEl("button", { text: "Open in web verifier" });
    openWeb.onclick = () => this.openWebVerifier();

    this.submitBtn = buttonRow.createEl("button", {
      text: "Verify",
      cls: "mod-cta",
    });
    this.submitBtn.onclick = () => void this.submit();

    this.resultsEl = contentEl.createDiv({ cls: "scholar-sidekick-verify-results" });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (!this.claim.title.trim()) {
      new Notice("A claimed title is required.");
      return;
    }
    this.busy = true;
    if (this.submitBtn) {
      this.submitBtn.disabled = true;
      this.submitBtn.setText("Verifying…");
    }
    if (this.resultsEl) {
      this.resultsEl.empty();
      this.resultsEl.createEl("p", { text: "Verifying…", cls: "scholar-sidekick-status" });
    }

    const claimed: VerifyClaim = { title: this.claim.title.trim() };
    if (this.claim.family.trim()) {
      const family = this.claim.family.trim();
      const given = this.claim.given.trim();
      claimed.authors = [given ? { family, given } : { family }];
    }
    const year = Number.parseInt(this.claim.year, 10);
    if (Number.isFinite(year)) claimed.year = year;
    if (this.claim.container.trim()) claimed.container = this.claim.container.trim();
    if (this.claim.identifierValue.trim()) {
      claimed[this.claim.identifierKind] = this.claim.identifierValue.trim();
    }

    const result = await verifyCitation(claimed, { baseUrl: this.settings.apiBaseUrl });
    this.busy = false;
    if (this.submitBtn) {
      this.submitBtn.disabled = false;
      this.submitBtn.setText("Verify");
    }
    if (!this.resultsEl) return;
    this.resultsEl.empty();
    if (!result.ok) {
      this.resultsEl.createEl("p", {
        text: result.message,
        cls: "scholar-sidekick-status scholar-sidekick-status-error",
      });
      return;
    }
    this.renderResult(result.data);
  }

  private renderResult(payload: VerifyPayload): void {
    if (!this.resultsEl) return;
    this.resultsEl.empty();

    const header = this.resultsEl.createDiv({ cls: "scholar-sidekick-verify-verdict" });
    header.appendChild(verdictPill(payload.verdict));
    header.appendChild(confidencePill(payload.confidence));

    if (payload.mismatches.length > 0) {
      const wrap = this.resultsEl.createDiv({ cls: "scholar-sidekick-verify-section" });
      wrap.createEl("h3", { text: "Mismatches" });
      const list = wrap.createEl("ul");
      for (const m of payload.mismatches) {
        const li = list.createEl("li");
        const pct = Math.round((m.similarity ?? 0) * 100);
        li.setText(
          `${labelField(m.field)} — claimed "${formatScalar(m.claimed)}" vs resolved "${formatScalar(m.resolved)}" (similarity ${pct}%)`,
        );
      }
    }

    if (payload.matched) {
      const wrap = this.resultsEl.createDiv({ cls: "scholar-sidekick-verify-section" });
      wrap.createEl("h3", { text: "Matched record" });
      const matched = payload.matched;
      const dl = wrap.createEl("dl");
      const addRow = (k: string, v: string | null | undefined) => {
        if (!v) return;
        dl.createEl("dt", { text: k });
        dl.createEl("dd", { text: v });
      };
      addRow("Title", typeof matched.title === "string" ? matched.title : null);
      const firstAuthor = matched.authors?.[0];
      addRow(
        "First author",
        firstAuthor
          ? `${firstAuthor.family ?? ""}${firstAuthor.given ? ", " + firstAuthor.given : ""}`
          : null,
      );
      addRow("Year", matched.issued?.year ? String(matched.issued.year) : null);
      addRow("Container", matched.container?.title ?? null);
    }

    if (payload.candidates && payload.candidates.length > 0) {
      const wrap = this.resultsEl.createDiv({ cls: "scholar-sidekick-verify-section" });
      wrap.createEl("h3", { text: "Candidates" });
      const list = wrap.createEl("ul");
      for (const c of payload.candidates.slice(0, 5)) {
        const li = list.createEl("li");
        const pct = Math.round((c.score ?? 0) * 100);
        const title = typeof c.item.title === "string" ? c.item.title : "(no title)";
        const registries = c.registries?.join(", ") || "—";
        li.setText(`${title} — ${pct}% via ${registries}`);
      }
    }

    if (payload._provenance) {
      const wrap = this.resultsEl.createDiv({ cls: "scholar-sidekick-verify-section" });
      wrap.createEl("h3", { text: "Provenance" });
      const stages = payload._provenance.stages_run.join(" → ") || "(none)";
      wrap.createEl("p", { text: `Stages run: ${stages}` });
      if (payload._provenance.resolved_via) {
        wrap.createEl("p", { text: `Resolved via: ${payload._provenance.resolved_via}` });
      }
      if (payload._provenance.skipped_reason) {
        wrap.createEl("p", {
          text: `Skipped reason: ${payload._provenance.skipped_reason}`,
        });
      }
      if (payload._provenance.registries_searched?.length) {
        const ul = wrap.createEl("ul");
        for (const r of payload._provenance.registries_searched) {
          ul.createEl("li", {
            text: `${r.registry} — ${r.ok ? "ok" : "fail"} (${r.count} hit${r.count === 1 ? "" : "s"}${r.reason ? `, ${r.reason}` : ""})`,
          });
        }
      }
    }
  }

  private openWebVerifier(): void {
    const base = this.settings.apiBaseUrl || DEFAULT_BASE;
    const url = new URL(`${base}/tools/citation-verifier`);
    // Hand off whatever the user has typed so far as structured params —
    // the web verifier reads these on mount and pre-fills the form. This
    // is the "escalate to the full UX" path: user typed enough into the
    // plugin modal to want a richer view (more candidates, history, etc.)
    // but doesn't want to retype the claim.
    if (this.claim.title.trim()) url.searchParams.set("title", this.claim.title.trim());
    if (this.claim.family.trim()) url.searchParams.set("author", this.claim.family.trim());
    if (this.claim.year.trim()) url.searchParams.set("year", this.claim.year.trim());
    if (this.claim.container.trim()) url.searchParams.set("container", this.claim.container.trim());
    if (this.claim.identifierValue.trim()) {
      url.searchParams.set(this.claim.identifierKind, this.claim.identifierValue.trim());
    }
    window.open(url.toString(), "_blank", "noopener");
  }
}

function labelField(field: string): string {
  switch (field) {
    case "first_author":
      return "First author";
    case "title":
      return "Title";
    case "year":
      return "Year";
    case "container":
      return "Container";
    default:
      return field;
  }
}

function formatScalar(v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  return String(v);
}

function verdictPill(verdict: VerifyPayload["verdict"]): HTMLElement {
  const span = document.createElement("span");
  span.addClass("scholar-sidekick-pill");
  switch (verdict) {
    case "matched":
      span.addClass("scholar-sidekick-status-ok");
      break;
    case "mismatch":
      span.addClass("scholar-sidekick-status-bad");
      break;
    case "ambiguous":
      span.addClass("scholar-sidekick-status-warn");
      break;
    default:
      span.addClass("scholar-sidekick-status-unknown");
  }
  span.setText(verdict.toUpperCase());
  return span;
}

function confidencePill(confidence: VerifyPayload["confidence"]): HTMLElement {
  const span = document.createElement("span");
  span.addClass("scholar-sidekick-pill", "scholar-sidekick-status-unknown");
  span.setText(`Confidence: ${confidence}`);
  return span;
}

function parseSelectionToClaim(initial: string): ClaimState {
  const raw = initial.trim();
  const claim: ClaimState = {
    title: "",
    family: "",
    given: "",
    year: "",
    container: "",
    identifierKind: "doi",
    identifierValue: "",
  };
  if (!raw) return claim;

  // Identifier sniff: pick the first detected identifier.
  const ids = findAllIdentifiers(raw);
  const first = ids[0];
  if (first) {
    claim.identifierKind = (first.type === "issn" ? "issn" : first.type) as VerifyIdentifierKind;
    claim.identifierValue = first.value;
  }

  // Year sniff: find the first 4-digit year in 1900–2099.
  const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) claim.year = yearMatch[1];

  // Title sniff: use the longest sentence-like chunk that isn't the
  // identifier. Splits on period, semicolon, or newline.
  const candidates = raw
    .split(/[.;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8 && !s.startsWith("http") && !/^10\.\d{4}/.test(s));
  if (candidates.length) {
    candidates.sort((a, b) => b.length - a.length);
    claim.title = candidates[0].slice(0, 400);
  }

  return claim;
}
