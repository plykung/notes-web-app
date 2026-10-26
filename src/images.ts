// Note images (Graph attachments): kept on the device for offline use, lazy
// display, and preparing uploads.
import { attachmentBlob, listAttachments, MAX_ATTACHMENT_BYTES } from "./graph";
import { t } from "./i18n";
import { allKeys, getItem, removeItem, setItem } from "./store";

/** `id` is the attachment id, or "local-<name>" for an image not uploaded yet. */
export type NoteImage = { id: string; name: string; blob: Blob; url: string };
type StoredImage = Omit<NoteImage, "url">;

const key = (noteId: string) => `img:${noteId}`;
const withUrls = (stored: StoredImage[]): NoteImage[] => stored.map((s) => ({ ...s, url: URL.createObjectURL(s.blob) }));

const memory = new Map<string, Promise<NoteImage[]>>();

async function download(noteId: string): Promise<StoredImage[]> {
  const attachments = (await listAttachments(noteId)).filter((a) => a.contentType.startsWith("image/"));
  return Promise.all(attachments.map(async (a) => ({ id: a.id, name: a.name, blob: await attachmentBlob(noteId, a.id) })));
}

/** A note's images: from memory, then the device, then Microsoft (and kept on the device). */
export function noteImages(noteId: string): Promise<NoteImage[]> {
  let images = memory.get(noteId);
  if (!images) {
    images = (async () => {
      let stored = await getItem<StoredImage[]>(key(noteId));
      if (!stored) {
        stored = noteId.startsWith("local-") ? [] : await download(noteId);
        await setItem(key(noteId), stored);
      }
      return withUrls(stored);
    })();
    images.catch(() => memory.delete(noteId)); // let a later view retry
    memory.set(noteId, images);
  }
  return images;
}

/** Records the images a note will have once a queued change syncs. */
export async function setLocalImages(noteId: string, images: StoredImage[]) {
  const stored = images.map(({ id, name, blob }) => ({ id, name, blob }));
  await setItem(key(noteId), stored);
  memory.set(noteId, Promise.resolve(withUrls(stored)));
}

/** Drops a note's kept images, so they're downloaded fresh next time. */
export async function forgetImages(noteId: string) {
  memory.delete(noteId);
  await removeItem(key(noteId));
}

/** Downloads images for these notes in the background, so they're there offline. */
export function prefetchImages(noteIds: string[]) {
  for (const id of noteIds) noteImages(id).catch(() => {});
}

/** How many images are kept on this device, and their total size in bytes. */
export async function imageStats(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  for (const k of await allKeys()) {
    if (!k.startsWith("img:")) continue;
    for (const img of (await getItem<StoredImage[]>(k)) ?? []) {
      count++;
      bytes += img.blob.size;
    }
  }
  return { count, bytes };
}

/** Forgets images of notes that no longer exist. */
export async function pruneImages(keep: Set<string>) {
  for (const k of await allKeys()) {
    if (k.startsWith("img:") && !keep.has(k.slice(4))) {
      await removeItem(k);
      memory.delete(k.slice(4));
    }
  }
}

const MAX_THUMBS = 4;

/** Fills `container` with the note's thumbnails; tapping one calls `onOpen`. */
export async function renderThumbs(noteId: string, container: HTMLElement, onOpen: (img: NoteImage) => void) {
  container.classList.remove("waiting");
  container.classList.add("thumbs", "loading");
  try {
    const images = await noteImages(noteId);
    if (!images.length) {
      container.textContent = t("noImages");
      container.classList.add("failed");
      return;
    }
    container.replaceChildren(
      ...images.slice(0, MAX_THUMBS).map((img, i) => {
        const el = document.createElement("img");
        el.src = img.url;
        el.alt = img.name;
        el.onclick = (e) => {
          e.stopPropagation();
          onOpen(img);
        };
        if (i === MAX_THUMBS - 1 && images.length > MAX_THUMBS) {
          const wrap = document.createElement("span");
          wrap.className = "more";
          wrap.dataset.more = `+${images.length - MAX_THUMBS + 1}`;
          wrap.append(el);
          return wrap;
        }
        return el;
      }),
    );
  } catch (err) {
    console.error("Note images failed", noteId, err);
    container.textContent = t("imagesFailed", { error: (err as Error).message });
    container.classList.add("failed");
  } finally {
    container.classList.remove("loading");
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      (entry.target as HTMLElement & { load?: () => void }).load?.();
    }
  },
  { rootMargin: "300px" },
);

/** Loads `load` once `el` is near the viewport. */
export function whenVisible(el: HTMLElement, load: () => void) {
  (el as HTMLElement & { load?: () => void }).load = load;
  observer.observe(el);
}

// ---------- Uploads ----------

/** An image ready to attach: named like the native app's attachments (<uuid>.<ext>). */
export type NewImage = { name: string; blob: Blob };

const KEEP_AS_IS = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_SIDE = 2560;

async function scaleDown(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_ATTACHMENT_BYTES) return blob;
  }
  throw new Error(t("tooLarge", { name: file.name }));
}

/** Keeps images that Graph accepts as they are; shrinks bigger or unusual ones to a JPEG under 3 MB. */
export async function prepareImage(file: File): Promise<NewImage> {
  const keep = KEEP_AS_IS.has(file.type) && file.size <= MAX_ATTACHMENT_BYTES;
  const blob = keep ? file : await scaleDown(file);
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1];
  return { name: `${crypto.randomUUID()}.${ext}`, blob };
}
