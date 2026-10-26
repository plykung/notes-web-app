// Telling users about Releases (src/changelog.ts, GLOSSARY.md). App code
// updates by itself (the service worker fetches the newest page when online),
// but an open app keeps running the old version until it reloads, and
// home-screen shortcuts and icons only refresh when the app is reinstalled.
//
// Toasts appear only for Releases, never for silent fixes. The user can turn
// them off (the What's New checkbox, ticked by default, or Settings), except for
// a Release they must act on: that one always shows, and turns them back on.
import { APP_VERSION, actionNeeded, releasesSince, type Release, type ReleaseAction } from "./changelog";
import { locale, t } from "./i18n";
import { getSettings, saveSettings } from "./settings";
import { toast } from "./ui";

const SEEN_KEY = "notes-release-seen";

/**
 * The last Release this device saw. Devices that used Notes before Releases
 * were tracked (they have settings or a sign-in saved) count as having seen 1.0.0.
 */
function seenVersion(): string | null {
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    if (seen) return seen;
    const usedBefore = Object.keys(localStorage).some((k) => k === "notes-settings" || k.startsWith("msal."));
    return usedBefore ? "1.0.0" : null;
  } catch {
    return null;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    // Storage blocked: the toast may show again next time.
  }
}

/** Whether to show a toast for these Releases, turning toasts back on if one needs action. */
function shouldAnnounce(releases: Release[]): boolean {
  if (!releases.length) return false;
  if (actionNeeded(releases) !== "none") {
    if (!getSettings().updateToasts) saveSettings({ updateToasts: true }); // the user gets to choose again
    return true;
  }
  return getSettings().updateToasts;
}

const STEPS: Record<ReleaseAction, "" | "updateStepsReload" | "updateStepsReinstall"> = {
  none: "",
  reload: "updateStepsReload",
  reinstall: "updateStepsReinstall",
};

/**
 * The What's New pop-up: notes for `releases`, the step they need (if any),
 * and, after an update, the "don't show again" checkbox.
 */
export function showWhatsNew(releases: Release[], opts: { afterUpdate: boolean }) {
  const lang = getSettings().language;
  const dialog = document.createElement("dialog");
  dialog.className = "ask whats-new";
  dialog.setAttribute("aria-labelledby", "whats-new-title");
  const h = Object.assign(document.createElement("h2"), { id: "whats-new-title", textContent: t("whatsNew") });
  const body = document.createElement("div");
  body.className = "whats-new-body";
  for (const r of releases) {
    const head = Object.assign(document.createElement("h3"), {
      textContent: `${r.version} · ${new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(new Date(`${r.date}T12:00:00`))}`,
    });
    const list = document.createElement("ul");
    list.append(...r.notes[lang].map((n) => Object.assign(document.createElement("li"), { textContent: n })));
    body.append(head, list);
  }
  const steps = STEPS[actionNeeded(releases)];
  if (steps) body.append(Object.assign(document.createElement("p"), { className: "steps", textContent: t(steps) }));
  body.append(Object.assign(document.createElement("p"), { className: "hint", textContent: t("updateSafe") }));

  const actions = document.createElement("div");
  actions.className = "actions end";
  let checkbox: HTMLInputElement | null = null;
  if (opts.afterUpdate) {
    const label = document.createElement("label");
    label.className = "dont-show";
    checkbox = Object.assign(document.createElement("input"), { type: "checkbox", checked: true });
    label.append(checkbox, t("dontShowUpdates"));
    actions.append(label);
  }
  const ok = Object.assign(document.createElement("button"), { className: "primary", textContent: t("ok") });
  const close = () => {
    if (checkbox) saveSettings({ updateToasts: !checkbox.checked });
    markSeen();
    dialog.close();
    dialog.remove();
  };
  ok.onclick = close;
  dialog.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  actions.append(ok);
  dialog.append(h, body, actions);
  document.body.append(dialog);
  dialog.showModal();
  ok.focus();
}

/** Settings → What's new: the full history. */
export const showAllReleases = () => showWhatsNew(releasesSince(null), { afterUpdate: false });

/** First launch after a Release: a toast with Details, once. A brand-new user sees nothing. */
function announceUpdated() {
  const seen = seenVersion();
  if (seen === null) return markSeen();
  const releases = releasesSince(seen);
  if (!shouldAnnounce(releases)) return markSeen();
  toast("updated", t("updatedToast"), {
    label: t("details"),
    run: () => showWhatsNew(releases, { afterUpdate: true }),
  }, document, { sticky: true, onClose: markSeen });
}

/** While the app is open, a new version arrived: offer to reload if it's a Release worth telling about. */
async function announceReady() {
  let latest: { version: string; action: ReleaseAction };
  try {
    latest = await (await fetch("/version.json", { cache: "no-store" })).json();
  } catch {
    return;
  }
  if (latest.version === APP_VERSION) return; // a silent fix: it loads next time
  if (latest.action === "none" && !getSettings().updateToasts) return;
  if (latest.action !== "none") saveSettings({ updateToasts: true });
  toast("updated", t("updateReady"), [
    { label: t("reload"), run: () => location.reload() },
  ], document, { sticky: true });
}

/**
 * Starts the service worker and watches for new versions while the app is
 * open; checks again whenever the user comes back to it.
 */
export function watchForUpdates() {
  announceUpdated();
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const hadWorker = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          // A first install isn't an update; a replacement for a running worker is.
          if (worker.state === "activated" && hadWorker) announceReady();
        });
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    })
    .catch((err) => console.error("Offline support unavailable", err));
}
