// Action Links: addresses that open the app and ask it to do one thing
// (GLOSSARY.md). They never save, delete or change a note by themselves: they
// only open the editor or the search, and the user's own typing or closing
// saves. A link tapped while signed out becomes a Pending Action.
//
// PUBLIC CONTRACT (docs/adr/0006): these addresses are baked into shared iCloud
// shortcuts, Android shortcuts and bookmarks that can't be updated. Never
// rename or remove an action or parameter; only add. The "published links"
// tests in actions.test.ts must keep passing unchanged.
import { COLORS, type NoteColor } from "./note";
import { toNoteHtml, withTagLine } from "./serialize";

export type Action =
  | { kind: "new"; text?: string; tag?: string; color?: NoteColor }
  | { kind: "latest" }
  | { kind: "search"; q?: string }
  /** Something shared into Notes; its content waits in the share store under `id`. */
  | { kind: "share"; id: string };

const MAX_TEXT = 10_000;
const MAX_QUERY = 200;
const TAG = /^[\p{L}\p{M}\p{N}_-]{1,50}$/u;
const SHARE_ID = /^[\w-]{1,64}$/;

/** The action in an address, or null. Values it doesn't accept are dropped, not errors. */
export function parseActionLink(url: URL): Action | null {
  const p = url.searchParams;
  switch (p.get("action")) {
    case "new": {
      const action: Action = { kind: "new" };
      const text = p.get("text");
      if (text) action.text = text.slice(0, MAX_TEXT);
      const tag = p.get("tag")?.replace(/^#/, "");
      if (tag && TAG.test(tag)) action.tag = tag;
      const color = p.get("color")?.toLowerCase();
      if (color && (COLORS as readonly string[]).includes(color)) action.color = color as NoteColor;
      return action;
    }
    case "latest":
      return { kind: "latest" };
    case "search": {
      const q = p.get("q")?.trim();
      return q ? { kind: "search", q: q.slice(0, MAX_QUERY) } : { kind: "search" };
    }
    case "share": {
      const id = p.get("id");
      return id && SHARE_ID.test(id) ? { kind: "share", id } : null;
    }
    default:
      return null;
  }
}

// ---------- Pending Action (survives the trip to Microsoft's sign-in) ----------

const PENDING_KEY = "notes-pending-action";
const PENDING_MS = 10 * 60 * 1000;

/** Keeps the action for this tab only, until sign-in comes back. */
export function savePending(action: Action, now = Date.now()) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ action, at: now }));
  } catch {
    // Storage blocked: the action is simply lost, as before.
  }
}

/** The Pending Action if there is one and it's under 10 minutes old; it's removed either way. */
export function takePending(now = Date.now()): Action | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const { action, at } = JSON.parse(raw) as { action: Action; at: number };
    return now - at <= PENDING_MS ? action : null;
  } catch {
    return null;
  }
}

// ---------- Note content ----------

function htmlFromLines(lines: string[]): string {
  const root = document.createElement("div");
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    root.append(p);
  }
  return toNoteHtml(root);
}

/** A new note's HTML from link text, with the Tag as its last line. */
export function noteHtmlFor(text = "", tag?: string): string {
  const html = htmlFromLines(text.split(/\r?\n/));
  return tag ? withTagLine(html, [tag]) : html;
}

export type SharedContent = { title?: string; text?: string; url?: string };

/** A shared title, text and link as note lines: title first, link last, nothing repeated. */
export function sharedNoteHtml({ title = "", text = "", url = "" }: SharedContent): string {
  const lines: string[] = [];
  const body = text.trim();
  if (title.trim() && !body.startsWith(title.trim())) lines.push(title.trim());
  if (body) lines.push(...body.split(/\r?\n/));
  if (url.trim() && !body.includes(url.trim())) lines.push(url.trim());
  return htmlFromLines(lines.length ? lines : [""]);
}
