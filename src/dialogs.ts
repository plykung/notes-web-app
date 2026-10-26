// The main window's editor dialog, conflict compare screen and settings.
import { wordDiff } from "./diff";
import { createEditor, type Draft, type Editor } from "./editor";
import type { ImageChanges } from "./graph";
import { noteText, type Note } from "./note";
import { getSettings, saveSettings, type Settings } from "./settings";
import { formatDateTime, locale, t, translatePage } from "./i18n";
import type { Change, ConflictChoice } from "./sync";
import { confirmDanger, openGallery } from "./ui";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;


// ---------- Editor ----------

const editorDialog = $<HTMLDialogElement>("editor");
const mountEl = $("editor-mount");
const popOutBtn = $<HTMLButtonElement>("editor-popout");

export type EditorActions = {
  /** Saves a change (the editor calls it by itself); resolves with the note's id. */
  save: (id: string | null, change: Change) => Promise<string>;
  /** Deletes the note with this id. */
  remove: (id: string) => void;
  /** Continues editing in a separate window. */
  popOut?: (id: string | null) => void;
  /** The editor closed: send what was saved to Microsoft now. */
  closed: () => void;
};

let actions: EditorActions | null = null;
let editor: Editor | null = null;

/** Opens the editor on a note (or a blank new note). `draft` restores unsaved work. */
export function openEditor(note: Note | null, next: EditorActions, draft?: Draft) {
  actions = next;
  editor = createEditor({
    note,
    draft,
    save: next.save,
    showImages: (images, start, edit) => openGallery({ images, start, onAdd: edit.add, onRemove: edit.remove }),
    onDelete: deleteNote,
    toolbarAt: "top",
  });
  mountEl.replaceChildren(editor.el);
  popOutBtn.hidden = !next.popOut;
  editorDialog.showModal();
  if (!note || matchMedia("(pointer: fine)").matches) editor.focus();
}

/** Saves the open note now, if there is one (before leaving to sign in). */
export async function flushOpenEditor() {
  await editor?.flush();
}

/** Saves whatever is left, then closes. There's no Save button: notes save themselves. */
async function closeEditor() {
  if (!editor || !actions) return;
  const { closed } = actions;
  const open = editor;
  editor = null;
  actions = null;
  editorDialog.close();
  await open.flush();
  mountEl.replaceChildren();
  closed();
}

/** Asks before a note is deleted (Undo is still offered afterwards). */
export const confirmDelete = (doc = document) => confirmDanger("deleteNoteTitle", "deleteNoteBody", doc);

async function deleteNote() {
  if (!editor || !actions) return;
  if (!(await confirmDelete())) return;
  const { remove } = actions;
  const open = editor;
  await open.flush();
  const id = open.id();
  editor = null; // nothing left to save
  actions = null;
  editorDialog.close();
  mountEl.replaceChildren();
  if (id) remove(id);
}

popOutBtn.onclick = async () => {
  if (!editor || !actions?.popOut) return;
  const { popOut } = actions;
  const open = editor;
  await open.flush();
  const id = open.id();
  await closeEditor();
  popOut(id);
};

$("editor-close").onclick = () => closeEditor();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") editor?.flush();
});
editorDialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeEditor();
});
// A click on the dimmed area around the note closes it (and saves).
editorDialog.addEventListener("click", (e) => {
  if (e.target !== editorDialog) return;
  const r = editorDialog.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) closeEditor();
});
editorDialog.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    editor?.flush();
  }
});

// ---------- Conflict compare ----------

const compareDialog = $<HTMLDialogElement>("compare");


function diffSide(parts: ReturnType<typeof wordDiff>, show: "added" | "removed"): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const part of parts) {
    if (part.kind === "same") frag.append(part.text);
    else if (part.kind === show) {
      const mark = document.createElement("mark");
      mark.textContent = part.text;
      frag.append(mark);
    }
  }
  return frag;
}

/** Shows the user's edit next to the saved version and resolves with the version to keep. */
export function chooseConflictVersion(mineHtml: string, saved: Note | null): Promise<ConflictChoice> {
  let parts: ReturnType<typeof wordDiff>;
  try {
    parts = wordDiff(saved ? noteText(saved.html) : "", noteText(mineHtml));
  } catch {
    parts = [
      { kind: "removed", text: saved ? noteText(saved.html) : "" },
      { kind: "added", text: noteText(mineHtml) },
    ];
  }

  $("compare-info").textContent = saved
    ? t("compareInfo", { time: formatDateTime(saved.modified) })
    : t("compareInfoDeleted");
  $("compare-mine").replaceChildren(diffSide(parts, "added"));
  $("compare-saved").replaceChildren(saved ? diffSide(parts, "removed") : t("thisWasDeleted"));
  $("compare-saved-title").textContent = saved ? t("savedElsewhere") : t("deletedElsewhere");
  $("compare-mine-btn").textContent = saved ? t("keepMine") : t("restoreWithEdit");
  $("compare-saved-btn").textContent = saved ? t("keepSaved") : t("leaveDeleted");
  $("compare-both").hidden = !saved;
  $("compare-hint").hidden = !saved;

  compareDialog.showModal();
  return new Promise((resolve) => {
    const pick = (choice: ConflictChoice) => () => {
      compareDialog.close();
      resolve(choice);
    };
    $("compare-mine-btn").onclick = pick("mine");
    $("compare-saved-btn").onclick = pick("saved");
    $("compare-both").onclick = pick("both");
    compareDialog.oncancel = (e) => e.preventDefault();
  });
}

