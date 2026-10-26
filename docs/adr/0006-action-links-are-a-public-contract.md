# Action Links are a public contract: never rename or remove them

Action Links are baked into things this repo can't update once they're out:
- iCloud shortcut links (iPhone and iPad);
- Android app shortcuts on installed copies;
- the share target;
- the Shortcuts & Siri help page;
- users' own bookmarks, QR codes and shortcuts.

An iCloud shortcut keeps the exact address it was built with, and editing the original doesn't update links already shared. So a renamed parameter or a moved domain breaks every installed shortcut, silently.

## The contract

These addresses must keep working, with the same meaning:

| Address | Meaning |
|---|---|
| `https://notes.naphats.me/?action=new` | Open a blank new note |
| `…/?action=new&text=<text>&tag=<tag>&color=<colour>` | Open a new note pre-filled. Each parameter is optional. Colours: yellow, green, pink, purple, blue, gray, charcoal |
| `…/?action=latest` | Refresh, then open the Latest Note |
| `…/?action=search` and `…/?action=search&q=<words>` | Open search, optionally with the words filled in |
| `POST /share` (manifest `share_target`), then `…/?action=share&id=<id>` | A share from another app |

Rules:
- **Add, don't change.** A new action or parameter is fine. Never rename, repurpose or remove an existing one; keep accepting old names alongside any new ones.
- **Unknown or bad values are ignored, never errors.** A shortcut made for a later version must still open the app.
- **Links never save, delete or change a note by themselves** (GLOSSARY.md: Action Link).
- **Keep the domain.** `notes.naphats.me` is in every shared shortcut. If it ever has to change, keep the old domain serving the app, or redirecting with the query string intact, for as long as old shortcuts may exist.
- **The iCloud links on the help page** (the `ICLOUD_SHORTCUTS` list in `public/legal.js`, shown on `public/shortcuts.html`) point to shortcuts in the developer's iCloud. Editing one of those shortcuts means copying its new iCloud link into the page, because old links don't update.

`src/actions.test.ts` holds the published addresses as fixed examples, so a change that breaks one fails the tests.

## Considered Options

- **Versioned links (`?v=1&action=…`)**: rejected. It adds nothing while every change stays additive.
- **A custom URL scheme (`web+notes:`)**: rejected. It's only supported on desktop browsers and doesn't work in iOS Shortcuts.
