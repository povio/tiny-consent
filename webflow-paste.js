// Builds a Webflow clipboard payload (@webflow/XscpData) from the component tree in
// index.html (the one the live preview uses) and the @tc-component section of styles.css,
// so the Designer paste always matches the reference. Also builds a plain HTML embed as a fallback.
//
// Node shapes follow what the Designer itself puts on the clipboard:
//   div / span                       Block (data.text true when it only holds text)
//   h1-h6                            Heading
//   p                                Paragraph
//   strong                           Strong
//   a                                Link (Button when it carries the tc-button class)
//   button                           DOM element with tag "button" (text wrapped in a Block)
//   element holding a single <svg>   HtmlEmbed with the SVG as its code
//   form                             Form Block (FormWrapper > FormForm + success/error messages)
//   div > input[type=checkbox]       Checkbox field (FormCheckboxWrapper > FormCheckboxInput + FormInlineLabel + Blocks)
//   data-* / role / tabindex / aria  Custom attributes (DOM elements take them in data.attributes)
//
// Style shapes: one class per rule, optional `.base.state` combo rules. var() resolves to
// the :root defaults, color-mix() becomes rgba, min()/calc() with px operands are evaluated.
// Shorthands (padding, margin, border, border-radius, flex, transition, gap) become the
// longhands the Style panel reads, `display: grid` gets explicit tracks, :hover becomes the
// `main_hover` variant and @media (max-width) the matching breakpoint variant.

