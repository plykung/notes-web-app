# Deploying Notes to production

Notes is a static, browser-only app. There is no server of ours: each user's browser signs in to Microsoft and talks to Microsoft Graph directly (see [ADR 0001](adr/0001-sticky-notes-is-the-hub.md) and [ADR 0004](adr/0004-offline-first-with-a-device-outbox.md)). Production has two parts:

1. **A Microsoft Entra app registration.** This is the app's identity, shared by every user.
2. **Cloudflare Workers static assets.** These serve the built files from Cloudflare's edge.

## Why Workers (static assets) and not Pages

Both can host a static site. Workers static assets is the path Cloudflare recommends for new projects. It supports what this app needs:
- a `_headers` file for security headers ([public/_headers](../public/_headers));
- Git-connected builds (Workers Builds);
- custom domains.

If the app ever needs server code, such as a token proxy, it can be added to the same Worker. Config: [wrangler.jsonc](../wrangler.jsonc).

## 1. Microsoft Entra app registration

In [entra.microsoft.com](https://entra.microsoft.com) → App registrations → your app:

| Setting | Value |
|---|---|
| Supported account types | **Personal Microsoft accounts only**. The app is built and tested for personal (outlook.com, hotmail, Gmail-based) accounts. Work and school accounts use a different authority and are untested. |
| Platform | **Single-page application (SPA)**. Don't use "Web", and don't add a client secret: a browser app can't keep one. |
| Redirect URIs | `http://localhost:5173` (development), `https://notes.naphats.me` (the custom domain), and `https://notes-web-app.<your-subdomain>.workers.dev` while that address stays on. They must match exactly: no trailing slash, and HTTPS in production. |
| Implicit grant | **Off**. MSAL uses the authorization-code flow with PKCE. |
| API permissions | Microsoft Graph, delegated: **Mail.ReadWrite**. You can remove `User.Read`, since the app no longer requests it. `openid`, `profile` and `offline_access` are added automatically at sign-in. |
| Branding | Name "Notes", the logo from `public/icon-512.png`, home page URL, **Terms of service URL** `https://<domain>/terms`, **Privacy statement URL** `https://<domain>/privacy`. Microsoft shows these on the consent screen. Cloudflare serves the pages at these clean URLs; the `.html` addresses redirect to them. |
| Publisher verification | **Strongly recommended before public launch.** Unverified apps show "unverified" on the consent screen, which matters for an app asking for Mail.ReadWrite. It needs a Microsoft AI Cloud Partner Program (MPN) ID; see [Publisher verification](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview). |

**Why Mail.ReadWrite:** Microsoft's dedicated Sticky Notes permission (`ShortNotes.ReadWrite`) returns 403 for personal accounts. The only working route is the mail API on the mailbox's Notes folder ([ADR 0001](adr/0001-sticky-notes-is-the-hub.md)). The code touches only the Notes folder, plus Deleted Items for delete and restore. The consent screen still says "read and write your mail", and the landing page and Privacy statement explain why.

The client ID is **not a secret**: it's public in every SPA. It goes in `VITE_ENTRA_CLIENT_ID` at build time.

## 2. Cloudflare

**Live:** https://notes.naphats.me (also served at https://notes-web-app.naphats.workers.dev). It deploys from `main` on github.com/plykung/notes-web-app through Workers Builds. Logs, traces and issue detection are on (`observability` in [wrangler.jsonc](../wrangler.jsonc), kept in step with the dashboard so a deploy doesn't undo them).

### One-time setup (Workers Builds, recommended)

1. Push this repository to GitHub. A private repo is fine.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, and pick the repo.
3. Build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Build variable:** `VITE_ENTRA_CLIENT_ID` = your Entra Application (client) ID
4. Deploy. Add the resulting `https://notes-web-app.<subdomain>.workers.dev` URL to the Entra redirect URIs (section 1).
5. Optional: add a custom domain under the Worker's **Settings → Domains & Routes**, then add it to Entra too.

Every push to the main branch then builds and deploys automatically.

### From your own computer instead

```sh
npm ci
npm run deploy:check   # builds, then a dry-run: checks packaging without uploading
npx wrangler login     # once
npm run deploy         # builds and deploys
```

`VITE_ENTRA_CLIENT_ID` must be in `.env` (copy `.env.example`).

## 3. Many users: capacity and limits

There is **no shared backend to overload**, so there's nothing to load-balance:
- **App files** are static and served from Cloudflare's global edge network with long-lived caching (`/assets/*` is immutable).
  - Requests that hit only static assets don't run a Worker script.
  - Check current limits on [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) for your plan.
- **Notes traffic** goes from each user's browser to Microsoft Graph, so it's governed by Microsoft's per-user, per-mailbox limits, not by anything shared between users:
  - Graph's Outlook limits are about 4 concurrent requests per mailbox per app. The app keeps to 3 at a time.
  - It retries `429`/`503`/`504` after the `Retry-After` delay (`src/graph.ts`).
  - After the first full download, refreshes fetch only changes (delta), so steady-state traffic per user is small.
- **One shared identity:** every user signs in to the same Entra app. Microsoft also applies app-wide Graph limits across all users of one app. These are far above what a notes app generates, but watch sign-in and usage in Entra if you grow large. See [Graph throttling](https://learn.microsoft.com/graph/throttling) and [service-specific limits](https://learn.microsoft.com/graph/throttling-limits#outlook-service-limits).
- **If Microsoft throttles a user,** their changes stay queued on their device and sync later. Nothing is lost.

## 4. Pre-launch checklist

- [ ] Have `public/terms.html` and `public/privacy.html` reviewed. They're drafts, not legal advice.
- [ ] Entra: production redirect URI added, implicit grant off, Terms and Privacy URLs set, publisher verified.
- [ ] Cloudflare: `VITE_ENTRA_CLIENT_ID` build variable set. After the first deploy, check the headers: `curl -I https://<domain>/` should show `Content-Security-Policy`, `Strict-Transport-Security` and the other headers from `public/_headers`.
- [ ] Sign in on the production URL with a test account. Check that notes load, an edit reaches the Sticky Notes PC app, and offline launch works once installed.
- [ ] `npm audit --omit=dev` reports 0 vulnerabilities (true as of 2026-10-26; the dev-only warnings are in Wrangler's build tooling, which never ships).

## 5. Security model for public users (review summary, 2026-10-26)

- **Isolation:** each user's notes exist only in their browser and their own Microsoft mailbox. The device copy is tied to the signed-in account and wiped if a different account signs in ([ADR 0004](adr/0004-offline-first-with-a-device-outbox.md)). Sign-out wipes it too.
- **No secrets in the app:** the client ID is public by design, and there's no client secret or API key anywhere.
- **XSS defence:**
  - Strict CSP with no third-party scripts.
  - Note HTML is rebuilt from text only (`src/note.ts`).
  - Every `innerHTML` in the code writes constant strings.
  - The CSP is sent both as a header (with `frame-ancestors 'none'` against clickjacking) and as a meta tag.
- **Token storage:** MSAL keeps tokens in `localStorage` so users stay signed in across visits. A successful XSS could read them, which is why the CSP matters. On shared computers, users should sign out.
- **Developer tools excluded:** the diagnostic `spike.html` is development-only and not in the production build.
- **Known residual risk:** device copies of notes are unencrypted at rest in the browser (IndexedDB). Notes therefore rely on the device's own disk encryption and screen lock, as the Privacy statement tells users.
