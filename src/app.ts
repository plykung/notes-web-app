// Notes Web App: offline-first list, search and Tags, with edits queued on the
// device and synced to Microsoft Sticky Notes (docs/adr/0001, 0003, 0004).
import "./style.css";
import { noteHtmlFor, parseActionLink, savePending, sharedNoteHtml, takePending, type Action } from "./actions";
import { initAuth, signIn, signInAgain, signOut } from "./auth";
import { chooseConflictVersion, flushOpenEditor, openEditor, openSettings } from "./dialogs";
import { deleteShare, readShare } from "./share";
import { DuplicateError, NO_IMAGE_CHANGES, listDeletedNotes, removeOldVersion, restoreNote } from "./graph";
import { imageStats, noteImages, prepareImage, renderThumbs, whenVisible } from "./images";
import {
  COLORS,
  DEFAULT_COLOR,
  PIN_TAG,
  colorOf,
  extractTags,
  hideSystemTags,
  isPinned,
  matchesFilter,
  noteText,
  renderNoteBody,
  type Note,
} from "./note";
import { canPopOut, closePopOuts, popOut, refreshPopOuts } from "./popout";
import { BLANK_LINE, NOTE_HEAD, NOTE_TAIL, toNoteHtml, withTagLine } from "./serialize";
import { changes, formatDateTime, t, translatePage } from "./i18n";
import { applyTheme, getSettings, saveSettings } from "./settings";
import { clearAll, getItem, setItem } from "./store";
import {
  deviceNotes,
  initSync,
  lastSynced,
  localNotes,
  noteState,
  queueCreate,
  queueDelete,
  queueEdit,
  status,
  sync,
  undoDelete,
  type Change,
  type Op,
  type SyncProgress,
} from "./sync";
import { ask, OK, openGallery, toast, type GalleryImage } from "./ui";
import { ICONS, iconEl } from "./icons";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const searchEl = $<HTMLInputElement>("search");
const activeTagsEl = $("active-tags");
const tagPanel = $("tag-panel");
const notesEl = $("notes");
const countEl = $("count");
const errorEl = $("error");
const syncBtn = $("sync-status");
const syncPop = $("sync-pop");
const progressEl = $("progress");
const progressFill = $("progress-fill");
const menuEl = $("menu");
const viewbarEl = $("viewbar");

// ---------- State ----------

let deletedNotes: Note[] = [];
let deletedError: string | null = null;
let view: "notes" | "deleted" = "notes";
const selectedTags = new Map<string, string>(); // lower-case key → label
let lastRefresh = 0;

window.addEventListener("beforeunload", (e) => {
  // Queued changes are safe on the device; only one being sent right now could be cut off.
  if (status().syncing) e.preventDefault();
});
window.addEventListener("pagehide", closePopOuts);

// ---------- Rendering ----------

// Colour and pin are shown as colour and a pin icon, so they aren't listed as Tags.
const SYSTEM_TAGS = new Set<string>([...COLORS, PIN_TAG]);
const COLOR_KEY = "color:";

