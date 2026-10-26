# Handoff: Sticky-notes-style desktop notes app with an API (proof of concept)

Written for a fresh agent running inside VS Code on the user's own computer.
Date of research: 2026-10-26. Nothing here has been run or tested yet; it is all desk research.

## 1. What the user wants

The user (likely on Windows, since they compare against Microsoft Sticky Notes; confirm this) wants notes that behave like Microsoft Sticky Notes: standalone desktop windows on the PC, ideally always on top. They first asked for this with Google Keep, then asked for alternatives that have a **developer API**. They also want to **migrate existing Microsoft Sticky Notes** into whichever tool wins, and probably their Google Keep notes too.

The user now wants to **build a proof of concept (PoC)** in VS Code. The exact PoC scope was NOT confirmed. See section 6.

## 2. Findings so far

### Google Keep
- No official desktop app. The Chrome app was retired in 2021. Options are a Chrome/Edge PWA ("Install app"), `chrome.exe --app=https://keep.google.com`, or wrappers (Rambox, Franz, Wavebox, small Electron projects). None gives per-note floating windows.
- Official Keep API exists: https://developers.google.com/workspace/keep and https://developers.google.com/keep/api/reference/rest
  - Methods: notes.create / get / list / delete, media.download, notes.permissions.batchCreate / batchDelete. No update method seen.
  - Workspace-only: needs a managed Workspace domain, a service account with domain-wide delegation, and an admin-approved scope `https://www.googleapis.com/auth/keep`. Effectively unusable for a personal @gmail.com account.
- Unofficial: `gkeepapi` (Python, reverse-engineered, not endorsed by Google, can break). Used by keepcli and various Markdown exporters.
- Keep data export: Google Takeout (select Keep only).

