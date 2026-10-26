import { t, type StringKey } from "./i18n";
import { ICONS } from "./icons";

// Pop-ups, toasts and the image viewer. Each builds its own elements in the
// document it's given, so pop-out windows can use them too.

const reducedMotion = (doc: Document) => doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;

// ---------- Pop-up (modal) ----------

export type AskButton<T> = { label: string; value: T; style?: "primary" | "danger" };

let askCount = 0;

/**
 * A modal that waits for one of `buttons`. Used instead of the browser's
 * confirm(). Escape picks the safe choice (Cancel / OK) when there is one.
 */
export function ask<T>(title: string, message: string, buttons: AskButton<T>[], doc = document): Promise<T> {
  const id = `ask-${++askCount}`;
  const dialog = doc.createElement("dialog");
  dialog.className = "ask";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  dialog.setAttribute("aria-describedby", `${id}-text`);
  const h = Object.assign(doc.createElement("h2"), { id: `${id}-title`, textContent: title });
  const p = Object.assign(doc.createElement("p"), { id: `${id}-text`, textContent: message });
  const actions = doc.createElement("div");
  actions.className = "actions end";
  dialog.append(h, p, actions);
  doc.body.append(dialog);

  return new Promise((resolve) => {
    const choose = (value: T) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    for (const b of buttons) {
      const btn = doc.createElement("button");
      btn.textContent = b.label;
      if (b.style) btn.className = b.style;
      btn.onclick = () => choose(b.value);
      actions.append(btn);
    }
    const safe = buttons.find((b) => b.value === false || b.value === undefined);
    dialog.oncancel = (e) => {
      e.preventDefault(); // a choice must be made, but Escape may make the safe one
      if (safe) choose(safe.value);
    };
    dialog.showModal();
    (actions.querySelector<HTMLElement>(".primary") ?? actions.querySelector<HTMLElement>("button:last-child"))?.focus();
  });
}

export const OK = [{ get label() { return t("ok"); }, value: undefined }];

/** Cancel / Delete, for anything that deletes. */
export function confirmDanger(title: StringKey, body: StringKey, doc = document): Promise<boolean> {
  return ask(t(title), t(body), [
    { label: t("cancel"), value: false },
    { label: t("delete"), value: true, style: "danger" },
  ], doc);
}

// ---------- Toast ----------

let toastTimer = 0;
let toastLeft = 0;
let toastSince = 0;

/** What a toast is about; each kind has its own icon and colour. */
export type ToastKind = "success" | "updated" | "offline" | "deleted" | "pinned" | "attention" | "saved";
const TOAST_ICONS: Record<ToastKind, keyof typeof ICONS> = {
  success: "cloudCheck",
  updated: "sync",
  offline: "cloudOff",
  deleted: "trash",
  pinned: "pin",
  attention: "alert",
  saved: "check",
};

/**
 * A short message at the bottom of the screen with an icon for its kind, and
 * optionally one action such as Undo. It waits while the pointer or keyboard
 * focus is on it.
 */
export function toast(kind: ToastKind, message: string, action?: { label: string; run: () => void }, doc = document) {
  let el = doc.getElementById("toast");
  if (!el) {
    el = doc.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.hidden = true;
    doc.body.append(el);
  }
  const box = el;
  const hide = () => (box.hidden = true);
  const startTimer = (ms: number) => {
    clearTimeout(toastTimer);
    toastLeft = ms;
    toastSince = Date.now();
    toastTimer = window.setTimeout(hide, ms);
  };
  const pause = () => {
    clearTimeout(toastTimer);
    toastLeft -= Date.now() - toastSince;
  };
  const resume = () => startTimer(Math.max(toastLeft, 1500));
  box.onpointerenter = pause;
  box.onpointerleave = resume;
  if (!box.dataset.wired) {
    box.dataset.wired = "1"; // focusin/out have no on- properties; add them once
    box.addEventListener("focusin", () => pause());
    box.addEventListener("focusout", () => resume());
  }

  // Filled on the next frame so screen readers notice the live region change.
  requestAnimationFrame(() => {
    const icon = doc.createElement("span");
    icon.className = `toast-icon ${kind}`;
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = ICONS[TOAST_ICONS[kind]];
    const text = doc.createElement("span");
    text.className = "toast-text";
    text.textContent = message;
    box.replaceChildren(icon, text);
    if (action) {
      const btn = doc.createElement("button");
      btn.className = "toast-action";
      btn.textContent = action.label;
      btn.onclick = () => {
        hide();
        action.run();
      };
      box.append(btn);
    }
    box.hidden = false;
    startTimer(action ? 6000 : 3500);
  });
}

