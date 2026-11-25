/**
 * Injectable agent chrome (cursor + page border + target highlight).
 *
 * CRITICAL: every function passed to chrome.scripting.executeScript must be
 * fully self-contained — Chrome serializes only that function's body.
 */

export const AGENT_OVERLAY_HOST_ID = "__privateai_agent_overlay";

export type OverlayPointResult = {
  ok: boolean;
  error?: string;
  x?: number;
  y?: number;
};

/** Create / refresh border + cursor host on the page. */
export function ensureAgentOverlayInPage(): { ok: boolean } {
  const HOST_ID = "__privateai_agent_overlay";
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("privateai-agent-overlay");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-pai-agent-overlay", "1");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:visible;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .border {
          position: absolute; inset: 0;
          box-shadow: inset 0 0 0 3px #2563eb, inset 0 0 24px rgba(37,99,235,.35);
          border-radius: 0;
        }
        .cursor {
          position: absolute; left: 0; top: 0; width: 0; height: 0;
          transition: transform 300ms ease-out;
          will-change: transform;
        }
        .arrow {
          position: absolute; left: -3px; top: -3px;
          filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)) drop-shadow(0 0 6px rgba(37,99,235,.9));
        }
        .label {
          position: absolute; left: 22px; top: 26px;
          padding: 3px 9px; border-radius: 999px;
          background: #2563eb; color: #fff;
          font: 600 12px/16px system-ui, -apple-system, sans-serif;
          white-space: nowrap; border: 1.5px solid #fff;
          box-shadow: 0 2px 6px rgba(0,0,0,.35);
        }
        .highlight {
          position: absolute; pointer-events: none;
          border: 2px dashed #2563eb; border-radius: 4px;
          background: rgba(37,99,235,.12);
          box-shadow: 0 0 0 1px rgba(255,255,255,.8);
          display: none;
        }
      </style>
      <div class="border"></div>
      <div class="highlight"></div>
      <div class="cursor">
        <svg class="arrow" width="30" height="36" viewBox="0 0 20 24">
          <path d="M1 1 L1 19 L6 14.5 L9.5 22 L12.5 20.7 L9 13.3 L15.5 13 Z"
            fill="#2563eb" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <div class="label">PrivateAI</div>
      </div>
    `;
    document.documentElement.appendChild(host);
  }
  host.style.visibility = "visible";
  return { ok: true };
}

/** Move the floating cursor; ensure overlay exists. */
export function moveAgentCursorInPage(x: number, y: number): OverlayPointResult {
  const HOST_ID = "__privateai_agent_overlay";
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("privateai-agent-overlay");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-pai-agent-overlay", "1");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:visible;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .border {
          position: absolute; inset: 0;
          box-shadow: inset 0 0 0 3px #2563eb, inset 0 0 24px rgba(37,99,235,.35);
        }
        .cursor {
          position: absolute; left: 0; top: 0; width: 0; height: 0;
          transition: transform 300ms ease-out; will-change: transform;
        }
        .arrow {
          position: absolute; left: -3px; top: -3px;
          filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)) drop-shadow(0 0 6px rgba(37,99,235,.9));
        }
        .label {
          position: absolute; left: 22px; top: 26px; padding: 3px 9px; border-radius: 999px;
          background: #2563eb; color: #fff;
          font: 600 12px/16px system-ui, -apple-system, sans-serif;
          white-space: nowrap; border: 1.5px solid #fff;
          box-shadow: 0 2px 6px rgba(0,0,0,.35);
        }
        .highlight {
          position: absolute; pointer-events: none;
          border: 2px dashed #2563eb; border-radius: 4px;
          background: rgba(37,99,235,.12);
          box-shadow: 0 0 0 1px rgba(255,255,255,.8);
          display: none;
        }
      </style>
      <div class="border"></div>
      <div class="highlight"></div>
      <div class="cursor">
        <svg class="arrow" width="30" height="36" viewBox="0 0 20 24">
          <path d="M1 1 L1 19 L6 14.5 L9.5 22 L12.5 20.7 L9 13.3 L15.5 13 Z"
            fill="#2563eb" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <div class="label">PrivateAI</div>
      </div>
    `;
    document.documentElement.appendChild(host);
  }
  host.style.visibility = "visible";
  const root = host.shadowRoot;
  const cursor = root?.querySelector(".cursor") as HTMLElement | null;
  if (cursor) cursor.style.transform = `translate(${x}px, ${y}px)`;
  return { ok: true, x, y };
}