### Microsoft Sticky Notes
- Local store: `%UserProfile%\AppData\Local\Packages\Microsoft.MicrosoftStickyNotes_8wekyb3d8bbwe\LocalState\plum.sqlite`. No native export in the app.
- Third-party extractors: Primus-Izzy/Sticky-Note-Organizer (GitHub / PyPI `sticky-note-organizer`; exports CSV/JSON/Excel/Markdown), and a SQL-to-Markdown recipe on the Obsidian forum (https://forum.obsidian.md/t/liberating-and-importing-microsoft-windows-sticky-notes/30564). Both are community tools; spot-check output.
- Synced notes live in the user's Exchange / Outlook.com mailbox. Microsoft's own export route is via Outlook export: https://support.microsoft.com/en-US/Windows/Apps/StickyNotes/export-your-sticky-notes
- **Official Graph API now exists (corrects an earlier wrong claim in the conversation).** Microsoft Learn v1.0 "List notes": https://learn.microsoft.com/en-us/graph/api/user-list-notes?view=graph-rest-1.0
  - `GET /me/notes` and `GET /users/{id|upn}/notes`
  - Delegated permissions only: `ShortNotes.Read` / `ShortNotes.ReadWrite` (work/school and personal accounts). Application permissions are listed as "Not supported" there.
  - Docs example only shows id, subject, bodyPreview, lastModifiedDateTime. Not yet checked: the `note` resource page (https://learn.microsoft.com/en-us/graph/api/resources/note?view=graph-rest-1.0) for color/position/body fields.
- Related article reviewed: https://glenscales.substack.com/p/migrating-sticky-notes-in-ews-to (March 2026). Useful background (notes are Exchange items of class `IPM.StickyNote` in a `IPF.StickyNote` folder; extended MAPI props from MS-OXONOTE; the Messages endpoint `/me/mailFolders/notes/messages` also works but is not documented for this). Its claim that `/beta/me/notes` is undocumented is now outdated. Its property IDs are wrong or swapped: per Microsoft's reference, PidLidNoteWidth = `0x8B02`, PidLidNoteHeight = `0x8B03` (PSETID_Note `{0006200E-0000-0000-C000-000000000046}`). Verify X/Y (`0x8B04`/`0x8B05`) and color mapping against MS-OXONOTE before using them.

### Alternatives evaluated
| Option | Sticky-style windows | API | Migration in | Notes |
|---|---|---|---|---|
| **Obsidian** | Via community plugins: "Desktop Stickies" (always-on-top floating notes saved as Markdown), also Just Note, Floating Notes, Synaptic Hatch | Official plugin API (TypeScript); community "Local REST API" plugin; plain `.md` files on disk | Official **Importer** plugin reads Google Keep Takeout zip (reminders not imported, checklist indentation lost) | Plugins are young community projects; always-on-top relies on Electron internals that may break |
| **Joplin** | Not confirmed | Built-in Data API, REST on `http://localhost:41184`, token from Web Clipper settings; JS wrapper `joplin-api` (npm) | Can POST notes through the API | Best-documented API; weakest sticky UI |
| **Notezilla** (paid, Windows) | Yes, pin-on-top native sticky notes, phone sync | Unverified (only a third-party directory claims API access) | CSV / tab-delimited import | Closest to MS Sticky Notes itself |

## 3. Decisions and leanings so far
- Leading candidate: **Obsidian + Desktop Stickies + Local REST API**, because it gives sticky windows, Markdown files any script can read, and a Keep importer.
- Fallback if API quality matters more than look: **Joplin**.
- Not yet chosen by the user. Ask before locking in.

## 4. Open questions for the user
1. Confirm OS (assumed Windows 10/11).
2. Which PoC do they want first (see section 6)?
3. Do they use a personal Microsoft account or a work/school one for Sticky Notes sync? This affects Graph app registration and consent.
4. Personal Gmail or Workspace for Keep? (Determines whether the official Keep API is even an option; assume personal.)
5. Preferred language (Python vs Node/TypeScript).

## 5. Constraints and cautions
- Never commit tokens, client secrets, Joplin tokens or Takeout data. Use environment variables or an untracked `.env`.
- Treat all exports as personal data; keep them out of the repo.
- Microsoft Graph requires an Entra app registration (delegated flow, device code or interactive login suits a local CLI). Personal accounts are supported for `ShortNotes.*` per the docs, but test this.
- Back up `plum.sqlite` before touching it; read it with a copy.
- Obsidian sticky plugins need Obsidian 1.8.7+ (Desktop Stickies) and are desktop-only.

## 6. Suggested PoC scope (propose, then confirm with the user)
**PoC 1 (recommended first): Sticky Notes to Markdown exporter.**
1. Primary path: small CLI that authenticates to Microsoft Graph (delegated), calls `GET /me/notes` with paging (`$top`, `@odata.nextLink`), fetches body content, and writes one `.md` file per note into an Obsidian vault folder. Include created/modified dates in front matter. Handle attachments if the API exposes them.
2. Fallback path: read a *copy* of `plum.sqlite` directly (or via Sticky-Note-Organizer's JSON export) and write the same Markdown output, for users with unsynced local notes.
3. Verification: compare note counts between Sticky Notes, the export and the vault; spot-check Unicode (Thai text is likely) and checklists.

**PoC 2: Keep import.** Use Google Takeout plus the Obsidian Importer plugin (manual, no code needed). Document what is lost (reminders, checklist indent).

**PoC 3: Sticky look and API access.** Install Obsidian Desktop Stickies, confirm always-on-top windows open from migrated notes, then install Local REST API and write a tiny script that creates a note over HTTP and shows it as a sticky.

**Stretch:** a minimal Joplin Data API variant of PoC 1 for comparison.

Success criteria: a user can run one command, see their synced Sticky Notes appear as Markdown files in an Obsidian vault, and open one as a floating always-on-top sticky.

## 7. Suggested skills for the next agent
Use these if they exist in the target environment (they were available in the originating session and may not be in VS Code):
- `prototype` for throwaway PoC building and sanity checks.
- `tdd` for the exporter's parsing and file-writing logic.
- `research` to verify the `note` resource schema and Graph auth details against primary Microsoft docs and capture findings in a Markdown file.
- `diagnosing-bugs` if Graph auth, paging or SQLite parsing misbehave.
- `to-spec` / `to-tickets` only if the user wants this turned into tracked work after the PoC.

## 8. Key links
- Google Keep API: https://developers.google.com/workspace/keep
- Graph List notes (v1.0): https://learn.microsoft.com/en-us/graph/api/user-list-notes?view=graph-rest-1.0
- Graph note resource: https://learn.microsoft.com/en-us/graph/api/resources/note?view=graph-rest-1.0
- MS Sticky Notes export help: https://support.microsoft.com/en-US/Windows/Apps/StickyNotes/export-your-sticky-notes
- Sticky Note Organizer: https://github.com/Primus-Izzy/Sticky-Note-Organizer
- Obsidian Keep import: https://help.obsidian.md/import/google-keep
- Obsidian Desktop Stickies: https://community.obsidian.md/plugins/desktop-stickies
- Joplin Data API: https://joplinapp.org/help/api/references/rest_api/
- gkeepapi (unofficial Keep): https://github.com/jkitching/gkeepapi (fork of kiwiz/gkeepapi)
- Glen Scales article (reviewed, partly outdated): https://glenscales.substack.com/p/migrating-sticky-notes-in-ews-to
