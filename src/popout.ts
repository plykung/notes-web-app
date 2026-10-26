// Pop-out note windows, like Sticky Notes on the desktop. The main window builds
// and drives each one (they share its notes and sync queue), so a pop-out
// closes when the main window does.
import { confirmDelete } from "./dialogs";
import { createEditor, type Editor, type EditorImage, type ImageEdit } from "./editor";
import { colorOf, type Note, type NoteColor } from "./note";
import { firstLine } from "./serialize";
import type { Change } from "./sync";
import { t } from "./i18n";
import { applyTheme, getSettings } from "./settings";
import { openGallery, toast } from "./ui";

export type PopOutActions = {
  save: (id: string | null, change: Change) => Promise<string>;
  /** The note as it is now (following any new ids it got from syncing). */
  current: (id: string) => Note | undefined;
  /** A pop-out closed: send what it saved to Microsoft now. */
  closed: () => void;
  /** Deletes the note with this id. */
  remove: (id: string) => void;
};

type Handle = { win: Window; editor: () => Editor; refresh: () => void };
const open = new Map<string, Handle>();

// The title bar takes the note's colour where the browser supports it
// (installed app windows); these match --<colour> in style.css.
const BAR_COLORS: Record<NoteColor, string> = {
  yellow: "#e6b905",
  green: "#6fd262",
  pink: "#ea86c2",
  purple: "#c78eff",
  blue: "#5ac0e7",
  gray: "#aaaaaa",
  charcoal: "#454545",
};

/** Copies the app's styles so a new window looks the same. */
function copyStyles(into: Document) {
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    into.head.append(node.cloneNode(true));
  }
}

function prepareWindow(win: Window, title: string, color: NoteColor) {
  const doc = win.document;
  doc.documentElement.lang = getSettings().language;
  doc.head.replaceChildren();
  doc.title = title;
  const viewport = doc.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  const theme = doc.createElement("meta");
  theme.name = "theme-color";
  theme.content = BAR_COLORS[color];
  doc.head.append(viewport, theme);
  copyStyles(doc);
  applyTheme(doc); // the same light or dark choice as the main window
  doc.body.className = "popout-body";
}

function setWindowColor(win: Window, color: NoteColor) {
  win.document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", BAR_COLORS[color]);
}

const titleOf = (note: Note | null | undefined) => (note && firstLine(note.html)) || t(note ? "appName" : "newNote");

/** True where separate windows make sense (a mouse, not a phone). */
export const canPopOut = () => matchMedia("(pointer: fine)").matches;

/** Opens a note (or a blank new note) in its own small window. */
export function popOut(note: Note | null, actions: PopOutActions) {
  const key = note?.id ?? `new-${Date.now()}`;
  const existing = open.get(key);
  if (existing && !existing.win.closed) return existing.win.focus();

  const opened = window.open("", `note-${key}`, "popup,width=380,height=520");
  if (!opened) {
    toast("attention", t("popupBlocked"));
    return;
  }
  const win: Window = opened;
  prepareWindow(win, titleOf(note), note ? colorOf(note) : "yellow");
  const doc = win.document;
  doc.body.replaceChildren();

  // The note fills the whole window; its toolbar runs along the bottom.
  const root = doc.createElement("div");
  root.className = "popout";
  doc.body.append(root);

  let editor: Editor;
  let deleted = false;
  const mount = (n: Note | null) => {
    editor?.el.remove();
    editor = createEditor(
      {
        note: n,
        save: async (id, change) => {
          const saved = await actions.save(id, change);
          const now = actions.current(saved);
          win.document.title = titleOf(now);
          if (change.color) setWindowColor(win, change.color);
          return saved;
        },
        showImages: (imgs, start, edit) => showImagesWindow(imgs, start, edit, editor),
        toolbarAt: "bottom",
        onDelete: async () => {
          if (!(await confirmDelete(doc))) return;
          await editor.flush();
          const id = editor.id();
          deleted = true;
          win.close();
          if (id) actions.remove(id);
        },
      },
      doc,
    );
    root.append(editor.el);
  };

  const handle: Handle = {
    win,
    editor: () => editor,
    refresh: () => {
      const id = editor.id();
      const current = id ? actions.current(id) : undefined;
      if (current) editor.reloadImages(current);
    },
  };
  open.set(key, handle);

  doc.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      editor.flush();
    }
  });
  // Closing saves what's left, like Sticky Notes. The main window keeps running,
  // so the save finishes even though this window is gone.
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") editor.flush();
  });
  win.addEventListener("pagehide", () => {
    open.delete(key);
    if (!deleted) editor.flush().then(actions.closed);
  });

  mount(note);
  editor!.focus();
}

/** Notes changed (synced or edited elsewhere): windows pick up new images. */
export function refreshPopOuts() {
  for (const h of open.values()) if (!h.win.closed) h.refresh();
}

export function closePopOuts() {
  for (const h of open.values()) h.win.close();
}

/** Shows images in their own window, titled and coloured like the note, with the thumbnail strip and add / delete. */
function showImagesWindow(images: EditorImage[], start: number, edit: ImageEdit, editor: Editor) {
  const id = editor.id();
  const win = window.open("", `images-${id ?? "new"}`, "popup,width=960,height=720");
  if (!win) {
    toast("attention", t("popupBlocked"));
    return;
  }
  const title = editor.el.ownerDocument.title || t("appName");
  prepareWindow(win, `${title} · ${t("images")}`, editor.color());
  win.document.body.replaceChildren();
  openGallery({ images, start, onAdd: edit.add, onRemove: edit.remove, onClose: () => win.close() }, win.document);
}