// ---------- Settings ----------

export type StorageReport = {
  notes: number;
  textBytes: number;
  images: number;
  imageBytes: number;
  deviceBytes: number | null;
  lastSynced: string | null;
};

function size(bytes: number): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let i = 0;
  while (bytes >= 1000 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return new Intl.NumberFormat(locale(), { style: "unit", unit: units[i], unitDisplay: "short", maximumFractionDigits: i < 2 ? 0 : 1 }).format(bytes);
}

function fillSelect(select: HTMLSelectElement, options: [value: string, label: string][], current: string) {
  select.replaceChildren(
    ...options.map(([value, label]) => Object.assign(document.createElement("option"), { value, textContent: label })),
  );
  select.value = current;
}

/** The settings pop-up: appearance, language, preview, saving, offline images, storage. */
export async function openSettings(deps: {
  report: () => Promise<StorageReport>;
  changed: (s: Settings) => void;
  fullResync: () => void;
}) {
  const dialog = $<HTMLDialogElement>("settings");
  const fill = () => {
    const s = getSettings();
    translatePage();
    fillSelect($("set-theme") as HTMLSelectElement, [["system", t("themeSystem")], ["light", t("themeLight")], ["dark", t("themeDark")]], s.theme);
    fillSelect($("set-language") as HTMLSelectElement, [["en", "English"], ["th", "ไทย"]], s.language);
    fillSelect(
      $("set-lines") as HTMLSelectElement,
      [...[3, 5, 8, 12].map((n): [string, string] => [String(n), String(n)]), ["0", t("wholeNote")]],
      String(s.previewLines),
    );
    fillSelect(
      $("set-autosave") as HTMLSelectElement,
      [1, 1.5, 3, 5].map((n) => [String(n), t("seconds", { n })]),
      String(s.autosaveSeconds),
    );
    fillSelect(
      $("set-syncdelay") as HTMLSelectElement,
      [
        ...[5, 10, 30].map((n): [string, string] => [String(n), t("after", { n: t("seconds", { n }) })]),
        ["60", t("after", { n: t("oneMinute") })],
        ["0", t("onClose")],
      ],
      String(s.syncDelaySeconds),
    );
    ($("set-images") as HTMLInputElement).checked = s.offlineImages;
  };
  fill();

  const onSelect = (id: string, apply: (value: string) => Partial<Settings>) => {
    const el = $<HTMLSelectElement>(id);
    el.onchange = () => {
      deps.changed(saveSettings(apply(el.value)));
      if (id === "set-language") {
        fill(); // re-label the settings themselves
        showStorage();
      }
    };
  };
  onSelect("set-theme", (v) => ({ theme: v as Settings["theme"] }));
  onSelect("set-language", (v) => ({ language: v as Settings["language"] }));
  onSelect("set-lines", (v) => ({ previewLines: Number(v) }));
  onSelect("set-autosave", (v) => ({ autosaveSeconds: Number(v) }));
  onSelect("set-syncdelay", (v) => ({ syncDelaySeconds: Number(v) }));
  const offline = $<HTMLInputElement>("set-images");
  offline.onchange = () => deps.changed(saveSettings({ offlineImages: offline.checked }));
  $("set-resync").onclick = () => {
    dialog.close();
    deps.fullResync();
  };
  $("set-close").onclick = () => dialog.close();

  const storage = $("set-storage");
  storage.textContent = t("measuring");
  dialog.showModal();
  showStorage();

  async function showStorage() {
    const r = await deps.report();
    const rows: [string, string][] = [
      [t("stNotes"), t("stTextSize", { n: r.notes, size: size(r.textBytes) })],
      [t("stImages"), `${r.images} · ${size(r.imageBytes)}`],
      [t("stUsed"), r.deviceBytes === null ? t("unknown") : size(r.deviceBytes)],
      [t("stLast"), r.lastSynced ? formatDateTime(r.lastSynced) : t("notYet")],
    ];
    storage.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        return [dt, dd];
      }),
    );
  }
}

