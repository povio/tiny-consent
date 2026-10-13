// Stops tracker tags before they run and activates them once consent allows.
//
// Two sources of blocked tags:
// 1. Marked tags the author wrote: `<script type="text/plain" data-tc-src="…" data-tc-category="analytics">`
//    and `<iframe data-tc-src="…" data-tc-category="marketing">`.
// 2. Unmarked tags whose hostname is on the block list. A MutationObserver catches
//    parser-inserted tags; a `document.createElement` guard catches dynamic ones.

import { parseCategories } from './consent.js';

const rawSetAttribute = typeof Element !== 'undefined' ? Element.prototype.setAttribute : null;

function setAttr(el, name, value) {
  rawSetAttribute.call(el, name, value);
}

/** "host[:category], host2[/path][:category]" -> [[pattern, category], …] */
export function parseBlockAttr(attr) {
  return String(attr || '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colon = entry.lastIndexOf(':');
      if (colon < 0) return [entry.toLowerCase(), 'marketing'];
      return [entry.slice(0, colon).toLowerCase(), entry.slice(colon + 1).toLowerCase() || 'marketing'];
    });
}

/** Returns the category for the first matching pattern, or null. */
export function matchPattern(url, patterns, base) {
  let parsed;
  try {
    parsed = new URL(String(url), base || 'http://tc.invalid/');
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;
  const path = parsed.pathname;

  for (const [pattern, category] of patterns) {
    const slash = pattern.indexOf('/');
    const patternHost = (slash < 0 ? pattern : pattern.slice(0, slash)).toLowerCase();
    const patternPath = slash < 0 ? '' : pattern.slice(slash);
    if (host !== patternHost && !host.endsWith('.' + patternHost)) continue;
    if (patternPath && !path.startsWith(patternPath)) continue;
    return category;
  }
  return null;
}

const MARKED_SELECTOR = [
  'script[type="text/plain"][data-tc-category]',
  'script[data-tc-src][data-tc-category]',
  ':not(script)[data-tc-src][data-tc-category]',
  '[data-tc-element="placeholder"][data-tc-category]',
].join(', ');

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {Array<[string, string]>} options.patterns host patterns, checked in order
 * @param {(categories: string[]) => boolean} options.isAllowed
 * @param {string} [options.base] URL used to resolve relative `src` values
 * @param {(el: Element) => void} [options.onBlock]
 * @param {(el: Element) => void} [options.onActivate]
 */
export function createBlocker({ doc, patterns, isAllowed, base, onBlock, onActivate }) {
  const createRaw = doc.createElement.bind(doc);
  let observer = null;

  function categoryFor(el, src) {
    if (el.hasAttribute('data-tc-category') || el.hasAttribute('data-tc-activated') || el.hasAttribute('data-tc-ignore')) {
      return null;
    }
    return matchPattern(src, patterns, base);
  }

  function needsBlock(category) {
    return Boolean(category) && !isAllowed([category]);
  }

  function mark(el, src, category) {
    const tag = el.tagName;
    if (tag === 'SCRIPT') {
      const type = el.getAttribute('type');
      if (type && type !== 'text/plain') setAttr(el, 'data-tc-type', type);
      setAttr(el, 'type', 'text/plain');
      el.removeAttribute('src');
    } else if (el.hasAttribute('src')) {
      setAttr(el, 'src', 'about:blank');
    }
    setAttr(el, 'data-tc-src', src);
    setAttr(el, 'data-tc-category', category);
    setAttr(el, 'data-tc-auto', '');
    if (onBlock) onBlock(el);
  }

  function inspect(el) {
    const src = el.getAttribute('src');
    if (src) {
      const category = categoryFor(el, src);
      if (needsBlock(category)) mark(el, src, category);
      return;
    }
    // Marked external tags that are already allowed (returning visitors) run right away.
    // Inline marked scripts wait for activate(): their text is not parsed yet when the observer fires.
    if (el.hasAttribute('data-tc-category') && el.hasAttribute('data-tc-src')) activateOne(el);
  }

  function visit(node) {
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'IFRAME') inspect(node);
    if (node.querySelectorAll) {
      node.querySelectorAll('script[src], iframe[src]').forEach(inspect);
    }
  }

  /** Dynamically created tags: intercept `src` before the browser can start loading. */
  function guard(el) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
    const ownSetAttribute = el.setAttribute;

    el.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === 'src') {
        const category = categoryFor(el, value);
        if (needsBlock(category)) {
          mark(el, String(value), category);
          return;
        }
      }
      return ownSetAttribute.call(el, name, value);
    };

    if (descriptor && descriptor.set) {
      Object.defineProperty(el, 'src', {
        configurable: true,
        get() {
          return descriptor.get.call(el);
        },
        set(value) {
          el.setAttribute('src', value);
        },
      });
    }
  }

  function start() {
    doc.createElement = function (tag, options) {
      const el = createRaw(tag, options);
      const name = String(tag).toLowerCase();
      if (name === 'script' || name === 'iframe') guard(el);
      return el;
    };
    if (typeof MutationObserver !== 'undefined' && doc.documentElement) {
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
    const script = createRaw('script');
    for (const { name, value } of Array.from(el.attributes)) {
      if (name === 'type' || name === 'src' || name.startsWith('data-tc-')) continue;
      setAttr(script, name, value);
    }
    const type = el.getAttribute('data-tc-type');
    if (type) setAttr(script, 'type', type);
    setAttr(script, 'data-tc-activated', '');
    setAttr(script, 'data-tc-category', el.getAttribute('data-tc-category'));

    const src = el.getAttribute('data-tc-src');
    if (src) {
      script.async = false;
      setAttr(script, 'src', src);
    } else {
      script.textContent = el.textContent || '';
    }
    if (el.parentNode) el.parentNode.replaceChild(script, el);
    else (doc.head || doc.documentElement).appendChild(script);
    return script;
  }

  /** Runs or reveals one marked element if its categories are allowed. */
  function activateOne(el) {
    if (el.hasAttribute('data-tc-activated')) return false;
    const categories = parseCategories(el.getAttribute('data-tc-category'));
    if (!isAllowed(categories)) return false;

    let result = el;
    if (el.tagName === 'SCRIPT') {
      result = runScript(el);
    } else if (el.getAttribute('data-tc-element') === 'placeholder') {
      el.remove();
    } else {
      setAttr(el, 'data-tc-activated', '');
      const src = el.getAttribute('data-tc-src');
      if (src) setAttr(el, 'src', src);
    }
    if (onActivate) onActivate(result);
    return true;
  }

  /** Activates every marked element whose categories are allowed. Returns how many ran. */
  function activate() {
    let count = 0;
    doc.querySelectorAll(MARKED_SELECTOR).forEach((el) => {
      if (activateOne(el)) count += 1;
    });
    return count;
  }

  return { start, stop, activate, activateOne, inspect: visit, createRaw };
}
