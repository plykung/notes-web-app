// The note editor as a component, so the main window's dialog and pop-out
// windows share it. It saves by itself: shortly after typing stops, and when
// closed (flush). Formatting matches the native app (docs/note-html-format.md).
import type { ImageChanges } from "./graph";
import { noteImages, prepareImage, type NewImage, type NoteImage } from "./images";
import { COLORS, colorOf, isPinned, hideSystemTags, noteDates, noteText, renderNoteBody, PIN_TAG, type Note, type NoteColor } from "./note";
import { toNoteHtml, withTagLine } from "./serialize";
import { t, type StringKey } from "./i18n";
import { ICONS } from "./icons";
import { getSettings } from "./settings";
import type { Change } from "./sync";
import { ask, confirmDanger, OK, type GalleryImage } from "./ui";

export type EditorImage = GalleryImage & { added?: NewImage };

export type EditorOptions = {
  note: Note | null;
  /** Unsaved work to restore after a failed save. */
  draft?: { html: string; images: ImageChanges };
  /** Saves a change to the note with this id (null: a new note); resolves with the note's id. */
  save: (id: string | null, change: Change) => Promise<string>;
  onChange?: () => void;
  /** Opens the image viewer; the editor passes its current images and how to change them. */
  showImages: (images: EditorImage[], start: number, edit: ImageEdit) => void;
  /** Deletes the note (the trash button; shown once the note exists). */
  onDelete?: () => void;
  /** Where the toolbar sits: on top in the main window, along the bottom in pop-outs. */
  toolbarAt?: "top" | "bottom";
};

export type ImageEdit = {
  add: (files: File[]) => Promise<EditorImage[]>;
  remove: (img: GalleryImage) => Promise<EditorImage[]>;
};

export type Editor = {
  el: HTMLElement;
  /** Saves anything not saved yet. */
  flush: () => Promise<void>;
  /** The note's id so far (a new note gets one on its first save). */
  id: () => string | null;
  color: () => NoteColor;
  isEmpty: () => boolean;
  focus: () => void;
  /** Re-reads the note's saved images (after another window changed them). */
  reloadImages: (note: Note) => void;
};


const TOOLS: [cmd: string, label: StringKey, html: string][] = [
  ["bold", "bold", "<b>B</b>"],
  ["italic", "italic", "<i>I</i>"],
  ["underline", "underline", "<u>U</u>"],
  ["strikeThrough", "strike", "<s>S</s>"],
  ["insertUnorderedList", "bullets", ""],
];
const BULLETS_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="7" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="17" r="1.3" fill="currentColor"/><path d="M10 7h10M10 12h10M10 17h10"/></svg>';
const SVG = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const IMAGE_ICON = SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="m4 18 5-5 4 4 3-3 4 4"/>');
const PIN_ICON = SVG('<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"/>');
const SAVED_ICON = SVG('<path d="M5 12l4 4 10-10"/>');
const TRASH_ICON = ICONS.trash;

