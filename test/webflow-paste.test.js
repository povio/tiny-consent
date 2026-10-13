// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../webflow-paste.js';

const paste = window.TinyConsentPaste;

const CSS = `
:root { --tc-accent: #0f766e; --tc-radius: 16px; --tc-radius-row: min(calc(var(--tc-radius) * 0.6), 16px); }
.tc-button { padding: 10px 16px; border: 1px solid #000; border-radius: calc(var(--tc-radius) * 0.75); transition: transform 120ms ease, opacity 120ms ease; font-family: Inter, sans-serif; }
.tc-button:hover { transform: translateY(-1px); }
.tc-form { display: grid; gap: 6px; }
.tc-row_check { flex: 1 1 auto; }
.tc-switch { background: #999; }
.tc-switch.is-on { background: var(--tc-accent); }
.tc-switch_knob.is-on { margin-left: 20px; }
@media (max-width: 560px) {
  .tc-button { flex: none; }
  .tc-button:hover { opacity: 0.9; }
}
`;

const HTML = `
<div class="tc-root" data-tc="root">
  <button type="button" class="tc-float" data-tc="float" data-tc-action="open-preferences" aria-label="Open">
    <div class="tc-float_icon"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></div>
    <div class="tc-float_label">Preferences</div>
  </button>
  <form class="tc-form">
    <div class="tc-switch is-on" data-tc-element="switch">
      <input type="checkbox" class="tc-switch_input" id="tc-analytics" name="Analytics" />
      <label class="tc-switch_label" for="tc-analytics">Analytics</label>
      <span class="tc-switch_knob is-on"></span>
    </div>
  </form>
  <a href="https://example.com/privacy" target="_blank" rel="noopener" class="tc-link">Privacy</a>
  <button type="button" class="tc-button" data-tc-action="accept-all">Accept all</button>
  <p class="tc-text">Hello <strong>there</strong></p>
  <div class="tc-plain">Just text</div>
</div>
`;

function sources() {
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  return { root: doc.querySelector('[data-tc="root"]'), css: CSS };
}

function byType(payload, type) {
  return payload.payload.nodes.filter((n) => n.type === type);
}

function styleNamed(payload, name, comb) {
  return payload.payload.styles.find((s) => s.name === name && (comb === undefined || s.comb === comb));
}

describe('webflow paste: payload envelope', () => {
  it('uses the clipboard format Webflow expects', () => {
    const payload = paste.build(sources());
    expect(payload.type).toBe('@webflow/XscpData');
    expect(payload.payload.expandUserComponents).toBe(true);
    expect(payload.meta.codeComponentsRemovedCount).toBe(0);
    expect(payload.meta.richTextComponentsStripped).toBe(false);
  });

  it('gives every node and style a UUID', () => {
    const payload = paste.build(sources());
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    payload.payload.nodes.forEach((n) => expect(n._id).toMatch(uuid));
    payload.payload.styles.forEach((s) => expect(s._id).toMatch(uuid));
  });
});

