import changelogMd from "../CHANGELOG.md?raw";
import pkg from "../package.json";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES, actionNeeded, compareVersions, releasesSince, renderChangelogMd } from "./changelog";

describe("changelog", () => {
  it("lists Releases newest first, each with notes in both languages", () => {
    for (let i = 1; i < RELEASES.length; i++) expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBeGreaterThan(0);
    for (const r of RELEASES) {
      expect(r.notes.en.length).toBeGreaterThan(0);
      expect(r.notes.th.length).toBe(r.notes.en.length);
    }
  });

  it("matches package.json's version", () => {
    expect(pkg.version).toBe(APP_VERSION);
  });

  it("keeps CHANGELOG.md in step (run `npm run build` to regenerate it)", () => {
    expect(changelogMd).toBe(renderChangelogMd());
  });

  it("compares versions by number, not text", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0", "1.1")).toBe(0);
  });

  it("shows only Releases after the one last seen", () => {
    expect(releasesSince("1.0.0").map((r) => r.version)).toEqual(["1.1.0"]);
    expect(releasesSince(APP_VERSION)).toEqual([]);
    expect(releasesSince(null)).toHaveLength(RELEASES.length);
  });

  it("asks for the strongest step any skipped Release needs", () => {
    const r = (action: "none" | "reload" | "reinstall") => ({ ...RELEASES[0], action });
    expect(actionNeeded([r("none"), r("reload")])).toBe("reload");
    expect(actionNeeded([r("reload"), r("reinstall"), r("none")])).toBe("reinstall");
    expect(actionNeeded([r("none")])).toBe("none");
  });
});