/** Tags to filter by, plus one entry per note colour in use ("color:pink"). */
function allTags(list: Note[]): { key: string; label: string; count: number }[] {
  const counts = new Map<string, { key: string; label: string; count: number }>();
  const bump = (key: string, label: string) => {
    const entry = counts.get(key) ?? { key, label, count: 0 };
    entry.count++;
    counts.set(key, entry);
  };
  for (const note of list) {
    const color = colorOf(note);
    if (color !== DEFAULT_COLOR) bump(COLOR_KEY + color, color);
    for (const tag of extractTags(noteText(note.html))) {
      if (!SYSTEM_TAGS.has(tag.toLowerCase())) bump(tag.toLowerCase(), `#${tag}`);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function chip(label: string, onClick: () => void, extra = "", count?: number): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = `chip ${extra}`;
  el.title = label;
  const text = Object.assign(document.createElement("span"), { className: "label", textContent: label });
  el.append(text);
  if (count !== undefined) el.append(Object.assign(document.createElement("span"), { className: "n", textContent: String(count) }));
  el.onpointerdown = (e) => e.preventDefault(); // keep focus in the search box
  el.onclick = onClick;
  return el;
}

// Typing "#ca" in the search box narrows the tag list to tags containing "ca".
const tagQuery = () => searchEl.value.trim().replace(/^#/, "").toLowerCase();
// A search that is only "#something" picks tags; it doesn't filter the text.
const textQuery = () => (searchEl.value.trim().startsWith("#") ? "" : searchEl.value.trim());
/** Newest first; render() puts pinned notes in their own section. */
const currentList = () => (view === "deleted" ? deletedNotes : localNotes());
const chipClass = (key: string) => (key.startsWith(COLOR_KEY) ? `dot c-${key.slice(COLOR_KEY.length)}` : "");

function renderActiveTags() {
  activeTagsEl.replaceChildren(
    ...[...selectedTags].map(([key, label]) =>
      chip(`${label} ✕`, () => {
        selectedTags.delete(key);
        render();
      }, `active ${chipClass(key)}`),
    ),
  );
}

function renderTagPanel() {
  const query = tagQuery();
  const tags = allTags(currentList()).filter((t) => !selectedTags.has(t.key) && (!query || t.label.toLowerCase().includes(query)));
  tagPanel.replaceChildren(
    ...(tags.length
      ? tags.map((t) =>
          chip(t.label, () => {
            selectedTags.set(t.key, t.label);
            if (searchEl.value.trim().startsWith("#")) searchEl.value = "";
            render();
          }, chipClass(t.key), t.count),
        )
      : [Object.assign(document.createElement("p"), { className: "empty", textContent: t("noTags") })]),
  );
}

/** A test for the current search: its text, every selected Tag, and one of the selected colours. */
function makeMatcher(): (note: Note) => boolean {
  const keys = [...selectedTags.keys()];
  const colors = keys.filter((k) => k.startsWith(COLOR_KEY)).map((k) => k.slice(COLOR_KEY.length));
  const tags = keys.filter((k) => !k.startsWith(COLOR_KEY));
  const text = textQuery();
  return (note) => (!colors.length || colors.includes(colorOf(note))) && matchesFilter(note, text, tags);
}

const POP_OUT_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CHEVRON_ICON =
  '<svg class="chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

const PIN_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"/></svg>';

/**
 * Pins or unpins from the list. #pinned is part of the text (the PC app shows
 * it), so this replaces the note like any text edit.
 */
async function togglePin(note: Note) {
  const pin = !isPinned(noteText(note.html));
  const body = renderNoteBody(note.html);
  hideSystemTags(body);
  const html = toNoteHtml(body);
  // A colour still written as a Tag would be lost from the text: keep it in the hidden field.
  const color = note.color ? undefined : colorOf(note);
  await queueEdit(note, {
    html: pin ? withTagLine(html, [PIN_TAG]) : html,
    ...(color && color !== DEFAULT_COLOR ? { color } : {}),
  });
  toast("pinned", pin ? t("pinnedToast") : t("unpinnedToast"));
}

function noteCard(note: Note): HTMLElement {
  const card = document.createElement("article");
  card.className = `note c-${colorOf(note)}`;
  const body = renderNoteBody(note.html);
  hideSystemTags(body);
  body.className = "preview";
  if (!body.textContent?.replaceAll("\u200b", "").trim() && !note.hasAttachments) {
    body.append(Object.assign(document.createElement("p"), { className: "empty-note", textContent: t("emptyNote") }));
  }
  card.append(body);
  const pinned = isPinned(noteText(note.html));
  if (pinned) card.classList.add("pinned");

  if (note.hasAttachments) {
    const thumbs = document.createElement("div");
    // Sized placeholder: a zero-height box may never count as visible, so loading wouldn't start.
    thumbs.className = "thumbs waiting";
    card.append(thumbs);
    whenVisible(thumbs, () => renderThumbs(note.id, thumbs, (img) => showNoteImages(note, img.id)));
  }

  const footer = document.createElement("footer");
  card.append(footer);

  if (view === "deleted") {
    footer.append(chip(t("restore"), () => restore(note), "restore"));
    return card;
  }
  const state = noteState(note.id);
  if (state === "syncing") footer.append(iconEl("sync", t("saving"), "spin"));
  if (state === "queued") footer.append(iconEl("cloud", t("notSynced"), "pulse"));
  if (state === "syncing") {
    card.classList.add("pending");
    return card;
  }
  // Queued notes stay editable; only one being sent right now waits.
  card.tabIndex = 0;
  card.onclick = () => editNote(note);
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", note.title || t("note"));
  card.onkeydown = (e) => {
    if (e.target !== card || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    editNote(note);
  };
  const tool = (label: string, icon: string, run: () => void, extra = "") => {
    const btn = document.createElement("button");
    btn.className = `card-tool ${extra}`;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = icon;
    btn.onclick = (e) => {
      e.stopPropagation();
      run();
    };
    footer.append(btn);
  };
  footer.append(Object.assign(document.createElement("span"), { className: "spacer" }));
  tool(pinned ? t("unpin") : t("pin"), PIN_ICON, () => togglePin(note), pinned ? "on" : "");
  if (canPopOut()) tool(t("popOut"), POP_OUT_ICON, () => popOut(note, popOutActions));
  return card;
}

type SyncState = "ok" | "syncing" | "waiting" | "offline" | "error";
const SYNC_ICONS: Record<SyncState, keyof typeof ICONS> = {
  ok: "cloudCheck",
  syncing: "sync",
  waiting: "cloud",
  offline: "cloudOff",
  error: "cloudAlert",
};

/** The sync icon at the top left; its pop-over says what it means. */
function renderStatus() {
  const { offline, needsSignIn, waiting, syncing, loadError } = status();
  let state: SyncState = "ok";
  let text = t("stSynced");
  if (needsSignIn) [state, text] = ["error", t("signInAgain")];
  else if (view === "deleted" && deletedError) [state, text] = ["error", deletedError];
  else if (offline) [state, text] = ["offline", waiting ? t("stOfflineWaiting", { changes: changes(waiting) }) : t("stOffline")];
  else if (loadError) [state, text] = ["error", t("stError", { error: loadError })];
  else if (syncing) [state, text] = ["syncing", t("stSyncing", { changes: changes(Math.max(waiting, 1)) })];
  else if (waiting) [state, text] = ["waiting", t("stWaiting", { changes: changes(waiting) })];

  syncBtn.className = `sync-status ${state}`;
  syncBtn.innerHTML = ICONS[SYNC_ICONS[state]] + (waiting && state !== "syncing" ? `<span class="badge">${waiting > 99 ? t("manyMore") : waiting}</span>` : "");
  syncBtn.title = text;
  syncBtn.setAttribute("aria-label", text);
  $("sync-pop-text").textContent = text;
  $("sync-pop-now").hidden = offline && !needsSignIn;
  $("sync-pop-now").textContent = needsSignIn ? t("signInShort") : t("syncNow");
  if (!syncPop.hidden) showLastSynced();

  // Ask once each time the login expires, rather than leaving the page by itself.
  if (needsSignIn && !askedToSignIn) {
    askedToSignIn = true;
    toast("attention", t("signInAgain"), { label: t("signInShort"), run: signInAgainNow });
  }
  if (!needsSignIn) askedToSignIn = false;
}

let askedToSignIn = false;

/** Saves what's open, then goes to Microsoft to renew the login. Nothing typed is lost. */
async function signInAgainNow() {
  await flushOpenEditor();
  closePopOuts(); // each saves itself as it closes
  await new Promise((resolve) => setTimeout(resolve, 300)); // let those saves reach the device
  await signInAgain();
}

async function showLastSynced() {
  const at = await lastSynced();
  $("sync-pop-time").textContent = at ? t("lastSynced", { time: formatDateTime(at) }) : t("neverSynced");
}

/** Opens or closes a pop-over and keeps its button's aria-expanded in step. */
function setPopover(button: HTMLElement, panel: HTMLElement, open: boolean) {
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

// Escape closes an open menu or pop-over and returns focus to its button.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const [button, panel] of [[$("menu-btn"), menuEl], [syncBtn, syncPop]] as const) {
    if (!panel.hidden) {
      setPopover(button, panel, false);
      button.focus();
    }
  }
});

function setUpSyncStatus() {
  syncBtn.onclick = (e) => {
    e.stopPropagation();
    setPopover(syncBtn, syncPop, Boolean(syncPop.hidden));
    if (!syncPop.hidden) showLastSynced();
  };
  document.addEventListener("click", (e) => {
    if (!syncPop.contains(e.target as Node)) setPopover(syncBtn, syncPop, false);
  });
  $("sync-pop-now").onclick = () => {
    syncPop.hidden = true;
    if (status().needsSignIn) signInAgainNow();
    else refresh({ manual: true });
  };
}

// The list is drawn in batches as you scroll, so a long list appears at once.
// Pinned notes get their own section above, drawn in full (there are few).
const BATCH = 60;
let visibleNotes: Note[] = [];
let otherNotes: Note[] = [];
let drawn = 0;
const more = document.createElement("div");
more.className = "more-sentinel";
const moreObserver = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) drawMore();
}, { rootMargin: "600px" });
moreObserver.observe(more);

