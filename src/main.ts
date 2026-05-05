import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";

import { exportCitations, type ExportFormat, formatCitation } from "./lib/api";
import { findAllIdentifiers, findIdentifierAt } from "./lib/detect";
import { InsertCitationModal } from "./modals/insert-citation";
import { ScholarSidekickSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type ScholarSidekickSettings } from "./types";

export default class ScholarSidekickPlugin extends Plugin {
  settings: ScholarSidekickSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "format-selection",
      name: "Format selection as citation",
      editorCallback: (editor) => this.formatSelection(editor),
    });

    this.addCommand({
      id: "replace-identifier-at-cursor",
      name: "Replace identifier at cursor with citation",
      editorCallback: (editor) => this.replaceAtCursor(editor),
    });

    this.addCommand({
      id: "insert-citation",
      name: "Insert citation…",
      editorCallback: (editor) => this.openInsertModal(editor),
    });

    this.addCommand({
      id: "export-note-bibtex",
      name: "Export note citations to BibTeX",
      callback: () => this.exportNote("bib"),
    });

    this.addCommand({
      id: "export-note-ris",
      name: "Export note citations to RIS",
      callback: () => this.exportNote("ris"),
    });

    this.addSettingTab(new ScholarSidekickSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    const stored = (await this.loadData()) as Partial<ScholarSidekickSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private logHeaders(label: string, requestId: string | null, transformVersion: string | null) {
    console.debug(`[scholar-sidekick] ${label}`, {
      requestId,
      transformVersion,
    });
  }

  private async formatSelection(editor: Editor) {
    const raw = editor.getSelection().trim();
    if (!raw) {
      new Notice("Select an identifier (DOI, PMID, ISBN, arXiv) first.");
      return;
    }
    new Notice("Formatting…");
    const result = await formatCitation(raw, this.settings.defaultStyle, {
      baseUrl: this.settings.apiBaseUrl,
      output: this.settings.outputMode,
      provenance: this.settings.provenance,
    });
    if (!result.ok) {
      new Notice(result.message);
      return;
    }
    this.logHeaders("format-selection", result.requestId, result.transformVersion);
    editor.replaceSelection(result.text);
    if (result.warnings.length > 0) {
      new Notice(`Inserted (warnings: ${result.warnings.join("; ")})`);
    }
  }

  private async replaceAtCursor(editor: Editor) {
    const cursor = editor.getCursor();
    const fullText = editor.getValue();
    const offset = editor.posToOffset(cursor);

    const match = findIdentifierAt(fullText, offset, 96);
    if (!match) {
      new Notice("No identifier found near the cursor. Try selecting it first.");
      return;
    }

    new Notice(`Found ${match.type.toUpperCase()}: ${match.value}`);
    const result = await formatCitation(match.value, this.settings.defaultStyle, {
      baseUrl: this.settings.apiBaseUrl,
      output: this.settings.outputMode,
      provenance: this.settings.provenance,
    });
    if (!result.ok) {
      new Notice(result.message);
      return;
    }
    this.logHeaders("replace-at-cursor", result.requestId, result.transformVersion);

    const from = editor.offsetToPos(match.start);
    const to = editor.offsetToPos(match.end);
    if (this.settings.replaceMode === "replace") {
      editor.replaceRange(result.text, from, to);
    } else {
      editor.replaceRange(`${editor.getRange(from, to)} ${result.text}`, from, to);
    }
  }

  private openInsertModal(editor: Editor) {
    const initial = editor.getSelection().trim();
    new InsertCitationModal(
      this.app,
      this.settings,
      ({ text, styleUsed }) => {
        editor.replaceSelection(text);
        if (styleUsed && styleUsed !== this.settings.defaultStyle) {
          this.settings.defaultStyle = styleUsed;
          void this.saveSettings();
        }
      },
      initial,
    ).open();
  }

  private async exportNote(format: ExportFormat) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice("Open a note first.");
      return;
    }
    const file = view.file;
    const noteText = view.editor.getValue();
    const identifiers = findAllIdentifiers(noteText).map((m) => m.value);
    if (identifiers.length === 0) {
      new Notice("No identifiers found in this note.");
      return;
    }

    new Notice(`Exporting ${identifiers.length} identifier${identifiers.length === 1 ? "" : "s"}…`);
    const result = await exportCitations(identifiers, format, {
      baseUrl: this.settings.apiBaseUrl,
    });
    if (!result.ok) {
      new Notice(result.message);
      return;
    }
    this.logHeaders(`export-note (${format})`, result.requestId, null);

    await this.writeExportNextToNote(file, format, result.body);
  }

  private async writeExportNextToNote(source: TFile, format: ExportFormat, body: string) {
    const ext = format === "bib" ? "bib" : format === "ris" ? "ris" : format;
    const baseName = source.basename || "note";
    const dir = source.parent?.path && source.parent.path !== "/" ? `${source.parent.path}/` : "";
    let candidate = `${dir}${baseName}.${ext}`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${dir}${baseName} (${counter}).${ext}`;
      counter += 1;
    }
    const file = await this.app.vault.create(candidate, body);
    new Notice(`Saved → ${file.path}`);
  }
}
