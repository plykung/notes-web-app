# Microsoft Sticky Notes is the Hub; Google Keep is retired

Every note lives in Microsoft Sticky Notes. The user copies their Google Keep notes over by hand once, then stops using Keep. On phone and iPad they use our own browser-only Notes Web App. On the PC they keep the native Sticky Notes app, which gives each note its own floating window.

## How the Hub is reached

The Notes Web App reaches Sticky Notes through the Microsoft Graph **mail** API, on the mailbox's well-known `notes` folder (`/me/mailFolders/notes/messages`). It needs the delegated `Mail.ReadWrite` permission.

The dedicated notes API (`/me/notes`, `ShortNotes.ReadWrite`) was tried first. On 2026-10-26 it returned 403 `ErrorAccessDenied` for the user's personal, Gmail-based Microsoft account, even though the permission was granted. The mail API returned all 258 notes, each with message class `IPM.StickyNote` and its text as simple HTML in the body.

This is the official public Graph API, but Microsoft doesn't document it for Sticky Notes, so it may change without notice. `Mail.ReadWrite` grants access to the whole mailbox. To limit that:
- The code only ever touches the `notes` folder.
- Note HTML is cleaned before display.
- A strict content-security policy blocks third-party scripts.

## Considered Options

- **Keep as the Hub**: rejected. Keep's official API is for Workspace admins only and has no update method. Using a personal account would mean the unofficial `gkeepapi`.
- **Our own Hub, with both Note Sources syncing into it**: rejected. It meant much more to build and two sync paths to keep correct.
- **Microsoft's internal `substrate.office.com/NotesFabric` API**: rejected. Our app can't get a login token for it without posing as a Microsoft app.

## Consequences

- There is no sync service or server: the app calls Graph straight from the browser. The cost is a one-tap sign-in about once a day on iOS, because single-page-app refresh tokens last 24 hours and Safari blocks silent renewal. A server holding the login token was rejected as the bigger risk, especially with mailbox-wide access.
- Graph has no push notifications here, so the app refreshes on open, on reload, when the user returns to the app, and when a save hits a conflict.
- Note colour isn't stored in a field the API returns, so the first version leaves it out.