function drawMore() {
  const batch = otherNotes.slice(drawn, drawn + BATCH);
  drawn += batch.length;
  more.before(...batch.map(noteCard));
  more.hidden = drawn >= otherNotes.length;
}

function sectionHeading(text: string): HTMLElement {
  return Object.assign(document.createElement("h2"), { className: "section-heading", textContent: text });
}

function applySettings() {
  applyTheme();
  const { previewLines } = getSettings();
  notesEl.style.setProperty("--lines", previewLines ? String(previewLines) : "9999");
  notesEl.classList.toggle("full", !previewLines);
}

function render() {
  const list = currentList();
  visibleNotes = list.filter(makeMatcher());
  const filtering = textQuery() !== "" || selectedTags.size > 0;
  countEl.hidden = !filtering;
  countEl.textContent = t("countOf", { n: visibleNotes.length, total: list.length });
  viewbarEl.hidden = view !== "deleted";
  $("new").hidden = view === "deleted";
  renderActiveTags();
  if (!tagPanel.hidden) renderTagPanel();
  $("clear-search").hidden = !searchEl.value && selectedTags.size === 0;
  renderStatus();

  const pinned: Note[] = [];
  otherNotes = [];
  for (const n of visibleNotes) (view !== "deleted" && isPinned(noteText(n.html)) ? pinned : otherNotes).push(n);
  const grid = document.createElement("div");
  grid.className = "note-grid";
  grid.append(more);
  notesEl.replaceChildren();
  if (pinned.length) {
    const collapsed = getSettings().pinnedCollapsed;
    const section = document.createElement("section");
    section.className = `pinned-section${collapsed ? " collapsed" : ""}`;
    const head = document.createElement("button");
    head.className = "section-heading section-toggle";
    head.setAttribute("aria-expanded", String(!collapsed));
    head.title = collapsed ? t("expand") : t("collapse");
    head.innerHTML = CHEVRON_ICON + PIN_ICON;
    head.append(`${t("pinned")} · ${pinned.length}`);
    head.onclick = () => {
      saveSettings({ pinnedCollapsed: !collapsed });
      section.classList.toggle("collapsed", !collapsed);
      head.setAttribute("aria-expanded", String(collapsed));
      setTimeout(render, 200); // after the chevron's turn
    };
    section.append(head);
    if (!collapsed) {
      const pinnedGrid = document.createElement("div");
      pinnedGrid.className = "note-grid";
      pinnedGrid.append(...pinned.map(noteCard));
      section.append(pinnedGrid);
    }
    notesEl.append(section);
    if (otherNotes.length) notesEl.append(sectionHeading(t("others")));
  }
  notesEl.append(grid);

  // Keep as many cards as were already drawn, so a refresh doesn't jump the scroll position.
  const keep = Math.max(drawn, BATCH);
  drawn = 0;
  while (drawn < Math.min(keep, otherNotes.length)) drawMore();
  more.hidden = drawn >= otherNotes.length;
  if (!visibleNotes.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = view === "deleted" ? t("emptyDeleted") : filtering ? t("noMatch") : t("noNotes");
    notesEl.prepend(empty);
  }
  refreshPopOuts();
}

