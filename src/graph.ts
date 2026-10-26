// The Hub, reached through the Graph mail API on the Notes folder (docs/adr/0001).
// Only Sticky Notes are touched: the `notes` folder, and notes in Deleted Items.
import { getToken, OfflineError } from "./auth";
import type { NewImage } from "./images";
import { COLORS, type Note, type NoteColor } from "./note";
import { firstLine } from "./serialize";

const GRAPH = "https://graph.microsoft.com/v1.0";
const NOTES = `${GRAPH}/me/mailFolders/notes/messages`;
const STICKY_CLASS = { id: "String 0x001A", value: "IPM.StickyNote" };

// Our own hidden fields on a note (named properties in the public-strings set).
// Microsoft's apps ignore them.
const PROP = (name: string) => `String {00020329-0000-0000-C000-000000000046} Name NotesWebApp.${name}`;
/** The note's original creation time, carried across every replace-on-save. */
const CREATED_PROP = PROP("Created");
/** The queued change that wrote this note, so a retried change never duplicates it. */
const OP_ID_PROP = PROP("OpId");
/** The note's colour (docs/adr/0005). */
const COLOR_PROP = PROP("Color");

const SELECT =
  "$select=subject,body,createdDateTime,lastModifiedDateTime,hasAttachments,parentFolderId" +
  `&$expand=singleValueExtendedProperties($filter=id eq '${CREATED_PROP}' or id eq '${COLOR_PROP}')`;

// Graph accepts at most 3 MB per attachment in a single request.
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

type GraphMessage = {
  id: string;
  "@odata.etag": string;
  subject: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  hasAttachments: boolean;
  parentFolderId: string;
  body: { content: string };
  singleValueExtendedProperties?: { id: string; value: string }[];
};

export type Attachment = { id: string; name: string; contentType: string; size: number };

export class GraphError extends Error {
  constructor(readonly status: number, message: string) {
    super(`Graph ${status}: ${message}`);
  }
}

/** The note changed or was deleted elsewhere since it was loaded. `current` is null when deleted. */
export class ConflictError extends Error {
  constructor(readonly current: Note | null) {
    super(current ? "This note changed elsewhere." : "This note was deleted elsewhere.");
  }
}

/** The new version was saved but the old one couldn't be removed, so both exist. */
export class DuplicateError extends Error {
  constructor(readonly oldId: string, cause: unknown) {
    super(`Your edit was saved, but the old version couldn't be removed, so the note now appears twice. ${(cause as Error).message}`);
  }
}

// Outlook allows an app only ~4 open requests per mailbox ("MailboxConcurrency"),
// so every call waits for one of a few slots.
const MAX_CONCURRENT = 3;
let active = 0;
const waiting: (() => void)[] = [];

async function inSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await run();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const RETRYABLE = new Set([429, 503, 504]);
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(method: string, url: string, body?: unknown): Promise<Response> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 1; ; attempt++) {
    const res = await inSlot(async () => {
      const headers: Record<string, string> = { Authorization: `Bearer ${await getToken()}` };
      if (payload !== undefined) headers["Content-Type"] = "application/json";
      try {
        return await fetch(url, { method, headers, body: payload });
      } catch {
        throw new OfflineError(); // fetch only rejects when the network is unreachable
      }
    });
    if (res.ok) return res;
    if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
      // Graph says how long to wait; otherwise back off 1 s, 2 s, 4 s.
      const retryAfter = Number(res.headers.get("Retry-After"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1));
      continue;
    }
    const detail = await res.json().catch(() => null);
    throw new GraphError(res.status, detail?.error?.message ?? res.statusText);
  }
}

async function graph(method: string, url: string, body?: unknown) {
  const res = await request(method, url, body);
  return res.status === 204 ? null : res.json();
}

let notesFolderId: string | null = null;

const toNote = (m: GraphMessage): Note => {
  if (!notesFolderId && m.parentFolderId) notesFolderId = m.parentFolderId;
  const prop = (name: string) => m.singleValueExtendedProperties?.find((p) => p.id.endsWith(`NotesWebApp.${name}`))?.value;
  const color = prop("Color");
  return {
    id: m.id,
    etag: m["@odata.etag"],
    title: m.subject,
    html: m.body.content,
    created: prop("Created") ?? m.createdDateTime,
    modified: m.lastModifiedDateTime,
    hasAttachments: m.hasAttachments,
    ...(color && (COLORS as readonly string[]).includes(color) ? { color: color as NoteColor } : {}),
  };
};

