// Small inline icons. Each is labelled for screen readers and shows its meaning on hover.

const svg = (body: string, size = 16, stroke = 2) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  cloud: svg('<path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>'),
  cloudOff: svg('<path d="M7 18a5 5 0 0 1-.6-9.96M10 5.3A6 6 0 0 1 18 9a4.5 4.5 0 0 1 2.3 8.1M3 3l18 18"/>'),
  cloudCheck: svg('<path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="m9.5 13 2 2 3.5-3.5"/>'),
  cloudAlert: svg('<path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 10v3M12 15.5v.01"/>'),
  sync: svg('<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1M18 3v4.5h-4.5M6 21v-4.5h4.5"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 20),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 20, 2.2),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 20, 2.2),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  // Sliders: clearer at 16 px than a gear.
  settings: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  install: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  signOut: svg('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>'),
  deleted: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>'),
};

/** An icon element with a tooltip and an accessible name. */
export function iconEl(name: keyof typeof ICONS, label: string, className = ""): HTMLElement {
  const span = document.createElement("span");
  span.className = `ico ${className}`;
  span.innerHTML = ICONS[name];
  span.title = label;
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", label);
  return span;
}