// ---------- Progress ----------

let progressDone = 0;
function showProgress(p: SyncProgress | null) {
  clearTimeout(progressDone);
  if (!p) {
    if (progressEl.hidden) return;
    progressEl.classList.remove("indeterminate");
    progressFill.style.width = "100%";
    progressEl.classList.add("finishing");
    progressDone = window.setTimeout(() => {
      progressEl.hidden = true;
      progressEl.classList.remove("finishing");
    }, 450);
    return;
  }
  progressEl.classList.remove("finishing");
  progressEl.hidden = false;
  const known = p.total > 0;
  progressEl.classList.toggle("indeterminate", !known);
  progressFill.style.width = known ? `${Math.max(4, (p.done / p.total) * 100)}%` : "";
  progressEl.title = known ? `${p.label}: ${p.done} of ${p.total}` : p.label;
}

// ---------- Loading ----------

const fingerprint = () => new Map(deviceNotes().map((n) => [n.id, n.modified]));

/** Syncs and reports what happened. `manual` is a refresh the user asked for. */
async function refresh(opts: { manual?: boolean; full?: boolean } = {}) {
  lastRefresh = Date.now();
  if (view === "deleted") {
    showProgress({ label: t("refresh"), done: 0, total: 0 });
    try {
      deletedNotes = await listDeletedNotes();
      deletedError = null;
    } catch (err) {
      deletedError = t("deletedNeedsConnection", { error: (err as Error).message });
    }
    showProgress(null);
    render();
    return;
  }
  if (opts.manual) showProgress({ label: t("refresh"), done: 0, total: 0 }); // feedback right away
  const before = fingerprint();
  const sentBefore = status().waiting;
  await sync({ full: opts.full });
  const after = fingerprint();
  const { offline, waiting, loadError } = status();
  const sent = Math.max(0, sentBefore - waiting);
  let changed = 0;
  for (const [id, modified] of after) if (before.get(id) !== modified) changed++;
  for (const id of before.keys()) if (!after.has(id)) changed++;
  const fromElsewhere = Math.max(0, changed - sent * 2); // each of our saves replaces one note with another

  if (offline) {
    if (opts.manual) toast("offline", t("stOffline"));
  } else if (!loadError) {
    const parts = [];
    if (sent) parts.push(t("syncedToast", { changes: changes(sent) }));
    if (fromElsewhere) parts.push(t("updatedElsewhere", { n: fromElsewhere }));
    if (parts.length) toast(sent ? "success" : "updated", parts.join(" · "));
    else if (opts.manual) toast("success", t("upToDate"));
  }
}

