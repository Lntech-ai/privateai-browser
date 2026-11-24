/**
 * In-page accessibility-ish snapshot with stable short-lived refs (Playwright MCP style).
 *
 * CRITICAL: every function passed to chrome.scripting.executeScript must be fully
 * self-contained — Chrome serializes only that function's body. No outer helpers.
 */

export type SnapshotResult = {
  ok: boolean;
  error?: string;
  url?: string;
  title?: string;
  snapshot?: string;
  refCount?: number;
};

export type ActionResult = { ok: boolean; error?: string; ref?: string };

/** Pure function injected into the page to build a text a11y snapshot and stamp data-pai-ref. */
export function buildSnapshotInPage(interactiveOnly: boolean, maxNodes: number): SnapshotResult {
  const ATTR = "data-pai-ref";

  try {
    document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));

    const isVisible = (el: Element) => {
      const html = el as HTMLElement;
      if (!html.getBoundingClientRect) return false;
      const style = window.getComputedStyle(html);
      if (style.display === "none" || style.visibility === "hidden") return false;
      // Do not reject opacity:0 — WhatsApp animates rows that way during layout.
      const rect = html.getBoundingClientRect();
      // Allow off-screen list rows (negative top) as long as they have a box.
      if (rect.width < 2 && rect.height < 2) return false;
      return true;
    };

    const roleOf = (el: Element): string => {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "a" && el.hasAttribute("href")) return "link";
      if (tag === "button") return "button";
      if (tag === "input") {
        const type = ((el as HTMLInputElement).type || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "submit" || type === "button") return "button";
        return "textbox";
      }
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "img") return "image";
      if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
        return "heading";
      }
      if ((el as HTMLElement).isContentEditable) return "textbox";
      return tag;
    };

    const nameOf = (el: Element): string => {
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const parts = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText?.trim() || "")
          .filter(Boolean);
        if (parts.length) return parts.join(" ").slice(0, 120);
      }
      const candidates = [
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.getAttribute("placeholder"),
        el.getAttribute("title"),
        el.getAttribute("alt"),
        el.getAttribute("name"),
        (el as HTMLInputElement).value,
        (el as HTMLElement).innerText,
      ];
      for (const c of candidates) {
        const t = (c || "").replace(/\s+/g, " ").trim();
        if (t) return t.slice(0, 120);
      }
      return "";
    };

    const INTERACTIVE_ROLES = new Set([
      "button",
      "link",
      "textbox",
      "searchbox",
      "checkbox",
      "radio",
      "combobox",
      "listbox",
      "option",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "switch",
      "row",
      "gridcell",
      "listitem",
      "treeitem",
      "slider",
      "spinbutton",
    ]);

    const isInteractive = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (["button", "a", "input", "textarea", "select", "summary", "option"].includes(tag)) {
        return true;
      }
      if ((el as HTMLElement).isContentEditable) return true;
      if (el.getAttribute("contenteditable") === "true") return true;

      const role = el.getAttribute("role");
      if (role && INTERACTIVE_ROLES.has(role)) return true;

      if (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") return true;
      if (el.hasAttribute("onclick")) return true;
      if (el.hasAttribute("data-icon")) return true;

      // SPAs (WhatsApp, etc.): clickable rows often only show pointer cursor.
      // Require a usable name so layout shells are skipped.
      try {
        const cursor = window.getComputedStyle(el as HTMLElement).cursor;
        if (cursor === "pointer" && nameOf(el)) return true;
      } catch {
        // ignore
      }
      return false;
    };

    const visitRoot = (root: Element | ShadowRoot, into: Element[]) => {
      const walk = (el: Element) => {
        if (into.length >= maxNodes) return;

        if (el instanceof HTMLElement || el instanceof SVGElement) {
          if (isVisible(el)) {
            const interactive = isInteractive(el);
            const role = roleOf(el);
            const keep =
              interactive ||
              (!interactiveOnly &&
                (role === "heading" ||
                  role === "image" ||
                  role === "list" ||
                  role === "grid" ||
                  el.tagName.toLowerCase() === "p"));
            if (keep) into.push(el);
          }
        }

        // Pierce open shadow roots (WhatsApp / Lit / etc.)
        const shadow = (el as HTMLElement).shadowRoot;
        if (shadow) visitRoot(shadow, into);

        for (const child of Array.from(el.children)) walk(child);
      };

      if (root instanceof Element) walk(root);
      else for (const child of Array.from(root.children)) walk(child);
    };

    const collected: Element[] = [];
    if (document.body) visitRoot(document.body, collected);

    // Prefer deepest interactive nodes (drop wrappers that only contain other hits)
    const filtered = collected.filter((el) => {
      if (!isInteractive(el)) return true;
      const interactiveKids = collected.filter(
        (other) => other !== el && el.contains(other) && isInteractive(other),
      );
      return interactiveKids.length === 0;
    });

    // If still empty, fall back to any element with aria-label / contenteditable / role
    let nodes = filtered;
    if (nodes.length === 0) {
      const fallback = Array.from(
        document.querySelectorAll(
          '[contenteditable="true"], [role="textbox"], [role="button"], [role="listitem"], [role="row"], [aria-label], [data-testid], button, a[href], input, textarea',
        ),
      ).filter((el) => isVisible(el));
      nodes = fallback.slice(0, maxNodes);
    }

    const lines: string[] = [];
    let index = 0;
    for (const el of nodes.slice(0, maxNodes)) {
      index += 1;
      const ref = `e${index}`;
      el.setAttribute(ATTR, ref);
      const role = roleOf(el);
      const name = nameOf(el);
      const states: string[] = [];
      if ((el as HTMLInputElement).disabled || el.getAttribute("aria-disabled") === "true") {
        states.push("disabled");
      }
      if ((el as HTMLInputElement).checked || el.getAttribute("aria-checked") === "true") {
        states.push("checked");
      }
      if (el.getAttribute("aria-expanded")) {
        states.push(`expanded=${el.getAttribute("aria-expanded")}`);
      }
      if (el.getAttribute("aria-pressed")) {
        states.push(`pressed=${el.getAttribute("aria-pressed")}`);
      }

      let depth = 0;
      let p: Element | null = el.parentElement;
      while (p && p !== document.body) {
        depth += 1;
        p = p.parentElement;
      }
      depth = Math.min(depth, 8);

      const indent = "  ".repeat(Math.max(0, depth - 1));
      const namePart = name ? ` ${JSON.stringify(name)}` : "";
      const statePart = states.length ? ` [${states.join(", ")}]` : "";
      lines.push(`${indent}- ${role}${namePart} [ref=${ref}]${statePart}`);
    }

    return {
      ok: true,
      url: location.href,
      title: document.title,
      snapshot: lines.join("\n") || "(no interactive elements found)",
      refCount: index,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      url: location.href,
      title: document.title,
      snapshot: "",
      refCount: 0,
    };
  }
}

