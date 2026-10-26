// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { noteHtmlFor, parseActionLink, savePending, sharedNoteHtml, takePending } from "./actions";
import { noteText } from "./note";

const url = (q: string) => new URL(`https://notes.example/${q}`);

describe("parseActionLink", () => {
  it("reads a new note with text, a Tag and a colour", () => {
    expect(parseActionLink(url("?action=new&text=buy%20milk&tag=shopping&color=Green"))).toEqual({
      kind: "new",
      text: "buy milk",
      tag: "shopping",
      color: "green",
    });
  });

  it("ignores values it doesn't accept instead of failing", () => {
    expect(parseActionLink(url("?action=new&tag=bad%20tag!&color=rainbow"))).toEqual({ kind: "new" });
  });

  it("reads latest and search", () => {
    expect(parseActionLink(url("?action=latest"))).toEqual({ kind: "latest" });
    expect(parseActionLink(url("?action=search&q=ร้านกาแฟ"))).toEqual({ kind: "search", q: "ร้านกาแฟ" });
  });

  it("accepts a Thai Tag", () => {
    expect(parseActionLink(url("?action=new&tag=งาน"))).toMatchObject({ tag: "งาน" });
  });

  it("knows nothing that changes or deletes notes", () => {
    for (const action of ["delete", "pin", "edit", "clear", ""]) {
      expect(parseActionLink(url(`?action=${action}&id=1`))).toBeNull();
    }
    expect(parseActionLink(url(""))).toBeNull();
  });

  it("caps very long text", () => {
    const parsed = parseActionLink(url(`?action=new&text=${"a".repeat(20000)}`));
    expect(parsed?.kind === "new" && parsed.text?.length).toBe(10000);
  });

  it("reads a share by its id", () => {
    expect(parseActionLink(url("?action=share&id=abc-123"))).toEqual({ kind: "share", id: "abc-123" });
    expect(parseActionLink(url("?action=share"))).toBeNull();
  });
});

// docs/adr/0006: these exact addresses are in shared shortcuts and must keep
// working. If one of these fails, the change broke installed shortcuts: fix the
// code, never these examples.
describe("published links (public contract)", () => {
  const published: [string, unknown][] = [
    ["/?action=new", { kind: "new" }],
    ["/?action=new&text=buy%20milk", { kind: "new", text: "buy milk" }],
    ["/?action=new&tag=shopping&color=green", { kind: "new", tag: "shopping", color: "green" }],
    ["/?action=latest", { kind: "latest" }],
    ["/?action=search", { kind: "search" }],
    ["/?action=search&q=coffee", { kind: "search", q: "coffee" }],
  ];
  for (const [address, meaning] of published) {
    it(`still understands ${address}`, () => {
      expect(parseActionLink(new URL(`https://notes.naphats.me${address}`))).toEqual(meaning);
    });
  }

  it("still opens the app for a link from a newer version, ignoring what it doesn't know", () => {
    expect(parseActionLink(new URL("https://notes.naphats.me/?action=new&text=hi&future=1"))).toEqual({ kind: "new", text: "hi" });
  });
});

describe("Pending Action", () => {
  beforeEach(() => sessionStorage.clear());

  it("is used once", () => {
    savePending({ kind: "latest" }, 1000);
    expect(takePending(2000)).toEqual({ kind: "latest" });
    expect(takePending(3000)).toBeNull();
  });

  it("expires after 10 minutes", () => {
    savePending({ kind: "new", text: "x" }, 0);
    expect(takePending(10 * 60 * 1000 + 1)).toBeNull();
  });
});

describe("note text from a link or a share", () => {
  it("puts the text in lines and the Tag on the last line", () => {
    expect(noteText(noteHtmlFor("buy milk\neggs", "shopping"))).toBe("buy milk\neggs\n\n\n#shopping");
  });

  it("starts a shared note with its title, then the text, then the link", () => {
    expect(noteText(sharedNoteHtml({ title: "A recipe", text: "Looks good", url: "https://example.com/r" }))).toBe(
      "A recipe\nLooks good\nhttps://example.com/r",
    );
  });

  it("doesn't repeat a link the text already contains, or a title that starts the text", () => {
    expect(noteText(sharedNoteHtml({ title: "Hello", text: "Hello there https://x.com", url: "https://x.com" }))).toBe(
      "Hello there https://x.com",
    );
  });
});