// ---------- Changes ----------

/** A queued change was refused by Microsoft (not just offline): explain, let the user decide. */
async function explainFailure(op: Op, err: unknown) {
  if (err instanceof DuplicateError) {
    const choice = await ask(t("dupTitle"), err.message, [
      { label: t("leaveBoth"), value: "leave" },
      { label: t("removeOldCopy"), value: "remove", style: "primary" },
    ]);
    if (choice === "remove") {
      await removeOldVersion(err.oldId).catch((e) => ask(t("oldCopyStill"), (e as Error).message, OK));
    }
    return;
  }
  if (op.kind === "delete") {
    await ask(t("notDeleted"), (err as Error).message, OK);
    return;
  }
  if (op.kind === "color") {
    await ask(t("colorNotSaved"), (err as Error).message, OK);
    return;
  }
  const choice = await ask(t("notSaved"), (err as Error).message, [
    { label: t("discard"), value: "discard", style: "danger" },
    { label: t("editAgain"), value: "edit", style: "primary" },
  ]);
  if (choice !== "edit") return;
  const original = op.kind === "edit" ? localNotes().find((n) => n.id === op.base.id) ?? op.base : null;
  openEditor(original, editorActions(original), { html: op.html, images: op.images });
}

async function removeNote(note: Note) {
  const opId = await queueDelete(note);
  toast("deleted", t("noteDeleted"), {
    label: t("undo"),
    run: async () => {
      const movedTo = await undoDelete(opId);
      if (movedTo) await restore({ ...note, id: movedTo });
    },
  });
}

async function restore(note: Note) {
  deletedNotes = deletedNotes.filter((n) => n.id !== note.id);
  render();
  try {
    await restoreNote(note.id);
    toast("success", t("noteRestored"));
  } catch (err) {
    await ask(t("notRestored"), (err as Error).message, OK);
  }
  await refresh();
}

// A note gets a new id each time a change syncs (replace-on-save). An open
// editor keeps the id it started with; this follows it to the current one.
const renamedTo = new Map<string, string>();
const resolveId = (id: string) => {
  for (let next = renamedTo.get(id); next; next = renamedTo.get(id)) id = next;
  return id;
};
const currentNote = (id: string) => localNotes().find((n) => n.id === resolveId(id));

const EMPTY_NOTE = NOTE_HEAD + BLANK_LINE + NOTE_TAIL;

/**
 * Saves a change from an editor. It goes on the device straight away and to
 * Microsoft once typing has been quiet for a while, or when the editor closes.
 */
async function saveChange(id: string | null, change: Change): Promise<string> {
  if (!id) return queueCreate(change.html ?? EMPTY_NOTE, change.images ?? NO_IMAGE_CHANGES, change.color, { later: true });
  const note = currentNote(id);
  if (!note) throw new Error(t("noteGone"));
  await queueEdit(note, change, { later: true });
  return note.id;
}