/**
 * MUST stay fully self-contained: chrome.scripting.executeScript serializes only
 * this function body (no sibling helpers / imports survive injection).
 */
export function clickInPage(target: string): ActionResult {
  const ATTR = "data-pai-ref";
  const trimmed = (target || "").trim();
  if (!trimmed) return { ok: false, error: "Missing target" };

  // Playwright :has-text/:text, jQuery :contains, text=…
  const extractTextNeedles = (value: string): string[] => {
    const found: string[] = [];
    const re =
      /(?::has-text|:text|:contains)\(\s*(['"])([\s\S]*?)\1\s*\)|text\s*=\s*(['"]?)([\s\S]*?)\3(?:\s|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      const needle = (m[2] || m[4] || "").trim();
      if (needle) found.push(needle);
    }
    // Dedupe, longest first (more specific labels win)
    return Array.from(new Set(found)).sort((a, b) => b.length - a.length);
  };

  const findByVisibleText = (needle: string): HTMLElement | null => {
    const want = needle.trim().toLowerCase();
    if (!want) return null;

    const stamped = Array.from(document.querySelectorAll(`[${ATTR}]`)) as HTMLElement[];
    for (const el of stamped) {
      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.innerText ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (label.includes(want)) return el;
    }

    const all = Array.from(
      document.querySelectorAll(
        'a, button, [role="button"], [role="link"], [role="row"], [role="option"], [role="listitem"], [tabindex], span, div, li, p',
      ),
    ) as HTMLElement[];

    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      if (lower !== want && !lower.includes(want)) continue;
      const score = (lower === want ? 0 : 100) + text.length;
      if (score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  };

  let el: HTMLElement | null = null;

  if (/^e\d+$/i.test(trimmed)) {
    el = document.querySelector(`[${ATTR}="${trimmed}"]`) as HTMLElement | null;
    if (!el) {
      return {
        ok: false,
        error: `Ref ${trimmed} not found. Call browser_snapshot again — refs are invalidated when the page changes.`,
      };
    }
  } else {
    const textNeedles = extractTextNeedles(trimmed);
    if (textNeedles.length) {
      for (const needle of textNeedles) {
        el = findByVisibleText(needle);
        if (el) break;
      }
      if (!el) {
        return {
          ok: false,
          error: `No element with text ${JSON.stringify(textNeedles[0])}. Prefer browser_snapshot then click ref="eN".`,
        };
      }
    } else {
      try {
        el = document.querySelector(trimmed) as HTMLElement | null;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: `Invalid CSS selector ${JSON.stringify(trimmed)} (${msg}). Use ref from browser_snapshot (e.g. ref="e12"), not :has-text()/:contains().`,
        };
      }
      if (!el) {
        return {
          ok: false,
          error: `No element for selector: ${trimmed}. Prefer browser_snapshot then click ref="eN".`,
        };
      }
    }
  }

  el.scrollIntoView({ block: "center", inline: "center" });
  el.focus?.();
  el.click();
  return { ok: true, ref: el.getAttribute(ATTR) || undefined };
}

/**
 * MUST stay fully self-contained for chrome.scripting.executeScript serialization.
 * Empty target → focused field, else visible compose/textbox (WhatsApp etc.).
 */
export function typeInPage(target: string, text: string, submit: boolean): ActionResult {
  const ATTR = "data-pai-ref";
  const trimmed = (target || "").trim();

  const isTypeable = (node: Element | null): node is HTMLElement => {
    if (!node || !(node instanceof HTMLElement)) return false;
    if (node.isContentEditable || node.getAttribute("contenteditable") === "true") return true;
    const tag = node.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const type = ((node as HTMLInputElement).type || "text").toLowerCase();
      return !["button", "submit", "checkbox", "radio", "file", "hidden", "reset", "image"].includes(
        type,
      );
    }
    const role = node.getAttribute("role");
    return role === "textbox" || role === "searchbox";
  };

  const findComposeBox = (): HTMLElement | null => {
    const active = document.activeElement;
    if (isTypeable(active)) return active;

    const stamped = Array.from(document.querySelectorAll(`[${ATTR}]`)) as HTMLElement[];
    for (const el of stamped) {
      if (isTypeable(el)) {
        const label = (el.getAttribute("aria-label") || el.getAttribute("data-tab") || "").toLowerCase();
        if (label.includes("message") || label.includes("type") || el.isContentEditable) {
          return el;
        }
      }
    }

    const candidates = Array.from(
      document.querySelectorAll(
        '[contenteditable="true"], [role="textbox"], textarea, input:not([type]), input[type="text"], input[type="search"]',
      ),
    ) as HTMLElement[];

    let best: HTMLElement | null = null;
    let bestScore = -1;
    for (const el of candidates) {
      if (!isTypeable(el)) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 10) continue;
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      let score = rect.width * rect.height;
      if (label.includes("message") || label.includes("type a message")) score += 1e9;
      if (el.isContentEditable) score += 1e6;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  };

  const extractTextNeedles = (value: string): string[] => {
    const found: string[] = [];
    const re =
      /(?::has-text|:text|:contains)\(\s*(['"])([\s\S]*?)\1\s*\)|text\s*=\s*(['"]?)([\s\S]*?)\3(?:\s|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      const needle = (m[2] || m[4] || "").trim();
      if (needle) found.push(needle);
    }
    return Array.from(new Set(found)).sort((a, b) => b.length - a.length);
  };

  const findByVisibleText = (needle: string): HTMLElement | null => {
    const want = needle.trim().toLowerCase();
    if (!want) return null;

    const stamped = Array.from(document.querySelectorAll(`[${ATTR}]`)) as HTMLElement[];
    for (const el of stamped) {
      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.innerText ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (label.includes(want)) return el;
    }

    const all = Array.from(
      document.querySelectorAll(
        'a, button, [role="button"], [role="link"], [role="row"], [role="option"], [role="listitem"], [tabindex], span, div, li, p',
      ),
    ) as HTMLElement[];

    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const nodeText = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!nodeText) continue;
      const lower = nodeText.toLowerCase();
      if (lower !== want && !lower.includes(want)) continue;
      const score = (lower === want ? 0 : 100) + nodeText.length;
      if (score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  };

  let el: HTMLElement | null = null;

  if (!trimmed) {
    el = findComposeBox();
    if (!el) {
      return {
        ok: false,
        error:
          'No typeable field found. Open a chat, then pass ref from browser_snapshot (e.g. the "Type a message" textbox).',
      };
    }
  } else if (/^e\d+$/i.test(trimmed)) {
    el = document.querySelector(`[${ATTR}="${trimmed}"]`) as HTMLElement | null;
    if (!el) {
      return {
        ok: false,
        error: `Ref ${trimmed} not found. Call browser_snapshot again — refs are invalidated when the page changes.`,
      };
    }
  } else {
    const textNeedles = extractTextNeedles(trimmed);
    if (textNeedles.length) {
      for (const needle of textNeedles) {
        el = findByVisibleText(needle);
        if (el) break;
      }
      if (!el) {
        return {
          ok: false,
          error: `No element with text ${JSON.stringify(textNeedles[0])}. Prefer browser_snapshot then type with ref="eN".`,
        };
      }
    } else {
      try {
        el = document.querySelector(trimmed) as HTMLElement | null;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: `Invalid CSS selector ${JSON.stringify(trimmed)} (${msg}). Use ref from browser_snapshot.`,
        };
      }
      if (!el) {
        return {
          ok: false,
          error: `No element for selector: ${trimmed}. Prefer browser_snapshot then type with ref="eN".`,
        };
      }
    }
  }

  el.scrollIntoView({ block: "center", inline: "center" });
  el.focus();

  if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
    // Prefer execCommand so React/WhatsApp contenteditables pick up the change.
    try {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text);
    } catch {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }
  } else if ("value" in el) {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName.toLowerCase() === "textarea"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(input, text);
    else input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    return { ok: false, error: "Element is not typeable" };
  }

  if (submit) {
    const form = el.closest("form");
    if (form) form.requestSubmit();
    else {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
        }),
      );
    }
  }

  return { ok: true, ref: el.getAttribute(ATTR) || undefined };
}