/** Highlight a viewport rect and point the cursor at its center. */
export function highlightRectInPage(
  left: number,
  top: number,
  width: number,
  height: number,
): OverlayPointResult {
  const HOST_ID = "__privateai_agent_overlay";
  let host = document.getElementById(HOST_ID);
  if (!host) {
    // ensure exists (same markup as move)
    const ensure = () => {
      const el = document.createElement("privateai-agent-overlay");
      el.id = HOST_ID;
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("data-pai-agent-overlay", "1");
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:visible;";
      const shadow = el.attachShadow({ mode: "closed" });
      shadow.innerHTML = `
        <style>
          .border {
            position: absolute; inset: 0;
            box-shadow: inset 0 0 0 3px #2563eb, inset 0 0 24px rgba(37,99,235,.35);
          }
          .cursor {
            position: absolute; left: 0; top: 0; width: 0; height: 0;
            transition: transform 300ms ease-out; will-change: transform;
          }
          .arrow {
            position: absolute; left: -3px; top: -3px;
            filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)) drop-shadow(0 0 6px rgba(37,99,235,.9));
          }
          .label {
            position: absolute; left: 22px; top: 26px; padding: 3px 9px; border-radius: 999px;
            background: #2563eb; color: #fff;
            font: 600 12px/16px system-ui, -apple-system, sans-serif;
            white-space: nowrap; border: 1.5px solid #fff;
            box-shadow: 0 2px 6px rgba(0,0,0,.35);
          }
          .highlight {
            position: absolute; pointer-events: none;
            border: 2px dashed #2563eb; border-radius: 4px;
            background: rgba(37,99,235,.12);
            box-shadow: 0 0 0 1px rgba(255,255,255,.8);
            display: none;
          }
        </style>
        <div class="border"></div>
        <div class="highlight"></div>
        <div class="cursor">
          <svg class="arrow" width="30" height="36" viewBox="0 0 20 24">
            <path d="M1 1 L1 19 L6 14.5 L9.5 22 L12.5 20.7 L9 13.3 L15.5 13 Z"
              fill="#2563eb" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
          <div class="label">PrivateAI</div>
        </div>
      `;
      document.documentElement.appendChild(el);
      return el;
    };
    host = ensure();
  }
  host.style.visibility = "visible";
  const root = host.shadowRoot;
  const highlight = root?.querySelector(".highlight") as HTMLElement | null;
  const cursor = root?.querySelector(".cursor") as HTMLElement | null;
  if (highlight) {
    highlight.style.display = "block";
    highlight.style.left = `${left}px`;
    highlight.style.top = `${top}px`;
    highlight.style.width = `${Math.max(0, width)}px`;
    highlight.style.height = `${Math.max(0, height)}px`;
  }
  const x = left + Math.max(0, width) / 2;
  const y = top + Math.max(0, height) / 2;
  if (cursor) cursor.style.transform = `translate(${x}px, ${y}px)`;
  return { ok: true, x, y };
}

/**
 * Resolve a snapshot ref / CSS / text target, scroll into view, then point
 * cursor + highlight at it. Self-contained for executeScript.
 */
