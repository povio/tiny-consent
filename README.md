# Tiny Consent for Webflow

A small first-party cookie consent kit for Webflow projects. One static script blocks trackers until the visitor agrees; one native Webflow component is the banner, styled in the Designer with your fonts, colors, and interactions.

- No server, no account, no per-site plan. Consent lives in a first-party cookie.
- Banner and preferences panel are regular Webflow elements. The script only reads `data-tc` attributes.
- Scripts, iframes, and images stay blocked until their category is allowed. Known tracker hosts are blocked even when you forget to tag them.
- Honors Global Privacy Control. Opt-in (GDPR) and opt-out (CCPA) modes, or rules by region: GDPR banner in Europe, opt-out notice in US privacy states, no banner elsewhere.

## Contents

- `src/` script source (`tiny-consent.js` entry, `consent.js`, `blocker.js`, `ui.js`, `blocklist.js`, `vendors.js`, `cleanup.js`, `geo.js`)
- `dist/` built bundle to host (`tiny-consent.js`, `tiny-consent.min.js`)
- `index.html` onboarding docs: the setup steps with copy buttons, a head-code configurator, **Copy component for Webflow**, and a live preview of the component (the exact tree, driven by the real script)
- `webflow-paste.js` turns the component tree in `index.html` and the component section of `styles.css` into a Webflow clipboard payload
- `test/` Vitest suite

```sh
npm install
npm run build   # dist/tiny-consent.js + dist/tiny-consent.min.js
npm run dev     # http://localhost:8787/ with rebuild on change
npm test
```

The docs page is the shortest path: open `npm run dev`, follow the six steps, and use the copy buttons.

## 1. Host the script once

The script is published on jsDelivr from this repo. `@1` includes later 1.x releases. Use `@main` when a site should follow the latest build. To host it yourself, upload `dist/tiny-consent.min.js` and point the script tag at that file.

## 2. Install on a Webflow site

Site settings → Custom code → **Head code**. Put this first, before any analytics or pixel snippet, with no `async` or `defer`:

```html
<script src="https://cdn.jsdelivr.net/gh/povio/tiny-consent@1/dist/tiny-consent.min.js"
        data-tc-mode="opt-in"
        data-tc-cookie-days="180"></script>
```