export type ScrollResult = {
  ok: boolean;
  error?: string;
  direction?: string;
  scrolled?: number;
  top?: number;
  max?: number;
  atTop?: boolean;
  atBottom?: boolean;
  ref?: string;
};

/**
 * Scroll the page (or nearest scrollable pane) / bring a ref into view.
 * Self-contained for chrome.scripting.executeScript.
 *
 * direction: down | up | top | bottom | into_view
 */
export function scrollInPage(
  direction: string,
  amountPx: number,
  target: string,
): ScrollResult {
  const ATTR = "data-pai-ref";
  const dir = (direction || "").trim().toLowerCase();
  const trimmed = (target || "").trim();

  const resolveEl = (value: string): HTMLElement | null => {
    if (!value) return null;
    if (/^e\d+$/i.test(value)) {
      return document.querySelector(`[${ATTR}="${value}"]`) as HTMLElement | null;
    }
    try {
      return document.querySelector(value) as HTMLElement | null;
    } catch {
      return null;
    }
  };

  const scrolls = (node: Element) => {
    const style = getComputedStyle(node);
    return (
      /auto|scroll|overlay/.test(style.overflowY) &&
      (node as HTMLElement).scrollHeight > (node as HTMLElement).clientHeight + 1
    );
  };

  const findScrollBox = (from: Element | null): Element => {
    const root = document.scrollingElement || document.documentElement;
    if (from) {
      for (
        let node: Element | null = from;
        node && node !== root;
        node =
          node.parentElement ||
          ((node.getRootNode() as ShadowRoot).host as Element | null) ||
          null
      ) {
        if (scrolls(node)) return node;
      }
      if (scrolls(root)) return root;
    }

    // Apps that hide document scroll and use an inner pane (Shopee, WhatsApp).
    if (root.scrollHeight <= root.clientHeight + 1) {
      let best: Element | null = null;
      let bestArea = 0;
      for (const node of document.body?.querySelectorAll("*") || []) {
        if (!scrolls(node)) continue;
        const rect = (node as HTMLElement).getBoundingClientRect();
        const visibleH =
          Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
        const visibleW =
          Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
        const area = visibleH * visibleW;
        if (area > bestArea) {
          bestArea = area;
          best = node;
        }
      }
      if (best) return best;
    }
    return root;
  };

  if (dir === "into_view" || dir === "into-view" || (!dir && trimmed)) {
    const el = resolveEl(trimmed);
    if (!el) {
      return {
        ok: false,
        error: trimmed
          ? `Target ${JSON.stringify(trimmed)} not found. Call browser_snapshot again.`
          : "Provide ref/selector for into_view, or direction down|up|top|bottom",
      };
    }
    el.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant" as ScrollBehavior,
    });
    return { ok: true, direction: "into_view", ref: el.getAttribute(ATTR) || undefined };
  }

  if (!["down", "up", "top", "bottom"].includes(dir)) {
    return {
      ok: false,
      error:
        "direction must be down|up|top|bottom|into_view (or pass ref to scroll into view)",
    };
  }

  const anchor = trimmed ? resolveEl(trimmed) : null;
  if (trimmed && !anchor) {
    return {
      ok: false,
      error: `Target ${JSON.stringify(trimmed)} not found. Call browser_snapshot again.`,
    };
  }

  const box = findScrollBox(anchor);
  const htmlBox = box as HTMLElement;
  const before = htmlBox.scrollTop;
  const max = Math.max(0, htmlBox.scrollHeight - htmlBox.clientHeight);
  const defaultPx = Math.max(120, Math.floor(htmlBox.clientHeight * 0.85));
  const px = amountPx > 0 ? amountPx : defaultPx;

  if (dir === "top") htmlBox.scrollTop = 0;
  else if (dir === "bottom") htmlBox.scrollTop = max + 1;
  else if (dir === "down") htmlBox.scrollTop = Math.min(max, before + px);
  else htmlBox.scrollTop = Math.max(0, before - px);

  box.dispatchEvent(new Event("scroll", { bubbles: true }));

  const after = htmlBox.scrollTop;
  const afterMax = Math.max(0, htmlBox.scrollHeight - htmlBox.clientHeight);
  return {
    ok: true,
    direction: dir,
    scrolled: after - before,
    top: after,
    max: afterMax,
    atTop: after <= 1,
    atBottom: after >= afterMax - 2,
    ref: anchor?.getAttribute(ATTR) || undefined,
  };
}

