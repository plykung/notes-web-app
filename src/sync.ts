// Offline-first: the last notes from Microsoft plus a queue of local changes
// (the outbox), both kept on the device. The screen always shows the notes with
// queued changes applied; the queue syncs in order whenever Microsoft is reachable.
import { OfflineError, SignInNeededError } from "./auth";
import {
  ConflictError,
  GraphError,
  changesSince,
  createNote,
  createNoteOnce,
  deleteNote,
  listNotes,
  replaceNote,
  NO_IMAGE_CHANGES,
  setNoteColor,
  startChangeTracking,
  type ImageChanges,
} from "./graph";
import { forgetImages, noteImages, pruneImages, prefetchImages, setLocalImages, type NewImage } from "./images";
import type { Note, NoteColor } from "./note";
import { NOTE_TAIL, firstLine } from "./serialize";
import { getSettings } from "./settings";
import { getItem, setItem } from "./store";

/** What a sync is doing right now, for a progress bar. `total` 0 means "not known yet". */
export type SyncProgress = { label: string; done: number; total: number };

export type Op =
  | { opId: string; kind: "create"; tempId: string; html: string; images: ImageChanges; created: string; at: string; color?: NoteColor }
  | { opId: string; kind: "edit"; base: Note; html: string; images: ImageChanges; hasImages: boolean; at: string; color?: NoteColor }
  /** Only the colour changed: set in place, no replacement (docs/adr/0005). */
  | { opId: string; kind: "color"; base: Note; color: NoteColor; at: string }
  | { opId: string; kind: "delete"; base: Note; at: string };

/** What an edit changes. A missing `html` means the text is unchanged. */
export type Change = { html?: string; images?: ImageChanges; color?: NoteColor };

export type ConflictChoice = "mine" | "saved" | "both";

/** What sync needs from the screen: conflict decisions and explaining failures. */
export type SyncUi = {
  chooseConflict: (mineHtml: string, saved: Note | null) => Promise<ConflictChoice>;
  failed: (op: Op, err: unknown) => Promise<void>;
  changed: () => void;
  progress?: (p: SyncProgress | null) => void;
  /** A note got a new id (replace-on-save); pop-out windows follow it. */
  renamed?: (fromId: string, to: Note) => void;
};

let snapshot: Note[] = [];
let outbox: Op[] = [];
let syncingOpId: string | null = null;
let running = false;
let offline = !navigator.onLine;
let loadError: string | null = null;
/** The login expired: changes wait on the device until the user signs in again. */
let needsSignIn = false;
let ui: SyncUi;
/** Where each synced delete moved its note, so it can still be undone. */
const deletedTo = new Map<string, string>();

const isLocalId = (id: string) => id.startsWith("local-");
const saveOutbox = () => {
  changedLocally();
  return setItem("outbox", outbox);
};
const opNoteId = (op: Op) => (op.kind === "create" ? op.tempId : op.base.id);

export async function initSync(next: SyncUi) {
  ui = next;
  snapshot = (await getItem<Note[]>("snapshot")) ?? [];
  outbox = (await getItem<Op[]>("outbox")) ?? [];
  changedLocally();
  window.addEventListener("online", () => sync());
  window.addEventListener("offline", () => {
    offline = true;
    ui.changed();
  });
}

// ---------- What the screen shows ----------

// Bumped whenever the device copy or the queue changes.
let version = 0;
const changedLocally = () => void version++;
let cached: { version: number; notes: Note[]; states: Map<string, "syncing" | "queued">; syncing: string | null } | null = null;

/** The notes as they will be once every queued change has synced. */
export function localNotes(): Note[] {
  if (cached?.version !== version) cached = { version, notes: buildLocalNotes(), states: new Map(), syncing: "" };
  return cached.notes;
}

