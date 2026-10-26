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
})();
