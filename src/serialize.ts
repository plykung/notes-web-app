// Turns the editor's DOM into the exact HTML the native Sticky Notes app writes
// (docs/note-html-format.md), so notes round-trip between the two apps.
import { noteText } from "./note";

export const NOTE_HEAD =
  '<html><head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>\r\n<!--\r\n' +
  "ul\r\n\t{list-style:none}\r\nhtml, body, div, span, h1, h2, h3, h4, h5, h6, p, ul, li\r\n" +
  "\t{margin:0;\r\n\tpadding:0;\r\n\tborder:0;\r\n\toutline:0;\r\n\tfont-size:100%;\r\n\tvertical-align:baseline}\r\n" +
  '-->\r\n</style></head><body id="NotesClientContent"><div>';
export const NOTE_TAIL = "</div></body></html>";

type Style = { b: boolean; i: boolean; u: boolean; s: boolean };
type Run = { text: string; style: Style };
type Line = { list: boolean; runs: Run[] };

const BLOCKS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);
const LISTS = new Set(["UL", "OL"]);

function styleOf(el: HTMLElement, parent: Style): Style {
  const tag = el.tagName;
  const css = el.getAttribute("style") ?? "";
  return {
    b: parent.b || tag === "B" || tag === "STRONG" || /font-weight:\s*(bold|[6-9]00)/.test(css),
    i: parent.i || tag === "I" || tag === "EM" || /font-style:\s*italic/.test(css),
    u: parent.u || tag === "U" || /text-decoration[^;]*underline/.test(css),
    s: parent.s || tag === "S" || tag === "STRIKE" || tag === "DEL" || /text-decoration[^;]*line-through/.test(css),
  };
}

// A <br> that ends its block is the browser's placeholder for an empty line, not a break.
function isTrailingBr(br: Node): boolean {
  for (let n = br.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType !== Node.TEXT_NODE || n.textContent) return false;
  }
  return true;
}

function collectLines(root: HTMLElement): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  const start = (list: boolean) => {
    current = { list, runs: [] };
    lines.push(current);
    return current;
  };

  const walk = (node: Node, style: Style, list: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) (current ?? start(list)).runs.push({ text, style });
      return;
    }
    // nodeType, not instanceof: pop-out windows have their own HTMLElement class.
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;

    if (tag === "BR") {
      if (!current) start(list);
      if (!isTrailingBr(node)) current = null;
      return;
    }
    if (LISTS.has(tag)) {
      current = null;
      for (const child of node.childNodes) walk(child, style, true);
      current = null;
      return;
    }
    if (BLOCKS.has(tag)) {
      const inList = list || tag === "LI";
      const hasBlockChild = [...el.children].some((c) => BLOCKS.has(c.tagName) || LISTS.has(c.tagName));
      current = null;
      if (!hasBlockChild) start(inList);
      for (const child of node.childNodes) walk(child, style, inList);
      current = null;
      return;
    }
    const inner = styleOf(el, style);
    for (const child of node.childNodes) walk(child, inner, list);
  };

  for (const child of root.childNodes) walk(child, { b: false, i: false, u: false, s: false }, false);
  return lines;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The PC app and onenote.com drop empty lines (<p></p>, <p><br></p>, <p>&nbsp;</p>)
 * and &nbsp; from notes written through Graph, and collapse repeated spaces.
 * A zero-width space survives (tested 2026-10-26), so a blank line holds one,
 * and one sits between repeated spaces. The app ignores it when reading.
 */
export const ZWSP = "​";
export const BLANK_LINE = `<p>${ZWSP}</p>`;

// Every space followed by another gets a zero-width space after it, so
// "a  b" stays two spaces wide; a leading space is protected the same way.
const keepSpaces = (text: string, lineStart: boolean) => {
  const kept = text.replace(/ (?= )/g, ` ${ZWSP}`);
  return lineStart && kept.startsWith(" ") ? ZWSP + kept : kept;
};

function runsHtml(runs: Run[]): string {
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    const same = last && (["b", "i", "u", "s"] as const).every((k) => last.style[k] === run.style[k]);
    if (same) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged
    .map(({ text, style }, i) => {
      const css: string[] = [];
      if (style.b) css.push("font-weight:bold");
      if (style.i) css.push("font-style:italic");
      const deco = [style.u && "underline", style.s && "line-through"].filter(Boolean);
      if (deco.length) css.push(`text-decoration:${deco.join(" ")}`);
      // Old zero-width spaces are dropped first, so saving again never piles them up.
      const safe = keepSpaces(escapeHtml(text.replaceAll(ZWSP, "").replace(/ /g, " ")), i === 0);
      return css.length ? `<span style="${css.join(";")}">${safe}</span>` : safe;
    })
    .join("");
}

/** The full note HTML, in the native app's shape, for the editor's content. */
export function toNoteHtml(root: HTMLElement): string {
  let html = "";
  let inList = false;
  for (const line of collectLines(root)) {
    if (line.list !== inList) {
      html += line.list ? '<ul style="padding:0px 20px">' : "</ul>";
      inList = line.list;
    }
    const content = runsHtml(line.runs);
    const p = content.replaceAll(ZWSP, "").trim() ? `<p>${content}</p>` : BLANK_LINE;
    html += line.list ? `<li style="list-style-type:disc">${p}</li>` : p;
  }
  if (inList) html += "</ul>";
  return NOTE_HEAD + html + NOTE_TAIL;
}

/**
 * Ends the note with a line of Tags (such as #pinned), two blank lines below
 * the text so it reads as a footer in the native app.
 */
export function withTagLine(html: string, tags: string[]): string {
  if (!tags.length) return html;
  const body = html.slice(0, -NOTE_TAIL.length).replace(/(<p>(&nbsp;|​)?<\/p>)+$/, "");
  return `${body}${BLANK_LINE}${BLANK_LINE}<p>${tags.map((t) => `#${t}`).join(" ")}</p>${NOTE_TAIL}`;
}

/** The note's title as Outlook shows it: its first non-empty line. */
export function firstLine(html: string): string {
  const line = noteText(html).split("\n").find((l) => l.trim()) ?? "";
  return line.trim().slice(0, 255);
}
