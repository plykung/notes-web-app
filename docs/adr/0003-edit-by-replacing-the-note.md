# Editing a note replaces it with a new note

When the Notes Web App saves an edit, it creates a new note with the new content and **permanently deletes** the old one. It never `PATCH`es a note's body. A deliberate delete still moves the note to Deleted Items.

For notes the native Sticky Notes app created, a body `PATCH` returns 200 but is ignored by the native app, onenote.com/stickynotes and Outlook on the web, and the next native edit overwrites it (see `docs/note-html-format.md`). The native app keeps the real content where Graph can't reach it. Notes created through Graph do sync to every Microsoft app, so replacing is the only editing path that rests on observed behaviour.

## Considered Options

- **Read-only for existing notes, create-only**: rejected. It's safe, but you can't fix a note on the iPad.
- **Find and write the native app's hidden content field**: rejected for now. It's undocumented, and it may not be reachable through Graph at all.

## Consequences

- Every save changes the note's id and resets its created date.
- On the PC, an open sticky window for that note closes, and the new note opens at the default position and size.
- Before replacing, the app re-reads the old note's etag. If it changed, the user gets the conflict compare screen (keep mine / keep theirs / keep both).
- If the create succeeds but the delete fails, a duplicate exists. The app must show the error and offer a retry, never hide it.
- Old versions are deleted permanently, not moved to Deleted Items, so copies of personal notes don't pile up there.
