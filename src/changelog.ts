// The changelog: one entry per Release (GLOSSARY.md), newest first. It drives
// the What's New pop-up and the update toasts (src/updates.ts), and
// CHANGELOG.md is generated from it at build time (vite.config.ts), so the two
// never disagree.
//
// To publish a Release: add an entry at the top, set package.json "version" to
// the same number (a test checks), and pick the action users need to take.
// Deploys without a new entry are silent fixes: no toast, no pop-up.

/** What a user has to do to get a Release. */
export type ReleaseAction =
  /** Nothing: it loads next time the app opens. */
  | "none"
  /** Close and reopen the app (for example, a change to how notes are stored). */
  | "reload"
  /** Remove and re-add the app, for new shortcuts or icons. */
  | "reinstall";

export type Release = {
  version: string;
  date: string;
  action: ReleaseAction;
  notes: { en: string[]; th: string[] };
};

export const RELEASES: Release[] = [
  {
    version: "1.1.0",
    date: "2026-10-26",
    action: "reinstall",
    notes: {
      en: [
        "Android: long-press the Notes icon for New note, Latest note and Search.",
        "Share text, links and photos from other apps into a new note (Android, and Chrome on Windows).",
        "iPhone and iPad: a Shortcuts & Siri page with links for Siri, the Action Button and Back Tap.",
        "When your sign-in expires, Notes asks you to sign in again instead of leaving the page, so nothing you're typing is lost.",
        "Changes are sent as soon as you leave the app, not on the next open.",
        "Each message at the bottom of the screen now has an icon.",
        "This What's New pop-up.",
      ],
      th: [
        "Android: กดค้างที่ไอคอนแอปโน้ตเพื่อเปิด โน้ตใหม่ โน้ตล่าสุด และค้นหา",
        "แชร์ข้อความ ลิงก์ และรูปภาพจากแอปอื่นมาเป็นโน้ตใหม่ (Android และ Chrome บน Windows)",
        "iPhone และ iPad: หน้า ทางลัดและ Siri พร้อมลิงก์สำหรับ Siri ปุ่ม Action และการแตะด้านหลัง",
        "เมื่อการลงชื่อเข้าใช้หมดอายุ แอปจะขอให้ลงชื่อเข้าใช้ใหม่แทนการออกจากหน้า สิ่งที่คุณกำลังพิมพ์จึงไม่หาย",
        "การเปลี่ยนแปลงจะถูกส่งทันทีเมื่อคุณออกจากแอป ไม่ต้องรอเปิดครั้งถัดไป",
        "ข้อความแจ้งเตือนด้านล่างหน้าจอมีไอคอนแล้ว",
        "หน้าต่าง มีอะไรใหม่ นี้",
      ],
    },
  },
  {
    version: "1.0.0",
    date: "2026-10-26",
    action: "none",
    notes: {
      en: [
        "Your Microsoft Sticky Notes on PC, iPad and phone, even offline.",
        "Search, Tags, colours, pinning, images, pop-out windows on the PC, and a compare screen for conflicts.",
        "English and Thai, light and dark.",
      ],
      th: [
        "Microsoft Sticky Notes ของคุณบน PC, iPad และโทรศัพท์ แม้ออฟไลน์",
        "ค้นหา แท็ก สี ปักหมุด รูปภาพ หน้าต่างแยกบน PC และหน้าเปรียบเทียบเมื่อมีการแก้ไขชนกัน",
        "ภาษาไทยและอังกฤษ ธีมสว่างและมืด",
      ],
    },
  },
];

/** The version this build is. */
export const APP_VERSION = RELEASES[0].version;

/** Compares "1.10.0" and "1.9.2" by number: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Releases newer than `seen`, newest first (all of them when `seen` is null). */
export const releasesSince = (seen: string | null) =>
  RELEASES.filter((r) => seen === null || compareVersions(r.version, seen) > 0);

/** The strongest step any of these Releases needs. */
export function actionNeeded(releases: Release[]): ReleaseAction {
  if (releases.some((r) => r.action === "reinstall")) return "reinstall";
  if (releases.some((r) => r.action === "reload")) return "reload";
  return "none";
}

/** CHANGELOG.md for GitHub readers (English, then Thai), generated from RELEASES. */
export function renderChangelogMd(releases = RELEASES): string {
  const steps: Record<ReleaseAction, string> = {
    none: "",
    reload: "\n_To get it: close and reopen Notes._\n",
    reinstall: "\n_To get the new shortcuts or icons: remove Notes from your home screen and install it again._\n",
  };
  const lines = [
    "# Changelog",
    "",
    "<!-- Generated from src/changelog.ts at build time. Edit that file, not this one. -->",
    "",
  ];
  for (const r of releases) {
    lines.push(`## ${r.version} (${r.date})`, "", ...r.notes.en.map((n) => `- ${n}`), steps[r.action]);
    lines.push("<details><summary>ภาษาไทย</summary>", "", ...r.notes.th.map((n) => `- ${n}`), "", "</details>", "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
