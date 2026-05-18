// obsidian-plugin/src/types.ts
import type { OutputMode } from "./lib/api";

export interface ScholarSidekickSettings {
  defaultStyle: string;
  outputMode: OutputMode;
  replaceMode: "replace" | "append";
  provenance: boolean;
  checksEnabled: boolean;
  apiBaseUrl: string;
}

export const DEFAULT_SETTINGS: ScholarSidekickSettings = {
  defaultStyle: "vancouver",
  outputMode: "text",
  replaceMode: "replace",
  provenance: false,
  checksEnabled: false,
  apiBaseUrl: "https://scholar-sidekick.com",
};