export function previewAgentTargetInPage(target: string): OverlayPointResult {
  const HOST_ID = "__privateai_agent_overlay";
  const ATTR = "data-pai-ref";
  const trimmed = (target || "").trim();
  if (!trimmed) return { ok: false, error: "Missing target" };

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
          error: `No element with text ${JSON.stringify(textNeedles[0])}.`,
        };
      }
    } else {
      try {
        el = document.querySelector(trimmed) as HTMLElement | null;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `Invalid CSS selector (${msg})` };
      }
      if (!el) return { ok: false, error: `No element for selector: ${trimmed}` };
    }
  }

  el.scrollIntoView({ block: "center", inline: "center" });
  const rect = el.getBoundingClientRect();

  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("privateai-agent-overlay");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-pai-agent-overlay", "1");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:visible;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .border {
          position: absolute; inset: 0;
          box-shadow: inset 0 0 0 3px #2563eb, inset 0 0 24px rgba(37,99,235,.35);
        }
        .cursor {
          position: absolute; left: 0; top: 0; width: 0; height: 0;
          transition: transform 300ms ease-out; will-change: transform;
        }
        .arrow {
          position: absolute; left: -3px; top: -3px;
          filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)) drop-shadow(0 0 6px rgba(37,99,235,.9));
        }
        .label {
          position: absolute; left: 22px; top: 26px; padding: 3px 9px; border-radius: 999px;
          background: #2563eb; color: #fff;
          font: 600 12px/16px system-ui, -apple-system, sans-serif;
          white-space: nowrap; border: 1.5px solid #fff;
          box-shadow: 0 2px 6px rgba(0,0,0,.35);
        }
        .highlight {
          position: absolute; pointer-events: none;
          border: 2px dashed #2563eb; border-radius: 4px;
          background: rgba(37,99,235,.12);
          box-shadow: 0 0 0 1px rgba(255,255,255,.8);
          display: none;
        }
      </style>
      <div class="border"></div>
      <div class="highlight"></div>
      <div class="cursor">
        <svg class="arrow" width="30" height="36" viewBox="0 0 20 24">
          <path d="M1 1 L1 19 L6 14.5 L9.5 22 L12.5 20.7 L9 13.3 L15.5 13 Z"
            fill="#2563eb" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <div class="label">PrivateAI</div>
      </div>
    `;
    document.documentElement.appendChild(host);
  }
  host.style.visibility = "visible";
  const root = host.shadowRoot;
  const highlight = root?.querySelector(".highlight") as HTMLElement | null;
  const cursor = root?.querySelector(".cursor") as HTMLElement | null;
  if (highlight) {
    highlight.style.display = "block";
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (cursor) cursor.style.transform = `translate(${x}px, ${y}px)`;
  return { ok: true, x, y };
}

export function setAgentOverlayHiddenInPage(hidden: boolean): { ok: boolean } {
  const host = document.getElementById("__privateai_agent_overlay");
  if (host) host.style.visibility = hidden ? "hidden" : "visible";
  return { ok: true };
}

export function teardownAgentOverlayInPage(): { ok: boolean } {
  const host = document.getElementById("__privateai_agent_overlay");
  host?.remove();
  return { ok: true };
}

/** Pure helpers for unit tests (not injected). */
export function isSplitViewApiAvailable(tabsApi: {
  createSplit?: unknown;
}): boolean {
  return typeof tabsApi.createSplit === "function";
}

/** Runtime check against the live Chrome tabs API (safe in popup / SW). */
export function browserSupportsSplitView(): boolean {
  try {
    const tabs = (globalThis as { chrome?: { tabs?: { createSplit?: unknown } } }).chrome
      ?.tabs;
    return isSplitViewApiAvailable(tabs ?? {});
  } catch {
    return false;
  }
}

export function isChatWithTabPageUrl(
  url: string | undefined,
  owuiOrigin: string | null,
): { ok: true } | { ok: false; error: string } {
  if (!url) return { ok: false, error: "This tab has no URL yet" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid tab URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Only http(s) pages can be used with Chat with tab" };
  }
  if (owuiOrigin && parsed.origin === owuiOrigin) {
    return { ok: false, error: "Pick a page tab, not the PrivateAI chat tab" };
  }
  return { ok: true };
}