const removeById = (id: string) => {
  const note = currentNote(id);
  if (note) removeNote(note);
};

const popOutActions = {
  save: saveChange,
  current: currentNote,
  closed: () => void sync(),
  remove: removeById,
};

const editorActions = (note: Note | null) => ({
  save: saveChange,
  remove: removeById,
  popOut: canPopOut()
    ? (id: string | null) => popOut(id ? currentNote(id) ?? note : note, popOutActions)
    : undefined,
  closed: () => void sync(),
});

function editNote(note: Note) {
  openEditor(note, editorActions(note));
}

/** Image viewer from a card: adding or deleting images is queued straight away. */
async function showNoteImages(note: Note, startId: string) {
  const current = () => currentNote(note.id) ?? note;
  const list = async (): Promise<GalleryImage[]> =>
    (await noteImages(current().id)).map(({ id, name, url }) => ({ id, name, url }));
  const images = await list();
  openGallery({
    images,
    start: Math.max(0, images.findIndex((i) => i.id === startId)),
    onAdd: async (files) => {
      const added = [];
      for (const file of files) {
        try {
          added.push(await prepareImage(file));
        } catch (err) {
          await ask(t("imageCantAdd"), (err as Error).message, OK);
        }
      }
      if (added.length) await queueEdit(current(), { images: { removed: [], added } });
      return list();
    },
    onRemove: async (img) => {
      await queueEdit(current(), { images: { removed: [img.id], added: [] } });
      return list();
    },
  });
}

// ---------- Views, search, menu, settings, install ----------

function showView(next: typeof view) {
  view = next;
  selectedTags.clear();
  searchEl.value = "";
  menuEl.hidden = true;
  deletedNotes = [];
  deletedError = null;
  render();
  refresh();
}

function setUpSearch() {
  searchEl.onfocus = () => {
    tagPanel.hidden = false;
    searchEl.setAttribute("aria-expanded", "true");
    renderTagPanel();
  };
  const closeTags = (e: FocusEvent) => {
    if (tagPanel.contains(e.relatedTarget as Node) || e.relatedTarget === searchEl) return;
    tagPanel.hidden = true;
    searchEl.setAttribute("aria-expanded", "false");
  };
  searchEl.onblur = closeTags;
  tagPanel.addEventListener("focusout", closeTags);
  searchEl.oninput = () => render();
  searchEl.onkeydown = (e) => {
    if (e.key === "Backspace" && !searchEl.value && selectedTags.size) {
      selectedTags.delete([...selectedTags.keys()].pop()!);
      render();
    }
    if (e.key === "Escape") searchEl.blur();
  };
  $("clear-search").onpointerdown = (e) => e.preventDefault();
  $("clear-search").onclick = () => {
    searchEl.value = "";
    selectedTags.clear();
    render();
  };
}

async function storageReport() {
  const notes = deviceNotes();
  const textBytes = notes.reduce((sum, n) => sum + new Blob([n.html]).size, 0);
  const images = await imageStats();
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  return {
    notes: notes.length,
    textBytes,
    images: images.count,
    imageBytes: images.bytes,
    deviceBytes: estimate?.usage ?? null,
    lastSynced: (await lastSynced()) ?? null,
  };
}

type InstallPrompt = Event & { prompt: () => Promise<void> };
let installPrompt: InstallPrompt | null = null;
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

function setUpInstall() {
  const item = $("menu-install");
  item.hidden = isInstalled() || !isIos;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // offer it from the menu instead of the browser's banner
    installPrompt = e as InstallPrompt;
    item.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    item.hidden = true;
    toast("success", t("installed"));
  });
  item.onclick = async () => {
    menuEl.hidden = true;
    if (installPrompt) {
      await installPrompt.prompt();
      installPrompt = null;
      return;
    }
    await ask(t("installIosTitle"), t("installIosBody"), OK);
  };
}

