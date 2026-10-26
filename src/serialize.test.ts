// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { BLANK_LINE, NOTE_HEAD, NOTE_TAIL, ZWSP, firstLine, toNoteHtml, withTagLine } from "./serialize";
import { renderNoteBody } from "./note";

const editor = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};
const inner = (html: string) => {
  expect(html.startsWith(NOTE_HEAD) && html.endsWith(NOTE_TAIL)).toBe(true);
  return html.slice(NOTE_HEAD.length, -NOTE_TAIL.length);
};

describe("toNoteHtml", () => {
  it("round-trips the native formatting sample, writing its blank line so the PC app keeps it", () => {
    const native =
      '<p>one <span style="font-weight:bold">bold </span>word</p><p>one <span style="font-style:italic">italic </span>word</p>' +
      '<p>one <span style="text-decoration:underline">underlined </span>word</p>' +
      '<p>one <span style="text-decoration:line-through">struck </span>word</p><p></p>' +
      '<ul style="padding:0px 20px"><li style="list-style-type:disc"><p>1</p></li><li style="list-style-type:disc"><p>2</p></li></ul>';
    const rendered = renderNoteBody(NOTE_HEAD + native + NOTE_TAIL);
    expect(inner(toNoteHtml(rendered))).toBe(native.replace("<p></p>", BLANK_LINE));
  });

  it("turns browser editing markup (div, br, b, i) into native paragraphs and spans", () => {
    expect(inner(toNoteHtml(editor("first<div><b>bold</b> <i>it</i></div><div><br></div><div>last</div>")))).toBe(
      '<p>first</p><p><span style="font-weight:bold">bold</span> <span style="font-style:italic">it</span></p>' + BLANK_LINE + '<p>last</p>',
    );
  });

  it("splits lines on <br> inside a block", () => {
    expect(inner(toNoteHtml(editor("<p>a<br>b<br><br>c</p>")))).toBe(`<p>a</p><p>b</p>${BLANK_LINE}<p>c</p>`);
  });

  it("keeps repeated and leading spaces with zero-width spaces between them", () => {
    const Z = ZWSP;
    expect(inner(toNoteHtml(editor("<p>  indented   gap</p>")))).toBe(`<p>${Z} ${Z} indented ${Z} ${Z} gap</p>`);
  });

  it("saving again doesn't pile up zero-width spaces", () => {
    const once = toNoteHtml(editor("<p>a  b</p><p></p>"));
    expect(toNoteHtml(renderNoteBody(once))).toBe(once);
  });

  it("combines overlapping styles into one span", () => {
    expect(inner(toNoteHtml(editor("<p><b><i><u><s>x</s></u></i></b></p>")))).toBe(
      '<p><span style="font-weight:bold;font-style:italic;text-decoration:underline line-through">x</span></p>',
    );
  });

  it("writes plain browser lists in the native list shape", () => {
    expect(inner(toNoteHtml(editor("<ul><li>a</li><li>b</li></ul><div>after</div>")))).toBe(
      '<ul style="padding:0px 20px"><li style="list-style-type:disc"><p>a</p></li>' +
        '<li style="list-style-type:disc"><p>b</p></li></ul><p>after</p>',
    );
  });

  it("escapes text so typed markup stays text", () => {
    expect(inner(toNoteHtml(editor("<p>a &lt;b&gt; &amp; c</p>")))).toBe("<p>a &lt;b&gt; &amp; c</p>");
  });
});

describe("withTagLine", () => {
  it("adds the Tags as a last line, two blank lines below the text", () => {
    const html = NOTE_HEAD + "<p>todo</p><p></p>" + NOTE_TAIL;
    expect(inner(withTagLine(html, ["pinned"]))).toBe(`<p>todo</p>${BLANK_LINE}${BLANK_LINE}<p>#pinned</p>`);
  });

  it("leaves the note alone when there are no Tags", () => {
    const html = NOTE_HEAD + "<p>todo</p>" + NOTE_TAIL;
    expect(withTagLine(html, [])).toBe(html);
  });
});

describe("firstLine", () => {
  it("is the first non-empty line, trimmed", () => {
    expect(firstLine(NOTE_HEAD + "<p></p><p>  shopping list </p><p>x</p>" + NOTE_TAIL)).toBe("shopping list");
  });
});
