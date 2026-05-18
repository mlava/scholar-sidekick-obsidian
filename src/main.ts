import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";

import {
  checkOpenAccess,
  checkRetraction,
  describeCheckReason,
  exportCitations,
  type CheckKind,
  type CheckResult,
  type ExportFormat,
  formatCitation,
  type OaPayload,
  type RetractionPayload,
} from "./lib/api";
import { findAllIdentifiers, findIdentifierAt, type IdentifierMatch } from "./lib/detect";
import { CheckResultsModal, type OaRow, type RetractionRow } from "./modals/check-results";
import { InsertCitationModal } from "./modals/insert-citation";
import { VerifyCitationModal } from "./modals/verify-citation";
import { ScholarSidekickSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type ScholarSidekickSettings } from "./types";

const NOTE_CHECK_CONCURRENCY = 5;

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
      name: "Replace identifier at caret with citation",
      editorCallback: (editor) => this.replaceAtCursor(editor),
    });

    this.addCommand({
      id: "insert-citation",
      name: "Insert citation…",
      editorCallback: (editor) => this.openInsertModal(editor),
    });

    this.addCommand({
      id: "export-note-bibtex",
      name: "Export note citations to bibtex",
      callback: () => this.exportNote("bib"),
    });

    this.addCommand({
      id: "export-note-ris",
      name: "Export note citations to ris",
      callback: () => this.exportNote("ris"),
    });

    this.addCommand({
      id: "check-retraction-at-caret",
      name: "Check identifier at caret for retraction",
      editorCallback: (editor) => this.runCaretCheck(editor, "retraction"),
    });

    this.addCommand({
      id: "check-oa-at-caret",
      name: "Check identifier at caret for open access",
      editorCallback: (editor) => this.runCaretCheck(editor, "oa"),
    });

    this.addCommand({
      id: "check-note-retractions",
      name: "Check note citations for retractions",
      editorCallback: (editor) => this.runNoteCheck(editor, "retraction"),
    });

    this.addCommand({
      id: "check-note-open-access",
      name: "Check note citations for open access",
      editorCallback: (editor) => this.runNoteCheck(editor, "oa"),
    });

    this.addCommand({
      id: "verify-selected-citation",
      name: "Verify selected citation",
      editorCallback: (editor) => this.openVerifyModal(editor),
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

  private get formatChecks(): CheckKind[] | undefined {
    return this.settings.checksEnabled ? ["retraction", "oa"] : undefined;
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
      new Notice("Select an identifier first.");
      return;
    }
    new Notice("Formatting…");
    const result = await formatCitation(raw, this.settings.defaultStyle, {
      baseUrl: this.settings.apiBaseUrl,
      output: this.settings.outputMode,
      provenance: this.settings.provenance,
      checks: this.formatChecks,
    });
    if (!result.ok) {
      new Notice(result.message);
      return;
    }
    this.logHeaders("format-selection", result.requestId, result.transformVersion);
    editor.replaceSelection(result.text);
    const warnings =
      result.warnings.length > 0 ? `Inserted (warnings: ${result.warnings.join("; ")})` : null;
    const checkSummary = summariseFormatChecks(result.items);
    if (warnings && checkSummary) new Notice(`${warnings}\n${checkSummary}`);
    else if (warnings) new Notice(warnings);
    else if (checkSummary) new Notice(checkSummary);
  }

  private async replaceAtCursor(editor: Editor) {
    const cursor = editor.getCursor();
    const fullText = editor.getValue();
    const offset = editor.posToOffset(cursor);

    const match = findIdentifierAt(fullText, offset, 96);
    if (!match) {
      new Notice("No identifier found near the caret. Try selecting it first.");
      return;
    }

    new Notice(`Found ${match.type.toUpperCase()}: ${match.value}`);
    const result = await formatCitation(match.value, this.settings.defaultStyle, {
      baseUrl: this.settings.apiBaseUrl,
      output: this.settings.outputMode,
      provenance: this.settings.provenance,
      checks: this.formatChecks,
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
    const checkSummary = summariseFormatChecks(result.items);
    if (checkSummary) new Notice(checkSummary);
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

  private async runCaretCheck(editor: Editor, kind: CheckKind) {
    const cursor = editor.getCursor();
    const fullText = editor.getValue();
    const offset = editor.posToOffset(cursor);
    const match = findIdentifierAt(fullText, offset, 96);
    if (!match) {
      new Notice("No identifier found near the caret. Try selecting it first.");
      return;
    }
    new Notice(
      `Checking ${kind === "retraction" ? "retraction" : "open access"} for ${match.value}…`,
    );
    const checker = kind === "retraction" ? checkRetraction : checkOpenAccess;
    const result = await checker(match.value, { baseUrl: this.settings.apiBaseUrl });
    if (!result.ok) {
      new Notice(result.message);
      return;
    }
    new Notice(formatSingleCheckNotice(kind, result));
  }

  private async runNoteCheck(editor: Editor, kind: CheckKind) {
    const fullText = editor.getValue();
    const identifiers = dedupeIdentifiers(findAllIdentifiers(fullText));
    if (identifiers.length === 0) {
      new Notice("No identifiers found in this note.");
      return;
    }
    new Notice(
      `Scanning ${identifiers.length} identifier${identifiers.length === 1 ? "" : "s"} for ${kind === "retraction" ? "retractions" : "open access"}…`,
    );
    if (kind === "retraction") {
      const rows = await runConcurrent(identifiers, (id) =>
        checkRetraction(id.value, { baseUrl: this.settings.apiBaseUrl }).then(
          (result): RetractionRow => ({ identifier: id, result }),
        ),
      );
      new CheckResultsModal(this.app, { kind: "retraction", rows }, editor).open();
    } else {
      const rows = await runConcurrent(identifiers, (id) =>
        checkOpenAccess(id.value, { baseUrl: this.settings.apiBaseUrl }).then(
          (result): OaRow => ({ identifier: id, result }),
        ),
      );
      new CheckResultsModal(this.app, { kind: "oa", rows }, editor).open();
    }
  }

  private openVerifyModal(editor: Editor) {
    const initial = editor.getSelection().trim();
    new VerifyCitationModal(this.app, this.settings, initial).open();
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

function dedupeIdentifiers(matches: IdentifierMatch[]): IdentifierMatch[] {
  const seen = new Set<string>();
  const out: IdentifierMatch[] = [];
  for (const m of matches) {
    const key = `${m.type}:${m.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

async function runConcurrent<T, U>(items: T[], fn: (item: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(NOTE_CHECK_CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const idx = next;
        next += 1;
        out[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

function formatSingleCheckNotice(
  kind: CheckKind,
  result: Extract<CheckResult<RetractionPayload | OaPayload>, { ok: true }>,
): string {
  if (kind === "retraction") {
    const payload = result.data as RetractionPayload;
    if (!payload.result) return describeCheckReason(payload.reason);
    const r = payload.result;
    if (r.isRetracted) {
      const n = r.notices[0];
      const dateBit = n?.date ? ` (${n.date})` : "";
      return `RETRACTED — ${n?.label ?? "retraction notice"}${dateBit}`;
    }
    if (r.hasConcern) return "EXPRESSION OF CONCERN raised for this paper.";
    if (r.hasCorrections) return "CORRECTION published for this paper.";
    return "OK — no retractions or notices found.";
  }
  const payload = result.data as OaPayload;
  if (!payload.result) return describeCheckReason(payload.reason);
  const r = payload.result;
  if (r.isOa) {
    const license = r.bestLocation?.license ? ` · ${r.bestLocation.license}` : "";
    const link = r.bestLocation?.url ? `\n${r.bestLocation.url}` : "";
    return `OPEN (${r.oaStatus}${license})${link}`;
  }
  return "CLOSED — no open-access copy found.";
}

function summariseFormatChecks(
  items?: Array<{
    _checks?: {
      retraction?: { status?: string; notices?: Array<{ label?: string; date?: string | null }> };
      open_access?: { status?: string; best_url?: string };
    };
  }>,
): string | null {
  if (!items?.length) return null;
  const parts: string[] = [];
  for (const item of items) {
    const c = item._checks;
    if (!c) continue;
    const subs: string[] = [];
    if (c.retraction) {
      if (c.retraction.status === "retracted") {
        const n = c.retraction.notices?.[0];
        subs.push(`RETRACTED${n?.label ? `: ${n.label}` : ""}`);
      } else if (c.retraction.status === "concern") subs.push("EXPRESSION OF CONCERN");
      else if (c.retraction.status === "correction") subs.push("CORRECTION");
      else if (c.retraction.status === "ok") subs.push("Retraction: OK");
      else subs.push("Retraction: unknown");
    }
    if (c.open_access) {
      if (c.open_access.status === "open") subs.push("Open access");
      else if (c.open_access.status === "closed") subs.push("Closed access");
      else subs.push("OA: unknown");
    }
    if (subs.length) parts.push(subs.join(" · "));
  }
  return parts.length ? parts.join("\n") : null;
}
