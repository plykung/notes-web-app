// A Sticky Note as the app sees it, plus the pure logic for reading its HTML.
// The stored HTML shape is described in docs/note-html-format.md.
import { locale, t } from "./i18n";

export type Note = {
  id: string;
  etag: string;
  title: string;
  html: string;
  /** Original creation time; survives replace-on-save (docs/adr/0003). */
  created: string;
  modified: string;
  hasAttachments: boolean;
  /** Colour from our hidden field (docs/adr/0005); absent on notes never coloured here. */
  color?: NoteColor;
};

function contentRoot(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.getElementById("NotesClientContent") ?? doc.body;
}

// Search runs on every keystroke across all notes, so parse each body once.
const textCache = new Map<string, string>();

/** Plain text of a note, one line per paragraph or list item. */
export function noteText(html: string): string {
  const cached = textCache.get(html);
  if (cached !== undefined) return cached;
  const lines: string[] = [];
  // Zero-width spaces only keep blank lines and spaces alive on the PC (serialize.ts).
  for (const p of contentRoot(html).querySelectorAll("p")) lines.push((p.textContent ?? "").replaceAll("​", ""));
  const text = lines.join("\n").replace(/\n+$/, "");
  if (textCache.size > 2000) textCache.clear();
  textCache.set(html, text);
  return text;
}

// A Tag starts at the beginning of the text or after whitespace, so "C#",
// "a#b" and URL anchors are not Tags. \p{M} keeps Thai vowel and tone marks.
const TAG = /(?<=^|\s)#([\p{L}\p{M}\p{N}_-]+)/gu;

const tagCache = new Map<string, string[]>();

/** Tags in the text, without "#", each once (case-insensitive), first spelling kept. */
export function extractTags(text: string): string[] {
  const cached = tagCache.get(text);
  if (cached) return cached;
  const tags = readTags(text);
  if (tagCache.size > 2000) tagCache.clear();
  tagCache.set(text, tags);
  return tags;
}

function readTags(text: string): string[] {
  const seen = new Map<string, string>();
  for (const [, tag] of text.normalize("NFC").matchAll(TAG)) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

/** The native Sticky Notes palette (docs/adr/0005). */
export const COLORS = ["yellow", "green", "pink", "purple", "blue", "gray", "charcoal"] as const;
export type NoteColor = (typeof COLORS)[number];
export const DEFAULT_COLOR: NoteColor = "yellow";
const isColor = (tag: string): tag is NoteColor => (COLORS as readonly string[]).includes(tag.toLowerCase());

/** A colour Tag in the text (from before colour moved to a hidden field), or yellow. */
export function noteColor(text: string): NoteColor {
  const tag = extractTags(text).find(isColor);
  return tag ? (tag.toLowerCase() as NoteColor) : DEFAULT_COLOR;
}

/** The note's colour: the hidden field first, then an old colour Tag, then yellow. */
export const colorOf = (note: Note): NoteColor => note.color ?? noteColor(noteText(note.html));

export const PIN_TAG = "pinned";
export const isPinned = (text: string) => extractTags(text).some((t) => t.toLowerCase() === PIN_TAG);

// Tags the app shows as colour or a pin icon instead of text.
const SYSTEM_TAG = new RegExp(`(^|\\s)#(?:${[...COLORS, PIN_TAG].join("|")})(?=\\s|$)`, "giu");

/** A line with nothing visible (a zero-width space counts as nothing). */
const isBlank = (el: Element) => !(el.textContent ?? "").replaceAll("​", "").trim();

/**
 * Removes colour Tags and #pinned from a rendered note, along with lines left
 * empty by that and the blank lines written before them.
 */
export function hideSystemTags(el: HTMLElement) {
  let removedAny = false;
  for (const p of [...el.querySelectorAll("p")]) {
    let changed = false;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      const next = text.replace(SYSTEM_TAG, "$1");
      if (next !== text) {
        node.textContent = next.replace(/\s+$/, "");
        changed = true;
      }
    }
    if (changed && isBlank(p)) {
      p.remove();
      removedAny = true;
    }
  }
  if (!removedAny) return;
  // Drop the blank spacer lines that were above the hidden Tags.
  for (let last = el.lastElementChild; last?.tagName === "P" && isBlank(last); last = el.lastElementChild) {
    last.remove();
  }
}

const STYLE_TO_TAG: [RegExp, string][] = [
  [/font-weight:\s*bold/, "strong"],
  [/font-style:\s*italic/, "em"],
  [/text-decoration:\s*underline/, "u"],
  [/text-decoration:\s*line-through/, "s"],
];
const KEPT = new Set(["P", "UL", "LI", "BR"]);

// Rebuilds the note from scratch with only the elements the native app writes.
// Nothing from the source is copied except text, so attributes such as onclick
// or href can never reach the page.
function cleanChildren(from: Node, into: Node) {
  for (const child of from.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      into.appendChild(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") continue;

    let target: Node = into;
    if (KEPT.has(tag)) {
      target = into.appendChild(document.createElement(tag.toLowerCase()));
    } else if (tag === "SPAN") {
      const style = child.getAttribute("style") ?? "";
      for (const [pattern, wrapTag] of STYLE_TO_TAG) {
        if (pattern.test(style)) target = target.appendChild(document.createElement(wrapTag));
      }
    }
    cleanChildren(child, target);
  }
}

/** A safe element for displaying a note's HTML. */
export function renderNoteBody(html: string): HTMLElement {
  const out = document.createElement("div");
  const root = contentRoot(html);
  const inner = root.children.length === 1 && root.firstElementChild?.tagName === "DIV" ? root.firstElementChild : root;
  cleanChildren(inner, out);
  return out;
}

/** "Created 16 Jan 2022 · Edited 26 Oct 2026, 14:32"; only the first part if never edited. */
export function noteDates(note: Note): string {
  const date = new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(new Date(note.created));
  const edited = new Date(note.modified).getTime() - new Date(note.created).getTime() > 60_000;
  if (!edited) return t("created", { date });
  const time = new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.modified));
  return t("createdEdited", { date, time });
}

/** True when the note contains the search text and carries every selected Tag. */
export function matchesFilter(note: Note, search: string, tags: string[]): boolean {
  const text = noteText(note.html).normalize("NFC");
  if (search && !text.toLowerCase().includes(search.normalize("NFC").toLowerCase())) return false;
  if (tags.length === 0) return true;
  const noteTags = new Set(extractTags(text).map((t) => t.toLowerCase()));
  return tags.every((t) => noteTags.has(t.toLowerCase()));
}