function buildLocalNotes(): Note[] {
  let list = [...snapshot];
  for (const op of outbox) {
    if (op.kind === "create") {
      list.push({
        id: op.tempId,
        etag: "",
        title: firstLine(op.html),
        html: op.html,
        created: op.created,
        modified: op.at,
        hasAttachments: op.images.added.length > 0,
        ...(op.color ? { color: op.color } : {}),
      });
    } else if (op.kind === "edit") {
      list = list.map((n) =>
        n.id === op.base.id
          ? { ...n, html: op.html, title: firstLine(op.html), modified: op.at, hasAttachments: op.hasImages, ...(op.color ? { color: op.color } : {}) }
          : n,
      );
    } else if (op.kind === "color") {
      list = list.map((n) => (n.id === op.base.id ? { ...n, color: op.color } : n));
    } else {
      list = list.filter((n) => n.id !== op.base.id);
    }
  }
  return list.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** "syncing" while a change to this note is being sent, "queued" while one waits. */
export function noteState(id: string): "syncing" | "queued" | null {
  localNotes(); // makes sure the cache is current
  if (cached!.syncing !== syncingOpId) {
    cached!.states = new Map();
    for (const op of outbox) {
      const noteId = opNoteId(op);
      if (cached!.states.get(noteId) !== "syncing") cached!.states.set(noteId, op.opId === syncingOpId ? "syncing" : "queued");
    }
    cached!.syncing = syncingOpId;
  }
  return cached!.states.get(id) ?? null;
}

export const status = () => ({ offline, needsSignIn, waiting: outbox.length, syncing: syncingOpId !== null, loadError });

// ---------- Queueing changes ----------

const toNewImages = (images: { name: string; blob: Blob }[]): NewImage[] => images.map(({ name, blob }) => ({ name, blob }));
const localImage = (img: NewImage) => ({ id: `local-${img.name}`, name: img.name, blob: img.blob });
const unsynced = (op: Op) => op.opId !== syncingOpId;

let quietTimer = 0;

function queue(op: Op, later = false) {
  outbox.push(op);
  return persistAndSync(later);
}

/**
 * Saves the queue on the device, then syncs: now, or `later` once edits have
 * been quiet for the time set in Settings, so the PC doesn't get a new version
 * at every pause. A delay of 0 waits until the editor closes (it calls sync).
 */
async function persistAndSync(later = false) {
  await saveOutbox();
  ui.changed();
  clearTimeout(quietTimer);
  if (!later) {
    sync();
    return;
  }
  const delay = getSettings().syncDelaySeconds;
  if (delay > 0) quietTimer = window.setTimeout(() => sync(), delay * 1000);
}

/** Queues a new note and returns its temporary id (until it syncs). */
export async function queueCreate(html: string, images: ImageChanges, color?: NoteColor, opts: { later?: boolean } = {}) {
  const tempId = `local-${crypto.randomUUID()}`;
  await setLocalImages(tempId, images.added.map(localImage));
  const now = new Date().toISOString();
  await queue({ opId: crypto.randomUUID(), kind: "create", tempId, html, images, created: now, at: now, color }, opts.later);
  return tempId;
}

const hasImageChanges = (i?: ImageChanges) => Boolean(i && (i.added.length || i.removed.length));

/** Queues an edit of `note` as shown on screen (possibly with earlier queued changes applied). */
export async function queueEdit(note: Note, change: Change, opts: { later?: boolean } = {}) {
  const at = new Date().toISOString();
  const earlier = [...outbox].reverse().find((op) => opNoteId(op) === note.id && op.kind !== "delete" && unsynced(op));

  // Only the colour: change it in place, without replacing the note.
  if (change.html === undefined && !hasImageChanges(change.images)) {
    if (!change.color) return;
    if (earlier) {
      Object.assign(earlier, { color: change.color });
      return persistAndSync(opts.later);
    }
    const base = snapshot.find((n) => n.id === note.id) ?? note;
    return queue({ opId: crypto.randomUUID(), kind: "color", base, color: change.color, at }, opts.later);
  }

  const html = change.html ?? note.html;
  const images = change.images ?? NO_IMAGE_CHANGES;
  // The images the note will have after this edit, for display and offline editing.
  const before = await noteImages(note.id).catch(() => []);
  const after = [...before.filter((i) => !images.removed.includes(i.id)), ...images.added.map(localImage)];
  await setLocalImages(note.id, after);
  const pendingUploads = toNewImages(after.filter((i) => isLocalId(i.id)));
  const serverRemovals = images.removed.filter((id) => !isLocalId(id));
  const color = change.color ?? (earlier && "color" in earlier ? earlier.color : undefined);

  // Fold into a queued change to the same note that hasn't started sending, so
  // the PC app sees one new version instead of several.
  if (earlier?.kind === "create") {
    Object.assign(earlier, { html, at, color: color ?? earlier.color, images: { removed: [], added: pendingUploads } });
    return persistAndSync(opts.later);
  }
  if (earlier?.kind === "edit") {
    const removed = [...new Set([...earlier.images.removed, ...serverRemovals])];
    Object.assign(earlier, { html, at, color, hasImages: after.length > 0, images: { removed, added: pendingUploads } });
    return persistAndSync(opts.later);
  }
  if (earlier?.kind === "color") outbox = outbox.filter((op) => op !== earlier); // the replacement carries it
  const base = snapshot.find((n) => n.id === note.id) ?? note;
  await queue(
    {
      opId: crypto.randomUUID(),
      kind: "edit",
      base,
      html,
      images: { removed: serverRemovals, added: pendingUploads },
      hasImages: after.length > 0,
      at,
      color,
    },
    opts.later,
  );
}

/** Changes dropped by deleting a note that never reached Microsoft, kept for undo. */
const droppedFor = new Map<string, Op[]>();

/** Queues a delete and returns an id for undo. */
export async function queueDelete(note: Note): Promise<string> {
  const opId = crypto.randomUUID();
  const create = outbox.find((op) => op.kind === "create" && op.tempId === note.id);
  if (create && unsynced(create)) {
    // Never reached Microsoft: just forget it (but keep it for undo).
    droppedFor.set(opId, outbox.filter((op) => opNoteId(op) === note.id));
    outbox = outbox.filter((op) => opNoteId(op) !== note.id);
    await persistAndSync();
    return opId;
  }
  const base = snapshot.find((n) => n.id === note.id) ?? note;
  await queue({ opId, kind: "delete", base, at: new Date().toISOString() });
  return opId;
}

/** Undoes a delete if it hasn't synced; otherwise returns where the note went, to restore it. */
export async function undoDelete(opId: string): Promise<string | null> {
  const dropped = droppedFor.get(opId);
  if (dropped) {
    droppedFor.delete(opId);
    outbox.push(...dropped);
    for (const op of dropped) if (op.kind === "create") await setLocalImages(op.tempId, op.images.added.map(localImage));
    await persistAndSync();
    return null;
  }
  if (outbox.some((op) => op.opId === opId && unsynced(op))) {
    outbox = outbox.filter((op) => op.opId !== opId);
    await persistAndSync();
    return null;
  }
  return deletedTo.get(opId) ?? null;
}

// ---------- Syncing ----------

/** Saves an edit, asking the user when the note changed elsewhere. Returns the new version. */
async function saveEdit(base: Note, html: string, images: ImageChanges, opId: string, color?: NoteColor): Promise<Note | null> {
  try {
    return await replaceNote(base, html, images, opId, color);
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    const choice = await ui.chooseConflict(html, err.current);
    if (!err.current) await forgetNote(base.id); // it's gone on Microsoft's side: stop showing it
    if (choice === "saved") return null;
    if (choice === "both") {
      // The extra note gets the images as they were when this edit started, plus my changes.
      const marked = html.replace(NOTE_TAIL, `<p>#conflict</p>${NOTE_TAIL}`);
      await createNote(marked, { copyFrom: base.hasAttachments ? err.current!.id : undefined, changes: images, color });
      return null;
    }
    if (!err.current) {
      // Deleted elsewhere: its images are gone too, so only newly added ones come along.
      return createNote(html, { changes: { removed: [], added: images.added }, created: base.created, color: color ?? base.color });
    }
    return saveEdit(err.current, html, images, opId, color);
  }
}

async function runOp(op: Op): Promise<Note | null> {
  if (op.kind === "create") {
    return createNoteOnce(op.html, { changes: op.images, created: op.created, opId: op.opId, color: op.color });
  }
  if (op.kind === "edit") return saveEdit(op.base, op.html, op.images, op.opId, op.color);
  if (op.kind === "color") {
    try {
      await setNoteColor(op.base.id, op.color);
    } catch (err) {
      if (!(err instanceof GraphError && err.status === 404)) throw err;
      await forgetNote(op.base.id); // deleted meanwhile: nothing to colour
    }
    return null;
  }
  try {
    deletedTo.set(op.opId, await deleteNote(op.base.id));
  } catch (err) {
    if (!(err instanceof GraphError && err.status === 404)) throw err; // already gone is fine
  }
  await forgetNote(op.base.id);
  return null;
}

/**
 * Drops a note from the device copy once Microsoft says it's gone. Don't wait
 * for the change list: a note created and deleted between two checks (such as
 * the new copy made by pinning) never appears in it, so it would stay forever.
 */
async function forgetNote(id: string) {
  snapshot = snapshot.filter((n) => n.id !== id);
  changedLocally();
  await setItem("snapshot", snapshot);
}

/** A note just got a new id: show the new version now, and point later queued changes at it. */
function retarget(fromId: string, to: Note) {
  snapshot = [to, ...snapshot.filter((n) => n.id !== fromId && n.id !== to.id)];
  changedLocally();
  for (const op of outbox) {
    if (op.kind !== "create" && op.base.id === fromId) op.base = to;
  }
  ui.renamed?.(fromId, to);
}

const byNewest = (a: Note, b: Note) => b.modified.localeCompare(a.modified);

/**
 * Brings the device copy up to date. After the first full download only
 * changes are fetched (Graph delta), so a refresh is usually a few requests.
 */
async function refreshFromServer(full: boolean) {
  const link = full ? undefined : await getItem<string>("deltaLink");
  let done = false;
  if (link) {
    try {
      ui.progress?.({ label: "Checking for changes", done: 0, total: 0 });
      const { changed, removed, nextLink } = await changesSince(link, (d, t) =>
        ui.progress?.({ label: "Downloading changes", done: d, total: t }),
      );
      const gone = new Set([...removed, ...changed.map((n) => n.id)]);
      snapshot = [...changed, ...snapshot.filter((n) => !gone.has(n.id))].sort(byNewest);
      await setItem("deltaLink", nextLink);
      done = true;
    } catch (err) {
      // An expired or unusable link means starting over; anything else is a real failure.
      if (!(err instanceof GraphError) || ![400, 404, 410].includes(err.status)) throw err;
    }
  }
  if (!done) {
    ui.progress?.({ label: "Downloading notes", done: 0, total: 0 });
    const nextLink = await startChangeTracking(); // before the download, so nothing is missed
    snapshot = await listNotes((d, t) => ui.progress?.({ label: "Downloading notes", done: d, total: t }));
    await setItem("deltaLink", nextLink);
  }
  offline = false;
  needsSignIn = false;
  loadError = null;
  changedLocally();
  await setItem("snapshot", snapshot);
  await setItem("lastSynced", new Date().toISOString());
  const keep = new Set([...snapshot.map((n) => n.id), ...outbox.map(opNoteId)]);
  await pruneImages(keep);
  if (getSettings().offlineImages) prefetchImages(snapshot.filter((n) => n.hasAttachments).map((n) => n.id));
}

export const lastSynced = () => getItem<string>("lastSynced");
export const deviceNotes = () => snapshot;

/** Sends queued changes in order, then brings the notes up to date. Safe to call any time. */
export async function sync(opts: { full?: boolean } = {}) {
  if (running || !ui) return;
  clearTimeout(quietTimer);
  running = true;
  const totalOps = outbox.length;
  try {
    while (outbox.length) {
      const op = outbox[0];
      syncingOpId = op.opId;
      ui.progress?.({ label: "Saving changes", done: totalOps - outbox.length, total: totalOps });
      ui.changed();
      let failure: unknown = null;
      try {
        const result = await runOp(op);
        if (result) retarget(opNoteId(op), result);
        offline = false;
        needsSignIn = false;
      } catch (err) {
        if (err instanceof OfflineError || err instanceof SignInNeededError) {
          if (err instanceof SignInNeededError) needsSignIn = true;
          else offline = true;
          return;
        }
        failure = err;
      }
      outbox.shift();
      await saveOutbox();
      // The images kept for this note described the queued change; once it's
      // done (or failed), Microsoft's copy is the truth again.
      if (!outbox.some((o) => opNoteId(o) === opNoteId(op))) await forgetImages(opNoteId(op));
      if (failure) {
        syncingOpId = null;
        ui.changed();
        await ui.failed(op, failure);
      }
    }
    syncingOpId = null;
    await refreshFromServer(opts.full ?? false);
  } catch (err) {
    if (err instanceof OfflineError) offline = true;
    else if (err instanceof SignInNeededError) needsSignIn = true;
    else loadError = (err as Error).message;
  } finally {
    syncingOpId = null;
    running = false;
    ui.progress?.(null);
    ui.changed();
  }
}
