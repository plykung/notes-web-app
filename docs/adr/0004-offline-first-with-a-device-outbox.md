# Offline-first: notes and queued changes live on the device

The Notes Web App keeps the last notes it loaded, their images and every Queued Change in IndexedDB. A service worker caches the app's own files. The app therefore opens, shows every note and accepts edits with no connection. Queued Changes sync in order whenever Microsoft is reachable. Conflicts found while syncing go to the user through the normal compare screen.

## Consequences

- **Notes are stored unencrypted on each Device** where the user signs in. Signing out wipes the device copy, and warns first if Queued Changes would be lost.
- **The device copy belongs to one account.** It's stamped with the account that synced it (`owner`). If a different account signs in, everything is wiped first. A session can end without Sign out, for example on a shared PC, and this stops one person's notes from showing to the next person, or their Queued Changes from being written into the next person's mailbox.
- **The diagnostic spike page is development-only.** It shows full note text and can write to the mailbox, so the production build leaves it out.
- **Every Queued Change carries an id**, stamped on the note it creates as a hidden property (`NotesWebApp.OpId`). A sync cut off halfway, for example by the app closing, is retried safely: leftovers from the earlier attempt are found and cleared, so a retry never duplicates a note.
- **Edits fold together.** Several edits to the same note that haven't started sending become one Queued Change, so the PC sees one new version instead of several.
- **Replace-on-save changes a note's id** (ADR 0003). Later Queued Changes are pointed at the new id once an earlier one syncs.
- **The original creation time is a hidden property** (`NotesWebApp.Created`), carried across every replacement, because Graph's `createdDateTime` resets each time. Notes without it fall back to `createdDateTime`. It's untested whether the native app keeps the property when it edits a note.
- **Recently deleted and Restore need a connection.**
