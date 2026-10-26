import { describe, expect, it } from "vitest";
import { wordDiff } from "./diff";

describe("wordDiff", () => {
  it("marks words only in the old text as removed and only in the new text as added", () => {
    expect(wordDiff("take the bus daily", "take the train daily")).toEqual([
      { kind: "same", text: "take the " },
      { kind: "removed", text: "bus" },
      { kind: "added", text: "train" },
      { kind: "same", text: " daily" },
    ]);
  });

  it("handles Thai words split by spaces", () => {
    expect(wordDiff("แมว ดำ", "แมว ขาว")).toEqual([
      { kind: "same", text: "แมว " },
      { kind: "removed", text: "ดำ" },
      { kind: "added", text: "ขาว" },
    ]);
  });

  it("finds the changed word inside Thai text that has no spaces", () => {
    const parts = wordDiff("แมวสีดำนอนอยู่บนโซฟา", "แมวสีขาวนอนอยู่บนโซฟา");
    const removed = parts.filter((p) => p.kind === "removed").map((p) => p.text).join("");
    expect(removed).toContain("ดำ");
    expect(removed).not.toContain("แมว"); // not the whole line
  });

  it("copes with a huge note without running out of memory", () => {
    const words = Array.from({ length: 20000 }, (_, i) => `w${i}`).join(" ");
    const parts = wordDiff(words, words.replace("w10000 ", "changed ").replace("w15000 ", "edited "));
    expect(parts.map((p) => p.text).join("").length).toBeGreaterThan(0);
    expect(parts.some((p) => p.kind === "added" && p.text.includes("changed"))).toBe(true);
    expect(parts[0]).toMatchObject({ kind: "same" }); // the long shared start is kept as one piece
  });

  it("reports identical text as one unchanged part", () => {
    expect(wordDiff("a b", "a b")).toEqual([{ kind: "same", text: "a b" }]);
  });
});
