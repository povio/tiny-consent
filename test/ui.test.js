// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindUI } from '../src/ui.js';
import { allConsent, createConsent, defaultConsent } from '../src/consent.js';

const MARKUP = `
<div data-tc="root">
  <div data-tc="banner">
    <button data-tc-action="accept-all">Accept all</button>
    <button data-tc-action="open-preferences">Preferences</button>
  </div>
  <div data-tc="preferences">
    <form>
      <div data-tc-category="essential" data-tc-element="accordion">
        <div data-tc-action="toggle" data-tc-element="chevron" role="button" tabindex="0"></div>
        <div data-tc-element="details">
          <div data-tc-element="accordion" id="vendor">
            <div data-tc-action="toggle" role="button" tabindex="0" id="vendor-toggle">
              <a href="https://example.com/privacy" id="policy">Privacy policy</a>
            </div>
            <div data-tc-element="details" id="vendor-details"></div>
          </div>
        </div>
      </div>
      <div data-tc-category="analytics" data-tc-element="accordion" id="analytics">
        <button type="button" data-tc-action="toggle" id="analytics-toggle">
          <div data-tc-element="chevron" id="analytics-chevron"></div>
        </button>
        <div data-tc-action="toggle" id="analytics-title">Analytics</div>
        <div data-tc-element="switch" id="analytics-switch">
          <input type="checkbox" id="analytics-input" name="Analytics" />
          <label for="analytics-input">Analytics</label>
          <div id="analytics-knob"></div>
        </div>
        <div data-tc-element="details"></div>
      </div>
      <div data-tc-category="marketing" id="marketing">
        <label id="marketing-label"><input type="checkbox" id="marketing-input" /> Marketing</label>
      </div>
      <button data-tc-action="save">Save</button>
    </form>
  </div>
  <div data-tc="float" data-tc-action="open-preferences" role="button" tabindex="0">Preferences</div>
</div>`;

// Each test gets its own document: bindUI attaches listeners to the document it receives.
let doc;

function setup() {
  doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = MARKUP;
  const handlers = { acceptAll: vi.fn(), rejectAll: vi.fn(), save: vi.fn(), close: vi.fn() };
  const ui = bindUI(doc, handlers);
  return { ui, handlers };
}

const byId = (id) => doc.getElementById(id);

const visible = (el) => el.getAttribute('data-tc-visible') === 'true';
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('float button', () => {
  it('stays hidden until a choice exists', () => {
    const { ui } = setup();
    ui.sync(defaultConsent({ mode: 'opt-in' }));
    ui.showBanner();
    expect(visible(ui.float)).toBe(false);
    expect(visible(ui.root)).toBe(true);
  });

  it('shows after a choice, hides while a panel is open', () => {
    const { ui } = setup();
    ui.sync(createConsent(defaultConsent({ mode: 'opt-in' }), allConsent(true)));
    ui.hideAll();
    expect(visible(ui.float)).toBe(true);
    expect(visible(ui.root)).toBe(true);

    click(ui.float);
    expect(visible(ui.prefs)).toBe(true);
    expect(visible(ui.float)).toBe(false);

    ui.hideAll();
    expect(visible(ui.float)).toBe(true);
  });

  it('is shown for returning visitors by sync alone', () => {
    const { ui } = setup();
    ui.sync(createConsent(defaultConsent({ mode: 'opt-in' }), { analytics: true }));
    expect(visible(ui.float)).toBe(true);
  });
});

describe('accordion', () => {
  it('toggles data-tc-open on the nearest accordion and aria-expanded on the toggle', () => {
    setup();
    const box = byId('analytics');
    const toggle = byId('analytics-toggle');
    click(toggle);
    expect(box.getAttribute('data-tc-open')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(box.getAttribute('data-tc-open')).toBe('false');
  });

  it('opens from the title too and keeps every toggle of the row in sync', () => {
    setup();
    const box = byId('analytics');
    const button = byId('analytics-toggle');
    const title = byId('analytics-title');
    click(title);
    expect(box.getAttribute('data-tc-open')).toBe('true');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.classList.contains('is-open')).toBe(true);
    expect(byId('analytics-chevron').classList.contains('is-open')).toBe(true);
    expect(title.classList.contains('is-open')).toBe(true);
    expect(title.hasAttribute('aria-expanded')).toBe(false); // a plain div carries no ARIA state
    click(button);
    expect(box.getAttribute('data-tc-open')).toBe('false');
    expect(title.classList.contains('is-open')).toBe(false);
    expect(byId('analytics-chevron').classList.contains('is-open')).toBe(false);
  });

  it('nested toggles only affect their own accordion', () => {
    setup();
    click(byId('vendor-toggle'));
    expect(byId('vendor').getAttribute('data-tc-open')).toBe('true');
    expect(doc.querySelector('[data-tc-category="essential"]').hasAttribute('data-tc-open')).toBe(false);
  });

  it('lets a link inside a toggle header through', () => {
    setup();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    byId('policy').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(byId('vendor').hasAttribute('data-tc-open')).toBe(false);
  });

  it('activates role="button" divs with Enter and Space', () => {
    setup();
    const toggle = byId('vendor-toggle');
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(byId('vendor').getAttribute('data-tc-open')).toBe('true');
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    toggle.dispatchEvent(space);
    expect(byId('vendor').getAttribute('data-tc-open')).toBe('false');
    expect(space.defaultPrevented).toBe(true);
  });

  it('mirrors data-tc-open into is-open on the accordion, toggle, and chevron', () => {
    setup();
    const toggle = byId('analytics-toggle');
    click(toggle);
    expect(byId('analytics').classList.contains('is-open')).toBe(true);
    expect(toggle.classList.contains('is-open')).toBe(true);
    expect(byId('analytics-chevron').classList.contains('is-open')).toBe(true);
    click(toggle);
    expect(byId('analytics').classList.contains('is-open')).toBe(false);
    expect(toggle.classList.contains('is-open')).toBe(false);
    expect(byId('analytics-chevron').classList.contains('is-open')).toBe(false);
  });
});

describe('switch state', () => {
  const on = (id) => byId(id).classList.contains('is-on');

  it('sync() puts is-on on the switch wrapper and its children for allowed categories', () => {
    const { ui } = setup();
    ui.sync(createConsent(defaultConsent({ mode: 'opt-in' }), { analytics: true, marketing: false }));
    expect(byId('analytics-input').checked).toBe(true);
    expect(on('analytics-switch')).toBe(true);
    expect(on('analytics-input')).toBe(true);
    expect(on('analytics-knob')).toBe(true);
    expect(on('marketing-label')).toBe(false);

    ui.sync(createConsent(defaultConsent({ mode: 'opt-in' }), { analytics: false, marketing: true }));
    expect(on('analytics-switch')).toBe(false);
    expect(on('analytics-knob')).toBe(false);
    // Without a switch wrapper the input's parent carries the class.
    expect(on('marketing-label')).toBe(true);
  });

  it('follows the checkbox when the visitor flips it', () => {
    const { ui } = setup();
    ui.sync(defaultConsent({ mode: 'opt-in' }));
    const input = byId('analytics-input');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(on('analytics-switch')).toBe(true);
    expect(on('analytics-knob')).toBe(true);
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(on('analytics-switch')).toBe(false);
    expect(ui.read()).toEqual({ analytics: false, marketing: false });
  });
});
