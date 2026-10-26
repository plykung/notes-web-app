# A note's colour is a hidden field; pinning is a Tag

The colour is stored in our own hidden property on the note (`NotesWebApp.Color`), like the original creation date. It uses one of the native palette's names: yellow, green, pink, purple, blue, gray or charcoal. The Graph API doesn't return the native app's colour field, so the two colours are independent.

- **No text on any Device.** Unlike a Tag, the colour appears nowhere in the note's text.
- **Changing only the colour updates the field in place.** The note isn't replaced (ADR 0003), so the PC app's window doesn't jump.

Notes coloured by an earlier version still carry a colour Tag such as `#pink` in their text. They show that colour until they're next saved, when the Tag leaves the text and the colour moves to the field.

Pinning, by contrast, is the Tag `#pinned`, so the PC app shows the note is pinned. It's written as the note's last line, two blank lines below the text. The web app hides it, shows a pin icon, and lists pinned notes first.