export function createEditor(opts: EditorOptions, doc = document): Editor {
  const { note } = opts;
  let noteId = note?.id ?? null;
  const startText = note ? noteText(note.html) : "";
  let pinned = isPinned(opts.draft ? noteText(opts.draft.html) : startText);
  let color: NoteColor = note ? colorOf(note) : "yellow";
  let images: EditorImage[] = [];
  let removed: string[] = [...(opts.draft?.images.removed ?? [])];

  const el = doc.createElement("div");
  el.className = `editor-wrap toolbar-${opts.toolbarAt ?? "top"}`;
  const toolbar = doc.createElement("div");
  toolbar.className = "toolbar";
  const body = doc.createElement("div");
  body.className = "editor-body";
  body.contentEditable = "true";
  body.setAttribute("role", "textbox");
  body.setAttribute("aria-multiline", "true");
  body.setAttribute("aria-label", t("note"));
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", t("note"));
  const strip = doc.createElement("div");
  strip.className = "editor-images";
  const meta = doc.createElement("p");
  meta.className = "meta";
  meta.textContent = note ? noteDates(note) : t("newNote");
  const fileInput = doc.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.hidden = true;
  // The toolbar's place is set by CSS (.toolbar-top / .toolbar-bottom), not DOM order.
  el.append(toolbar, body, strip, meta, fileInput);

  // Colour Tags and #pinned are hidden while editing; the pin is written back on save.
  const fill = (html: string) => {
    const rendered = renderNoteBody(html);
    hideSystemTags(rendered);
    body.replaceChildren(...[...rendered.childNodes].map((n) => doc.importNode(n, true)));
    if (!body.childNodes.length) body.innerHTML = "<p><br></p>";
  };
  const currentHtml = () => (pinned ? withTagLine(toNoteHtml(body), [PIN_TAG]) : toNoteHtml(body));
  fill(note?.html ?? "");

  // What was last saved, to work out what changed since.
  let savedHtml = note ? currentHtml() : "";
  let savedColor = color;
  if (opts.draft) fill(opts.draft.html);

  const added = () => images.flatMap((i) => (i.added ? [i.added] : []));
  const isEmpty = () => !noteText(toNoteHtml(body)).trim() && images.length === 0;
  const isDirty = () => currentHtml() !== savedHtml || color !== savedColor || removed.length > 0 || added().length > 0;

  // ----- saving -----
  const status = doc.createElement("span");
  status.className = "save-state";
  let timer = 0;
  let saving: Promise<void> = Promise.resolve();

  let shownDirty: boolean | null = null;
  function showState() {
    const dirty = isDirty();
    if (dirty !== shownDirty) {
      status.classList.toggle("dirty", dirty);
      status.innerHTML = dirty ? "" : SAVED_ICON;
      shownDirty = dirty;
    }
    status.title = dirty ? t("savingSoon") : noteId ? t("savedDevice") : "";
    deleteBtn.hidden = !opts.onDelete || !noteId;
  }

  const saveNow = () => {
    saving = saving.then(async () => {
      clearTimeout(timer);
      if (!isDirty() || (!noteId && isEmpty())) return;
      const html = currentHtml();
      const change: Change = {};
      if (html !== savedHtml || !noteId) change.html = html;
      const imageChanges = { removed: [...removed], added: added() };
      if (imageChanges.added.length || imageChanges.removed.length) change.images = imageChanges;
      if (color !== savedColor || (!noteId && color !== "yellow")) change.color = color;
      try {
        noteId = await opts.save(noteId, change);
      } catch (err) {
        await ask(t("notSaved"), (err as Error).message, OK, doc);
        return;
      }
      savedHtml = html;
      savedColor = color;
      removed = [];
      // Saved images now live on the device under their local ids (see sync.ts).
      images = images.map((i) => (i.added ? { id: `local-${i.added.name}`, name: i.name, url: i.url } : i));
      showState();
    });
    return saving;
  };

  const changed = () => {
    showState();
    opts.onChange?.();
    clearTimeout(timer);
    // Typing pauses this long (Settings) before the note is saved to the device.
    timer = window.setTimeout(saveNow, getSettings().autosaveSeconds * 1000);
  };

  // ----- toolbar -----
  const toolButton = (label: string, inner: string, run: () => void) => {
    const btn = doc.createElement("button");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = inner;
    btn.onpointerdown = (e) => e.preventDefault(); // keep the text selection
    btn.onclick = run;
    toolbar.append(btn);
    return btn;
  };
  const formatButtons: [string, HTMLButtonElement][] = [];
  for (const [cmd, label, inner] of TOOLS) {
    const btn = toolButton(t(label), inner || BULLETS_ICON, () => {
      doc.execCommand(cmd);
      changed();
      paintFormats();
    });
    formatButtons.push([cmd, btn]);
  }
  const paintFormats = () => {
    if (!body.contains(doc.getSelection()?.anchorNode ?? null)) return;
    for (const [cmd, btn] of formatButtons) {
      const on = doc.queryCommandState(cmd);
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("on", on);
    }
  };
  doc.addEventListener("selectionchange", paintFormats);
  toolButton(t("addImage"), IMAGE_ICON, () => fileInput.click());
  const pinBtn = toolButton(t("pin"), PIN_ICON, () => {
    pinned = !pinned;
    paintPin();
    changed();
  });
  const paintPin = () => {
    pinBtn.classList.toggle("on", pinned);
    pinBtn.setAttribute("aria-pressed", String(pinned));
    pinBtn.title = pinned ? t("unpin") : t("pin");
    pinBtn.setAttribute("aria-label", pinBtn.title);
  };
  paintPin();

  // Colour: one button showing the current colour; the palette floats out on
  // hover (mouse) or tap (touch), above the button when the toolbar is at the bottom.
  const picker = doc.createElement("span");
  picker.className = "color-picker";
  const colorBtn = doc.createElement("button");
  colorBtn.className = "color-btn";
  colorBtn.title = t("colour");
  colorBtn.setAttribute("aria-label", t("colour"));
  colorBtn.setAttribute("aria-haspopup", "true");
  colorBtn.innerHTML = '<span class="color-dot"></span>';
  const swatches = doc.createElement("div");
  swatches.className = "color-menu";
  swatches.setAttribute("role", "radiogroup");
  swatches.setAttribute("aria-label", t("colour"));
  swatches.hidden = true;
  for (const c of COLORS) {
    const s = doc.createElement("button");
    s.className = `swatch c-${c}`;
    s.title = t(c);
    s.setAttribute("aria-label", t(c));
    s.setAttribute("role", "radio");
    s.onpointerdown = (e) => e.preventDefault();
    s.onclick = () => {
      color = c;
      paintColor();
      setMenu(false);
      changed();
    };
    swatches.append(s);
  }
  picker.append(colorBtn, swatches);
  let hideTimer = 0;
  // Keep the palette inside the window: two rows when one won't fit, and
  // nudged sideways when centring it on the button would cut it off.
  const placeMenu = () => {
    const win = doc.defaultView!;
    const margin = 8;
    swatches.style.setProperty("--shift", "0px");
    swatches.classList.toggle("two-rows", win.innerWidth < 260);
    const r = swatches.getBoundingClientRect();
    let shift = 0;
    if (r.left < margin) shift = margin - r.left;
    else if (r.right > win.innerWidth - margin) shift = win.innerWidth - margin - r.right;
    swatches.style.setProperty("--shift", `${shift}px`);
  };
  const setMenu = (open: boolean) => {
    swatches.hidden = !open;
    colorBtn.setAttribute("aria-expanded", String(open));
  };
  const showMenu = () => {
    clearTimeout(hideTimer);
    setMenu(true);
    placeMenu();
  };
  const hideMenuSoon = () => {
    hideTimer = window.setTimeout(() => setMenu(false), 250);
  };
  swatches.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation(); // close the palette, not the whole editor
    setMenu(false);
    colorBtn.focus();
  });
  doc.addEventListener("pointerdown", (e) => {
    if (!swatches.hidden && !picker.contains(e.target as Node)) setMenu(false);
  });
  picker.onpointerenter = (e) => e.pointerType === "mouse" && showMenu();
  picker.onpointerleave = (e) => e.pointerType === "mouse" && hideMenuSoon();
  colorBtn.onpointerdown = (e) => e.preventDefault();
  colorBtn.onclick = () => (swatches.hidden ? showMenu() : setMenu(false));
  colorBtn.setAttribute("aria-expanded", "false");

  const spacer = doc.createElement("span");
  spacer.className = "spacer";
  const deleteBtn = doc.createElement("button");
  deleteBtn.className = "danger";
  deleteBtn.title = t("deleteNote");
  deleteBtn.setAttribute("aria-label", t("deleteNote"));
  deleteBtn.innerHTML = TRASH_ICON;
  deleteBtn.onclick = () => opts.onDelete?.();
  toolbar.append(picker, spacer, status, deleteBtn);

  function paintColor() {
    for (const c of COLORS) el.classList.toggle(`c-${c}`, c === color);
    swatches.querySelectorAll("button").forEach((s, i) => s.setAttribute("aria-checked", String(COLORS[i] === color)));
  }
  paintColor();
  body.oninput = changed;

  // ----- images -----
  const edit: ImageEdit = {
    async add(files) {
      for (const file of files) {
        try {
          const img = await prepareImage(file);
          images.push({ id: `new-${img.name}`, name: img.name, url: URL.createObjectURL(img.blob), added: img });
        } catch (err) {
          await ask(t("imageCantAdd"), (err as Error).message, OK, doc);
        }
      }
      renderStrip();
      changed();
      return images;
    },
    async remove(img) {
      images = images.filter((i) => i.id !== img.id);
      if (!img.id.startsWith("new-")) removed.push(img.id);
      renderStrip();
      changed();
      return images;
    },
  };

  function renderStrip() {
    strip.hidden = images.length === 0;
    strip.replaceChildren(
      ...images.map((img, i) => {
        const tile = doc.createElement("span");
        tile.className = "tile";
        const pic = doc.createElement("img");
        pic.src = img.url;
        pic.alt = img.name;
        pic.onclick = () => opts.showImages(images, i, edit);
        const x = doc.createElement("button");
        x.className = "remove";
        x.textContent = "✕";
        x.setAttribute("aria-label", t("removeImage"));
        // The image viewer asks before deleting; the quick ✕ asks the same way.
        x.onclick = async () => {
          if (await confirmDanger("deleteImageTitle", "deleteImageBody", doc)) edit.remove(img);
        };
        tile.append(pic, x);
        return tile;
      }),
    );
  }

  const loadSaved = (n: Note) => {
    if (!n.hasAttachments) return;
    noteImages(n.id)
      .then((saved: NoteImage[]) => {
        const kept = saved.filter((s) => !removed.includes(s.id)).map(({ id, name, url }) => ({ id, name, url }));
        images = [...kept, ...images.filter((i) => i.added)];
        renderStrip();
      })
      .catch((err) => ask(t("imagesCouldntLoad"), (err as Error).message, OK, doc));
  };

  for (const a of opts.draft?.images.added ?? []) {
    images.push({ id: `new-${a.name}`, name: a.name, url: URL.createObjectURL(a.blob), added: a });
  }
  renderStrip();
  if (note) loadSaved(note);
  showState();
  if (opts.draft) changed(); // restored work saves itself again

  fileInput.onchange = async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    await edit.add(files);
  };

  return {
    el,
    flush: saveNow,
    id: () => noteId,
    color: () => color,
    isEmpty,
    focus: () => body.focus(),
    reloadImages: (n) => {
      if (removed.length || added().length) return; // don't throw away unsaved image changes
      images = [];
      loadSaved(n);
    },
  };
}