async function listAll(url: string): Promise<GraphMessage[]> {
  const all: GraphMessage[] = [];
  for (let next: string | undefined = url; next; ) {
    const page = await graph("GET", next);
    all.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return all;
}

/** Reports how far a download has got. */
export type Progress = (done: number, total: number) => void;

/** Every note in the Hub, most recently modified first. */
export async function listNotes(onProgress?: Progress): Promise<Note[]> {
  const notes: Note[] = [];
  let total = 0;
  for (let next: string | undefined = `${NOTES}?$top=100&$count=true&$orderby=lastModifiedDateTime desc&${SELECT}`; next; ) {
    const page = await graph("GET", next);
    total ||= page["@odata.count"] ?? 0;
    notes.push(...(page.value as GraphMessage[]).map(toNote));
    onProgress?.(notes.length, Math.max(total, notes.length));
    next = page["@odata.nextLink"];
  }
  return notes;
}

/**
 * Starts tracking changes in the Notes folder and returns the link that later
 * asks "what changed since now?". Pages through ids only, not note bodies.
 */
export async function startChangeTracking(): Promise<string> {
  let url = `${NOTES}/delta?$select=lastModifiedDateTime`;
  for (;;) {
    const page = await graph("GET", url);
    if (page["@odata.deltaLink"]) return page["@odata.deltaLink"];
    url = page["@odata.nextLink"];
  }
}

export type Changes = { changed: Note[]; removed: string[]; nextLink: string };

/** What changed since `link`: the changed notes in full, and ids that left the folder. */
export async function changesSince(link: string, onProgress?: Progress): Promise<Changes> {
  const changedIds = new Set<string>();
  const removed: string[] = [];
  let url = link;
  let nextLink = "";
  while (!nextLink) {
    const page = await graph("GET", url);
    for (const item of page.value as { id: string; "@removed"?: unknown }[]) {
      if (item["@removed"]) {
        removed.push(item.id);
        changedIds.delete(item.id);
      } else changedIds.add(item.id);
    }
    nextLink = page["@odata.deltaLink"] ?? "";
    url = page["@odata.nextLink"];
  }
  const ids = [...changedIds];
  let done = 0;
  onProgress?.(0, ids.length);
  const fetched = await Promise.all(
    ids.map(async (id) => {
      const note = await getNote(id);
      onProgress?.(++done, ids.length);
      return note;
    }),
  );
  const changed = fetched.filter((n): n is Note => n !== null);
  removed.push(...ids.filter((_, i) => !fetched[i]));
  return { changed, removed, nextLink };
}

const hasProp = (id: string, value: string) => `singleValueExtendedProperties/any(ep:ep/id eq '${id}' and ep/value eq '${value}')`;

/** Sticky Notes sitting in Deleted Items, most recently deleted first. */
export async function listDeletedNotes(): Promise<Note[]> {
  // Graph rejects $orderby together with this filter, so sort here.
  const messages = await listAll(
    `${GRAPH}/me/mailFolders/deleteditems/messages?$top=100&$filter=${hasProp(STICKY_CLASS.id, STICKY_CLASS.value)}&${SELECT}`,
  );
  return messages.map(toNote).sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Moves a deleted note back into the Notes folder. */
export async function restoreNote(id: string) {
  if (!notesFolderId) await listNotes();
  if (!notesFolderId) throw new Error("Couldn't find the Notes folder to restore into.");
  await graph("POST", `${GRAPH}/me/messages/${id}/move`, { destinationId: notesFolderId });
}

async function getNote(id: string): Promise<Note | null> {
  try {
    return toNote(await graph("GET", `${GRAPH}/me/messages/${id}?${SELECT}`));
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

/** The note an earlier attempt of the queued change `opId` created, if any. */
async function findByOpId(opId: string): Promise<Note | null> {
  const page = await graph("GET", `${NOTES}?$top=1&$filter=${hasProp(OP_ID_PROP, opId)}&${SELECT}`);
  return page.value[0] ? toNote(page.value[0]) : null;
}

/** Images to change on save: attachment ids to leave out, and new images to add. */
export type ImageChanges = { removed: string[]; added: NewImage[] };
export const NO_IMAGE_CHANGES: ImageChanges = { removed: [], added: [] };

type CreateOptions = {
  /** Copy this note's images (minus `changes.removed`). */
  copyFrom?: string;
  changes?: ImageChanges;
  /** Original creation time to keep; defaults to now. */
  created?: string;
  /** The queued change doing this, stamped on the note so a retry can find it. */
  opId?: string;
  color?: NoteColor;
};

/**
 * Creates a note with its images. If any image fails, the new note is removed
 * again, so a note is never left half-saved.
 */
export async function createNote(html: string, opts: CreateOptions = {}): Promise<Note> {
  const changes = opts.changes ?? NO_IMAGE_CHANGES;
  const props = [STICKY_CLASS, { id: CREATED_PROP, value: opts.created ?? new Date().toISOString() }];
  if (opts.opId) props.push({ id: OP_ID_PROP, value: opts.opId });
  if (opts.color) props.push({ id: COLOR_PROP, value: opts.color });
  const created = toNote(
    await graph("POST", NOTES, {
      subject: firstLine(html),
      body: { contentType: "html", content: html },
      singleValueExtendedProperties: props,
    }),
  );
  const withImages = Boolean(opts.copyFrom) || changes.added.length > 0;
  if (!withImages) return created;
  try {
    if (opts.copyFrom) await copyAttachments(opts.copyFrom, created.id, new Set(changes.removed));
    for (const image of changes.added) await addImage(created.id, image);
  } catch (err) {
    await removeOldVersion(created.id).catch(() => {});
    throw new Error(`Not saved, because the images couldn't be attached. ${(err as Error).message}`);
  }
  // Adding images changes the etag; later queued changes need the final one.
  return (await getNote(created.id)) ?? created;
}

/** createNote for a queued change: first clears away anything a cut-off earlier attempt left. */
export async function createNoteOnce(html: string, opts: CreateOptions & { opId: string }): Promise<Note> {
  const leftover = await findByOpId(opts.opId);
  if (leftover) await removeOldVersion(leftover.id);
  return createNote(html, opts);
}

/**
 * Sets only the colour. It's our own hidden field, so it can be changed in
 * place: no replacement, and the PC app's window doesn't jump.
 */
export async function setNoteColor(id: string, color: NoteColor) {
  await graph("PATCH", `${GRAPH}/me/messages/${id}`, { singleValueExtendedProperties: [{ id: COLOR_PROP, value: color }] });
}

/**
 * A deliberate delete: the note moves to Deleted Items. Moving gives the item a
 * new id, which is returned so the delete can be undone.
 */
export async function deleteNote(id: string): Promise<string> {
  const moved = await graph("POST", `${GRAPH}/me/messages/${id}/move`, { destinationId: "deleteditems" });
  return moved.id;
}

/** Removes a replaced version for good, so copies don't pile up in Deleted Items. */
export async function removeOldVersion(id: string) {
  await graph("POST", `${GRAPH}/me/messages/${id}/permanentDelete`);
}

export async function listAttachments(noteId: string): Promise<Attachment[]> {
  const page = await graph("GET", `${GRAPH}/me/messages/${noteId}/attachments?$select=id,name,contentType,size`);
  return page.value;
}

export async function attachmentBlob(noteId: string, attachmentId: string): Promise<Blob> {
  return (await request("GET", `${GRAPH}/me/messages/${noteId}/attachments/${attachmentId}/$value`)).blob();
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The native app only shows an image whose contentId is its file name without
// the extension (seen on every native image, 2026-10-26); without one, it and
// onenote.com ignore the image.
const contentIdFor = (name: string) => name.replace(/\.[^.]+$/, "");

async function addImage(noteId: string, image: NewImage) {
  await graph("POST", `${GRAPH}/me/messages/${noteId}/attachments`, {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: image.name,
    contentType: image.blob.type,
    contentBytes: await base64(image.blob),
    isInline: false,
    contentId: contentIdFor(image.name),
  });
}

// Copies the images from one note to another, so a replaced note keeps them.
async function copyAttachments(fromId: string, toId: string, skip: Set<string>) {
  const page = await graph("GET", `${GRAPH}/me/messages/${fromId}/attachments`);
  for (const a of page.value) {
    if (skip.has(a.id)) continue;
    if (a["@odata.type"] !== "#microsoft.graph.fileAttachment") {
      throw new Error(`"${a.name}" isn't a file, so it can't be copied to the new version.`);
    }
    if (a.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`"${a.name}" is larger than 3 MB, which the app can't copy yet.`);
    }
    await graph("POST", `${GRAPH}/me/messages/${toId}/attachments`, {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
      isInline: a.isInline,
      // Also repairs images uploaded before contentId was set.
      contentId: a.contentId ?? contentIdFor(a.name),
    });
  }
}

/**
 * Saves an edit by creating a new note and removing the old one, because the
 * native app ignores body edits to its notes (docs/adr/0003). Images are copied
 * across first; if that fails the new note is removed and the old one is kept.
 *
 * Safe to retry with the same `opId` after being cut off at any point.
 */
export async function replaceNote(
  old: Note,
  html: string,
  changes: ImageChanges,
  opId: string,
  color?: NoteColor,
): Promise<Note> {
  const leftover = await findByOpId(opId);
  const current = await getNote(old.id);
  if (leftover) {
    if (!current) return leftover; // the earlier attempt finished; only its bookkeeping was lost
    await removeOldVersion(leftover.id); // the earlier attempt may be half done: redo it
  }
  if (!current || current.etag !== old.etag) throw new ConflictError(current);
  const created = await createNote(html, {
    copyFrom: current.hasAttachments ? old.id : undefined,
    changes,
    created: current.created,
    opId,
    color: color ?? current.color,
  });
  try {
    await removeOldVersion(old.id);
  } catch (err) {
    throw new DuplicateError(old.id, err);
  }
  return created;
}
