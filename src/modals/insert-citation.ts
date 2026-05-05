import { App, Modal, Notice, Setting } from "obsidian";

import { BUILTIN_STYLES, formatCitation, searchStyles, type StyleEntry } from "../lib/api";
import type { ScholarSidekickSettings } from "../types";

export interface InsertResult {
  text: string;
  styleUsed: string;
}

export class InsertCitationModal extends Modal {
  private identifier = "";
  private style: string;
  private searchAbort: AbortController | null = null;
  private statusEl?: HTMLElement;
  private resultsEl?: HTMLElement;

  constructor(
    app: App,
    private readonly settings: ScholarSidekickSettings,
    private readonly onInsert: (result: InsertResult) => void,
    initialText = "",
  ) {
    super(app);
    this.identifier = initialText;
    this.style = settings.defaultStyle;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Insert citation" });

    new Setting(contentEl)
      .setName("Identifier")
      .setDesc("DOI, PMID, ISBN, arXiv ID, ADS bibcode, or any URL containing one.")
      .addText((text) =>
        text
          .setPlaceholder("10.1038/s41586-021-03819-2")
          .setValue(this.identifier)
          .onChange((value) => {
            this.identifier = value.trim();
          })
          .inputEl.setAttribute("style", "width: 100%"),
      );

    const styleRow = new Setting(contentEl)
      .setName("Style")
      .setDesc(`Currently: ${this.style}. Pick a built-in or search the full CSL catalogue below.`);

    const chipsWrap = styleRow.controlEl.createDiv({ cls: "scholar-sidekick-chips" });
    chipsWrap.style.display = "flex";
    chipsWrap.style.flexWrap = "wrap";
    chipsWrap.style.gap = "6px";
    for (const id of BUILTIN_STYLES) {
      const btn = chipsWrap.createEl("button", { text: id.toUpperCase(), cls: "mod-cta" });
      btn.style.padding = "2px 8px";
      btn.onclick = (e) => {
        e.preventDefault();
        this.style = id;
        styleRow.setDesc(
          `Currently: ${this.style}. Pick a built-in or search the full CSL catalogue below.`,
        );
      };
    }

    const searchWrap = contentEl.createDiv();
    searchWrap.createEl("h3", { text: "Search styles", cls: "scholar-sidekick-search-heading" });
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      placeholder: "Search 10,000+ styles…",
    });
    searchInput.style.width = "100%";
    searchInput.style.marginBottom = "8px";

    this.statusEl = searchWrap.createEl("div", { cls: "scholar-sidekick-status" });
    this.resultsEl = searchWrap.createEl("div");

    let debounce: number | undefined;
    searchInput.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => this.runStyleSearch(searchInput.value), 200);
    });

    const buttonRow = contentEl.createDiv();
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "flex-end";
    buttonRow.style.gap = "8px";
    buttonRow.style.marginTop = "16px";
    const cancel = buttonRow.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const insert = buttonRow.createEl("button", { text: "Insert", cls: "mod-cta" });
    insert.onclick = () => this.submit();
  }

  onClose() {
    this.searchAbort?.abort();
    this.contentEl.empty();
  }

  private async runStyleSearch(query: string) {
    this.searchAbort?.abort();
    const ctrl = new AbortController();
    this.searchAbort = ctrl;
    if (this.statusEl) this.statusEl.textContent = "Searching…";
    const results = await searchStyles(query, {
      baseUrl: this.settings.apiBaseUrl,
      signal: ctrl.signal,
    });
    if (ctrl.signal.aborted || !this.resultsEl) return;
    this.renderStyleResults(results, query);
  }

  private renderStyleResults(results: StyleEntry[], query: string) {
    if (!this.resultsEl || !this.statusEl) return;
    this.resultsEl.empty();
    if (results.length === 0) {
      this.statusEl.textContent = query ? "No matches." : "Type to search.";
      return;
    }
    this.statusEl.textContent = `${results.length} matches`;
    const list = this.resultsEl.createEl("ul");
    list.style.listStyle = "none";
    list.style.padding = "0";
    list.style.maxHeight = "240px";
    list.style.overflowY = "auto";
    for (const entry of results.slice(0, 30)) {
      const li = list.createEl("li");
      li.style.padding = "4px 0";
      li.style.cursor = "pointer";
      li.textContent = `${entry.title} — ${entry.id}`;
      li.onclick = () => {
        this.style = entry.id;
        new Notice(`Style: ${entry.id}`);
      };
    }
  }

  private async submit() {
    if (!this.identifier) {
      new Notice("Enter an identifier first.");
      return;
    }
    new Notice("Formatting…");
    const result = await formatCitation(this.identifier, this.style, {
      baseUrl: this.settings.apiBaseUrl,
      output: this.settings.outputMode,
      provenance: this.settings.provenance,
    });
    if (!result.ok) {
      new Notice(result.message);
      return;
    }
    this.onInsert({ text: result.text, styleUsed: result.styleUsed });
    if (this.style !== this.settings.defaultStyle) {
      // Persist the most recently used style as the new default — same UX as the browser extension.
      this.settings.defaultStyle = this.style;
    }
    this.close();
  }
}
