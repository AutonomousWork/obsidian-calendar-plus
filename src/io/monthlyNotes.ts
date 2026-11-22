import type { Moment } from "moment";
import { normalizePath, Notice, TFile } from "obsidian";
import {
  appHasMonthlyNotesPluginLoaded,
  getMonthlyNoteSettings as getPeriodicMonthlyNoteSettings,
  getTemplateInfo,
} from "obsidian-daily-notes-interface";
import type { IPeriodicNoteSettings } from "obsidian-daily-notes-interface";

import { DEFAULT_MONTH_FORMAT } from "src/constants";
import type { ISettings } from "src/settings";
import { createConfirmationDialog } from "src/ui/modal";

/**
 * Monthly note settings. The Periodic Notes plugin takes precedence when its
 * monthly notes are enabled; otherwise the Calendar plugin's own settings are used.
 */
export function getMonthlyNoteSettings(
  settings: ISettings
): IPeriodicNoteSettings {
  if (appHasMonthlyNotesPluginLoaded()) {
    return getPeriodicMonthlyNoteSettings();
  }
  return {
    format: settings.monthlyNoteFormat || DEFAULT_MONTH_FORMAT,
    folder: settings.monthlyNoteFolder?.trim() || "",
    template: settings.monthlyNoteTemplate?.trim() || "",
  };
}

function getMonthlyNotePath(date: Moment, settings: ISettings): string {
  const { format, folder } = getMonthlyNoteSettings(settings);
  return normalizePath(`${folder}/${date.format(format)}.md`);
}

export function getMonthlyNote(date: Moment, settings: ISettings): TFile {
  const file = window.app.vault.getAbstractFileByPath(
    getMonthlyNotePath(date, settings)
  );
  return file instanceof TFile ? file : null;
}

/**
 * Mirrors `createWeeklyNote`: the note is created from the template contents
 * with {{date}}, {{time}} and {{title}} replaced, so Templater can pick it up
 * on file creation.
 */
async function createMonthlyNote(
  date: Moment,
  settings: ISettings
): Promise<TFile> {
  const { vault } = window.app;
  const { template, format } = getMonthlyNoteSettings(settings);
  const [templateContents, foldInfo] = await getTemplateInfo(template);
  const filename = date.format(format);
  const path = getMonthlyNotePath(date, settings);

  try {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !vault.getAbstractFileByPath(dir)) {
      await vault.createFolder(dir);
    }

    const createdFile = await vault.create(
      path,
      templateContents
        .replace(
          /{{\s*(date|time)\s*:(.*?)}}/gi,
          (_, _timeOrDate, momentFormat) => {
            const now = window.moment();
            return date
              .clone()
              .set({
                hour: now.get("hour"),
                minute: now.get("minute"),
                second: now.get("second"),
              })
              .format(momentFormat.trim());
          }
        )
        .replace(/{{\s*date\s*}}/gi, filename)
        .replace(/{{\s*time\s*}}/gi, window.moment().format("HH:mm"))
        .replace(/{{\s*title\s*}}/gi, filename)
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (<any>window.app).foldManager.save(createdFile, foldInfo);
    return createdFile;
  } catch (err) {
    console.error(`Failed to create file: '${path}'`, err);
    new Notice("Unable to create new file.");
  }
}

/**
 * Create a Monthly Note for a given date.
 */
export async function tryToCreateMonthlyNote(
  date: Moment,
  inNewSplit: boolean,
  settings: ISettings,
  cb?: (file: TFile) => void
): Promise<void> {
  const { workspace } = window.app;
  const { format } = getMonthlyNoteSettings(settings);
  const filename = date.format(format);

  const createFile = async () => {
    const monthlyNote = await createMonthlyNote(date, settings);
    if (!monthlyNote) {
      return;
    }
    const leaf = inNewSplit
      ? workspace.splitActiveLeaf()
      : workspace.getUnpinnedLeaf();

    await leaf.openFile(monthlyNote, { active: true });
    cb?.(monthlyNote);
  };

  if (settings.shouldConfirmBeforeCreate) {
    createConfirmationDialog({
      cta: "Create",
      onAccept: createFile,
      text: `File ${filename} does not exist. Would you like to create it?`,
      title: "New Monthly Note",
    });
  } else {
    await createFile();
  }
}
