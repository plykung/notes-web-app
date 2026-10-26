// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { colorOf, extractTags, hideSystemTags, isPinned, noteColor, noteText, renderNoteBody, matchesFilter, type Note } from "./note";

const wrap = (inner: string) =>
  `<html><head><style>p{}</style></head><body id="NotesClientContent"><div>${inner}</div></body></html>`;

const note = (inner: string): Note => ({
  id: "1",
  etag: "e",
  title: "",
  html: wrap(inner),
  created: "2026-10-26T09:00:00Z",
  modified: "2026-10-26T09:00:00Z",
  hasAttachments: false,
});

describe("noteText", () => {
  it("joins paragraphs with newlines and ignores the style block", () => {
    expect(noteText(wrap("<p>one</p><p></p><p>two</p>"))).toBe("one\n\ntwo");
  });

  it("reads list items as lines", () => {
    expect(noteText(wrap('<ul><li><p>a</p></li><li><p>b</p></li></ul>'))).toBe("a\nb");
  });
});

describe("extractTags", () => {
  it("finds tags anywhere in the text", () => {
    expect(extractTags("buy milk #home\n#work today")).toEqual(["home", "work"]);
  });

  it("keeps Thai tags whole, including combining vowel and tone marks", () => {
    expect(extractTags("ประชุม #งาน และ #ผู้จัดการ")).toEqual(["งาน", "ผู้จัดการ"]);
  });

  it("allows underscores, hyphens and digits", () => {
    expect(extractTags("#side_project #from-keep #2026")).toEqual(["side_project", "from-keep", "2026"]);
  });

  it("ignores # inside words and URLs", () => {
    expect(extractTags("C# and https://x.com/page#anchor and a#b")).toEqual([]);
  });

  it("returns each tag once, case-insensitively, keeping the first spelling", () => {
    expect(extractTags("#Work #work #WORK")).toEqual(["Work"]);
  });
});

describe("renderNoteBody", () => {
  it("maps the native formatting spans to semantic elements", () => {
    const el = renderNoteBody(
      wrap(
        '<p><span style="font-weight:bold">b</span><span style="font-style:italic">i</span>' +
          '<span style="text-decoration:underline">u</span><span style="text-decoration:line-through">s</span></p>',
      ),
    );
    expect(el.innerHTML).toBe("<p><strong>b</strong><em>i</em><u>u</u><s>s</s></p>");
  });

  it("keeps bullet lists", () => {
    const el = renderNoteBody(wrap('<ul style="padding:0px 20px"><li style="list-style-type:disc"><p>1</p></li></ul>'));
    expect(el.innerHTML).toBe("<ul><li><p>1</p></li></ul>");
  });

  it("drops scripts, event handlers and unknown elements but keeps their text", () => {
    const el = renderNoteBody(
      wrap('<p onclick="x()">hi<script>alert(1)</script><img src=x onerror="y()"><a href="javascript:z()">link</a></p>'),
    );
    expect(el.innerHTML).toBe("<p>hilink</p>");
  });
});

describe("colour Tags", () => {
  it("takes the first colour Tag, case-insensitively, and defaults to yellow", () => {
    expect(noteColor("milk #home #Pink #blue")).toBe("pink");
    expect(noteColor("no colour #home")).toBe("yellow");
    expect(noteColor("#pinkish is not a colour")).toBe("yellow");
  });

  it("hides colour Tags and #pinned, with the blank lines written above them", () => {
    const el = renderNoteBody(wrap("<p>buy milk #pink</p><p>#home</p><p></p><p></p><p>#pinned</p>"));
    hideSystemTags(el);
    expect(el.innerHTML).toBe("<p>buy milk</p><p>#home</p>");
  });

  it("hides #pinned and the zero-width blank lines the app writes above it", () => {
    const el = renderNoteBody(wrap("<p>todo</p><p>​</p><p>​</p><p>#pinned</p>"));
    hideSystemTags(el);
    expect(el.innerHTML).toBe("<p>todo</p>");
  });

  it("ignores zero-width spaces when reading text, so search and Tags still match", () => {
    expect(noteText(wrap("<p>a ​ b #work</p><p>​</p><p>c</p>"))).toBe("a  b #work\n\nc");
  });

  it("keeps a note's own blank lines when nothing was hidden", () => {
    const el = renderNoteBody(wrap("<p>a</p><p></p>"));
    hideSystemTags(el);
    expect(el.innerHTML).toBe("<p>a</p><p></p>");
  });

  it("prefers the hidden colour field over a colour Tag", () => {
    expect(colorOf({ ...note("<p>#pink</p>"), color: "blue" })).toBe("blue");
    expect(colorOf(note("<p>#pink</p>"))).toBe("pink");
  });

  it("knows a pinned note", () => {
    expect(isPinned("todo\n\n\n#pinned")).toBe(true);
    expect(isPinned("#pinnedish")).toBe(false);
  });
});

describe("matchesFilter", () => {
  const n = note("<p>Buy coffee #shop</p><p>ร้านกาแฟ #งาน</p>");

  it("matches search text case-insensitively", () => {
    expect(matchesFilter(n, "COFFEE", [])).toBe(true);
    expect(matchesFilter(n, "ร้านกาแฟ", [])).toBe(true);
    expect(matchesFilter(n, "tea", [])).toBe(false);
  });

  it("requires every selected tag", () => {
    expect(matchesFilter(n, "", ["shop", "งาน"])).toBe(true);
    expect(matchesFilter(n, "", ["shop", "home"])).toBe(false);
  });
});