describe('webflow paste: node shapes', () => {
  it('maps <button> to a DOM element with attributes and a text Block child', () => {
    const payload = paste.build(sources());
    const [button] = byType(payload, 'DOM');
    expect(button.tag).toBe('div');
    expect(button.data.tag).toBe('button');
    expect(button.data.attributes).toEqual(
      expect.arrayContaining([
        { name: 'type', value: 'button' },
        { name: 'data-tc', value: 'float' },
        { name: 'data-tc-action', value: 'open-preferences' },
        { name: 'aria-label', value: 'Open' },
      ]),
    );
    const nodes = payload.payload.nodes;
    const children = button.children.map((id) => nodes.find((n) => n._id === id));
    expect(children.map((c) => c.type)).toEqual(['HtmlEmbed', 'Block']);
    expect(children[1].data.text).toBe(true);
  });

  it('maps an svg-only wrapper to an HtmlEmbed carrying the svg', () => {
    const payload = paste.build(sources());
    const [embed] = byType(payload, 'HtmlEmbed');
    expect(embed.tag).toBe('div');
    expect(embed.children).toEqual([]);
    expect(embed.v).toMatch(/^<svg/);
    expect(embed.data.embed).toEqual({
      meta: { html: embed.v, div: false, script: false, compilable: false, iframe: false },
      type: 'html',
    });
    expect(embed.data.search.exclude).toBe(true);
    expect(styleNamed(payload, 'tc-float_icon')).toBeTruthy();
    expect(embed.classes).toEqual([styleNamed(payload, 'tc-float_icon')._id]);
  });

  it('maps the switch to FormCheckboxWrapper > FormCheckboxInput + FormInlineLabel + Block', () => {
    const payload = paste.build(sources());
    const nodes = payload.payload.nodes;
    const [wrapper] = byType(payload, 'FormCheckboxWrapper');
    expect(wrapper.tag).toBe('div');
    expect(wrapper.data.form).toEqual({ type: 'checkbox' });
    expect(wrapper.data.xattr).toEqual([{ name: 'data-tc-element', value: 'switch' }]);

    const children = wrapper.children.map((id) => nodes.find((n) => n._id === id));
    expect(children.map((c) => c.type)).toEqual(['FormCheckboxInput', 'FormInlineLabel', 'Block']);

    const [input, label, knob] = children;
    expect(input.tag).toBe('input');
    expect(input.data.form).toEqual({ type: 'checkbox-input', name: 'Analytics' });
    expect(input.data.inputType).toBe('default');
    expect(input.data.attr).toEqual({
      type: 'checkbox',
      name: 'Analytics',
      id: 'tc-analytics',
      'data-name': 'Analytics',
      required: false,
      checked: false,
    });
    expect(label.tag).toBe('label');
    expect(label.data.form).toEqual({ type: 'checkbox-label' });
    expect(label.data.attr).toEqual({ for: 'tc-analytics' });
    expect(knob.data.text).toBe(false);
  });

  it('wraps the form with wrapper and messages and carries the form extras', () => {
    const payload = paste.build(sources());
    const [wrapper] = byType(payload, 'FormWrapper');
    expect(wrapper.data.form).toEqual({ type: 'wrapper' });
    expect(wrapper.data.search.exclude).toBe(true);
    const [form] = byType(payload, 'FormForm');
    expect(form.data.Source).toEqual({ tag: 'Default form', val: {} });
    expect(form.data.attr).toMatchObject({ redirect: '', 'data-redirect': '', action: '', method: 'get' });
    expect(byType(payload, 'FormSuccessMessage')).toHaveLength(1);
    expect(byType(payload, 'FormErrorMessage')).toHaveLength(1);
  });

  it('maps links with the extras the Designer writes', () => {
    const payload = paste.build(sources());
    const [link] = byType(payload, 'Link');
    expect(link.data).toMatchObject({
      button: false,
      block: '',
      eventIds: [],
      link: { mode: 'external', url: 'https://example.com/privacy', target: '_blank' },
      attr: { rel: 'noopener' },
    });
  });

  it('flags text-only Blocks and keeps the Designer boilerplate', () => {
    const payload = paste.build(sources());
    const plain = payload.payload.nodes.find((n) => n.type === 'Block' && n.data.text === true && n.classes.length);
    expect(plain).toBeTruthy();
    expect(plain.data).toMatchObject({
      tag: 'div',
      devlink: { runtimeProps: {}, slot: '' },
      displayName: '',
      attr: { id: '' },
      search: { exclude: false },
      visibility: { conditions: [], keepInHtml: { tag: 'False', val: {} } },
    });
    const root = payload.payload.nodes[0];
    expect(root.type).toBe('Block');
    expect(root.data.text).toBe(false);
    expect(byType(payload, 'Paragraph')).toHaveLength(1);
    expect(byType(payload, 'Strong')).toHaveLength(1);
  });
});

