# Sticky Notes HTML format

This is the HTML the native Microsoft Sticky Notes app stores in a note's `body` (Graph mail API, `contentType: "html"`). It was captured on 2026-10-26 from a sample note. The Notes Web App must read and write exactly this shape, so notes round-trip cleanly between the two apps.

## Wrapper

```html
<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>
<!--
ul
	{list-style:none}
html, body, div, span, h1, h2, h3, h4, h5, h6, p, ul, li
	{margin:0;
	padding:0;
	border:0;
	outline:0;
	font-size:100%;
	vertical-align:baseline}
-->
</style></head><body id="NotesClientContent"><div> …content… </div></body></html>
```

Line breaks inside the wrapper are `\r\n`. The exact string is `NOTE_HEAD` / `NOTE_TAIL` in the spike.

## Content

| Element | HTML |
|---|---|
| Line | `<p>text</p>`. An empty line is `<p></p>` |
| Bold | `<span style="font-weight:bold">…</span>` |
| Italic | `<span style="font-style:italic">…</span>` |
| Underline | `<span style="text-decoration:underline">…</span>` |
| Strikethrough | `<span style="text-decoration:line-through">…</span>` |
| Bullet list | `<ul style="padding:0px 20px"><li style="list-style-type:disc"><p>item</p></li>…</ul>` |

These are not the native app's formatting: a `- ` typed at the start of a line, or a ✅ emoji, are plain text inside `<p>`.

## Blank lines and spaces (notes written through Graph)

The native app writes a blank line as `<p></p>`, and collapses repeated spaces to one even in its own copy. A note **written through Graph** loses all of these on the way into the PC app and onenote.com (tested 2026-10-26):
- `<p></p>`, `<p><br></p>`, `<p>&nbsp;</p>`, `<br><br>` inside a paragraph, and `<div><br></div>` all disappear.
- `&nbsp;` is removed. Two normal spaces become one, and so do two en spaces.

What does survive:
- **Blank line:** `<p>&#x200B;</p>`, a paragraph holding one zero-width space.
- **Repeated spaces:** a zero-width space between each pair, as in `a &#x200B; b`.
- **A plain-text body** keeps both, but loses all formatting.

The app writes the first two, and strips zero-width spaces wherever it reads text (search, Tags, titles), so they're invisible to the user.

## Images

Images are ordinary file attachments (`isInline: false`), not `<img>` tags in the body. Every image the native app writes has:
- `name`: `<uuid>.png`
- `contentType`: `image/png`
- `contentId`: the same uuid, without the extension

An image uploaded through Graph with `contentId: null` is stored and returned by Graph, but the native app and onenote.com don't show it (tested 2026-10-26). The note-level `hasAttachments` is `true` when a note has images.

## Other fields

- `subject` is the note's first line, as plain text.
- `isDraft` is `false` for notes the native app creates, and `true` for notes created through Graph.
- `body` is a **read-only mirror** for notes the native app created. Edits made in the native app show up in `body`. But a `PATCH` to `body` returns 200 and is then ignored by the native app, onenote.com/stickynotes and Outlook on the web, and the next native edit overwrites it. This was tested on 2026-10-26. The native app keeps its own copy of the content somewhere Graph doesn't expose.
- Notes created through Graph (`POST`) do show up in the native app, and so do later `PATCH` edits and `DELETE`, as long as the native app hasn't edited the note yet. Whether a Graph-created note behaves the same after the native app edits it is untested. The app therefore never edits in place: see `docs/adr/0003-edit-by-replacing-the-note.md`.
