// Terms of service / Privacy statement: Thai by default, English on request.
// Follows the app's Light/Dark setting (same site, same saved settings).
(() => {
  const root = document.documentElement;
  try {
    const theme = JSON.parse(localStorage.getItem("notes-settings") ?? "{}").theme;
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  } catch {
    // No saved settings: follow the device.
  }

  // ?lang=en opens English; otherwise Thai (the version that prevails).
  const wanted = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "th";
  const show = (lang) => {
    root.lang = lang;
    for (const el of document.querySelectorAll("[data-lang-block]")) el.hidden = el.dataset.langBlock !== lang;
    for (const btn of document.querySelectorAll("[data-lang]")) btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
    document.title = document.querySelector(`[data-lang-block="${lang}"] h1`)?.textContent ?? document.title;
    const url = new URL(location.href);
    if (lang === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    history.replaceState(null, "", url);
  };
  for (const btn of document.querySelectorAll("[data-lang]")) btn.addEventListener("click", () => show(btn.dataset.lang));
  show(wanted);

  // Shortcuts page: the one-tap "Get Shortcut" links, one place for both
  // languages. Paste each shortcut's iCloud link here (Share → Copy iCloud Link).
  // After editing a shortcut, paste its NEW link: old links don't update
  // (docs/adr/0006). Empty ones stay hidden, and so does the section if all are.
  const ICLOUD_SHORTCUTS = {
    new: "https://www.icloud.com/shortcuts/c354c41ca6e24d7ca1cf4fa9491cd64d",
    "new-voice": "https://www.icloud.com/shortcuts/781fc62915414effac53ef3b3b9fc45a",
    latest: "https://www.icloud.com/shortcuts/928358a7b7f0418cb5b702cdf292220c",
    search: "https://www.icloud.com/shortcuts/a70157ca984847ea86b2431113e07605",
  };
  for (const a of document.querySelectorAll("a[data-shortcut]")) {
    const link = ICLOUD_SHORTCUTS[a.dataset.shortcut] ?? "";
    if (link.startsWith("https://www.icloud.com/shortcuts/")) {
      a.href = link;
      a.hidden = false;
      a.closest("[data-one-tap]").hidden = false;
    }
  }

  // Shortcuts page: links use this site's own address, with a copy button each.
  for (const code of document.querySelectorAll("code[data-link]")) code.textContent = location.origin + code.dataset.link;
  for (const btn of document.querySelectorAll("button[data-copy]")) {
    btn.addEventListener("click", async () => {
      const code = btn.previousElementSibling;
      const label = btn.textContent;
      try {
        await navigator.clipboard.writeText(code.textContent);
        btn.textContent = "✓";
      } catch {
        // No clipboard access: select the link so it can be copied by hand.
        getSelection().selectAllChildren(code);
      }
      setTimeout(() => (btn.textContent = label), 1500);
    });
  }
})();
