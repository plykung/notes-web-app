// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "./note";

class OfflineError extends Error {}
class SignInNeededError extends Error {}
const graph = {
  createNote: vi.fn(),
  createNoteOnce: vi.fn(),
  deleteNote: vi.fn(),
  listNotes: vi.fn(),
  replaceNote: vi.fn(),
  setNoteColor: vi.fn(),
  startChangeTracking: vi.fn(),
  changesSince: vi.fn(),
};

vi.mock("./auth", () => ({ OfflineError, SignInNeededError }));
vi.mock("./graph", () => ({
  ...graph,
  NO_IMAGE_CHANGES: { removed: [], added: [] },
  ConflictError: class extends Error {},
  GraphError: class extends Error {},
}));
vi.mock("./images", () => ({
  noteImages: vi.fn(async () => []),
  setLocalImages: vi.fn(async () => {}),
  forgetImages: vi.fn(async () => {}),
  pruneImages: vi.fn(async () => {}),
  prefetchImages: vi.fn(),
}));
const stored = new Map<string, unknown>();
vi.mock("./store", () => ({
  getItem: async (k: string) => stored.get(k),
  setItem: async (k: string, v: unknown) => void stored.set(k, structuredClone(v)),
}));

const note = (id: string, text: string): Note => ({
  id,
  etag: `etag-${id}`,
  title: text,
  html: `<html><body id="NotesClientContent"><div><p>${text}</p></div></body></html>`,
  created: "2022-01-16T09:00:00Z",
  modified: "2026-10-26T09:00:00Z",
  hasAttachments: false,
});
const html = (text: string) => note("x", text).html;
const noImages = { removed: [], added: [] };

let sync: typeof import("./sync");
const ui = { chooseConflict: vi.fn(), failed: vi.fn(async () => {}), changed: vi.fn() };

async function start(serverNotes: Note[]) {
  stored.clear();
  stored.set("snapshot", serverNotes);
  vi.resetModules();
  for (const fn of Object.values(graph)) fn.mockReset();
  graph.listNotes.mockResolvedValue(serverNotes);
  graph.startChangeTracking.mockResolvedValue("delta-1");
  sync = await import("./sync");
  await sync.initSync(ui);
}

// Queueing kicks off a sync; keep Microsoft unreachable unless a test says otherwise.
const offline = () => {
  for (const fn of Object.values(graph)) fn.mockRejectedValue(new OfflineError());
};
const online = (serverNotes: Note[]) => {
  graph.listNotes.mockResolvedValue(serverNotes);
  graph.startChangeTracking.mockResolvedValue("delta-1");
};

describe("offline queue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a new note straight away and marks it not synced", async () => {
    await start([]);
    offline();
    await sync.queueCreate(html("hello"), noImages);
    const [shown] = sync.localNotes();
    expect(shown.title).toBe("hello");
    expect(shown.id).toMatch(/^local-/);
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    expect(sync.noteState(shown.id)).toBe("queued");
    expect(stored.get("outbox")).toHaveLength(1); // survives closing the app
  });

  it("folds an edit of an unsent new note into the create", async () => {
    await start([]);
    offline();
    await sync.queueCreate(html("first"), noImages);
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    await sync.queueEdit(sync.localNotes()[0], { html: html("second") });
    expect(sync.status().waiting).toBe(1);
    expect(sync.localNotes()[0].title).toBe("second");
  });

  it("folds repeated edits of the same note into one replacement", async () => {
    await start([note("a", "original")]);
    offline();
    await sync.queueEdit(sync.localNotes()[0], { html: html("v1") });
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    await sync.queueEdit(sync.localNotes()[0], { html: html("v2") });
    expect(sync.status().waiting).toBe(1);
    expect(sync.localNotes()[0].title).toBe("v2");
  });

  it("hides a deleted note, and undo before syncing brings it back", async () => {
    await start([note("a", "keep me")]);
    offline();
    const undo = await sync.queueDelete(sync.localNotes()[0]);
    expect(sync.localNotes()).toHaveLength(0);
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    expect(await sync.undoDelete(undo)).toBeNull();
    expect(sync.localNotes().map((n) => n.title)).toEqual(["keep me"]);
    expect(sync.status().waiting).toBe(0);
  });

  it("undo brings back a deleted new note that never synced", async () => {
    await start([]);
    offline();
    await sync.queueCreate(html("draft"), noImages);
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    const undo = await sync.queueDelete(sync.localNotes()[0]);
    expect(sync.localNotes()).toHaveLength(0);
    await sync.undoDelete(undo);
    expect(sync.localNotes().map((n) => n.title)).toEqual(["draft"]);
  });
});