export type KeyResult = { ok: boolean; error?: string; key?: string; ref?: string };

/** Dispatch a key on the target (or active element / body). Self-contained. */
export function pressKeyInPage(key: string, target: string): KeyResult {
  const ATTR = "data-pai-ref";
  const raw = (key || "").trim();
  if (!raw) return { ok: false, error: "key is required (e.g. Enter, Escape, ArrowDown, Tab)" };

  const trimmed = (target || "").trim();
  let el: HTMLElement | null = null;
  if (trimmed) {
    if (/^e\d+$/i.test(trimmed)) {
      el = document.querySelector(`[${ATTR}="${trimmed}"]`) as HTMLElement | null;
    } else {
      try {
        el = document.querySelector(trimmed) as HTMLElement | null;
      } catch {
        return { ok: false, error: `Invalid selector ${JSON.stringify(trimmed)}` };
      }
    }
    if (!el) {
      return {
        ok: false,
        error: `Target ${JSON.stringify(trimmed)} not found. Call browser_snapshot again.`,
      };
    }
  } else {
    el =
      (document.activeElement as HTMLElement | null) &&
      document.activeElement !== document.body
        ? (document.activeElement as HTMLElement)
        : document.body;
  }

  el.focus?.();
  const aliases: Record<string, { key: string; code: string; keyCode: number }> = {
    enter: { key: "Enter", code: "Enter", keyCode: 13 },
    return: { key: "Enter", code: "Enter", keyCode: 13 },
    escape: { key: "Escape", code: "Escape", keyCode: 27 },
    esc: { key: "Escape", code: "Escape", keyCode: 27 },
    tab: { key: "Tab", code: "Tab", keyCode: 9 },
    backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    delete: { key: "Delete", code: "Delete", keyCode: 46 },
    space: { key: " ", code: "Space", keyCode: 32 },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    home: { key: "Home", code: "Home", keyCode: 36 },
    end: { key: "End", code: "End", keyCode: 35 },
    pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
    pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  };
  const mapped = aliases[raw.toLowerCase()] || {
    key: raw,
    code: raw.length === 1 ? `Key${raw.toUpperCase()}` : raw,
    keyCode: raw.length === 1 ? raw.toUpperCase().charCodeAt(0) : 0,
  };

  for (const type of ["keydown", "keypress", "keyup"] as const) {
    if (type === "keypress" && mapped.key.length !== 1 && mapped.key !== "Enter") continue;
    el.dispatchEvent(
      new KeyboardEvent(type, {
        key: mapped.key,
        code: mapped.code,
        keyCode: mapped.keyCode,
        which: mapped.keyCode,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  return { ok: true, key: mapped.key, ref: el.getAttribute?.(ATTR) || undefined };
}

export type HoverResult = { ok: boolean; error?: string; ref?: string };

/** Hover / mouseover a ref or selector. Self-contained. */
export function hoverInPage(target: string): HoverResult {
  const ATTR = "data-pai-ref";
  const trimmed = (target || "").trim();
  if (!trimmed) return { ok: false, error: "Provide ref (from snapshot) or selector" };

  let el: HTMLElement | null = null;
  if (/^e\d+$/i.test(trimmed)) {
    el = document.querySelector(`[${ATTR}="${trimmed}"]`) as HTMLElement | null;
  } else {
    try {
      el = document.querySelector(trimmed) as HTMLElement | null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Invalid selector (${msg})` };
    }
  }
  if (!el) {
    return {
      ok: false,
      error: `Target ${JSON.stringify(trimmed)} not found. Call browser_snapshot again.`,
    };
  }

  el.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "instant" as ScrollBehavior,
  });
  const rect = el.getBoundingClientRect();
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    view: window,
  };
  el.dispatchEvent(new MouseEvent("pointerover", opts));
  el.dispatchEvent(new MouseEvent("pointerenter", opts));
  el.dispatchEvent(new MouseEvent("mouseover", opts));
  el.dispatchEvent(new MouseEvent("mouseenter", opts));
  el.dispatchEvent(new MouseEvent("mousemove", opts));
  return { ok: true, ref: el.getAttribute(ATTR) || undefined };
}

export type SelectResult = { ok: boolean; error?: string; value?: string; ref?: string };

/** Choose an option on a <select> by value or visible label. Self-contained. */
export function selectInPage(target: string, value: string): SelectResult {
  const ATTR = "data-pai-ref";
  const trimmed = (target || "").trim();
  const want = (value || "").trim();
  if (!trimmed) return { ok: false, error: "Provide ref/selector for the <select>" };
  if (!want) return { ok: false, error: "value is required (option value or label text)" };

  let el: HTMLElement | null = null;
  if (/^e\d+$/i.test(trimmed)) {
    el = document.querySelector(`[${ATTR}="${trimmed}"]`) as HTMLElement | null;
  } else {
    try {
      el = document.querySelector(trimmed) as HTMLElement | null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Invalid selector (${msg})` };
    }
  }
  if (!el) {
    return {
      ok: false,
      error: `Target ${JSON.stringify(trimmed)} not found. Call browser_snapshot again.`,
    };
  }

  const select =
    el.tagName.toLowerCase() === "select"
      ? (el as HTMLSelectElement)
      : (el.querySelector("select") as HTMLSelectElement | null);
  if (!select) {
    return { ok: false, error: "Element is not a <select> (and has no nested select)" };
  }

  const options = Array.from(select.options);
  const match =
    options.find((o) => o.value === want) ||
    options.find((o) => o.text.trim() === want) ||
    options.find((o) => o.text.trim().toLowerCase() === want.toLowerCase()) ||
    options.find((o) => o.text.toLowerCase().includes(want.toLowerCase()));
  if (!match) {
    return {
      ok: false,
      error: `No option matching ${JSON.stringify(want)}. Options: ${options
        .slice(0, 12)
        .map((o) => o.text.trim() || o.value)
        .join(" | ")}`,
    };
  }

  select.value = match.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: match.value, ref: el.getAttribute(ATTR) || undefined };
}