// ---------- Image viewer ----------

export type GalleryImage = { id: string; name: string; url: string };

export type GalleryOptions = {
  images: GalleryImage[];
  start?: number;
  /** Adds images; resolves with the note's images afterwards. Omit to hide the add button. */
  onAdd?: (files: File[]) => Promise<GalleryImage[]>;
  /** Removes one image; resolves with the images left. Omit to hide the delete button. */
  onRemove?: (img: GalleryImage) => Promise<GalleryImage[]>;
  /** Called when the viewer closes (a pop-out image window closes itself). */
  onClose?: () => void;
};

/**
 * Full-screen viewer: one image per slide (swipe, arrows or ‹ ›), a strip of
 * thumbnails along the bottom, and add / delete / close at the top right.
 * On touch screens, swiping down closes it.
 */
export function openGallery(opts: GalleryOptions, doc = document) {
  let images = opts.images;
  const dialog = doc.createElement("dialog");
  dialog.className = "images";
  dialog.innerHTML = `
    <div class="strip"></div>
    <span class="counter"></span>
    <div class="image-tools"></div>
    <button class="nav prev">‹</button>
    <button class="nav next">›</button>
    <div class="filmstrip"></div>
    <input type="file" accept="image/*" multiple hidden />`;
  doc.body.append(dialog);
  const strip = dialog.querySelector<HTMLElement>(".strip")!;
  const film = dialog.querySelector<HTMLElement>(".filmstrip")!;
  const counter = dialog.querySelector<HTMLElement>(".counter")!;
  const prev = dialog.querySelector<HTMLButtonElement>(".prev")!;
  const next = dialog.querySelector<HTMLButtonElement>(".next")!;
  const tools = dialog.querySelector<HTMLElement>(".image-tools")!;
  const fileInput = dialog.querySelector<HTMLInputElement>("input")!;

  const index = () => Math.round(strip.scrollLeft / Math.max(strip.clientWidth, 1));
  const goTo = (i: number, smooth = true) =>
    strip.scrollTo({
      left: Math.max(0, Math.min(i, images.length - 1)) * strip.clientWidth,
      behavior: smooth && !reducedMotion(doc) ? "smooth" : "instant",
    });

  function update() {
    const i = index();
    counter.textContent = images.length > 1 ? `${i + 1} / ${images.length}` : "";
    prev.hidden = i <= 0;
    next.hidden = i >= images.length - 1;
    film.querySelectorAll("button").forEach((b, n) => {
      b.classList.toggle("current", n === i);
      if (n === i) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    film.querySelector(".current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  const picture = (img: GalleryImage) => {
    const el = doc.createElement("img");
    el.src = img.url;
    el.alt = img.name;
    el.loading = "lazy"; // 30 full-size images shouldn't all decode at once
    el.decoding = "async";
    return el;
  };

  function render(start: number) {
    strip.replaceChildren(
      ...images.map((img) => {
        const slide = doc.createElement("div");
        slide.className = "slide";
        slide.append(picture(img));
        return slide;
      }),
    );
    // Thumbnails are buttons, so the keyboard can reach them too.
    film.replaceChildren(
      ...images.map((img, n) => {
        const btn = doc.createElement("button");
        btn.setAttribute("aria-label", img.name);
        btn.append(picture(img));
        btn.onclick = () => goTo(n);
        return btn;
      }),
    );
    film.hidden = images.length < 2 && !opts.onAdd;
    requestAnimationFrame(() => {
      goTo(start, false);
      update();
    });
  }

  function close() {
    dialog.close();
    dialog.remove();
    doc.defaultView?.removeEventListener("resize", onResize);
    opts.onClose?.();
  }

  const tool = (label: string, svg: string, run: () => void) => {
    const btn = doc.createElement("button");
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.innerHTML = svg;
    btn.onclick = run;
    tools.append(btn);
  };
  prev.setAttribute("aria-label", t("prevImage"));
  next.setAttribute("aria-label", t("nextImage"));
  if (opts.onAdd) tool(t("addImages"), ICONS.plus, () => fileInput.click());
  if (opts.onRemove) {
    tool(t("deleteThisImage"), ICONS.trash, async () => {
      const current = images[index()];
      if (!current || !(await confirmDanger("deleteImageTitle", "deleteImageBody", doc))) return;
      const at = index();
      images = await opts.onRemove!(current);
      if (!images.length) return close();
      render(Math.min(at, images.length - 1));
    });
  }
  tool(t("close"), ICONS.close, close);

  fileInput.onchange = async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    if (!files.length || !opts.onAdd) return;
    images = await opts.onAdd(files);
    render(images.length - 1);
  };

  strip.addEventListener("scroll", update, { passive: true });
  prev.onclick = () => goTo(index() - 1);
  next.onclick = () => goTo(index() + 1);
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") goTo(index() - 1);
    if (e.key === "ArrowRight") goTo(index() + 1);
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });

  // Swipe down to close (iOS-style): the image follows the finger, the black
  // fades, and a far or fast enough flick closes. Sideways swipes stay native.
  let y0 = 0;
  let x0 = 0;
  let dy = 0;
  let dragging = false;
  let samples: [y: number, time: number][] = [];
  const slide = () => strip.children[index()] as HTMLElement | undefined;
  strip.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    [y0, x0, dy, dragging, samples] = [e.clientY, e.clientX, 0, false, []];
  });
  strip.addEventListener("pointermove", (e) => {
    if (!y0) return;
    dy = e.clientY - y0;
    if (!dragging && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(e.clientX - x0)) dragging = true;
    if (!dragging) return;
    samples = [...samples.slice(-4), [e.clientY, e.timeStamp]];
    const down = Math.max(0, dy);
    const s = slide()?.style;
    if (s) s.transform = reducedMotion(doc) ? "" : `translateY(${dy < 0 ? dy / 4 : down}px) scale(${1 - Math.min(down, 400) / 2000})`;
    dialog.style.backgroundColor = `rgb(0 0 0 / ${1 - Math.min(down / 400, 0.7)})`;
  });
  const endDrag = () => {
    y0 = 0;
    if (!dragging) return;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const velocity = first && last && last[1] > first[1] ? (last[0] - first[0]) / (last[1] - first[1]) : 0; // px per ms
    const s = slide()?.style;
    if (dy + velocity * 200 > 200) {
      if (s) s.transition = "transform 200ms var(--ease-out), opacity 200ms";
      if (s) s.transform = "translateY(60dvh)";
      if (s) s.opacity = "0";
      setTimeout(close, 180);
    } else {
      if (s) s.transition = "transform 300ms var(--ease-out)";
      if (s) s.transform = "";
      dialog.style.backgroundColor = "";
      setTimeout(() => s && (s.transition = ""), 300);
    }
    // The click that ends a drag must not count as "tap outside to close".
    setTimeout(() => (dragging = false), 0);
  };
  strip.addEventListener("pointerup", endDrag);
  strip.addEventListener("pointercancel", endDrag);

  // Tapping the dark area around an image closes the viewer.
  strip.onclick = (e) => {
    if (!dragging && (e.target as HTMLElement).classList.contains("slide")) close();
  };
  const onResize = () => dialog.open && goTo(index(), false);
  doc.defaultView?.addEventListener("resize", onResize);

  dialog.showModal();
  render(opts.start ?? 0);
}
