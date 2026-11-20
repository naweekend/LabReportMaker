/* Extra fonts for the PDFs. Built-in PDF fonts (Helvetica, Times, Courier) need no file.
 * The fonts below are embedded into the PDF. Each lives in fonts/<key>.js (base64, so it works from file://)
 * and is only loaded when it is picked. Sources: Liberation, Carlito, Caladea, DejaVu, Work Sans, Lora,
 * IBM Plex, JetBrains Mono, Red Hat Mono (all free / open licences). */
(function (root) {
  const LIST = [{"key": "LiberationSans", "label": "Arial-style (Liberation Sans)", "mono": false, "kind": "sans"}, {"key": "Carlito", "label": "Calibri-style (Carlito)", "mono": false, "kind": "sans"}, {"key": "DejaVuSans", "label": "Verdana-style (DejaVu Sans)", "mono": false, "kind": "sans"}, {"key": "WorkSans", "label": "Work Sans", "mono": false, "kind": "sans"}, {"key": "Caladea", "label": "Cambria-style (Caladea)", "mono": false, "kind": "serif"}, {"key": "DejaVuSerif", "label": "Georgia-style (DejaVu Serif)", "mono": false, "kind": "serif"}, {"key": "Lora", "label": "Lora", "mono": false, "kind": "serif"}, {"key": "IBMPlexSerif", "label": "IBM Plex Serif", "mono": false, "kind": "serif"}, {"key": "LiberationMono", "label": "Courier New-style (Liberation Mono)", "mono": true, "kind": "mono"}, {"key": "DejaVuSansMono", "label": "Consolas-style (DejaVu Sans Mono)", "mono": true, "kind": "mono"}, {"key": "JetBrainsMono", "label": "JetBrains Mono", "mono": true, "kind": "mono"}, {"key": "IBMPlexMono", "label": "IBM Plex Mono", "mono": true, "kind": "mono"}, {"key": "RedHatMono", "label": "Red Hat Mono", "mono": true, "kind": "mono"}];
  const store = {};      // key -> { regular, bold } base64
  const loading = {};    // key -> Promise
  const faces = {};      // key -> true once registered for the page preview

  function data(key, regular, bold) {
    store[key] = { regular, bold };
    if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && !faces[key]) {
      faces[key] = true;
      const bin = b => Uint8Array.from(atob(b), c => c.charCodeAt(0)).buffer;
      try {
        const r = new FontFace('LRM ' + key, bin(regular), { weight: '400' });
        const b = new FontFace('LRM ' + key, bin(bold), { weight: '700' });
        Promise.all([r.load(), b.load()]).then(() => { document.fonts.add(r); document.fonts.add(b); if (root.onLabFontLoaded) root.onLabFontLoaded(key); }).catch(() => {});
      } catch (_) {}
    }
  }

  function load(key) {
    if (store[key]) return Promise.resolve(true);
    if (!LIST.some(f => f.key === key)) return Promise.resolve(false);
    if (!loading[key]) {
      loading[key] = new Promise(res => {
        const s = document.createElement('script');
        s.src = 'fonts/' + key + '.js';
        s.onload = () => res(!!store[key]);
        s.onerror = () => res(false);
        document.head.appendChild(s);
      });
    }
    return loading[key];
  }

  /** Load the fonts (async). Call and await this before building a PDF. Returns the keys that failed. */
  async function ensure(keys) {
    const bad = [];
    for (const key of new Set(keys)) if (LIST.some(f => f.key === key) && !(await load(key))) bad.push(key);
    return bad;
  }

  /** Register already-loaded fonts with a jsPDF document (sync). */
  function register(doc, keys) {
    for (const key of new Set(keys)) {
      const d = store[key];
      if (!d) continue;
      doc.addFileToVFS(key + '-Regular.ttf', d.regular);
      doc.addFileToVFS(key + '-Bold.ttf', d.bold);
      doc.addFont(key + '-Regular.ttf', key, 'normal');
      doc.addFont(key + '-Bold.ttf', key, 'bold');
    }
  }

  root.LabFonts = { LIST, data, load, ensure, register, has: k => LIST.some(f => f.key === k) };
})(typeof window !== 'undefined' ? window : globalThis);