| Attribute | Default | Meaning |
| --- | --- | --- |
| `data-tc-mode` | `opt-in` | `opt-in`: nothing optional runs until the visitor accepts. `opt-out`: everything runs until the visitor rejects (CCPA style). |
| `data-tc-cookie-days` | `180` | Lifetime of the consent cookie. |
| `data-tc-block` | | Extra hosts to block, `host[:category]`, comma separated. `cdn.example.com:analytics, pixel.example.com`. Category defaults to `marketing`. Use `:essential` to let a host through the default list, e.g. `googletagmanager.com:essential`. |
| `data-tc-reload` | `true` | Reload the page when a category that was allowed becomes denied. Running scripts cannot be unloaded, so this is how they stop. Set `false` to skip. |
| `data-tc-cookie-name` | `tc_consent` | Cookie name. |
| `data-tc-purge` | `true` | Delete the known cookies of vendors in denied categories (on load, after every change, and when the page is left). Set `false` to leave cookies alone. |
| `data-tc-vendors` | | Vendor ids to list in the panel even when nothing on the page matches them (server-side tags), e.g. `meta-pixel, hubspot`. See [Vendor list](#vendor-list). |
| `data-tc-geo` | | Rules by region. `auto`: IP lookup with timezone fallback. `timezone`: browser timezone only, no request. Overrides `data-tc-mode`. See [Rules by region](#rules-by-region). |
| `data-tc-regions` | see below | Region → policy table, `key:policy` comma separated. Policies: `opt-in`, `opt-out`, `none`. |
| `data-tc-geo-url` | geojs.io | Your own lookup endpoint for `auto`. JSON with `country_code`/`country` and `region_code`/`region`, or Cloudflare `cdn-cgi/trace` text. |
| `data-tc-region` | | Force a region (`us-ca`, `de`, `eu`) and skip detection. Also `window.TinyConsentRegion`. |

Then publish. Tags added under Webflow **Apps & Integrations** (the Google Analytics and Facebook Pixel fields) load before custom code and cannot be blocked. Paste those snippets into Head code instead.

## 3. Mark your trackers

Categories are `essential`, `analytics`, `marketing`, `personalization`. Essential always runs.

**Scripts** — set `type="text/plain"`, move `src` to `data-tc-src`, add the category:

```html
<!-- before -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments)} gtag('js', new Date()); gtag('config', 'G-XXXX');</script>

<!-- after -->
<script type="text/plain" data-tc-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX" data-tc-category="analytics"></script>
<script type="text/plain" data-tc-category="analytics">window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments)} gtag('js', new Date()); gtag('config', 'G-XXXX');</script>
```

A tag that lists several categories (`data-tc-category="analytics, marketing"`) runs only when all of them are allowed.

**Iframes and images** (YouTube, Vimeo, Google Maps, tracking pixels) — replace `src` with `data-tc-src` in a Code Embed:

```html
<iframe data-tc-src="https://www.youtube-nocookie.com/embed/VIDEO" data-tc-category="marketing" allowfullscreen></iframe>
```

**Placeholder** — any element with `data-tc-element="placeholder"` and a category is removed once that category is allowed. Put a message and an open-preferences button inside it, over the blocked embed.

**Automatic blocking** — scripts and iframes from hosts in `src/blocklist.js` (Google Analytics, GTM, Meta, Hotjar, LinkedIn, TikTok, HubSpot, YouTube, Intercom, …) are blocked even when they are not marked, including scripts injected later by other scripts. Scripts that already executed before Tiny Consent loaded, and tags Webflow injects ahead of custom code, cannot be caught. Add `data-tc-ignore` to a tag to exclude it from automatic blocking.

Remove `<noscript>` fallbacks from tracker snippets. They fire without consent.

## 4. Build the component in Webflow

### Paste it

On the docs page (`npm run dev`, step 4) press **Copy component for Webflow**. The clipboard then holds the component in Webflow's own clipboard format (`@webflow/XscpData`): native Div, Heading, Paragraph, Button, and Checkbox elements, one class per element with the default theme values, and all `data-tc` attributes set. In the Designer, select the footer (or any component that is on every page), enter the component, and paste.

The payload is generated from the component tree in `index.html` plus the component section of `styles.css`, so it always matches the live preview. During generation `var()` becomes the default value, `color-mix()` becomes `rgba()`, `:hover` becomes the Hover state, and the `max-width: 560px` media query becomes the Tablet/Mobile breakpoint. After pasting, swap the flat colors for your site's variables.

If nothing appears, **Copy as HTML embed** is the fallback: paste into a Code Embed element. Works instantly, not styleable in the Designer.

### Or build it by hand

The script finds elements by attribute, so names, classes, copy, order of buttons, and interactions are free.

```
Div                 data-tc="root"                 position relative, z-index 9999 (zero-size anchor)
├─ Div              data-tc="banner"               position fixed, bottom-right (or any placement)
│  ├─ Div           brand row: mark + Heading "We use cookies"
│  ├─ Paragraph     description
│  ├─ Text link     privacy policy
│  └─ Div           actions
│     ├─ Button     data-tc-action="reject-all"
│     ├─ Button     data-tc-action="open-preferences"
│     └─ Button     data-tc-action="accept-all"
├─ Div              data-tc="preferences"          position fixed, inset 0, centered
│  ├─ Div           backdrop, data-tc-action="close"
│  └─ Div           dialog
│     ├─ Button     data-tc-action="close"         the X (an SVG embed inside)
│     ├─ Heading / Paragraph
│     ├─ Form Block (Webflow checkboxes need one)
│     │  └─ Div     data-tc-category="analytics" data-tc-element="accordion"     one row per category
│     │     ├─ Div  head
│     │     │  ├─ Button  data-tc-action="toggle"
│     │     │  │  └─ Div  data-tc-element="chevron"   SVG embed inside; rotates while open
│     │     │  ├─ Div     title   data-tc-action="toggle"   clicking the title opens the row too
│     │     │  └─ Checkbox field  data-tc-element="switch"   Essential: a Div with a badge instead
│     │     │     ├─ Checkbox input   name="Analytics"
│     │     │     ├─ Label            hidden, for the input
│     │     │     └─ Div              knob
│     │     ├─ Paragraph  description
│     │     └─ Div  data-tc-element="details"      vendor list, hidden until the chevron opens it
│     │        ├─ Div   data-tc-element="accordion" data-tc-vendor="sample"   template, cloned per detected vendor
│     │        │  ├─ Div   head  data-tc-action="toggle": name (data-tc-field="vendor-name"), link (data-tc-field="vendor-privacy"), chevron button
│     │        │  └─ Div   data-tc-element="details"
│     │        │     └─ Div   data-tc-field="cookie"   one per cookie: cookie-name, cookie-purpose, cookie-duration
│     │        └─ Paragraph  data-tc-field="empty"     shown when nothing was detected for the category
│     └─ Div           actions
│        ├─ Button     data-tc-action="reject-all"
│        ├─ Button     data-tc-action="save"
│        └─ Button     data-tc-action="accept-all"
└─ Button           data-tc="float" data-tc-action="open-preferences"
   ├─ Div           cookie icon (SVG embed)        position fixed, bottom-left; shown once a choice exists
   └─ Div           "Preferences"
```

Rules:

- Keep every element inside `data-tc="root"` and keep the attributes. Everything else is yours.
- Set attributes in Element settings → Custom attributes. Put `data-tc-category` on the row Div around each switch; the script finds the checkbox input inside. A row without a checkbox (Essential) is display only.
- Switches: the checkbox input sits invisibly over the track; the knob is a plain Div. The script adds the combo class `is-on` to the `data-tc-element="switch"` wrapper (or the input's parent if there is no wrapper) and to its children while the category is allowed, so style the on state as `tc-switch` + `is-on` and `tc-switch_knob` + `is-on`.
- Accordions: any `data-tc-action="toggle"` flips `data-tc-open` on its nearest `data-tc-element="accordion"`; the script hides that accordion's `data-tc-element="details"` while closed, rotates its `data-tc-element="chevron"` while open, and adds the combo class `is-open` to the accordion, every toggle in it, and the chevron. An accordion can have more than one toggle (the chevron button and the row title both carry the attribute), and all of them update together. Nest them as deep as you like. In the Designer everything is expanded; on the published site everything starts closed.
- The `data-tc="float"` button is hidden while the banner or the panel is open and until the visitor has made a choice. A footer link with `data-tc-element="open-preferences"` still works if you prefer that, or want both.
- Use `button` elements (Button or Link Block with `type="button"`) inside the Form Block. The script also cancels form submission inside the component.
- Put the component in a symbol that already sits on every page (navbar or footer component). Webflow has no API that injects a component site-wide.
- Leave the banner visible in the Designer. On the published site the script hides it until it is needed, so there is no flash and you can still see it while designing. Hide the preferences panel and the float button while you work and set them back before publishing.

The `[data-tc="root"]` block at the end of `index.html` is the same tree in plain HTML. Use it as the reference when building the Webflow version.

### Visible names

Category labels are plain text. Rename "Analytics" to "Analytik" or "Statistics" in the Designer; the attribute value stays `analytics`.

### Vendor list

The vendor cards inside each row are generated. When the page loads, and again every time the panel opens, the script scans every `script` and `iframe` on the page (the URL in `src`, or in `data-tc-src` for tags the blocker neutralised) and the text of inline snippets and `noscript` tags, and matches them against a built-in registry: Google Analytics, Tag Manager, Meta Pixel, Google Ads, LinkedIn, TikTok, Microsoft Ads, HubSpot, Hotjar, Clarity, YouTube, Vimeo, Google Maps, Intercom, Crisp, Drift, and every other host on the default block list (`src/vendors.js`). Each match becomes a card with the vendor name, privacy policy link, and the cookies it sets (name, purpose, duration). Tiny Consent itself is always listed under Essential with the configured cookie lifetime.

How the markup drives it:

- The first block with `data-tc-vendor` in a row's details is the template. Give it `data-tc-vendor="sample"` (that is what the paste ships). The script clones it per vendor, fills the `data-tc-field` slots (`vendor-name`, `vendor-privacy`, `cookie`, `cookie-name`, `cookie-purpose`, `cookie-duration`), and removes the sample. A row without its own template borrows the first one it finds.
- A block with any other value, e.g. `data-tc-vendor="in-house-pixel"`, is hand-written: it stays as it is, and a registry vendor with the same id is not generated twice.
- An element with `data-tc-field="empty"` inside the details is shown when nothing was detected for that category and gets the `hidden` attribute otherwise.

Per-site additions and overrides go in Head code before or after the script:

```html
<script>
  window.TinyConsentVendors = [
    // Add a vendor the registry does not know. hosts match script/iframe URLs and inline snippets.
    // cookies are shown in the panel; purge lists every other cookie name (with * wildcards)
    // to delete once the category is denied.
    { id: 'acme-chat', name: 'Acme Chat', category: 'personalization',
      privacy: 'https://acme.example/privacy', hosts: ['cdn.acme-chat.example'],
      cookies: [{ name: 'acme_sid', purpose: 'Keeps the chat session.', duration: '1 day' }],
      purge: ['acme_*'] },
    // Override only some fields of a built-in vendor (matched by id).
    { id: 'google-analytics', name: 'Google Analytics 4' },
  ];
</script>
```

`data-tc-vendors="meta-pixel, hubspot"` on the script tag lists registry vendors even when nothing on the page matches (tags fired server-side). `TinyConsent.vendors()` re-scans and returns the current list.

## 5. Brand it per project

`styles.css` styles the component with seven custom properties:

```css
--tc-font       font family
--tc-bg         panel background
--tc-text       primary text
--tc-muted      secondary text
--tc-accent     primary button and switch color
--tc-on-accent  text on the accent color
--tc-radius     corner radius (panels cap at 28px so pill buttons stay sane)
```

In Webflow, create a variable collection with the same seven values and bind the component's colors, font, and radius to it. Two ways to use the component across sites:

1. **Shared Library, stay linked.** Share the source site as a Library, install it on a client site, and override the variables with the client's collection (or variable modes for multi-brand). Layout and copy follow the library; updates cascade.
2. **Install, unlink, restyle.** Install the Library, then uninstall it so the component becomes a local component. Now the whole Style panel is open: fonts, spacing, interactions, button order. This is the normal agency starter-kit workflow and the right choice when a client needs a different layout.

## Behavior

- First visit: banner shows. Nothing optional runs (opt-in) or everything runs (opt-out).
- Accept all / reject all / save: the choice is stored in `tc_consent` (`SameSite=Lax`, `Secure` on https) for `data-tc-cookie-days` days. Allowed tags run immediately. The panel closes and focus returns to the trigger.
- Returning visit: no banner. Allowed tags run as the page parses, blocked tags stay blocked.
- Downgrade (a category goes from allowed to denied): the cookies that category's vendors are known to set (`_ga`, `_ga_*`, `_fbp`, `_gcl_au`, `__hstc`, … from the registry, plus `window.TinyConsentVendors`) are deleted on every domain variant of the current host, then the page reloads so running trackers stop. The same purge runs on every load for whatever is denied, so a tag that slipped through cannot leave a cookie behind. Limits: scripts cannot touch HttpOnly cookies, third-party cookies set by iframes or pixel responses, or cookies on another registrable domain; `localStorage` is not cleared.
- Global Privacy Control (`navigator.globalPrivacyControl`): marketing is denied by default in opt-out mode.
- Escape closes the preferences panel. Closing without a stored choice returns to the banner.

### Rules by region

With `data-tc-geo="auto"` the banner follows the visitor's law instead of one global mode. Every page view starts strict (nothing optional runs, banner hidden), the region is resolved, then the policy for that region applies. A stored choice always wins; an unknown region gets the opt-in banner.

| Policy | Default regions | Before a choice |
| --- | --- | --- |
| `opt-in` | `eu` (EU + EEA), `gb`, `ch`, `br`, `ca-qc` | Nothing optional runs, the banner asks. |
| `opt-out` | `us-ca`, `us-va`, `us-co`, `us-ct`, `us-ut`, `us-tx`, `us-or`, `us-mt`, `us-ia`, `us-de`, `us-nh`, `us-nj`, `us-tn`, `us-mn`, `us-md`, `us-in`, `us-ky`, `us-ne`, `us-ri` | Everything runs (marketing off under GPC), the banner is a notice with *Do not sell or share*. |
| `none` | `*` | No banner, consent is recorded as granted, the Preferences button stays. |

`data-tc-regions` replaces the table; the most specific key wins (`us-ca` over `us` over `eu` over `*`). `data-tc-regions="eu:opt-in, gb:opt-in, us-ca:opt-out, *:opt-in"` asks everyone outside the listed regions too.

Detection: `auto` fetches `https://get.geojs.io/v1/ip/geo.json` once per session (no cookies, result in `sessionStorage`), or your `data-tc-geo-url`; on failure it falls back to the browser timezone. `timezone` never makes a request and is coarse: a European zone is treated as `eu`, a US zone takes the strictest `us-*` policy in the table, so an uncertain guess never relaxes the rules. Name the lookup service in your privacy policy.

Component copy per policy: give any element inside the component `data-tc-variant="opt-in"`, `"opt-out"`, `"none"`, or several space separated, and it shows only under those policies. The shipped banner has GDPR text with *Reject all* / *Accept all* and CCPA text with *Do not sell or share* / *OK*. `<html>` carries `data-tc-policy` and `data-tc-region` for your own CSS.

```js
TinyConsent.getRegion()        // { country, region?, source, policy } or null
TinyConsent.getPolicy()        // 'opt-in' | 'opt-out' | 'none'
TinyConsent.setRegion('us-ca') // force a region; re-applies the policy if no choice is stored
document.addEventListener('tc:region', e => e.detail) // { region, policy }
```

### Public API and events

```js
TinyConsent.getConsent()           // { chosen, essential, analytics, marketing, personalization, t, v }
TinyConsent.isAllowed('analytics') // boolean
TinyConsent.setConsent({ analytics: true, marketing: false })
TinyConsent.acceptAll()
TinyConsent.rejectAll()
TinyConsent.open()                 // preferences panel
TinyConsent.close()
TinyConsent.reset()                // forget the choice, show the banner
TinyConsent.vendors()              // re-scan the page; [{ id, name, category, privacy, cookies }]
TinyConsent.purge()                // delete cookies of denied categories now; returns the names removed

document.addEventListener('tc:consent',  e => e.detail)          // on load and after every change
document.addEventListener('tc:purge',    e => e.detail)          // { cookies: [names removed], categories }
document.addEventListener('tc:block',    e => e.detail.element)  // a tag was auto-blocked by hostname
document.addEventListener('tc:activate', e => e.detail.element)  // a marked tag ran or was revealed
```

Use `tc:consent` to update Google Consent Mode or push to a GTM `dataLayer` if you run tags through a container.

## Cookie format

`tc_consent` holds URL-encoded JSON: `{"v":1,"t":"2026-10-07T10:34:58.928Z","a":1,"m":1,"p":1}`. `t` is the time of the decision; `a`, `m`, `p` are analytics, marketing, personalization. Essential is implicit. A different `v` is treated as no consent, so bumping `VERSION` in `src/consent.js` re-asks everyone.

## Scope

This kit covers the part of a consent tool that runs on the site. The vendor list reflects the tags present in the page the visitor is looking at, matched against a fixed registry; a crawl of the whole site, consent-log storage and analytics, AI tracker descriptions, and policy-page generation are separate products and are out of scope here. The kit does not provide legal advice; which categories you need and what your policy says is still your call.
