# Notes

**Notes** puts your notes on every device: PC, iPad and phone. An offline-first PWA that works with Microsoft Sticky Notes, through Microsoft Graph, straight from the browser, with no server in between.

**Live:** https://notes.naphats.me

- Search and Tags (`#word`), colours, pinning, images
- Works offline; changes sync when you're back online, with a compare screen for conflicts
- Pop-out note windows on the PC; installable on iPad, Android and Windows
- English and ไทย, light and dark

## How it works

| Topic | Where |
|---|---|
| Why Sticky Notes is the hub, and why the mail API | [docs/adr/0001](docs/adr/0001-sticky-notes-is-the-hub.md) |
| Why every edit replaces the note | [docs/adr/0003](docs/adr/0003-edit-by-replacing-the-note.md) |
| Offline-first: device copy and queued changes | [docs/adr/0004](docs/adr/0004-offline-first-with-a-device-outbox.md) |
| Colour and pinning | [docs/adr/0005](docs/adr/0005-note-colour-and-pinning.md) |
| The HTML format the PC app expects | [docs/note-html-format.md](docs/note-html-format.md) |
| Terms used in the code | [GLOSSARY.md](GLOSSARY.md) |

Code: `src/app.ts` (screen), `src/sync.ts` (offline queue), `src/graph.ts` (Microsoft Graph), `src/auth.ts` (sign-in), `src/editor.ts` (editor), `src/note.ts` and `src/serialize.ts` (note HTML).

## Develop

You need Node 22+ and a Microsoft Entra app registration (Personal Microsoft accounts, SPA platform, redirect URI `http://localhost:5173`, delegated permission `Mail.ReadWrite`). See [docs/deploy.md](docs/deploy.md#1-microsoft-entra-app-registration).

```sh
npm ci
cp .env.example .env      # then set VITE_ENTRA_CLIENT_ID
npm run dev               # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server. Also serves `spike.html`, the diagnostic page, which isn't in production builds. |
| `npm run check` | Type check and tests |
| `npm run preview` | Production build on port 5173. Needed to test offline and install, since the service worker only runs in a build. |
| `npm run deploy:check` | Build and a Cloudflare dry run |
| `npm run deploy` | Build and deploy to Cloudflare Workers |

## Deploy

See [docs/deploy.md](docs/deploy.md): the Entra settings for public users, Cloudflare Workers static assets, capacity and limits, and the pre-launch and security checklists.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Privacy

Notes travel only between the user's device and Microsoft. See [public/privacy.html](public/privacy.html) and [public/terms.html](public/terms.html) (Thai, with English).

## License

[MIT](LICENSE). Not affiliated with Microsoft; Microsoft, Sticky Notes, Outlook and OneNote are trademarks of Microsoft Corporation.
