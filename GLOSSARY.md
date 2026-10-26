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

**Device**:
A screen the user reads notes on: the Windows PC, a phone or an iPad.
_Avoid_: Platform, client