function setUpMenu(username: string, initial: string) {
  const menuIcons: [string, keyof typeof ICONS][] = [
    ["menu-refresh", "refresh"],
    ["menu-deleted", "deleted"],
    ["menu-settings", "settings"],
    ["menu-install", "install"],
    ["menu-signout", "signOut"],
  ];
  for (const [id, name] of menuIcons) $(id).insertAdjacentHTML("afterbegin", ICONS[name]);
  $("retry").innerHTML = ICONS.refresh;
  const btn = $("menu-btn");
  btn.textContent = initial;
  $("account").textContent = username;
  $("account").title = username;
  btn.onclick = (e) => {
    e.stopPropagation();
    setPopover(btn, menuEl, Boolean(menuEl.hidden));
    if (!menuEl.hidden) menuEl.querySelector<HTMLElement>("button:not([hidden])")?.focus();
  };
  document.addEventListener("click", (e) => {
    if (!menuEl.contains(e.target as Node)) setPopover(btn, menuEl, false);
  });
  $("menu-refresh").onclick = () => {
    menuEl.hidden = true;
    refresh({ manual: true });
  };
  $("menu-deleted").onclick = () => showView("deleted");
  $("menu-settings").onclick = () => {
    menuEl.hidden = true;
    openSettings({
      report: storageReport,
      changed: () => {
        applySettings();
        translatePage();
        render();
      },
      fullResync: () => refresh({ manual: true, full: true }),
    });
  };
  $("menu-signout").onclick = async () => {
    menuEl.hidden = true;
    const { waiting } = status();
    const sure = await ask(t("signOutTitle"), waiting ? t("signOutWaiting", { n: waiting }) : t("signOutBody"), [
      { label: t("cancel"), value: false },
      { label: t("signOut"), value: true, style: "danger" },
    ]);
    if (!sure) return;
    closePopOuts();
    await clearAll(); // notes are personal: leave nothing behind
    signOut();
  };
  $("viewbar-back").onclick = () => showView("notes");
}

// Pull down at the top of the list to refresh (touch screens). The indicator
// follows the finger with rubber-band resistance and springs back on release.
function setUpPullToRefresh() {
  const ptr = $("ptr");
  const THRESHOLD = 80;
  const rubberBand = (x: number, limit = 300, c = 0.55) => (x * limit * c) / (limit + c * x);
  let startY: number | null = null;
  let startX = 0;
  let distance = 0;
  const reset = () => {
    startY = null;
    ptr.classList.remove("dragging", "ready", "spinning");
    ptr.classList.add("settle");
    ptr.style.setProperty("--pull", "0px");
    ptr.style.setProperty("--pull-turn", "0deg");
    setTimeout(() => {
      ptr.hidden = true;
      ptr.classList.remove("settle");
    }, 300);
  };
  window.addEventListener("touchstart", (e) => {
    const inPanel = (e.target as Element).closest?.(".menu, .tag-panel, .sync-pop, dialog");
    const ok = window.scrollY <= 0 && e.touches.length === 1 && !inPanel && !document.querySelector("dialog[open]");
    startY = ok ? e.touches[0].clientY : null;
    startX = e.touches[0].clientX;
    distance = 0;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    distance = Math.max(0, e.touches[0].clientY - startY);
    // Ignore small or mostly sideways moves, so scrolling never triggers it.
    if (distance < 8 || Math.abs(e.touches[0].clientX - startX) > distance) return;
    ptr.hidden = false;
    ptr.classList.add("dragging");
    const pull = rubberBand(distance);
    ptr.style.setProperty("--pull", `${pull}px`);
    ptr.style.setProperty("--pull-turn", `${pull * 2}deg`);
    ptr.classList.toggle("ready", distance > THRESHOLD);
  }, { passive: true });
  window.addEventListener("touchend", async () => {
    if (startY === null) return;
    startY = null;
    if (distance <= THRESHOLD) return reset();
    ptr.classList.remove("dragging");
    ptr.classList.add("spinning");
    try {
      await refresh({ manual: true });
    } finally {
      reset();
    }
  });
  window.addEventListener("touchcancel", reset);
}

/**
 * The avatar's letter: the first whole character (not half an emoji), skipping
 * Thai leading vowels (เ แ โ ใ ไ) so "เกศินี" shows ก.
 */
function initialOf(name: string): string {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.trim())].map((g) => g.segment);
  return (graphemes.find((g) => !/^[เแโใไ]$/.test(g)) ?? "?").toUpperCase();
}

