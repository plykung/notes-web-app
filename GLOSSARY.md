# Cross-platform Notes

One place to see, and ideally edit, a single person's notes on a Windows PC, phone and iPad. The notes come from Microsoft Sticky Notes and Google Keep.

## Language

**Sticky Note**:
A note that lives in Microsoft Sticky Notes and syncs through the user's Microsoft account.
_Avoid_: Stickie, MS note

**Keep Note**:
A note that lives in Google Keep under the user's Google account.
_Avoid_: Google note

**Note Source**:
One of the systems where notes originate and are stored: Microsoft Sticky Notes or Google Keep.
_Avoid_: Provider, backend, platform

**Hub**:
The single Note Source that holds every note once migration is done. Microsoft Sticky Notes is the hub.
_Avoid_: Master, primary store, server

**Keep Migration**:
The one-time copy of every Keep Note into the Hub, after which Google Keep is retired.
_Avoid_: Keep sync, import job

**Tag**:
A `#word` written inside a note's text, used to group and filter notes. Because it's part of the text, any search on any Device finds it.
_Avoid_: Category, label

**Notes Web App**:
The browser app the user builds to read and edit every note in the Hub from any Device.
_Avoid_: Viewer, client, my app

**Queued Change**:
A create, edit or delete the user made on a Device that hasn't reached the Hub yet. It's shown as "Not synced yet".
_Avoid_: Pending op, outbox item, draft

**Action Link**:
A web address that opens the Notes Web App and asks it to do one thing, such as start a new note or search. It never saves, deletes or changes a note by itself.
_Avoid_: Deep link, URL scheme, command

**Pending Action**:
An Action Link the user tapped while signed out, held in that browser tab until they sign in and then carried out once. It's discarded if sign-in doesn't happen within a few minutes.
_Avoid_: Saved link, queued action (a Queued Change is something else)

**Latest Note**:
The note edited most recently anywhere (on any Device or in the PC app), as known after a refresh.
_Avoid_: Recent note, last note, newest note

**Release**:
A version of the Notes Web App that has an entry in the changelog: a version number, a date, notes for users, and what they need to do to get it (nothing, reload, or reinstall). Deploys without an entry are silent fixes, not Releases.
_Avoid_: Build, deploy, update (a deploy may not be a Release)

**What's New**:
The pop-up that lists the Releases since the last one the user saw, and any step they need to take.
_Avoid_: Changelog popup, release notes dialog

**Device**:
A screen the user reads notes on: the Windows PC, a phone or an iPad.
_Avoid_: Platform, client