describe("syncing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the change queued when Microsoft can't be reached", async () => {
    await start([note("a", "x")]);
    offline();
    await sync.queueEdit(sync.localNotes()[0], { html: html("y") });
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    expect(sync.status()).toMatchObject({ offline: true, waiting: 1 });
    expect(ui.failed).not.toHaveBeenCalled();
  });

  it("keeps changes queued and asks for sign-in when the login has expired", async () => {
    await start([note("a", "x")]);
    offline();
    graph.replaceNote.mockRejectedValue(new SignInNeededError());
    await sync.queueEdit(note("a", "x"), { html: html("y") });
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    expect(sync.status()).toMatchObject({ needsSignIn: true, waiting: 1 });
    expect(ui.failed).not.toHaveBeenCalled(); // nothing is lost or reported as refused
  });

  it("sends queued changes in order once online, then reloads", async () => {
    await start([note("a", "x")]);
    offline();
    await sync.queueCreate(html("new"), noImages);
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    await sync.queueEdit(note("a", "x"), { html: html("edited") });
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));

    const calls: string[] = [];
    graph.createNoteOnce.mockImplementation(async () => (calls.push("create"), note("b", "new")));
    graph.replaceNote.mockImplementation(async () => (calls.push("replace"), note("c", "edited")));
    online([note("b", "new"), note("c", "edited")]);
    await sync.sync();

    expect(calls).toEqual(["create", "replace"]);
    expect(sync.status()).toMatchObject({ offline: false, waiting: 0 });
    expect(sync.localNotes().map((n) => n.id).sort()).toEqual(["b", "c"]);
  });

  it("points a later change at the new id the note got from an earlier one", async () => {
    await start([note("a", "x")]);
    offline();
    await sync.queueEdit(note("a", "x"), { html: html("v1") });
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));

    // While v1 is being sent, the user edits again: that can't fold into the sending change.
    let finishV1!: (n: Note) => void;
    graph.replaceNote.mockReset();
    graph.replaceNote.mockImplementationOnce(() => new Promise((resolve) => (finishV1 = resolve)));
    const running = sync.sync();
    await vi.waitFor(() => expect(sync.status().syncing).toBe(true));
    await sync.queueEdit(sync.localNotes()[0], { html: html("v2") });
    graph.replaceNote.mockResolvedValueOnce(note("c", "v2"));
    online([note("c", "v2")]);
    finishV1(note("b", "v1"));
    await running;

    expect(graph.replaceNote).toHaveBeenCalledTimes(2);
    expect(graph.replaceNote.mock.calls[1][0].id).toBe("b");
  });

  it("drops a refused change and lets the user decide", async () => {
    await start([note("a", "x")]);
    offline();
    await sync.queueEdit(note("a", "x"), { html: html("y") });
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    graph.replaceNote.mockRejectedValue(new Error("refused"));
    online([note("a", "x")]);
    await sync.sync();
    expect(ui.failed).toHaveBeenCalledWith(expect.objectContaining({ kind: "edit" }), expect.any(Error));
    expect(sync.status().waiting).toBe(0);
  });

  it("keeps a deleted note gone even if Microsoft's change list hasn't caught up yet", async () => {
    await start([note("a", "pinned one"), note("b", "other")]);
    online([note("a", "pinned one"), note("b", "other")]);
    await sync.sync(); // first full download sets up change tracking
    graph.deleteNote.mockResolvedValue("moved-a");
    graph.changesSince.mockResolvedValue({ changed: [], removed: [], nextLink: "delta-2" }); // lagging
    await sync.queueDelete(sync.localNotes().find((n) => n.id === "a")!);
    await vi.waitFor(() => expect(sync.status()).toMatchObject({ syncing: false, waiting: 0 }));
    expect(sync.localNotes().map((n) => n.id)).toEqual(["b"]);
  });

  it("drops a note Microsoft says no longer exists, so a stale copy can't linger", async () => {
    const { ConflictError } = await import("./graph");
    await start([note("ghost", "pinned ghost"), note("b", "other")]);
    online([note("ghost", "pinned ghost"), note("b", "other")]);
    await sync.sync(); // change tracking set up; from here on only changes arrive
    // The ghost was created and deleted between two checks, so the change list never mentions it.
    graph.changesSince.mockResolvedValue({ changed: [], removed: [], nextLink: "delta-2" });
    graph.replaceNote.mockRejectedValue(new ConflictError(null)); // deleted on Microsoft's side
    ui.chooseConflict.mockResolvedValue("saved"); // "Leave it deleted"
    await sync.queueEdit(sync.localNotes().find((n) => n.id === "ghost")!, { html: html("unpinned") });
    await vi.waitFor(() => expect(sync.status()).toMatchObject({ syncing: false, waiting: 0 }));
    expect(sync.localNotes().map((n) => n.id)).toEqual(["b"]);
  });

  it("changes only the colour in place, without replacing the note", async () => {
    await start([note("a", "x")]);
    offline();
    await sync.queueEdit(note("a", "x"), { color: "pink" });
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    expect(sync.localNotes()[0].color).toBe("pink");

    graph.setNoteColor.mockResolvedValue(undefined);
    graph.replaceNote.mockReset();
    online([{ ...note("a", "x"), color: "pink" }]);
    await sync.sync();
    expect(graph.setNoteColor).toHaveBeenCalledWith("a", "pink");
    expect(graph.replaceNote).not.toHaveBeenCalled();
  });

  it("carries a colour change into a text edit of the same note", async () => {
    await start([note("a", "x")]);
    offline();
    await sync.queueEdit(note("a", "x"), { color: "blue" });
    await vi.waitFor(() => expect(sync.status().syncing).toBe(false));
    await sync.queueEdit(sync.localNotes()[0], { html: html("y") });
    expect(sync.status().waiting).toBe(1);
    expect(sync.localNotes()[0]).toMatchObject({ title: "y", color: "blue" });
  });

  it("waits for a quiet moment before sending edits typed in an open editor", async () => {
    vi.useFakeTimers();
    try {
      await start([note("a", "x")]);
      online([note("a", "x")]);
      graph.replaceNote.mockResolvedValue(note("b", "y"));
      await sync.queueEdit(note("a", "x"), { html: html("y") }, { later: true });
      expect(graph.replaceNote).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(graph.replaceNote).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("after the first full download, fetches only what changed", async () => {
    await start([note("a", "x"), note("b", "y")]);
    online([note("a", "x"), note("b", "y")]);
    await sync.sync();
    expect(graph.listNotes).toHaveBeenCalledTimes(1);

    graph.changesSince.mockResolvedValue({ changed: [note("c", "new on PC")], removed: ["b"], nextLink: "delta-2" });
    await sync.sync();
    expect(graph.listNotes).toHaveBeenCalledTimes(1);
    expect(graph.changesSince).toHaveBeenCalledWith("delta-1", expect.any(Function));
    expect(sync.localNotes().map((n) => n.id).sort()).toEqual(["a", "c"]);
    expect(stored.get("deltaLink")).toBe("delta-2");
  });
});