describe('webflow paste: style shapes', () => {
  it('stores hover rules under main_hover and breakpoint hover under <bp>_hover', () => {
    const payload = paste.build(sources());
    const button = styleNamed(payload, 'tc-button');
    expect(button.variants.main_hover.styleLess).toBe('transform: translateY(-1px);');
    expect(button.variants.hover).toBeUndefined();
    expect(button.variants.small.styleLess).toBe('flex-grow: 0; flex-shrink: 0; flex-basis: auto;');
    expect(button.variants.small_hover.styleLess).toBe('opacity: 0.9;');
  });

  it('expands shorthands into the longhands the Style panel reads', () => {
    const out = paste.expandShorthands({
      padding: '10px 16px',
      margin: '0',
      border: '1px solid #000',
      'border-radius': '12px',
      flex: '1 1 auto',
      transition: 'transform 120ms ease, opacity 120ms ease',
    });
    expect(out).toEqual({
      'padding-top': '10px',
      'padding-right': '16px',
      'padding-bottom': '10px',
      'padding-left': '16px',
      'margin-top': '0',
      'margin-right': '0',
      'margin-bottom': '0',
      'margin-left': '0',
      'border-top-width': '1px',
      'border-top-style': 'solid',
      'border-top-color': '#000',
      'border-right-width': '1px',
      'border-right-style': 'solid',
      'border-right-color': '#000',
      'border-bottom-width': '1px',
      'border-bottom-style': 'solid',
      'border-bottom-color': '#000',
      'border-left-width': '1px',
      'border-left-style': 'solid',
      'border-left-color': '#000',
      'border-top-left-radius': '12px',
      'border-top-right-radius': '12px',
      'border-bottom-right-radius': '12px',
      'border-bottom-left-radius': '12px',
      'flex-grow': '1',
      'flex-shrink': '1',
      'flex-basis': 'auto',
      'transition-property': 'transform, opacity',
      'transition-duration': '120ms, 120ms',
      'transition-timing-function': 'ease, ease',
    });
  });

  it('expands per-side border shorthands and flex keywords', () => {
    expect(paste.expandShorthands({ 'border-width': '0 0 1px', 'border-bottom': '2px dashed red', flex: 'none' })).toEqual({
      'border-top-width': '0',
      'border-right-width': '0',
      'border-bottom-width': '2px',
      'border-left-width': '0',
      'border-bottom-style': 'dashed',
      'border-bottom-color': 'red',
      'flex-grow': '0',
      'flex-shrink': '0',
      'flex-basis': 'auto',
    });
  });

  it('resolves variables before expanding, drops font-family, and leaves no shorthands in styleLess', () => {
    const payload = paste.build(sources());
    const button = styleNamed(payload, 'tc-button');
    expect(button.styleLess).toContain('border-top-left-radius: 12px;');
    expect(button.styleLess).not.toMatch(/(^|\s)(padding|border|border-radius|transition|flex|gap|font-family):/);
    payload.payload.styles.forEach((s) => {
      expect(s.styleLess).not.toMatch(/(^|\s)(padding|margin|border|border-radius|transition|flex|gap):/);
    });
  });

  it('completes grid tracks and splits gap', () => {
    const payload = paste.build(sources());
    expect(styleNamed(payload, 'tc-form').styleLess).toBe(
      'display: grid; grid-template-columns: 1fr; grid-template-rows: auto; grid-auto-columns: 1fr; grid-row-gap: 6px; grid-column-gap: 6px;',
    );
  });

  it('evaluates min()/calc() with px operands', () => {
    const vars = { '--tc-radius': '16px' };
    expect(paste.resolveValue('min(calc(var(--tc-radius) * 0.6), 16px)', vars)).toBe('9.6px');
  });

  it('creates one combo style per base for .base.state rules and links it to the base', () => {
    const payload = paste.build(sources());
    const combos = payload.payload.styles.filter((s) => s.name === 'is-on');
    expect(combos).toHaveLength(2);
    combos.forEach((c) => expect(c.comb).toBe('&'));
    const field = styleNamed(payload, 'tc-switch');
    const knob = styleNamed(payload, 'tc-switch_knob');
    const fieldCombo = combos.find((c) => field.children.includes(c._id));
    const knobCombo = combos.find((c) => knob.children.includes(c._id));
    expect(fieldCombo.styleLess).toBe('background: #0f766e;');
    expect(knobCombo.styleLess).toBe('margin-left: 20px;');
    const [wrapper] = byType(payload, 'FormCheckboxWrapper');
    expect(wrapper.classes).toEqual([field._id, fieldCombo._id]);
  });
});

describe('webflow paste: policy variants', () => {
  function variantRoot() {
    const doc = new DOMParser().parseFromString(
      `<div data-tc="root">
        <p data-tc-variant="opt-in none">Ask first</p>
        <p data-tc-variant="opt-out">Already on</p>
        <button type="button" data-tc-variant="opt-in none">Reject all</button>
        <button type="button" data-tc-variant="opt-out">Do not sell or share</button>
        <button type="button">Preferences</button>
      </div>`,
      'text/html',
    );
    return doc.querySelector('[data-tc="root"]');
  }

  function texts(payload) {
    return payload.payload.nodes.filter((n) => n.text).map((n) => n.v);
  }

  it('keeps every variant when no policy is requested', () => {
    const labels = texts(paste.build({ root: variantRoot(), css: CSS }));
    expect(labels).toEqual(expect.arrayContaining(['Ask first', 'Already on', 'Reject all', 'Do not sell or share', 'Preferences']));
  });

  it('drops copy and buttons that do not belong to the requested policy', () => {
    const labels = texts(paste.build({ root: variantRoot(), css: CSS, policies: ['opt-in'] }));
    expect(labels).toEqual(expect.arrayContaining(['Ask first', 'Reject all', 'Preferences']));
    expect(labels).not.toContain('Already on');
    expect(labels).not.toContain('Do not sell or share');
  });

  it('leaves the source tree unchanged', () => {
    const root = variantRoot();
    paste.build({ root, css: CSS, policies: ['opt-out'] });
    expect(root.querySelectorAll('[data-tc-variant="opt-in none"]')).toHaveLength(2);
  });
});
