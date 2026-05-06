import { App, PluginSettingTab, Setting } from "obsidian";

import { BUILTIN_STYLES } from "./lib/api";
import type ScholarSidekickPlugin from "./main";

export class ScholarSidekickSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ScholarSidekickPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default citation style")
      .setDesc(
        "Used by every command unless overridden in the modal. Five built-in styles are listed; the modal lets you search 10,000+ citation styles.",
      )
      .addDropdown((drop) => {
        for (const id of BUILTIN_STYLES) drop.addOption(id, id.toUpperCase());
        // Allow a non-builtin style if the user has previously picked one in the modal.
        if (!BUILTIN_STYLES.includes(this.plugin.settings.defaultStyle as never)) {
          drop.addOption(this.plugin.settings.defaultStyle, this.plugin.settings.defaultStyle);
        }
        drop.setValue(this.plugin.settings.defaultStyle).onChange(async (value) => {
          this.plugin.settings.defaultStyle = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Output format")
      .setDesc(
        "Plain text is the safest default. HTML preserves italics and inline markup but only applies to styles selected via the modal — the five built-in styles emit text only and fall back automatically.",
      )
      .addDropdown((drop) =>
        drop
          .addOption("text", "Plain text")
          .addOption("html", "HTML")
          .setValue(this.plugin.settings.outputMode)
          .onChange(async (value) => {
            this.plugin.settings.outputMode = value as "text" | "html";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Replace identifier at caret")
      .setDesc(
        "Whether the command swaps the identifier in place or appends the citation after it.",
      )
      .addDropdown((drop) =>
        drop
          .addOption("replace", "Replace in place")
          .addOption("append", "Append after identifier")
          .setValue(this.plugin.settings.replaceMode)
          .onChange(async (value) => {
            this.plugin.settings.replaceMode = value as "replace" | "append";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show sources & conflicts (experimental)")
      .setDesc(
        "Sends ?provenance=1 with each request. Surfaces which upstream source supplied each field. Currently a no-op against the production API; activates with a future server release.",
      )
      .addToggle((tog) =>
        tog.setValue(this.plugin.settings.provenance).onChange(async (value) => {
          this.plugin.settings.provenance = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc(
        "Override only if you're testing against a staging or self-hosted instance.",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://scholar-sidekick.com")
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiBaseUrl = value.trim() || "https://scholar-sidekick.com";
            await this.plugin.saveSettings();
          }),
      );
  }
}
