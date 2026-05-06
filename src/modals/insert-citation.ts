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
      .setDesc("Enter a citation identifier or URL.")
      .addText((text) => {
        text
          .setPlaceholder("10.1038/s41586-021-03819-2")
          .setValue(this.identifier)
          .onChange((value) => {
            this.identifier = value.trim();
          });
        text.inputEl.addClass("scholar-sidekick-identifier-input");
      });

    const styleRow = new Setting(contentEl)
      .setName("Style")
      .setDesc(`Currently: ${this.style}. Pick a built-in or search the full catalogue below.`);

    const chipsWrap = styleRow.controlEl.createDiv({ cls: "scholar-sidekick-chips" });
    for (const id of BUILTIN_STYLES) {
      const btn = chipsWrap.createEl("button", {
        text: id.toUpperCase(),
        cls: ["mod-cta", "scholar-sidekick-chip"],
      });
      btn.onclick = (e) => {
        e.preventDefault();
        this.style = id;
        styleRow.setDesc(
          `Currently: ${this.style}. Pick a built-in or search the full catalogue below.`,
        );
      };
    }

    const searchWrap = contentEl.createDiv();
    searchWrap.createEl("h3", { text: "Search styles", cls: "scholar-sidekick-search-heading" });
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      placeholder: "Search 10,000+ styles…",
      cls: "scholar-sidekick-search-input",
    });

    this.statusEl = searchWrap.createDiv({ cls: "scholar-sidekick-status" });
    this.resultsEl = searchWrap.createDiv();

    let debounce: number | undefined;
    searchInput.addEventListener("input", () => {
      activeWindow.clearTimeout(debounce);
      debounce = activeWindow.setTimeout(() => {
        void this.runStyleSearch(searchInput.value);
      }, 200);
    });

    const buttonRow = contentEl.createDiv({ cls: "scholar-sidekick-button-row" });
    const cancel = buttonRow.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const insert = buttonRow.createEl("button", {
      text: "Insert",
      cls: ["mod-cta", "scholar-sidekick-chip"],
    });
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
    const list = this.resultsEl.createEl("ul", { cls: "scholar-sidekick-results-list" });
    for (const entry of results.slice(0, 30)) {
      const li = list.createEl("li", { cls: "scholar-sidekick-results-item" });
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
