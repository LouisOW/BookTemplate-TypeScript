// Page chrome: sidebar, theme picker, keyboard navigation, copy buttons.

// Read lazily so this module can be imported outside a browser (unit tests).
const root = () => document.documentElement;
const MOBILE = "(max-width: 999px)";

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Not fatal.
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True while a modal surface (quiz, search) owns the keyboard. */
export function modalOpen(): boolean {
  return root().classList.contains("quiz-open") || !(document.getElementById("search")?.hidden ?? true);
}

function initSidebar() {
  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  if (!toggle || !sidebar) return;

  const sync = () => {
    const open = matchMedia(MOBILE).matches ? root().classList.contains("sidebar-open") : !root().classList.contains("sidebar-hidden");
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => {
    if (matchMedia(MOBILE).matches) {
      root().classList.toggle("sidebar-open");
    } else {
      root().classList.toggle("sidebar-hidden");
      store("book-sidebar", root().classList.contains("sidebar-hidden") ? "hidden" : "visible");
    }
    sync();
  });
  // On mobile, tapping the page outside the open sidebar closes it.
  document.addEventListener("click", e => {
    if (!root().classList.contains("sidebar-open")) return;
    const target = e.target as Node;
    if (!sidebar.contains(target) && !toggle.contains(target)) {
      root().classList.remove("sidebar-open");
      sync();
    }
  });
  matchMedia(MOBILE).addEventListener("change", sync);
  sync();

  sidebar.querySelector(".active")?.scrollIntoView({ block: "center" });
}

function applyTheme(choice: string) {
  const theme = choice === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : choice;
  root().dataset.theme = theme;
}

function initThemePicker() {
  const button = document.getElementById("theme-toggle");
  const list = document.getElementById("theme-list");
  if (!button || !list) return;

  const close = () => {
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", e => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    button.setAttribute("aria-expanded", String(!list.hidden));
    if (!list.hidden) list.querySelector<HTMLButtonElement>(`[data-theme="${read("book-theme") ?? "system"}"]`)?.focus();
  });
  list.addEventListener("click", e => {
    const choice = (e.target as HTMLElement).closest<HTMLElement>("[data-theme]")?.dataset.theme;
    if (!choice) return;
    store("book-theme", choice);
    applyTheme(choice);
    close();
    button.focus();
  });
  list.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      close();
      button.focus();
    }
  });
  document.addEventListener("click", close);

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((read("book-theme") ?? "system") === "system") applyTheme("system");
  });
}

function initKeyboardNav() {
  document.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || modalOpen()) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
    const link =
      e.key === "ArrowLeft"
        ? document.querySelector<HTMLAnchorElement>(".nav-prev")
        : e.key === "ArrowRight"
          ? document.querySelector<HTMLAnchorElement>(".nav-next")
          : null;
    if (link) {
      e.preventDefault();
      location.href = link.href;
    }
  });
}

/** Returns the button row for a code block, creating it if needed. Shared with runnable.ts. */
export function codeButtons(pre: HTMLElement): HTMLElement {
  let row = pre.querySelector<HTMLElement>(":scope > .code-buttons");
  if (!row) {
    row = document.createElement("div");
    row.className = "code-buttons";
    pre.prepend(row);
  }
  return row;
}

function initCopyButtons() {
  for (const pre of document.querySelectorAll<HTMLElement>("pre.code-block")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code to clipboard");
    button.addEventListener("click", async () => {
      const code = pre.querySelector("code")?.innerText ?? "";
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "Copied!";
      } catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
    codeButtons(pre).append(button);
  }
}

export function initChrome() {
  initSidebar();
  initThemePicker();
  initKeyboardNav();
  initCopyButtons();
}

export { read as readStorage, store as writeStorage };