/** Waits for `work`, or gives up after `ms`: resolves true if it finished in time. */
const within = (work: Promise<unknown>, ms: number) =>
  Promise.race([work.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

/**
 * Does what an Action Link asked. It only opens things: a pre-filled note is
 * saved once the user types or closes it, never by the link itself.
 */
async function runAction(action: Action, refreshing: Promise<void>) {
  if (action.kind === "new") {
    const prefilled = action.text || action.tag || action.color;
    if (!prefilled) return openEditor(null, editorActions(null));
    return openEditor(null, editorActions(null), {
      html: noteHtmlFor(action.text, action.tag),
      images: NO_IMAGE_CHANGES,
      color: action.color,
      fromLink: true,
    });
  }
  if (action.kind === "search") {
    if (action.q) searchEl.value = action.q;
    searchEl.focus();
    render();
    return;
  }
  if (action.kind === "latest") {
    // The newest version may be on another device: refresh first, but don't
    // keep the user waiting more than a few seconds.
    showProgress({ label: t("refresh"), done: 0, total: 0 });
    const fresh = await within(refreshing, 8000);
    const latest = localNotes()[0];
    if (!latest) return toast("attention", t("noNotesYet"));
    if (!fresh || status().offline) toast("offline", t("latestMaybeOld"));
    return editNote(latest);
  }
  // A share: shown in the editor like a pre-filled new note.
  const shared = await readShare(action.id).catch(() => null);
  if (!shared) return toast("attention", t("shareGone"));
  const added = [];
  let unsupported = 0;
  for (const file of shared.files) {
    if (!file.type.startsWith("image/")) {
      unsupported++;
      continue;
    }
    try {
      added.push(await prepareImage(new File([file.blob], file.name, { type: file.type })));
    } catch {
      unsupported++;
    }
  }
  if (unsupported) toast("attention", t("shareUnsupported", { n: unsupported }));
  const hasText = Boolean(shared.title || shared.text || shared.url);
  if (hasText || added.length) {
    openEditor(null, editorActions(null), { html: sharedNoteHtml(shared), images: { removed: [], added }, fromLink: true });
  }
  await deleteShare(action.id).catch(() => {});
}

/** The page before sign-in: what the app does and what Microsoft will ask to allow. */
function showLanding() {
  $("landing").hidden = false;
  $("app").hidden = true;
  $("signin").onclick = () => signIn();
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-lang]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.lang === getSettings().language));
    btn.onclick = () => {
      saveSettings({ language: btn.dataset.lang as "en" | "th" });
      translatePage();
      showLanding();
    };
  }
}

async function start() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.error("Offline support unavailable", err));
  }
  // Ask the browser not to clear the notes kept on this device when space runs low.
  navigator.storage?.persist?.().catch(() => {});
  applySettings();
  translatePage();
  document.addEventListener("touchstart", () => {}, { passive: true });

  // An Action Link runs once: tidy the address so a reload doesn't repeat it.
  const linked = parseActionLink(new URL(location.href));
  if (linked) history.replaceState(null, "", "/");

  const account = await initAuth();
  if (account) {
    // Notes on this device belong to whoever synced them. If a different
    // account signs in (a shared PC, or a session that ended without Sign out),
    // wipe them first: otherwise one person's notes would show, and
    // their queued changes would be written into the other person's mailbox.
    const owner = await getItem<string>("owner");
    if (owner && owner !== account.homeAccountId) await clearAll();
    await setItem("owner", account.homeAccountId);
  }
  if (!account) {
    // Keep the action through sign-in (this tab only, used once, 10 minutes).
    if (linked) {
      savePending(linked);
      toast("attention", t("signInToContinue"));
    }
    showLanding();
    return;
  }
  // A Pending Action runs for whoever signed in: a different account's data was
  // wiped above, and a pre-filled note saves to the account now signed in.
  const action = linked ?? takePending();
  setUpMenu(account.username, initialOf(account.name || account.username));
  setUpSearch();
  setUpPullToRefresh();
  setUpInstall();
  setUpSyncStatus();
  $("new").onclick = () => openEditor(null, editorActions(null));
  $("retry").onclick = () => refresh({ manual: true });

  await initSync({
    chooseConflict: chooseConflictVersion,
    failed: explainFailure,
    changed: render,
    progress: showProgress,
    renamed: (fromId, to) => renamedTo.set(fromId, to.id),
  });
  render(); // notes saved on this device, before anything from the network

  // Refresh when the user comes back to the app (docs/adr/0001: no push from Graph).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastRefresh > 10_000) refresh();
  });
  // Notes load in the background while an action opens what it asked for.
  const refreshing = refresh();
  if (action) await runAction(action, refreshing);
  await refreshing;
}

start().catch((err) => {
  errorEl.hidden = false;
  errorEl.querySelector("span")!.textContent = t("couldntStart", { error: (err as Error).message });
});
