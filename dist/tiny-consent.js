(() => {
  // src/consent.js
  var COOKIE_NAME = "tc_consent";
  var VERSION = 1;
  var OPTIONAL_CATEGORIES = ["analytics", "marketing", "personalization"];
  function defaultConsent({ mode = "opt-in", gpc = false } = {}) {
    const allow = mode === "opt-out";
    return {
      v: VERSION,
      t: null,
      chosen: false,
      essential: true,
      analytics: allow,
      marketing: allow && !gpc,
      personalization: allow
    };
  }
  function createConsent(current, changes = {}, now = /* @__PURE__ */ new Date()) {
    const next = { ...current, v: VERSION, t: now.toISOString(), chosen: true, essential: true };
    for (const category of OPTIONAL_CATEGORIES) {
      if (category in changes) next[category] = Boolean(changes[category]);
    }
    return next;
  }
  function allConsent(value) {
    const out = {};
    for (const category of OPTIONAL_CATEGORIES) out[category] = Boolean(value);
    return out;
  }
  function serializeConsent(consent) {
    return encodeURIComponent(
      JSON.stringify({
        v: VERSION,
        t: consent.t,
        a: consent.analytics ? 1 : 0,
        m: consent.marketing ? 1 : 0,
        p: consent.personalization ? 1 : 0
      })
    );
  }
  function parseConsent(raw) {
    if (!raw) return null;
    try {
      const data = JSON.parse(decodeURIComponent(raw));
      if (!data || data.v !== VERSION || typeof data.t !== "string") return null;
      return {
        v: VERSION,
        t: data.t,
        chosen: true,
        essential: true,
        analytics: data.a === 1,
        marketing: data.m === 1,
        personalization: data.p === 1
      };
    } catch (e) {
      return null;
    }
  }
  function readCookie(cookieString2, name) {
    for (const part of String(cookieString2 || "").split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
  }
  function cookieString(name, value, { days = 180, secure = false } = {}) {
    const maxAge = Math.round(days * 86400);
    return `${name}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  }
  function isAllowed(consent, category) {
    if (category === "essential") return true;
    return consent[category] === true;
  }
  function parseCategories(attr) {
    return String(attr || "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  function categoriesAllowed(consent, categories) {
    const list = Array.isArray(categories) ? categories : parseCategories(categories);
    if (list.length === 0) return false;
    return list.every((category) => isAllowed(consent, category));
  }
  function isDowngrade(previous, next) {
    return OPTIONAL_CATEGORIES.some((category) => previous[category] && !next[category]);
  }

  // src/blocker.js
  var rawSetAttribute = typeof Element !== "undefined" ? Element.prototype.setAttribute : null;
  function setAttr(el, name, value) {
    rawSetAttribute.call(el, name, value);
  }
  function parseBlockAttr(attr) {
    return String(attr || "").split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const colon = entry.lastIndexOf(":");
      if (colon < 0) return [entry.toLowerCase(), "marketing"];
      return [entry.slice(0, colon).toLowerCase(), entry.slice(colon + 1).toLowerCase() || "marketing"];
    });
  }
  function matchPattern(url, patterns, base) {
    let parsed;
    try {
      parsed = new URL(String(url), base || "http://tc.invalid/");
    } catch (e) {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (!host) return null;
    const path = parsed.pathname;
    for (const [pattern, category] of patterns) {
      const slash = pattern.indexOf("/");
      const patternHost = (slash < 0 ? pattern : pattern.slice(0, slash)).toLowerCase();
      const patternPath = slash < 0 ? "" : pattern.slice(slash);
      if (host !== patternHost && !host.endsWith("." + patternHost)) continue;
      if (patternPath && !path.startsWith(patternPath)) continue;
      return category;
    }
    return null;
  }
  var MARKED_SELECTOR = [
    'script[type="text/plain"][data-tc-category]',
    "script[data-tc-src][data-tc-category]",
    ":not(script)[data-tc-src][data-tc-category]",
    '[data-tc-element="placeholder"][data-tc-category]'
  ].join(", ");
  function createBlocker({ doc, patterns, isAllowed: isAllowed2, base, onBlock, onActivate }) {
    const createRaw = doc.createElement.bind(doc);
    let observer = null;
    function categoryFor(el, src) {
      if (el.hasAttribute("data-tc-category") || el.hasAttribute("data-tc-activated") || el.hasAttribute("data-tc-ignore")) {
        return null;
      }
      return matchPattern(src, patterns, base);
    }
    function needsBlock(category) {
      return Boolean(category) && !isAllowed2([category]);
    }
    function mark(el, src, category) {
      const tag = el.tagName;
      if (tag === "SCRIPT") {
        const type = el.getAttribute("type");
        if (type && type !== "text/plain") setAttr(el, "data-tc-type", type);
        setAttr(el, "type", "text/plain");
        el.removeAttribute("src");
      } else if (el.hasAttribute("src")) {
        setAttr(el, "src", "about:blank");
      }
      setAttr(el, "data-tc-src", src);
      setAttr(el, "data-tc-category", category);
      setAttr(el, "data-tc-auto", "");
      if (onBlock) onBlock(el);
    }
    function inspect(el) {
      const src = el.getAttribute("src");
      if (src) {
        const category = categoryFor(el, src);
        if (needsBlock(category)) mark(el, src, category);
        return;
      }
      if (el.hasAttribute("data-tc-category") && el.hasAttribute("data-tc-src")) activateOne(el);
    }
    function visit(node) {
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === "SCRIPT" || tag === "IFRAME") inspect(node);
      if (node.querySelectorAll) {
        node.querySelectorAll("script[src], iframe[src]").forEach(inspect);
      }
    }
    function guard(el) {
      const proto = Object.getPrototypeOf(el);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "src");
      const ownSetAttribute = el.setAttribute;
      el.setAttribute = function(name, value) {
        if (String(name).toLowerCase() === "src") {
          const category = categoryFor(el, value);
          if (needsBlock(category)) {
            mark(el, String(value), category);
            return;
          }
        }
        return ownSetAttribute.call(el, name, value);
      };
      if (descriptor && descriptor.set) {
        Object.defineProperty(el, "src", {
          configurable: true,
          get() {
            return descriptor.get.call(el);
          },
          set(value) {
            el.setAttribute("src", value);
          }
        });
      }
    }
    function start() {
      doc.createElement = function(tag, options) {
        const el = createRaw(tag, options);
        const name = String(tag).toLowerCase();
        if (name === "script" || name === "iframe") guard(el);
        return el;
      };
      if (typeof MutationObserver !== "undefined" && doc.documentElement) {
        observer = new MutationObserver((records) => {
          for (const record of records) record.addedNodes.forEach(visit);
        });
        observer.observe(doc.documentElement, { childList: true, subtree: true });
      }
    }
    function stop() {
      if (observer) observer.disconnect();
      observer = null;
      doc.createElement = createRaw;
    }
    function runScript(el) {
      const script = createRaw("script");
      for (const { name, value } of Array.from(el.attributes)) {
        if (name === "type" || name === "src" || name.startsWith("data-tc-")) continue;
        setAttr(script, name, value);
      }
      const type = el.getAttribute("data-tc-type");
      if (type) setAttr(script, "type", type);
      setAttr(script, "data-tc-activated", "");
      setAttr(script, "data-tc-category", el.getAttribute("data-tc-category"));
      const src = el.getAttribute("data-tc-src");
      if (src) {
        script.async = false;
        setAttr(script, "src", src);
      } else {
        script.textContent = el.textContent || "";
      }
      if (el.parentNode) el.parentNode.replaceChild(script, el);
      else (doc.head || doc.documentElement).appendChild(script);
      return script;
    }
    function activateOne(el) {
      if (el.hasAttribute("data-tc-activated")) return false;
      const categories = parseCategories(el.getAttribute("data-tc-category"));
      if (!isAllowed2(categories)) return false;
      let result = el;
      if (el.tagName === "SCRIPT") {
        result = runScript(el);
      } else if (el.getAttribute("data-tc-element") === "placeholder") {
        el.remove();
      } else {
        setAttr(el, "data-tc-activated", "");
        const src = el.getAttribute("data-tc-src");
        if (src) setAttr(el, "src", src);
      }
      if (onActivate) onActivate(result);
      return true;
    }
    function activate() {
      let count = 0;
      doc.querySelectorAll(MARKED_SELECTOR).forEach((el) => {
        if (activateOne(el)) count += 1;
      });
      return count;
    }
    return { start, stop, activate, activateOne, inspect: visit, createRaw };
  }

  // src/blocklist.js
  var blocklist_default = [
    // analytics
    ["google-analytics.com", "analytics"],
    ["analytics.google.com", "analytics"],
    ["googletagmanager.com", "analytics"],
    ["hotjar.com", "analytics"],
    ["clarity.ms", "analytics"],
    ["mixpanel.com", "analytics"],
    ["segment.com", "analytics"],
    ["segment.io", "analytics"],
    ["amplitude.com", "analytics"],
    ["heapanalytics.com", "analytics"],
    ["fullstory.com", "analytics"],
    ["mouseflow.com", "analytics"],
    ["matomo.cloud", "analytics"],
    ["plausible.io", "analytics"],
    ["usefathom.com", "analytics"],
    ["posthog.com", "analytics"],
    ["luckyorange.com", "analytics"],
    ["smartlook.com", "analytics"],
    // marketing
    ["connect.facebook.net", "marketing"],
    ["facebook.com", "marketing"],
    ["doubleclick.net", "marketing"],
    ["googleadservices.com", "marketing"],
    ["googlesyndication.com", "marketing"],
    ["ads.linkedin.com", "marketing"],
    ["snap.licdn.com", "marketing"],
    ["ads-twitter.com", "marketing"],
    ["analytics.tiktok.com", "marketing"],
    ["bat.bing.com", "marketing"],
    ["pinimg.com", "marketing"],
    ["pinterest.com", "marketing"],
    ["hs-scripts.com", "marketing"],
    ["hs-analytics.net", "marketing"],
    ["hsforms.net", "marketing"],
    ["sc-static.net", "marketing"],
    ["tr.snapchat.com", "marketing"],
    ["redditstatic.com", "marketing"],
    ["adroll.com", "marketing"],
    ["criteo.com", "marketing"],
    ["criteo.net", "marketing"],
    ["youtube.com", "marketing"],
    ["youtube-nocookie.com", "marketing"],
    ["vimeo.com", "marketing"],
    ["maps.googleapis.com", "marketing"],
    ["maps.google.com", "marketing"],
    ["www.google.com/maps", "marketing"],
    // personalization
    ["intercom.io", "personalization"],
    ["intercomcdn.com", "personalization"],
    ["crisp.chat", "personalization"],
    ["drift.com", "personalization"],
    ["driftt.com", "personalization"],
    ["optimizely.com", "personalization"],
    ["visualwebsiteoptimizer.com", "personalization"],
    ["tawk.to", "personalization"]
  ];

  // src/ui.js
  var FOCUSABLE = 'button, [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  var ACTIONABLE = '[data-tc-action], [data-tc-element="open-preferences"]';
  function bindUI(doc, handlers) {
    const root = doc.querySelector('[data-tc="root"]');
    const banner = root ? root.querySelector('[data-tc="banner"]') : null;
    const prefs = root ? root.querySelector('[data-tc="preferences"]') : null;
    const float = root ? root.querySelector('[data-tc="float"]') : null;
    let lastFocus = null;
    let chosen = false;
    function isVisible(el) {
      return Boolean(el) && el.getAttribute("data-tc-visible") === "true";
    }
    function setVisible(el, on) {
      if (!el) return;
      if (on) el.setAttribute("data-tc-visible", "true");
      else el.removeAttribute("data-tc-visible");
    }
    function update() {
      const panelsOpen = isVisible(banner) || isVisible(prefs);
      setVisible(float, chosen && !panelsOpen);
      setVisible(root, panelsOpen || isVisible(float));
    }
    function focusFirst(el) {
      const target = el && el.querySelector(FOCUSABLE);
      if (target) target.focus();
    }
    function showBanner() {
      setVisible(prefs, false);
      setVisible(banner, true);
      update();
    }
    function showPreferences() {
      if (!prefs) return;
      if (handlers.beforeOpen) handlers.beforeOpen();
      if (!lastFocus) lastFocus = doc.activeElement;
      setVisible(banner, false);
      setVisible(prefs, true);
      update();
      focusFirst(prefs);
    }
    function hideAll() {
      setVisible(banner, false);
      setVisible(prefs, false);
      update();
      if (lastFocus && typeof lastFocus.focus === "function" && doc.contains(lastFocus)) lastFocus.focus();
      lastFocus = null;
    }
    function rows() {
      if (!root) return [];
      const out = [];
      root.querySelectorAll("[data-tc-category]").forEach((row) => {
        const input = row.matches("input") ? row : row.querySelector('input[type="checkbox"]');
        if (input) out.push({ category: row.getAttribute("data-tc-category"), input });
      });
      return out;
    }
    function setClass(el, name, on) {
      if (!el || !el.classList) return;
      if (on) el.classList.add(name);
      else el.classList.remove(name);
    }
    function reflect(input) {
      const wrap = input.closest('[data-tc-element="switch"]') || input.parentElement;
      if (!wrap || wrap === root) return;
      setClass(wrap, "is-on", input.checked);
      for (const child of wrap.children) setClass(child, "is-on", input.checked);
    }
    function sync(consent) {
      chosen = Boolean(consent && consent.chosen);
      for (const { category, input } of rows()) {
        input.checked = isAllowed(consent, category);
        if (category === "essential") {
          input.checked = true;
          input.disabled = true;
        }
        reflect(input);
      }
      update();
    }
    function read() {
      const out = {};
      for (const { category, input } of rows()) {
        if (category !== "essential") out[category] = input.checked;
      }
      return out;
    }
    const templates = /* @__PURE__ */ new Map();
    let fallbackTemplate = null;
    function isSample(el) {
      const value = el.getAttribute("data-tc-vendor");
      return value === "" || value === "sample";
    }
    function field(scope, name) {
      return scope.querySelectorAll(`[data-tc-field="${name}"]`);
    }
    function setText(scope, name, value) {
      field(scope, name).forEach((el) => {
        el.textContent = value;
      });
    }
    function resetOpenState(node) {
      node.removeAttribute("data-tc-open");
      node.classList.remove("is-open");
      node.querySelectorAll(".is-open").forEach((el) => el.classList.remove("is-open"));
      node.querySelectorAll("[aria-expanded]").forEach((el) => el.setAttribute("aria-expanded", "false"));
      node.querySelectorAll("[data-tc-open]").forEach((el) => el.removeAttribute("data-tc-open"));
    }
    function fillVendor(template, vendor) {
      const node = template.cloneNode(true);
      node.setAttribute("data-tc-vendor", vendor.id);
      node.setAttribute("data-tc-generated", "");
      resetOpenState(node);
      setText(node, "vendor-name", vendor.name);
      field(node, "vendor-privacy").forEach((link) => {
        if (vendor.privacy) link.setAttribute("href", vendor.privacy);
        else link.remove();
      });
      const cookieTemplates = Array.from(field(node, "cookie"));
      if (cookieTemplates.length) {
        const cookieTemplate = cookieTemplates[0];
        const parent = cookieTemplate.parentNode;
        cookieTemplates.forEach((el) => el.remove());
        vendor.cookies.forEach((cookie) => {
          const item = cookieTemplate.cloneNode(true);
          setText(item, "cookie-name", cookie.name);
          setText(item, "cookie-purpose", cookie.purpose);
          setText(item, "cookie-duration", cookie.duration);
          parent.appendChild(item);
        });
      }
      return node;
    }
    function renderVendors(vendors) {
      if (!root) return;
      const list = Array.isArray(vendors) ? vendors : [];
      const rowsWithDetails = [];
      root.querySelectorAll("[data-tc-category]").forEach((row) => {
        const details = row.querySelector('[data-tc-element="details"]');
        if (!details) return;
        rowsWithDetails.push([row, details]);
        if (templates.has(row)) return;
        const first = details.querySelector("[data-tc-vendor]");
        if (first) {
          templates.set(row, first.cloneNode(true));
          if (!fallbackTemplate) fallbackTemplate = templates.get(row);
        }
      });
      rowsWithDetails.forEach(([row, details]) => {
        const category = row.getAttribute("data-tc-category");
        const template = templates.get(row) || fallbackTemplate;
        if (!template) return;
        details.querySelectorAll("[data-tc-vendor]").forEach((el) => {
          if (isSample(el) || el.hasAttribute("data-tc-generated")) el.remove();
        });
        const kept = /* @__PURE__ */ new Set();
        details.querySelectorAll("[data-tc-vendor]").forEach((el) => kept.add(el.getAttribute("data-tc-vendor")));
        const empty = details.querySelector('[data-tc-field="empty"]');
        const items = list.filter((v) => v.category === category && !kept.has(v.id));
        items.forEach((vendor) => {
          const node = fillVendor(template, vendor);
          if (empty) details.insertBefore(node, empty);
          else details.appendChild(node);
        });
        if (empty) {
          if (items.length || kept.size) empty.setAttribute("hidden", "");
          else empty.removeAttribute("hidden");
        }
      });
    }
    function toggle(target) {
      const box = target.closest('[data-tc-element="accordion"]');
      if (!box) return;
      const open = box.getAttribute("data-tc-open") !== "true";
      box.setAttribute("data-tc-open", open ? "true" : "false");
      setClass(box, "is-open", open);
      box.querySelectorAll('[data-tc-action="toggle"]').forEach((el) => {
        if (el.closest('[data-tc-element="accordion"]') !== box) return;
        if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") el.setAttribute("aria-expanded", open ? "true" : "false");
        setClass(el, "is-open", open);
        const chevron = el.querySelector('[data-tc-element="chevron"]') || (el.matches('[data-tc-element="chevron"]') ? el : null);
        setClass(chevron, "is-open", open);
      });
    }
    function run(target, event) {
      const action = target.getAttribute("data-tc-action") || "open-preferences";
      if (target.tagName === "A" || target.closest("form")) event.preventDefault();
      switch (action) {
        case "accept-all":
          handlers.acceptAll();
          break;
        case "reject-all":
          handlers.rejectAll();
          break;
        case "save":
          handlers.save(read());
          break;
        case "open-preferences":
          showPreferences();
          break;
        case "close":
          handlers.close();
          break;
        case "toggle":
          toggle(target);
          break;
        default:
          break;
      }
    }
    doc.addEventListener("click", (event) => {
      const target = event.target && event.target.closest ? event.target.closest(ACTIONABLE) : null;
      if (!target) return;
      const link = event.target.closest("a[href]");
      if (link && link !== target && target.contains(link)) return;
      run(target, event);
    });
    doc.addEventListener("change", (event) => {
      const input = event.target;
      if (!root || !input || !input.matches || !input.matches('input[type="checkbox"]') || !root.contains(input)) return;
      if (input.closest("[data-tc-category]")) reflect(input);
    });
    doc.addEventListener("submit", (event) => {
      if (root && root.contains(event.target)) event.preventDefault();
    });
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isVisible(prefs)) {
        handlers.close();
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && event.target && event.target.matches) {
        const target = event.target.matches(ACTIONABLE) && event.target.getAttribute("role") === "button" ? event.target : null;
        if (target && target.tagName !== "BUTTON" && target.tagName !== "A") run(target, event);
      }
    });
    return { root, banner, prefs, float, hasUI: Boolean(root), showBanner, showPreferences, hideAll, sync, read, renderVendors };
  }

  // src/vendors.js
  var GOOGLE = "https://policies.google.com/privacy";
  var MS = "https://privacy.microsoft.com/privacystatement";
  var REGISTRY = [
    // essential
    ["tiny-consent", "Tiny Consent", "essential", "", [], [["tc_consent", "Stores the cookie choices you make here.", "{days} days"]]],
    ["recaptcha", "Google reCAPTCHA", "essential", GOOGLE, ["google.com/recaptcha", "recaptcha.net/recaptcha", "gstatic.com/recaptcha"], [
      ["rc::a", "reCAPTCHA risk data kept in this browser.", "Until cleared"]
    ]],
    // analytics
    ["google-analytics", "Google Analytics", "analytics", GOOGLE, ["google-analytics.com", "analytics.google.com", "googletagmanager.com/gtag"], [
      ["_ga", "Tells visitors apart.", "2 years"],
      ["_ga_*", "Keeps the session state.", "2 years"],
      ["_gid", "Tells visitors apart.", "24 hours"]
    ], ["_ga*", "_gat*", "_gid"]],
    ["google-tag-manager", "Google Tag Manager", "analytics", GOOGLE, ["googletagmanager.com/gtm.js", "googletagmanager.com/ns.html"], [], ["_dc_gtm_*"]],
    ["hotjar", "Hotjar", "analytics", "https://www.hotjar.com/legal/policies/privacy/", ["hotjar.com"], [
      ["_hjSessionUser_*", "Identifies returning visitors.", "1 year"],
      ["_hjSession_*", "Holds the current session.", "30 minutes"],
      ["hjActiveViewportIds", "Which parts of the page were on screen.", "Until cleared"],
      ["hjViewportId", "Screen size for this visit.", "Session"]
    ], ["_hj*"]],
    ["clarity", "Microsoft Clarity", "analytics", MS, ["clarity.ms"], [
      ["_clck", "Persists the Clarity user id.", "1 year"],
      ["_clsk", "Links page views into one session.", "1 day"]
    ], ["_clck", "_clsk", "_cltk"]],
    ["mixpanel", "Mixpanel", "analytics", "https://mixpanel.com/legal/privacy-policy", ["mixpanel.com"], [["mp_*_mixpanel", "Tracks events and visitors.", "1 year"]], ["mp_*_mixpanel*", "__mp_opt_in_out_*"]],
    ["segment", "Segment", "analytics", "https://segment.com/legal/privacy", ["segment.com", "segment.io"], [
      ["ajs_anonymous_id", "Anonymous visitor id.", "1 year"],
      ["ajs_user_id", "Logged-in user id.", "1 year"]
    ], ["ajs_*"]],
    ["amplitude", "Amplitude", "analytics", "https://amplitude.com/privacy", ["amplitude.com"], [["AMP_*", "Device and session ids.", "1 year"]], ["AMP_*", "amp_*", "amplitude_*"]],
    ["heap", "Heap", "analytics", "https://www.heap.io/privacy", ["heapanalytics.com"], [["_hp2_id.*", "Visitor id.", "13 months"]], ["_hp2_*"]],
    ["fullstory", "FullStory", "analytics", "https://www.fullstory.com/legal/privacy-policy", ["fullstory.com"], [["fs_uid", "Session replay id.", "1 year"]], ["fs_uid", "fs_lua", "fs_cid"]],
    ["mouseflow", "Mouseflow", "analytics", "https://mouseflow.com/legal/gdpr", ["mouseflow.com"], [
      ["mf_user", "Marks returning visitors.", "90 days"],
      ["mf_*", "Session recording id.", "Session"]
    ], ["mf_*"]],
    ["matomo", "Matomo", "analytics", "https://matomo.org/privacy-policy", ["matomo.cloud"], [
      ["_pk_id.*", "Visitor id.", "13 months"],
      ["_pk_ses.*", "Current session.", "30 minutes"]
    ], ["_pk_*", "mtm_*"]],
    ["plausible", "Plausible", "analytics", "https://plausible.io/privacy", ["plausible.io"], []],
    ["fathom", "Fathom", "analytics", "https://usefathom.com/privacy", ["usefathom.com"], []],
    ["posthog", "PostHog", "analytics", "https://posthog.com/privacy", ["posthog.com"], [["ph_*_posthog", "Visitor id and session.", "1 year"]], ["ph_*_posthog*"]],
    ["luckyorange", "Lucky Orange", "analytics", "https://www.luckyorange.com/privacy.php", ["luckyorange.com"], [["_lo_uid", "Visitor id.", "2 years"]], ["_lo_*", "_lorid"]],
    ["smartlook", "Smartlook", "analytics", "https://www.smartlook.com/privacy-policy", ["smartlook.com"], [["SL_C_*", "Visitor and session id.", "13 months"]], ["SL_*"]],
    // marketing
    ["meta-pixel", "Meta Pixel", "marketing", "https://www.facebook.com/privacy/policy/", ["connect.facebook.net", "facebook.com/tr"], [
      ["_fbp", "Identifies browsers for ad delivery and measurement.", "90 days"],
      ["_fbc", "Stores the last ad click.", "90 days"],
      ["lastExternalReferrer", "The last external page that sent the visitor here.", "Until cleared"],
      ["lastExternalReferrerTime", "When that external page was recorded.", "Until cleared"]
    ], ["_fbp", "_fbc"]],
    ["google-ads", "Google Ads", "marketing", "https://policies.google.com/technologies/ads", ["googleadservices.com", "doubleclick.net", "googlesyndication.com"], [
      ["_gcl_au", "Conversion attribution.", "90 days"],
      ["_gcl_ls", "Conversion data kept in this browser.", "90 days"],
      ["IDE", "Ad targeting across sites.", "13 months"],
      ["test_cookie", "Checks whether cookies can be set.", "15 minutes"]
    ], ["_gcl_*", "_gac_*"]],
    ["linkedin", "LinkedIn Insight Tag", "marketing", "https://www.linkedin.com/legal/privacy-policy", ["ads.linkedin.com", "snap.licdn.com"], [
      ["li_adsId", "Visitor id for LinkedIn ads.", "30 days"],
      ["li_sugr", "Browser id for ads.", "90 days"],
      ["bcookie", "Browser id.", "1 year"],
      ["UserMatchHistory", "Syncs ad ids.", "30 days"]
    ], ["li_*", "ln_or", "lidc", "bcookie", "bscookie", "UserMatchHistory", "AnalyticsSyncHistory"]],
    ["tiktok", "TikTok Pixel", "marketing", "https://www.tiktok.com/legal/privacy-policy", ["analytics.tiktok.com"], [["_ttp", "Ad measurement id.", "13 months"]], ["_ttp", "_tt_*"]],
    ["microsoft-ads", "Microsoft Advertising", "marketing", MS, ["bat.bing.com"], [
      ["_uetsid", "Session id for ad measurement.", "1 day"],
      ["_uetvid", "Visitor id for ad measurement.", "13 months"],
      ["MUID", "Browser id across Microsoft sites.", "13 months"]
    ], ["_uet*", "MUID"]],
    ["x-pixel", "X Pixel", "marketing", "https://x.com/privacy", ["ads-twitter.com"], [
      ["personalization_id", "Ad personalisation.", "2 years"],
      ["muc_ads", "Ad measurement.", "2 years"],
      ["guest_id", "Browser id for X ads.", "1 year"],
      ["guest_id_ads", "Ad measurement.", "1 year"],
      ["guest_id_marketing", "Marketing measurement.", "1 year"],
      ["_twpid", "Measures X ad campaigns.", "2 years"]
    ], ["_twclid", "_twpid", "muc_ads", "personalization_id", "guest_id*"]],
    ["pinterest", "Pinterest Tag", "marketing", "https://policy.pinterest.com/privacy-policy", ["pinimg.com", "pinterest.com"], [["_pin_unauth", "Groups actions of visitors not logged in to Pinterest.", "1 year"]], ["_pin_*", "_pinterest_*", "_epik", "_derived_epik"]],
    ["hubspot", "HubSpot", "marketing", "https://legal.hubspot.com/privacy-policy", ["hs-scripts.com", "hs-analytics.net", "hsforms.net"], [
      ["__hstc", "Visitor and session tracking.", "6 months"],
      ["hubspotutk", "Visitor identity for forms.", "6 months"],
      ["__hssc", "Current session.", "30 minutes"],
      ["__hssrc", "New session flag.", "Session"]
    ], ["__hs*", "hubspotutk", "hs_ab_test", "hs-messages-*", "messagesUtk"]],
    ["snapchat", "Snap Pixel", "marketing", "https://values.snap.com/privacy/privacy-policy", ["sc-static.net", "tr.snapchat.com"], [["_scid", "Visitor id.", "13 months"]], ["_scid*", "_sctr"]],
    ["reddit", "Reddit Pixel", "marketing", "https://www.reddit.com/policies/privacy-policy", ["redditstatic.com"], [["_rdt_uuid", "Ad measurement id.", "90 days"]], ["_rdt_*"]],
    ["adroll", "AdRoll", "marketing", "https://www.nextroll.com/privacy", ["adroll.com"], [["__adroll", "Visitor id for retargeting.", "1 year"]], ["__adroll*", "__ar_v4"]],
    ["criteo", "Criteo", "marketing", "https://www.criteo.com/privacy/", ["criteo.com", "criteo.net"], [["cto_bundle", "Ad personalisation id.", "13 months"]], ["cto_*"]],
    ["youtube", "YouTube", "marketing", GOOGLE, ["youtube.com", "youtube-nocookie.com"], [
      ["VISITOR_INFO1_LIVE", "Measures bandwidth and playback.", "6 months"],
      ["YSC", "Session id for embedded videos.", "Session"]
    ]],
    ["vimeo", "Vimeo", "marketing", "https://vimeo.com/privacy", ["vimeo.com"], [["vuid", "Playback statistics.", "2 years"]]],
    ["google-maps", "Google Maps", "marketing", GOOGLE, ["maps.googleapis.com", "maps.google.com", "www.google.com/maps"], [["NID", "Preferences and ad personalisation.", "6 months"]]],
    // personalization
    ["intercom", "Intercom", "personalization", "https://www.intercom.com/legal/privacy", ["intercom.io", "intercomcdn.com"], [
      ["intercom-id-*", "Anonymous visitor id.", "9 months"],
      ["intercom-session-*", "Keeps the chat session.", "7 days"]
    ], ["intercom-*"]],
    ["crisp", "Crisp", "personalization", "https://crisp.chat/en/privacy/", ["crisp.chat"], [["crisp-client/*", "Chat session.", "6 months"]], ["crisp-client*"]],
    ["drift", "Drift", "personalization", "https://www.drift.com/privacy-policy/", ["drift.com", "driftt.com"], [
      ["driftt_aid", "Anonymous visitor id.", "2 years"],
      ["drift_campaign_refresh", "Campaign display timing.", "30 minutes"]
    ], ["drift*", "DFTT_*"]],
    ["optimizely", "Optimizely", "personalization", "https://www.optimizely.com/legal/privacy-policy/", ["optimizely.com"], [["optimizelyEndUserId", "Experiment bucketing.", "6 months"]], ["optimizely*"]],
    ["vwo", "VWO", "personalization", "https://vwo.com/privacy-policy/", ["visualwebsiteoptimizer.com"], [
      ["_vwo_uuid_v2", "Experiment visitor id.", "1 year"],
      ["_vis_opt_s", "Session count.", "100 days"]
    ], ["_vwo_*", "_vis_opt_*"]],
    ["tawk", "Tawk.to", "personalization", "https://www.tawk.to/privacy-policy/", ["tawk.to"], [
      ["TawkConnectionTime", "Chat connection.", "Session"],
      ["twk_uuid_*", "Visitor id.", "6 months"]
    ], ["twk_*", "TawkConnectionTime", "tawkUUID", "__tawkuuid"]]
  ];
  var ALWAYS = /* @__PURE__ */ new Set(["tiny-consent"]);
  function cookieObject(cookie) {
    if (Array.isArray(cookie)) return { name: cookie[0], purpose: cookie[1] || "", duration: cookie[2] || "" };
    return { name: cookie.name, purpose: cookie.purpose || "", duration: cookie.duration || "" };
  }
  function normalizeVendor(entry) {
    const v = Array.isArray(entry) ? { id: entry[0], name: entry[1], category: entry[2], privacy: entry[3], hosts: entry[4], cookies: entry[5], purge: entry[6], always: ALWAYS.has(entry[0]) } : entry;
    return {
      id: String(v.id),
      name: v.name || v.id,
      category: v.category || "marketing",
      privacy: v.privacy || "",
      hosts: Array.isArray(v.hosts) ? v.hosts.map((h) => String(h).toLowerCase()) : [],
      cookies: Array.isArray(v.cookies) ? v.cookies.map(cookieObject) : [],
      purge: Array.isArray(v.purge) ? v.purge.map(String) : [],
      always: Boolean(v.always)
    };
  }
  function mergeVendors(registry, extra) {
    const byId = /* @__PURE__ */ new Map();
    registry.forEach((row) => {
      const v = normalizeVendor(row);
      byId.set(v.id, v);
    });
    (Array.isArray(extra) ? extra : []).forEach((row) => {
      if (!row || !row.id) return;
      const v = normalizeVendor(row);
      const current = byId.get(v.id);
      if (!current) {
        byId.set(v.id, v);
        return;
      }
      const patch = {};
      Object.keys(v).forEach((key) => {
        if (key in row) patch[key] = v[key];
      });
      byId.set(v.id, Object.assign({}, current, patch));
    });
    return Array.from(byId.values());
  }
  function cookiePatternsFor(categories, extra) {
    const wanted = new Set(categories || []);
    const patterns = /* @__PURE__ */ new Set();
    mergeVendors(REGISTRY, extra).forEach((v) => {
      if (!wanted.has(v.category)) return;
      v.cookies.forEach((c) => patterns.add(c.name));
      v.purge.forEach((p) => patterns.add(p));
    });
    return Array.from(patterns);
  }
  function collectSources(doc) {
    const urls = [];
    let text = "";
    doc.querySelectorAll("script, iframe").forEach((el) => {
      const src = el.getAttribute("data-tc-src") || el.getAttribute("src");
      if (src && !/^(about:|data:|blob:)/.test(src)) urls.push(src);
      if (el.tagName === "SCRIPT" && !src) text += "\n" + (el.textContent || "");
    });
    doc.querySelectorAll("noscript").forEach((el) => {
      text += "\n" + (el.textContent || "");
    });
    return { urls, text: text.toLowerCase() };
  }
  function detectVendors(doc, options) {
    const opts = options || {};
    const vendors = mergeVendors(opts.registry || REGISTRY, opts.extra);
    const include = new Set((opts.include || []).map((id) => String(id).trim()).filter(Boolean));
    const { urls, text } = collectSources(doc);
    const patterns = [];
    vendors.forEach((v) => v.hosts.forEach((host) => patterns.push([host, v.id])));
    const found = /* @__PURE__ */ new Set();
    urls.forEach((url) => {
      const id = matchPattern(url, patterns, opts.base);
      if (id) found.add(id);
    });
    if (text) {
      vendors.forEach((v) => {
        if (v.hosts.some((host) => text.includes(host))) found.add(v.id);
      });
    }
    const days = String(opts.cookieDays || 180);
    return vendors.filter((v) => v.always || include.has(v.id) || found.has(v.id)).map((v) => ({
      id: v.id,
      name: v.name,
      category: v.category,
      privacy: v.privacy,
      cookies: v.cookies.map((c) => ({ name: c.name, purpose: c.purpose, duration: c.duration.replace("{days}", days) }))
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  // src/cleanup.js
  var EXPIRED = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
  function cookieMatcher(pattern) {
    const source = String(pattern).split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${source}$`);
  }
  function cookieNames(cookieString2) {
    return String(cookieString2 || "").split(";").map((part) => part.trim().split("=")[0]).filter(Boolean);
  }
  function domainVariants(hostname) {
    const host = String(hostname || "").toLowerCase();
    const variants = [""];
    if (!host || /^(\d+\.){3}\d+$/.test(host) || host === "localhost") return variants;
    const labels = host.split(".");
    for (let i = 0; i < labels.length - 1; i++) {
      const domain = labels.slice(i).join(".");
      variants.push(domain, "." + domain);
    }
    return variants;
  }
  function purgeCookies(store, patterns, options) {
    const opts = options || {};
    const keep = new Set(opts.keep || []);
    const matchers = (patterns || []).map(cookieMatcher);
    const targets = cookieNames(store.cookie).filter((name) => !keep.has(name) && matchers.some((re) => re.test(name)));
    if (!targets.length) return [];
    const domains = domainVariants(opts.hostname);
    const paths = ["/"];
    const current = opts.path && opts.path !== "/" ? opts.path.replace(/\/[^/]*$/, "") || "/" : "";
    if (current && current !== "/") paths.push(current, current + "/");
    targets.forEach((name) => {
      domains.forEach((domain) => {
        paths.forEach((path) => {
          store.cookie = `${name}=; ${EXPIRED}; path=${path}${domain ? `; domain=${domain}` : ""}`;
        });
      });
    });
    const remaining = new Set(cookieNames(store.cookie));
    return targets.filter((name) => !remaining.has(name));
  }

  // src/geo.js
  var POLICIES = ["opt-in", "opt-out", "none"];
  var EEA = [
    "at",
    "be",
    "bg",
    "hr",
    "cy",
    "cz",
    "dk",
    "ee",
    "fi",
    "fr",
    "de",
    "gr",
    "hu",
    "ie",
    "it",
    "lv",
    "lt",
    "lu",
    "mt",
    "nl",
    "pl",
    "pt",
    "ro",
    "sk",
    "si",
    "es",
    "se",
    // EU 27
    "is",
    "li",
    "no"
    // EEA
  ];
  var GROUPS = {
    eu: EEA,
    eea: EEA,
    uk: ["gb"]
  };
  var US_OPT_OUT = ["ca", "va", "co", "ct", "ut", "tx", "or", "mt", "ia", "de", "nh", "nj", "tn", "mn", "md", "in", "ky", "ne", "ri"];
  var DEFAULT_REGIONS = ["eu:opt-in", "gb:opt-in", "ch:opt-in", "br:opt-in", "ca-qc:opt-in"].concat(US_OPT_OUT.map((state) => `us-${state}:opt-out`)).concat(["*:none"]).join(", ");
  function parseRegions(attr) {
    const table = /* @__PURE__ */ new Map();
    for (const entry of String(attr || "").split(/[\s,]+/)) {
      const colon = entry.lastIndexOf(":");
      if (colon < 0) continue;
      const key = entry.slice(0, colon).trim().toLowerCase();
      const policy = entry.slice(colon + 1).trim().toLowerCase();
      if (key && POLICIES.includes(policy)) table.set(key, policy);
    }
    return table;
  }
  var STRICTNESS = { "opt-in": 2, "opt-out": 1, none: 0 };
  function stricter(a, b) {
    if (!a) return b;
    if (!b) return a;
    return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
  }
  function groupsOf(country) {
    return Object.keys(GROUPS).filter((name) => GROUPS[name].includes(country));
  }
  function policyFor(region, table) {
    const map = table instanceof Map ? table : parseRegions(table || DEFAULT_REGIONS);
    if (!region || !region.country) return "opt-in";
    const country = String(region.country).toLowerCase();
    const sub = region.region ? String(region.region).toLowerCase() : "";
    const fallback = map.get("*") || "opt-in";
    if (!region.coarse) {
      if (sub && map.has(`${country}-${sub}`)) return map.get(`${country}-${sub}`);
      if (map.has(country)) return map.get(country);
      for (const name of groupsOf(country)) if (map.has(name)) return map.get(name);
      return fallback;
    }
    let policy = null;
    if (map.has(country)) policy = stricter(policy, map.get(country));
    for (const name of groupsOf(country)) if (map.has(name)) policy = stricter(policy, map.get(name));
    if (GROUPS[country]) {
      for (const member of GROUPS[country]) {
        if (map.has(member)) policy = stricter(policy, map.get(member));
      }
    }
    const prefix = `${country}-`;
    for (const [key, value] of map) if (key.startsWith(prefix)) policy = stricter(policy, value);
    return policy || fallback;
  }
  var EU_ZONES = /^(Europe\/|Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe|Faeroe)$)/;
  var US_ZONES = /^(US\/|Pacific\/Honolulu$|America\/(New_York|Detroit|Kentucky\/|Indiana\/|Chicago|Menominee|North_Dakota\/|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak))/;
  var CA_ZONES = /^(Canada\/|America\/(Toronto|Montreal|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Moncton|Glace_Bay|Goose_Bay|Iqaluit|Whitehorse|Dawson|Yellowknife|Inuvik|Rankin_Inlet|Resolute|Cambridge_Bay|Swift_Current|Fort_Nelson|Creston|Blanc-Sablon|Atikokan))/;
  var BR_ZONES = /^(Brazil\/|America\/(Sao_Paulo|Bahia|Fortaleza|Recife|Belem|Manaus|Maceio|Araguaina|Campo_Grande|Cuiaba|Porto_Velho|Boa_Vista|Rio_Branco|Eirunepe|Santarem|Noronha))/;
  function regionFromTimezone(tz) {
    const zone = String(tz || "");
    if (!zone) return null;
    if (EU_ZONES.test(zone)) return { country: "eu", coarse: true, source: "timezone" };
    if (US_ZONES.test(zone)) return { country: "us", coarse: true, source: "timezone" };
    if (CA_ZONES.test(zone)) return { country: "ca", coarse: true, source: "timezone" };
    if (BR_ZONES.test(zone)) return { country: "br", coarse: true, source: "timezone" };
    if (/^(Africa|Asia|Australia|Pacific|Indian|Antarctica|America|Atlantic)\//.test(zone)) {
      return { country: "*", coarse: true, source: "timezone" };
    }
    return null;
  }
  var US_STATES = {
    alabama: "al",
    alaska: "ak",
    arizona: "az",
    arkansas: "ar",
    california: "ca",
    colorado: "co",
    connecticut: "ct",
    delaware: "de",
    "district of columbia": "dc",
    florida: "fl",
    georgia: "ga",
    hawaii: "hi",
    idaho: "id",
    illinois: "il",
    indiana: "in",
    iowa: "ia",
    kansas: "ks",
    kentucky: "ky",
    louisiana: "la",
    maine: "me",
    maryland: "md",
    massachusetts: "ma",
    michigan: "mi",
    minnesota: "mn",
    mississippi: "ms",
    missouri: "mo",
    montana: "mt",
    nebraska: "ne",
    nevada: "nv",
    "new hampshire": "nh",
    "new jersey": "nj",
    "new mexico": "nm",
    "new york": "ny",
    "north carolina": "nc",
    "north dakota": "nd",
    ohio: "oh",
    oklahoma: "ok",
    oregon: "or",
    pennsylvania: "pa",
    "rhode island": "ri",
    "south carolina": "sc",
    "south dakota": "sd",
    tennessee: "tn",
    texas: "tx",
    utah: "ut",
    vermont: "vt",
    virginia: "va",
    washington: "wa",
    "west virginia": "wv",
    wisconsin: "wi",
    wyoming: "wy"
  };
  var CA_PROVINCES = {
    alberta: "ab",
    "british columbia": "bc",
    manitoba: "mb",
    "new brunswick": "nb",
    "newfoundland and labrador": "nl",
    "nova scotia": "ns",
    ontario: "on",
    "prince edward island": "pe",
    quebec: "qc",
    "qu\xE9bec": "qc",
    saskatchewan: "sk",
    "northwest territories": "nt",
    nunavut: "nu",
    yukon: "yt"
  };
  function pick(data, keys) {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }
  function parseLookup(payload) {
    let data = payload;
    if (typeof payload === "string") {
      const text = payload.trim();
      if (text.startsWith("{")) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          return null;
        }
      } else {
        data = {};
        for (const line of text.split(/\r?\n/)) {
          const eq = line.indexOf("=");
          if (eq > 0) data[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
    }
    if (!data || typeof data !== "object") return null;
    const country = pick(data, ["country_code", "countryCode", "country_code2", "country", "loc"]).toLowerCase();
    if (!/^[a-z]{2}$/.test(country)) return null;
    let region = pick(data, ["region_code", "regionCode", "region_iso_code", "state_code", "region", "state"]).toLowerCase();
    if (region.includes("-")) region = region.split("-").pop();
    if (region && !/^[a-z0-9]{1,3}$/.test(region)) {
      const names = country === "us" ? US_STATES : country === "ca" ? CA_PROVINCES : {};
      region = names[region] || "";
    }
    return region ? { country, region } : { country };
  }
  var DEFAULT_LOOKUP_URL = "https://get.geojs.io/v1/ip/geo.json";
  var STORAGE_KEY = "tc_region";
  function parseRegionCode(code) {
    const value = String(code || "").trim().toLowerCase();
    if (!value) return null;
    const [country, region] = value.split("-");
    if (!country) return null;
    return region ? { country, region, source: "forced" } : { country, source: "forced" };
  }
  function createGeoResolver({ win, source, url, forced, timeoutMs = 1500 }) {
    function fromTimezone() {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return regionFromTimezone(tz);
      } catch (e) {
        return null;
      }
    }
    function readCache() {
      try {
        const raw = win.sessionStorage && win.sessionStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : null;
        return data && data.country ? { ...data, source: "cache" } : null;
      } catch (e) {
        return null;
      }
    }
    function writeCache(region) {
      try {
        if (win.sessionStorage) win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ country: region.country, region: region.region }));
      } catch (e) {
      }
    }
    function lookup() {
      if (typeof win.fetch !== "function") return Promise.resolve(null);
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => controller && controller.abort(), timeoutMs);
      return win.fetch(url || DEFAULT_LOOKUP_URL, { mode: "cors", credentials: "omit", cache: "no-store", signal: controller ? controller.signal : void 0 }).then((res) => res.ok ? res.text() : null).then((text) => {
        const region = text ? parseLookup(text) : null;
        return region ? { ...region, source: "lookup" } : null;
      }).catch(() => null).finally(() => clearTimeout(timer));
    }
    function resolve() {
      const override = parseRegionCode(forced || win.TinyConsentRegion);
      if (override) return Promise.resolve(override);
      if (source === "timezone") return Promise.resolve(fromTimezone() || { country: null, source: "unknown" });
      if (source !== "auto") return Promise.resolve({ country: null, source: "off" });
      const cached = readCache();
      if (cached) return Promise.resolve(cached);
      return lookup().then((region) => {
        if (region) {
          writeCache(region);
          return region;
        }
        return fromTimezone() || { country: null, source: "unknown" };
      });
    }
    return { resolve };
  }

  // src/tiny-consent.js
  var VERSION2 = "1.0.1";
  var BOOT_CSS = [
    'html.tc-boot [data-tc="root"]:not([data-tc-visible="true"]),',
    'html.tc-boot [data-tc="banner"]:not([data-tc-visible="true"]),',
    'html.tc-boot [data-tc="preferences"]:not([data-tc-visible="true"]),',
    'html.tc-boot .tc-preferences:not([data-tc-visible="true"]),',
    'html.tc-boot [data-tc="float"]:not([data-tc-visible="true"]),',
    'html.tc-boot .tc-float:not([data-tc-visible="true"]),',
    'html.tc-boot [data-tc-element="accordion"]:not([data-tc-open="true"]) [data-tc-element="details"],',
    'html.tc-boot [data-tc="root"] [hidden],',
    POLICIES.map((p) => `html.tc-boot[data-tc-policy="${p}"] [data-tc-variant]:not([data-tc-variant~="${p}"])`).join(","),
    "{display:none!important}",
    'html.tc-boot [data-tc="root"][data-tc-visible="true"]{display:block!important}',
    'html.tc-boot [data-tc="banner"][data-tc-visible="true"]{display:block!important}',
    'html.tc-boot [data-tc="preferences"][data-tc-visible="true"],html.tc-boot .tc-preferences[data-tc-visible="true"]{display:flex!important}',
    'html.tc-boot [data-tc="float"][data-tc-visible="true"],html.tc-boot .tc-float[data-tc-visible="true"]{display:flex!important}',
    'html.tc-boot [data-tc-element="chevron"]{transition:transform 150ms ease}',
    'html.tc-boot [data-tc-element="accordion"][data-tc-open="true"]>[data-tc-element="chevron"],',
    'html.tc-boot [data-tc-element="accordion"][data-tc-open="true"]>:not([data-tc-element="details"]) [data-tc-element="chevron"]',
    "{transform:rotate(180deg)}"
  ].join("");
  function readConfig(script) {
    const attr = (name, fallback) => {
      const value = script ? script.getAttribute(name) : null;
      return value === null || value === "" ? fallback : value;
    };
    return {
      mode: attr("data-tc-mode", "opt-in") === "opt-out" ? "opt-out" : "opt-in",
      cookieDays: Number(attr("data-tc-cookie-days", 180)) || 180,
      cookieName: attr("data-tc-cookie-name", COOKIE_NAME),
      reload: attr("data-tc-reload", "true") !== "false",
      block: attr("data-tc-block", ""),
      purge: attr("data-tc-purge", "true") !== "false",
      vendors: attr("data-tc-vendors", "").split(/[\s,]+/).filter(Boolean),
      geo: ["auto", "timezone"].includes(attr("data-tc-geo", "")) ? attr("data-tc-geo", "") : "",
      geoUrl: attr("data-tc-geo-url", ""),
      region: attr("data-tc-region", ""),
      regions: attr("data-tc-regions", DEFAULT_REGIONS)
    };
  }
  (function init(win, doc) {
    if (win.TinyConsent && win.TinyConsent.__tc) return;
    const script = doc.currentScript || doc.querySelector('script[src*="tiny-consent"]');
    const config = readConfig(script);
    const gpc = Boolean(win.navigator && win.navigator.globalPrivacyControl === true);
    const patterns = parseBlockAttr(config.block).concat(blocklist_default);
    const secure = Boolean(win.location && win.location.protocol === "https:");
    const geoOn = Boolean(config.geo || config.region || win.TinyConsentRegion);
    const regionTable = parseRegions(config.regions);
    let region = null;
    let policy = geoOn ? "opt-in" : config.mode;
    const resolver = createGeoResolver({ win, source: config.geo, url: config.geoUrl, forced: config.region });
    let consent = parseConsent(readCookie(doc.cookie, config.cookieName)) || defaultConsent({ mode: policy, gpc });
    let ui = null;
    const emit = (name, detail) => doc.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    const getConsent = () => ({ ...consent });
    const blocker = createBlocker({
      doc,
      patterns,
      base: win.location ? win.location.href : void 0,
      isAllowed: (categories) => categoriesAllowed(consent, categories),
      onBlock: (el) => emit("tc:block", { element: el }),
      onActivate: (el) => emit("tc:activate", { element: el })
    });
    blocker.start();
    const style = doc.createElement("style");
    style.setAttribute("data-tc", "boot");
    style.textContent = BOOT_CSS;
    (doc.head || doc.documentElement).appendChild(style);
    doc.documentElement.classList.add("tc-boot");
    doc.documentElement.setAttribute("data-tc-policy", policy);
    function persist() {
      doc.cookie = cookieString(config.cookieName, serializeConsent(consent), { days: config.cookieDays, secure });
    }
    function purge() {
      if (!config.purge) return [];
      const denied = OPTIONAL_CATEGORIES.filter((category) => !isAllowed(consent, category));
      if (!denied.length) return [];
      const removed = purgeCookies(doc, cookiePatternsFor(denied, win.TinyConsentVendors), {
        hostname: win.location ? win.location.hostname : "",
        path: win.location ? win.location.pathname : "/",
        keep: [config.cookieName]
      });
      if (removed.length) emit("tc:purge", { cookies: removed, categories: denied });
      return removed;
    }
    purge();
    win.addEventListener("load", purge);
    win.addEventListener("pagehide", purge);
    function closePanels() {
      if (!ui) return;
      if (consent.chosen) ui.hideAll();
      else ui.showBanner();
    }
    function apply(changes) {
      const previous = consent;
      consent = createConsent(previous, changes);
      persist();
      purge();
      if (ui) {
        ui.sync(consent);
        ui.hideAll();
      }
      blocker.activate();
      emit("tc:consent", getConsent());
      if (isDowngrade(previous, consent)) {
        win.addEventListener("pagehide", () => purge(), { once: true });
        if (config.reload) win.location.reload();
      }
    }
    function applyPolicy() {
      doc.documentElement.setAttribute("data-tc-policy", policy);
      if (consent.chosen) return;
      if (policy === "none") {
        apply({ ...allConsent(true), marketing: !gpc });
        return;
      }
      const next = defaultConsent({ mode: policy, gpc });
      if (OPTIONAL_CATEGORIES.some((category) => next[category] !== consent[category])) {
        consent = next;
        if (ui) ui.sync(consent);
        blocker.activate();
        emit("tc:consent", getConsent());
      }
      if (ui) ui.showBanner();
    }
    function setRegion(code) {
      const next = typeof code === "string" ? parseRegionCode(code) : code;
      if (!next || !next.country) return;
      region = next;
      policy = geoOn ? policyFor(region, regionTable) : config.mode;
      const label = region.region ? `${region.country}-${region.region}` : region.country;
      doc.documentElement.setAttribute("data-tc-region", label);
      emit("tc:region", { region: { ...region }, policy });
      applyPolicy();
    }
    function resolveRegion() {
      return resolver.resolve().then((found) => {
        if (found && found.country) setRegion(found);
        else applyPolicy();
        return region ? { ...region } : null;
      });
    }
    function reset() {
      doc.cookie = cookieString(config.cookieName, "", { days: -1, secure });
      consent = defaultConsent({ mode: policy === "none" ? "opt-in" : policy, gpc });
      purge();
      if (ui) ui.sync(consent);
      emit("tc:consent", getConsent());
      if (geoOn && !region) resolveRegion();
      else applyPolicy();
    }
    let vendors = [];
    function refreshVendors() {
      vendors = detectVendors(doc, {
        extra: win.TinyConsentVendors,
        include: config.vendors,
        cookieDays: config.cookieDays,
        base: win.location ? win.location.href : void 0
      });
      if (ui) ui.renderVendors(vendors);
      return vendors.map((v) => ({ ...v }));
    }
    function ready() {
      ui = bindUI(doc, {
        acceptAll: () => apply(allConsent(true)),
        rejectAll: () => apply(allConsent(false)),
        save: (changes) => apply(changes),
        close: closePanels,
        beforeOpen: refreshVendors
      });
      refreshVendors();
      ui.sync(consent);
      purge();
      blocker.activate();
      emit("tc:consent", getConsent());
      if (geoOn) resolveRegion();
      else applyPolicy();
    }
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", ready);
    else ready();
    win.TinyConsent = {
      __tc: true,
      version: VERSION2,
      config: { ...config, gpc },
      getConsent,
      getRegion: () => region ? { ...region, policy } : null,
      getPolicy: () => policy,
      setRegion,
      isAllowed: (category) => isAllowed(consent, category),
      setConsent: apply,
      acceptAll: () => apply(allConsent(true)),
      rejectAll: () => apply(allConsent(false)),
      open: () => ui && ui.showPreferences(),
      close: closePanels,
      reset,
      vendors: refreshVendors,
      purge
    };
  })(window, document);
})();
