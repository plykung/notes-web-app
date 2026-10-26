# Security policy

Notes asks for access to the user's Microsoft mailbox (`Mail.ReadWrite`), so security problems are taken seriously. Thank you for helping keep users safe.

## Supported versions

Only the current `main` branch, which is what's deployed at https://notes-web-app.naphats.workers.dev, gets security fixes.

## Reporting a vulnerability

**Please don't open a public issue for security problems.** Report them privately instead:

- **GitHub:** use **Security → Report a vulnerability** on this repository (private vulnerability reporting), or
- **Email:** naphats.saokm (at) gmail (dot) com, with "Security: Notes" in the subject.

Please include:
- what the problem is and where (a file, URL or screen);
- the steps to reproduce it, or a proof of concept;
- what an attacker could do with it, for example read another user's notes or steal a sign-in token.

Please **don't** access other people's data, run automated scans against the live site, or test anything that could damage notes. A test Microsoft account of your own is enough to show almost any issue.

## What happens next

- You'll get an acknowledgement within **7 days**.
- Confirmed issues are fixed as soon as practical, with priority on anything that could expose mailbox data or sign-in tokens.
- You'll be told when the fix is deployed, and credited if you'd like.
- Problems involving the connection to Microsoft's APIs, or any data breach, are also reported to the **Microsoft Security Response Center**, as the Microsoft APIs Terms of Use require.

## Scope

**In scope:**
- the web app and its code in this repository;
- the live site's configuration, such as its security headers (`public/_headers`).

**Out of scope:**
- Microsoft's own services (sign-in, Microsoft Graph, Outlook, Sticky Notes): report those to Microsoft at https://msrc.microsoft.com;
- Cloudflare's or GitHub's platforms;
- problems that need an already-compromised device or browser;
- missing hardening with no demonstrated impact.

## How the app protects users

The app has no server of its own: notes go straight between the user's browser and Microsoft. It uses a strict Content Security Policy with no third-party scripts, rebuilds note HTML from text only, keeps the device copy tied to the signed-in account, and wipes it on sign-out. The full security model is in [docs/deploy.md](docs/deploy.md#5-security-model-for-public-users-review-summary-2026-10-26).
