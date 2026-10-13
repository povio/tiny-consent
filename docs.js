// Docs page: copy buttons, head-code configurator, and the Webflow paste buttons.
(function () {
  const paste = window.TinyConsentPaste;

  // ---------- Generic copy buttons ----------

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  }

  function flash(button, label) {
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = label;
    button.classList.add('is-done');
    clearTimeout(button._t);
    button._t = setTimeout(() => {
      button.textContent = original;
      button.classList.remove('is-done');
    }, 1600);
  }

  document.querySelectorAll('.doc-copy[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.querySelector(button.dataset.copy);
      if (!target) return;
      await copyText(target.textContent);
      flash(button, 'Copied');
    });
  });

  // ---------- Head code configurator ----------

  const SCRIPT_URL = 'https://cdn.jsdelivr.net/gh/mio31337/tiny-consent@v1.0.0/dist/tiny-consent.min.js';
  const config = document.getElementById('config');
  const headSnippet = document.getElementById('head-snippet');
  let scannedVendorIds = [];

  function renderHead() {
    const data = new FormData(config);
    const url = SCRIPT_URL;
    const rule = String(data.get('mode') || 'opt-in');
    const days = Number(data.get('days')) || 180;
    const block = String(data.get('block') || '').trim();
    // Only emit attributes that differ from the script's defaults (opt-in, 180 days).
    const lines = [`<script src="${url}"`];
    if (rule === 'opt-out') lines.push(`        data-tc-mode="opt-out"`);
    if (rule === 'geo') lines.push(`        data-tc-geo="auto"`);
    if (rule === 'geo-timezone') lines.push(`        data-tc-geo="timezone"`);
    if (days !== 180) lines.push(`        data-tc-cookie-days="${days}"`);
    if (block) lines.push(`        data-tc-block="${block.replace(/"/g, '')}"`);
    if (scannedVendorIds.length) lines.push(`        data-tc-vendors="${scannedVendorIds.join(', ')}"`);
    headSnippet.textContent = lines.join('\n') + '></script>';
  }

  config.addEventListener('input', renderHead);
  config.addEventListener('submit', (e) => e.preventDefault());
  renderHead();

  // ---------- Site scan ----------

  const scanForm = document.getElementById('scan-form');
  const scanStatus = document.getElementById('scan-status');
  const scanList = document.getElementById('scan-list');

  function scanMessage(text, kind) {
    scanStatus.hidden = false;
    scanStatus.textContent = text;
    scanStatus.className = 'doc-paste_status' + (kind ? ' is-' + kind : '');
  }

  function renderScan(result) {
    scannedVendorIds = result.vendors.map((vendor) => vendor.id);
    renderHead();
    scanList.hidden = result.vendors.length === 0;
    scanList.replaceChildren(...result.vendors.map((vendor) => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = vendor.name;
      const meta = document.createElement('div');
      meta.className = 'doc-scan_meta';
      const cookies = vendor.cookies.length
        ? vendor.cookies.map((cookie) => `${cookie.name} (${cookie.duration})`).join(', ')
        : 'No cookies listed';
      const where = vendor.pages === 1 ? '1 page' : `${vendor.pages} pages`;
      meta.textContent = `${vendor.category} · ${where} · ${cookies}`;
      item.append(title, meta);
      return item;
    }));
    const pageNote = result.capped
      ? `Stopped after ${result.pagesScanned} pages.`
      : `Read ${result.pagesScanned} of ${result.pagesListed} pages.`;
    if (result.vendors.length) {
      scanMessage(`${pageNote} Added ${result.vendors.length} ${result.vendors.length === 1 ? 'service' : 'services'} to the head snippet in step 1.`, 'ok');
    } else {
      scanMessage(`${pageNote} No known trackers were in the HTML.`, 'ok');
    }
  }

  if (scanForm) {
    scanForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = scanForm.querySelector('input[name="url"]');
      const button = scanForm.querySelector('button');
      const site = input.value.trim();
      if (!site) return;
      button.disabled = true;
      scanList.hidden = true;
      scanMessage('Reading the sitemap and the pages…');
      const days = Number(new FormData(config).get('days')) || 180;
      try {
        const response = await fetch(`/api/scan?url=${encodeURIComponent(site)}&days=${days}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'The scan failed.');
        if (body.url) input.value = body.url;
        renderScan(body);
      } catch (error) {
        scannedVendorIds = [];
        renderHead();
        scanMessage(error.message || 'The scan failed. Run the docs with npm run dev so this page can reach other sites.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  }

  // ---------- Webflow paste ----------

  const copyWebflow = document.getElementById('copy-webflow');
  const copyEmbed = document.getElementById('copy-embed');
  const status = document.getElementById('paste-status');
  let sources = null;

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'doc-paste_status' + (kind ? ' is-' + kind : '');
  }

  // Geolocation needs every wording. A single rule pastes only that wording.
  function selectedPolicies() {
    const rule = String(new FormData(config).get('mode') || 'opt-in');
    if (rule === 'geo' || rule === 'geo-timezone') return null;
    return [rule === 'opt-out' ? 'opt-out' : 'opt-in'];
  }

  function pasteSources() {
    return Object.assign({}, sources, { policies: selectedPolicies() });
  }

  function describeReady() {
    const payload = paste.build(pasteSources());
    const policies = selectedPolicies();
    const which = policies ? policies[0] : 'every region';
    setStatus(`Ready: ${payload.payload.nodes.length} elements, ${payload.payload.styles.length} classes, ${which} copy.`);
  }

  paste
    .loadSources(window.TC_DOCS_BASE || './')
    .then((loaded) => {
      sources = loaded;
      copyWebflow.disabled = false;
      copyEmbed.disabled = false;
      describeReady();
    })
    .catch((error) => {
      setStatus('Could not build the component payload: ' + error.message, 'error');
    });

  config.querySelector('[name="mode"]').addEventListener('change', () => {
    if (sources) describeReady();
  });

  copyWebflow.addEventListener('click', () => {
    if (!sources) return;
    try {
      const payload = paste.build(pasteSources());
      const bytes = paste.writeWebflowClipboard(payload);
      setStatus(`Copied for Webflow (${Math.round(bytes / 1024)} KB). Select the footer in the Designer and paste.`, 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  copyEmbed.addEventListener('click', async () => {
    if (!sources) return;
    await copyText(paste.buildEmbed(pasteSources()));
    setStatus('Copied as HTML. Paste it into a Code Embed element.', 'ok');
  });

  // ---------- Hero mock + live preview ----------

  const liveRoot = document.querySelector('[data-tc="root"]');
  const previewBar = document.getElementById('preview-bar');

  // The real script runs on this page but its component stays hidden until launched.
  // Launching clears any stored choice so the banner always appears fresh.
  const tc = window.TinyConsent;

  function startPreview(openPreferences) {
    if (!tc) return;
    document.documentElement.classList.add('doc-preview-on');
    previewBar.hidden = false;
    tc.reset();
    if (openPreferences) tc.open();
  }

  function exitPreview() {
    if (tc) tc.close();
    document.documentElement.classList.remove('doc-preview-on');
    previewBar.hidden = true;
  }

  // Region switcher: the docs load the script with a forced region (data-tc-region="eu"),
  // so the same policy table a geolocated site uses decides what each region sees.
  const previewLabel = previewBar ? previewBar.querySelector('span') : null;
  const POLICY_LABEL = {
    'opt-in': 'Live preview: GDPR banner, trackers wait',
    'opt-out': 'Live preview: CCPA notice, trackers run until opted out',
    none: 'Live preview: no banner required, only the Preferences button',
  };

  function describePolicy() {
    if (!tc || !previewLabel) return;
    previewLabel.textContent = POLICY_LABEL[tc.getPolicy()] || 'Live preview';
  }

  document.querySelectorAll('[data-preview-region]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!tc) return;
      document.querySelectorAll('[data-preview-region]').forEach((c) => c.classList.toggle('is-active', c === chip));
      tc.setRegion(chip.dataset.previewRegion);
      tc.reset();
      describePolicy();
    });
  });
  document.addEventListener('tc:region', describePolicy);
  describePolicy();

  document.querySelectorAll('[data-preview]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.preview;
      if (action === 'launch') startPreview(false);
      else if (action === 'launch-preferences') startPreview(true);
      else if (action === 'restart') tc && tc.reset();
      else if (action === 'exit') exitPreview();
    });
  });

  // Escape closes the panel first (the script handles that); a second Escape leaves the preview.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !document.documentElement.classList.contains('doc-preview-on')) return;
    const panel = liveRoot && liveRoot.querySelector('[data-tc="preferences"][data-tc-visible="true"]');
    if (!panel) exitPreview();
  });

  // ---------- Setup checklist ----------

  const STORE_KEY = 'tc-docs-done';
  const rail = document.getElementById('rail');
  const railCount = document.getElementById('rail-count');
  const railProgress = document.getElementById('rail-progress');
  const railReset = document.getElementById('rail-reset');
  const steps = Array.from(document.querySelectorAll('.doc-step[data-step]'));

  const stepIds = new Set(steps.map((step) => step.dataset.step));

  function readDone() {
    try {
      const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      // Drop ids of steps that no longer exist on the page.
      return new Set((Array.isArray(list) ? list : []).filter((id) => stepIds.has(id)));
    } catch {
      return new Set();
    }
  }

  function writeDone(done) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...done]));
    } catch {
      /* private mode or storage disabled: ticks still work for this page view */
    }
  }

  function renderDone(done) {
    rail.querySelectorAll('.doc-rail_item').forEach((item) => {
      const on = done.has(item.dataset.step);
      item.classList.toggle('is-done', on);
      item.querySelector('.doc-rail_check').checked = on;
    });
    steps.forEach((step) => step.classList.toggle('is-done', done.has(step.dataset.step)));
    const total = steps.length;
    railCount.textContent = done.size === total ? 'All done' : `${done.size} of ${total} done`;
    railProgress.style.width = `${(done.size / total) * 100}%`;
    railReset.hidden = done.size === 0;
  }

  if (rail) {
    let done = readDone();
    renderDone(done);

    rail.addEventListener('change', (event) => {
      const box = event.target.closest('.doc-rail_check');
      if (!box) return;
      const step = box.closest('.doc-rail_item').dataset.step;
      if (box.checked) done.add(step);
      else done.delete(step);
      writeDone(done);
      renderDone(done);
    });

    railReset.addEventListener('click', () => {
      done = new Set();
      writeDone(done);
      renderDone(done);
    });

    // Highlight the step closest to the top of the viewport.
    function setCurrent(id) {
      rail.querySelectorAll('.doc-rail_item').forEach((item) => {
        item.classList.toggle('is-current', item.dataset.step === id);
      });
    }

    // The current step is the last one whose top has passed a line a third of the way down the viewport.
    let ticking = false;
    function updateCurrent() {
      ticking = false;
      const line = window.innerHeight * 0.33;
      if (!steps.length) return;
      let current = null;
      for (const step of steps) {
        if (step.getBoundingClientRect().top <= line) current = step;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) current = steps[steps.length - 1];
      setCurrent(current ? current.dataset.step : null);
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      setTimeout(updateCurrent, 40);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    updateCurrent();
  }
})();
