// Microsoft sign-in for a personal account, in the browser only (docs/adr/0001).
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from "@azure/msal-browser";

// Only what the app uses. Mail.ReadWrite is the only permission that reaches the
// mailbox Notes folder where Sticky Notes live (docs/adr/0001). The name and
// email come from sign-in itself (openid, profile, and offline_access to stay
// signed in, which MSAL always adds), so User.Read isn't requested.
const SCOPES = ["Mail.ReadWrite"];

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
if (!clientId) throw new Error("Missing VITE_ENTRA_CLIENT_ID in .env");

/** Microsoft can't be reached right now; the change stays queued on the device. */
export class OfflineError extends Error {
  constructor() {
    super("You're offline.");
  }
}

const msal = new PublicClientApplication({
  auth: {
    clientId,
    authority: "https://login.microsoftonline.com/consumers",
    redirectUri: window.location.origin,
  },
  cache: { cacheLocation: "localStorage" },
});

let account: AccountInfo | null = null;

/** Finishes any sign-in redirect and returns the signed-in account, if any. Works offline. */
export async function initAuth(): Promise<AccountInfo | null> {
  await msal.initialize();
  const redirect = await msal.handleRedirectPromise().catch(() => null);
  // The account that just signed in wins; otherwise the one marked active.
  account = redirect?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
  if (account) msal.setActiveAccount(account);
  return account;
}

export function signIn() {
  return msal.loginRedirect({ scopes: SCOPES });
}

export function signOut() {
  return msal.logoutRedirect({ account });
}

/**
 * An access token for Graph. Redirects to Microsoft only when the user really
 * has to sign in again, never while offline.
 */
export async function getToken(): Promise<string> {
  if (!account) throw new Error("Not signed in");
  try {
    return (await msal.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (err) {
    if (!navigator.onLine || !(err instanceof InteractionRequiredAuthError)) throw new OfflineError();
    await msal.acquireTokenRedirect({ scopes: SCOPES, account });
    throw new Error("Signing in again…");
  }
}