(function (global) {
  const DROP_PROPS = new Set(['accent-color', 'appearance', 'outline', 'outline-offset', 'font-family']);
  const KEEP_ATTRS = /^(data-|role$|tabindex$|aria-)/;

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // ---------- CSS ----------

  function parseDecls(text) {
    const out = {};
    text.split(';').forEach((part) => {
      const colon = part.indexOf(':');
      if (colon < 0) return;
      const prop = part.slice(0, colon).trim();
      const value = part.slice(colon + 1).trim();
      if (prop && value) out[prop] = value;
    });
    return out;
  }

  function breakpointFor(maxWidth) {
    if (maxWidth <= 478) return 'tiny';
    if (maxWidth <= 767) return 'small';
    return 'medium';
  }

  /**
   * Returns { vars, classes: { name: { base, main_hover, small, … } }, combos: { base: { state: { … } } } }
   * `.name` rules go to classes, `.name.state` rules to combos[name][state].
   */
  function parseCss(cssText) {
    const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
    const result = { vars: {}, classes: {}, combos: {} };

    function handle(selector, decls, variant) {
      if (selector === ':root') {
        Object.assign(result.vars, decls);
        return;
      }
      const match = selector.match(/^\.([\w-]+)(?:\.([\w-]+))?(?::(hover|focus-visible))?$/);
      if (!match || match[3] === 'focus-visible') return;
      const [, name, state, pseudo] = match;
      const key = pseudo === 'hover' ? (variant === 'base' ? 'main_hover' : variant + '_hover') : variant;
      let entry;
      if (state) {
        const byBase = (result.combos[name] = result.combos[name] || {});
        entry = byBase[state] = byBase[state] || {};
      } else {
        entry = result.classes[name] = result.classes[name] || {};
      }
      entry[key] = Object.assign(entry[key] || {}, decls);
    }

    function parseRules(text, variant) {
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m;
      while ((m = re.exec(text))) handle(m[1].trim(), parseDecls(m[2]), variant);
    }

    // Pull out @media blocks first (brace matching), then parse the remainder.
    let rest = '';
    let i = 0;
    while (i < css.length) {
      const at = css.indexOf('@media', i);
      if (at < 0) {
        rest += css.slice(i);
        break;
      }
      rest += css.slice(i, at);
      const open = css.indexOf('{', at);
      let depth = 1;
      let j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const query = css.slice(at, open);
      const inner = css.slice(open + 1, j - 1);
      const width = query.match(/max-width:\s*(\d+)px/);
      parseRules(inner, width ? breakpointFor(Number(width[1])) : 'base');
      i = j;
    }
    parseRules(rest, 'base');
    return result;
  }

  function hexToRgba(hex, alpha) {
    let h = hex.replace('#', '');
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
  }

  function round(n) {
    return Math.round(n * 10) / 10;
  }

  function resolveValue(value, vars) {
    let v = value;
    for (let guard = 0; guard < 10 && /var\(/.test(v); guard++) {
      v = v.replace(/var\((--[\w-]+)\)/g, (_, name) => vars[name] || '');
    }
    let prev;
    let guard = 0;
    do {
      prev = v;
      v = v.replace(/calc\(\s*([\d.]+)px\s*\*\s*([\d.]+)\s*\)/g, (_, a, b) => round(a * b) + 'px');
      v = v.replace(/min\(\s*([\d.]+)px\s*,\s*([\d.]+)px\s*\)/g, (_, a, b) => Math.min(+a, +b) + 'px');
      v = v.replace(
        /color-mix\(in srgb,\s*(#[0-9a-fA-F]{3,8})\s+([\d.]+)%\s*,\s*transparent\s*\)/g,
        (_, hex, pct) => hexToRgba(hex, pct / 100),
      );
    } while (v !== prev && guard++ < 10);
    return v.trim();
  }

  /** Splits a value on whitespace, keeping function calls like rgba(…) together. */
  function tokens(value) {
    return value.match(/[^\s(]+\([^)]*\)|\S+/g) || [];
  }

  /** 1-4 values -> [top, right, bottom, left] */
  function fourSides(value) {
    const t = tokens(value);
    if (t.length === 1) return [t[0], t[0], t[0], t[0]];
    if (t.length === 2) return [t[0], t[1], t[0], t[1]];
    if (t.length === 3) return [t[0], t[1], t[2], t[1]];
    return t.slice(0, 4);
  }

  const SIDES = ['top', 'right', 'bottom', 'left'];
  const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  const BORDER_STYLES = /^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/;

  function borderParts(value) {
    const out = {};
    tokens(value).forEach((t) => {
      if (BORDER_STYLES.test(t)) out.style = t;
      else if (/^(\d|\.|thin$|medium$|thick$)/.test(t)) out.width = t;
      else out.color = t;
    });
    if (out.width === '0' && !out.style) out.style = 'none';
    return out;
  }

  /** The Style panel stores longhands only. Expand the shorthands the theme uses. */
  function expandShorthands(decls) {
    const out = {};
    Object.entries(decls).forEach(([prop, value]) => {
      if (prop === 'padding' || prop === 'margin') {
        fourSides(value).forEach((v, i) => (out[`${prop}-${SIDES[i]}`] = v));
      } else if (prop === 'border-radius') {
        fourSides(value.split('/')[0]).forEach((v, i) => (out[`border-${CORNERS[i]}-radius`] = v));
      } else if (prop === 'border-width' || prop === 'border-style' || prop === 'border-color') {
        const part = prop.slice('border-'.length);
        fourSides(value).forEach((v, i) => (out[`border-${SIDES[i]}-${part}`] = v));
      } else if (prop === 'border') {
        const parts = borderParts(value);
        SIDES.forEach((side) => {
          Object.entries(parts).forEach(([part, v]) => (out[`border-${side}-${part}`] = v));
        });
      } else if (/^border-(top|right|bottom|left)$/.test(prop)) {
        Object.entries(borderParts(value)).forEach(([part, v]) => (out[`${prop}-${part}`] = v));
      } else if (prop === 'flex') {
        if (value === 'none') Object.assign(out, { 'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto' });
        else if (value === 'auto') Object.assign(out, { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': 'auto' });
        else {
          const t = tokens(value);
          const nums = t.filter((x) => /^[\d.]+$/.test(x));
          const basis = t.find((x) => !/^[\d.]+$/.test(x));
          out['flex-grow'] = nums[0] || '0';
          out['flex-shrink'] = nums[1] || '1';
          out['flex-basis'] = basis || (nums.length === 1 ? '0%' : 'auto');
        }
      } else if (prop === 'transition') {
        const props = [];
        const durations = [];
        const timings = [];
        value.split(',').forEach((item) => {
          const t = tokens(item.trim());
          props.push(t[0] || 'all');
          durations.push(t.find((x) => /^[\d.]+m?s$/.test(x)) || '0ms');
          timings.push(t.find((x, i) => i > 0 && !/^[\d.]+m?s$/.test(x)) || 'ease');
        });
        out['transition-property'] = props.join(', ');
        out['transition-duration'] = durations.join(', ');
        out['transition-timing-function'] = timings.join(', ');
      } else {
        out[prop] = value;
      }
    });
    return out;
  }

  /** Webflow's grid editor needs explicit tracks. A `display: grid` without columns gets one `1fr` column. */
  function completeGrid(decls) {
    if (decls.display !== 'grid') return decls;
    const out = Object.assign({}, decls);
    if (!out['grid-template-columns']) out['grid-template-columns'] = '1fr';
    if (!out['grid-template-rows']) out['grid-template-rows'] = 'auto';
    if (!out['grid-auto-columns']) out['grid-auto-columns'] = '1fr';
    return out;
  }

  /** The Style panel stores `gap` as grid-row-gap / grid-column-gap, for flex and grid alike. */
  function splitGap(decls) {
    if (!decls.gap) return decls;
    const out = Object.assign({}, decls);
    const [row, column = row] = out.gap.split(/\s+/);
    delete out.gap;
    out['grid-row-gap'] = row;
    out['grid-column-gap'] = column;
    return out;
  }

  function normalizeDecls(decls, vars) {
    const resolved = {};
    Object.entries(decls || {}).forEach(([prop, value]) => {
      if (!DROP_PROPS.has(prop)) resolved[prop] = resolveValue(value, vars);
    });
    return splitGap(completeGrid(expandShorthands(resolved)));
  }

  function toStyleLess(decls, vars) {
    return Object.entries(normalizeDecls(decls, vars))
      .map(([prop, value]) => `${prop}: ${value};`)
      .join(' ');
  }

  // ---------- Nodes ----------

  const VISIBILITY = () => ({ conditions: [], keepInHtml: { tag: 'False', val: {} } });

  /** The data boilerplate every Designer node carries. */
  function baseData(tag) {
    return {
      tag,
      devlink: { runtimeProps: {}, slot: '' },
      displayName: '',
      attr: { id: '' },
      xattr: [],
      search: { exclude: false },
      visibility: VISIBILITY(),
    };
  }

  function keptAttrs(el) {
    return Array.from(el.attributes)
      .filter((a) => KEEP_ATTRS.test(a.name))
      .map((a) => ({ name: a.name, value: a.value }));
  }

  function isTextOnly(el) {
    return el.children.length === 0 && el.textContent.trim().length > 0;
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';
  }

  /**
   * Elements tagged data-tc-variant only belong to the listed policies. A single-policy
   * paste (opt-in, or opt-out) drops the others so the Designer does not show unused
   * copy and buttons. No list keeps every variant, which geolocation needs.
   */
  function forPolicies(root, policies) {
    if (!policies || !policies.length) return root;
    const clone = root.cloneNode(true);
    clone.querySelectorAll('[data-tc-variant]').forEach((el) => {
      const listed = el.getAttribute('data-tc-variant').trim().split(/\s+/);
      if (!listed.some((name) => policies.includes(name))) el.remove();
    });
    return clone;
  }

  function build({ root, css, policies }) {
    root = forPolicies(root, policies);
    const parsed = parseCss(css);
    const nodes = [];
    const styles = [];
    const styleIds = {};

    /** Rules for a class, or for a combo on a given base (`.base.state` first, plain `.state` as fallback). */
    function rulesFor(name, parent) {
      if (parent && parsed.combos[parent] && parsed.combos[parent][name]) return parsed.combos[parent][name];
      return parsed.classes[name] || {};
    }

    function styleFor(name, parent) {
      const key = parent ? `${parent}&${name}` : name;
      if (styleIds[key]) return styleIds[key];
      const rules = rulesFor(name, parent);
      const variants = {};
      Object.keys(rules).forEach((k) => {
        if (k === 'base') return;
        variants[k] = { styleLess: toStyleLess(rules[k], parsed.vars) };
      });
      const style = {
        _id: uid(),
        fake: false,
        type: 'class',
        name,
        namespace: '',
        comb: parent ? '&' : '',
        styleLess: toStyleLess(rules.base, parsed.vars),
        variants,
        children: [],
        createdBy: null,
        origin: null,
        selector: null,
      };
      styles.push(style);
      styleIds[key] = style._id;
      return style._id;
    }

    function classIds(el) {
      const names = Array.from(el.classList);
      if (!names.length) return [];
      const baseName = names[0];
      const baseId = styleFor(baseName, null);
      const ids = [baseId];
      names.slice(1).forEach((name) => {
        const comboId = styleFor(name, baseName);
        const base = styles.find((s) => s._id === baseId);
        if (!base.children.includes(comboId)) base.children.push(comboId);
        ids.push(comboId);
      });
      return ids;
    }

    function push(node) {
      nodes.push(node);
      return node._id;
    }

    function textNode(value) {
      return push({ _id: uid(), text: true, v: value });
    }

    function textBlock(value) {
      const data = baseData('div');
      data.text = true;
      return push({ _id: uid(), type: 'Block', tag: 'div', classes: [], children: [textNode(value)], data });
    }

    function childIds(el, ctx, wrapText) {
      const ids = [];
      el.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          const v = child.textContent.replace(/\s+/g, ' ').trim();
          if (v) ids.push(wrapText ? textBlock(v) : textNode(v));
        } else if (child.nodeType === 1) {
          ids.push(walk(child, ctx));
        }
      });
      return ids;
    }

    /** Generic element node. `extra` is merged into data after the boilerplate. */
    function element(type, tag, el, ctx, extra) {
      const data = Object.assign(baseData(tag), extra || {});
      if (type === 'Block') data.text = isTextOnly(el);
      if (el.id && 'id' in data.attr) data.attr.id = el.id;
      const attrs = keptAttrs(el);
      if (attrs.length) data.xattr = attrs;
      const node = { _id: uid(), type, tag, classes: classIds(el), children: [], data };
      nodes.push(node);
      node.children = childIds(el, ctx, false);
      return node._id;
    }

    function embed(el, svg) {
      const html = svg.outerHTML;
      const data = Object.assign(baseData('div'), {
        search: { exclude: true },
        embed: { meta: { html, div: false, script: false, compilable: false, iframe: false }, type: 'html' },
        insideRTE: false,
        content: '',
      });
      const attrs = keptAttrs(el);
      if (attrs.length) data.xattr = attrs;
      return push({ _id: uid(), type: 'HtmlEmbed', tag: 'div', classes: classIds(el), children: [], v: html, data });
    }

    /** Real <button>: Webflow's DOM element. Attributes live in data.attributes; text needs a Block. */
    function domButton(el, ctx) {
      const attributes = [{ name: 'type', value: el.getAttribute('type') || 'button' }].concat(keptAttrs(el));
      const node = {
        _id: uid(),
        type: 'DOM',
        tag: 'div',
        classes: classIds(el),
        children: [],
        data: { tag: 'button', attributes, slot: '', text: false, visibility: VISIBILITY() },
      };
      nodes.push(node);
      node.children = childIds(el, ctx, true);
      return node._id;
    }

    function link(el, ctx) {
      const isButton = el.classList.contains('tc-button');
      const data = Object.assign(baseData('a'), {
        button: isButton,
        block: '',
        link: { mode: 'external', url: el.getAttribute('href') || '#' },
        eventIds: [],
      });
      if (el.getAttribute('target') === '_blank') data.link.target = '_blank';
      data.attr = {};
      if (el.getAttribute('rel')) data.attr.rel = el.getAttribute('rel');
      const attrs = keptAttrs(el);
      if (attrs.length) data.xattr = attrs;
      const node = { _id: uid(), type: 'Link', tag: 'a', classes: classIds(el), children: [], data };
      nodes.push(node);
      node.children = childIds(el, ctx, false);
      return node._id;
    }

    function formBlock(el, ctx) {
      const name = 'Cookie Preferences';
      const formData = Object.assign(baseData('form'), {
        Source: { tag: 'Default form', val: {} },
        form: { type: 'form', name },
        attr: {
          id: 'wf-form-Cookie-Preferences',
          name: 'wf-form-Cookie-Preferences',
          'data-name': name,
          redirect: '',
          'data-redirect': '',
          action: '',
          method: 'get',
        },
      });
      const attrs = keptAttrs(el);
      if (attrs.length) formData.xattr = attrs;
      const formNode = { _id: uid(), type: 'FormForm', tag: 'form', classes: classIds(el), children: [], data: formData };
      nodes.push(formNode);
      formNode.children = childIds(el, Object.assign({}, ctx, { inForm: true }), false);

      const message = (type, formType, text) =>
        push({
          _id: uid(),
          type,
          tag: 'div',
          classes: [],
          children: [textBlock(text)],
          data: Object.assign(baseData('div'), { form: { type: formType } }),
        });
      const done = message('FormSuccessMessage', 'msg-done', 'Thank you! Your preferences were saved.');
      const fail = message('FormErrorMessage', 'msg-fail', 'Something went wrong. Please try again.');

      return push({
        _id: uid(),
        type: 'FormWrapper',
        tag: 'div',
        classes: [],
        children: [formNode._id, done, fail],
        data: Object.assign(baseData('div'), { search: { exclude: true }, form: { type: 'wrapper' } }),
      });
    }

    function checkboxInput(el) {
      const name = el.getAttribute('name') || 'Checkbox';
      const id = el.id || slug(name);
      const data = Object.assign(baseData('input'), {
        form: { type: 'checkbox-input', name },
        inputType: 'default',
        attr: { type: 'checkbox', name, id, 'data-name': name, required: false, checked: el.hasAttribute('checked') },
      });
      const attrs = keptAttrs(el);
      if (attrs.length) data.xattr = attrs;
      return push({ _id: uid(), type: 'FormCheckboxInput', tag: 'input', classes: classIds(el), children: [], data });
    }

    function walk(el, ctx) {
      const tag = el.tagName.toLowerCase();
      const onlyChild = el.children.length === 1 ? el.children[0] : null;

      if (tag === 'svg') return embed(el, el);
      if (onlyChild && onlyChild.tagName.toLowerCase() === 'svg') return embed(el, onlyChild);
      if (/^h[1-6]$/.test(tag)) return element('Heading', tag, el, ctx);
      if (tag === 'p') return element('Paragraph', 'p', el, ctx);
      if (tag === 'strong' || tag === 'b') return element('Strong', 'strong', el, ctx);
      if (tag === 'form') return formBlock(el, ctx);
      if (tag === 'button') return domButton(el, ctx);
      if (tag === 'a') return link(el, ctx);

      if (el.querySelector(':scope > input[type="checkbox"]')) {
        return element('FormCheckboxWrapper', 'div', el, Object.assign({}, ctx, { inCheckbox: true }), {
          form: { type: 'checkbox' },
        });
      }
      if (tag === 'input' && el.type === 'checkbox') return checkboxInput(el);
      if (tag === 'label' && ctx.inCheckbox) {
        const extra = { form: { type: 'checkbox-label' }, attr: { for: el.getAttribute('for') || '' } };
        return element('FormInlineLabel', 'label', el, ctx, extra);
      }

      return element('Block', 'div', el, ctx);
    }

    walk(root, {});

    return {
      type: '@webflow/XscpData',
      payload: {
        nodes,
        styles,
        assets: [],
        ix1: [],
        ix2: { interactions: [], events: [], actionLists: [] },
        expandUserComponents: true,
      },
      meta: {
        droppedLinks: 0,
        dynBindRemovedCount: 0,
        dynListBindRemovedCount: 0,
        paginationRemovedCount: 0,
        universalBindingsRemovedCount: 0,
        unlinkedSymbolCount: 0,
        codeComponentsRemovedCount: 0,
        richTextComponentsStripped: false,
      },
    };
  }

  // ---------- HTML embed fallback ----------

  function buildEmbed({ root, css, policies }) {
    root = forPolicies(root, policies);
    const scoped = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\.brand-[\w-]+\s*\{[^}]*\}\s*/g, '')
      .replace(/:root\s*\{/, '.tc-root {')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const html = root.outerHTML.replace(/^\s+/gm, (m) => m.replace(/^ {2}/, ''));
    return `<style>\n${scoped}\n</style>\n${html}`;
  }

  // ---------- Sources and clipboard ----------

  /** Page styles share styles.css. The paste and HTML embed use only the component section. */
  function componentCss(text) {
    const start = text.indexOf('/* @tc-component */');
    const end = text.indexOf('/* @tc-page */');
    if (start < 0 || end <= start) throw new Error('styles.css is missing the @tc-component section');
    return text.slice(start, end);
  }

  async function loadSources(base) {
    const prefix = base || './';
    const [html, css] = await Promise.all([
      fetch(prefix + 'index.html').then((r) => r.text()),
      fetch(prefix + 'styles.css').then((r) => r.text()),
    ]);
    // The pristine markup is fetched rather than read from the live document, because the
    // script running on the docs page mutates its copy (state attributes, generated vendors).
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector('[data-tc="root"]');
    if (!root) throw new Error('index.html has no [data-tc="root"] element');
    return { root, css: componentCss(css) };
  }

  /** Must run inside a user gesture: Webflow reads a JSON MIME type that only the copy event can set. */
  function writeWebflowClipboard(payload) {
    const json = JSON.stringify(payload);
    let ok = false;
    const onCopy = (event) => {
      event.preventDefault();
      event.clipboardData.setData('application/json', json);
      event.clipboardData.setData('text/plain', json);
      ok = true;
    };
    // execCommand('copy') needs a selection to fire the copy event. Select a scratch
    // textarea, then replace the clipboard contents in the handler.
    const scratch = document.createElement('textarea');
    scratch.value = 'tiny-consent';
    scratch.setAttribute('readonly', '');
    scratch.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(scratch);
    const active = document.activeElement;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    scratch.focus({ preventScroll: true });
    scratch.select();
    document.addEventListener('copy', onCopy);
    try {
      document.execCommand('copy');
    } finally {
      document.removeEventListener('copy', onCopy);
      scratch.remove();
      if (active && active.focus) active.focus({ preventScroll: true });
      window.scrollTo(scrollX, scrollY);
    }
    if (!ok) {
      // Without window focus Chrome disables execCommand. Leave the JSON on the clipboard as
      // text so nothing is lost, and tell the user how to get the real format.
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).catch(() => {});
      throw new Error(
        document.hasFocus()
          ? 'The browser blocked the copy. Click the button again.'
          : 'The browser window is not focused, so the copy was blocked. Click anywhere on this page, then press the button again.',
      );
    }
    return json.length;
  }

  global.TinyConsentPaste = {
    loadSources,
    build,
    buildEmbed,
    writeWebflowClipboard,
    parseCss,
    resolveValue,
    expandShorthands,
    normalizeDecls,
  };
})(typeof window !== 'undefined' ? window : globalThis);
