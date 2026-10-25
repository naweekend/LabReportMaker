/* "Algorithms, Pseudocodes & Dry Runs" PDF for Lab Report Maker.
 *
 * Takes photos / scans of handwritten work and turns them into one PDF:
 * a title page (same look as the code report), then one image per page.
 *
 *   NotesPdf.order(entries, mode)      work out the page order from the file names
 *   NotesPdf.prepareImage(file, q)     decode, shrink and re-encode an image as JPEG
 *   NotesPdf.buildPdf(...)             make the jsPDF document
 *   NotesPdf.fileName(meta, heading)   "<roll>_<title>_<heading>.pdf"
 */
(function (root) {
  'use strict';

  /* ============================================================ ordering */

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  const stripExt = n => n.replace(/\.[A-Za-z0-9]{1,5}$/, '');

  function validDate(y, mo, d) {
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }

  // time of day found right after a date, in ms (0 when there is none)
  function timeAfter(rest) {
    let m = /^\D{0,8}?(\d{1,2})[-_.:h](\d{2})(?:[-_.:](\d{2}))?(?:[-_.:]?(\d{1,3}))?\s*([ap]\.?m\.?)?/i.exec(rest);
    if (m) {
      let h = +m[1];
      const mi = +m[2], s = m[3] ? +m[3] : 0;
      const ap = m[5] ? m[5][0].toLowerCase() : '';
      if (ap === 'p' && h < 12) h += 12;
      if (ap === 'a' && h === 12) h = 0;
      if (h < 24 && mi < 60 && s < 60) return ((h * 60 + mi) * 60 + s) * 1000 + (m[4] ? +(m[4] + '00').slice(0, 3) : 0);
    }
    m = /^\D{0,3}([01]\d|2[0-3])([0-5]\d)([0-5]\d)(\d{0,3})/.exec(rest);      // 153045 or 153045123
    if (m) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + (m[4] ? +(m[4] + '00').slice(0, 3) : 0);
    return 0;
  }

  /** A date (and time) written in a file name, as UTC milliseconds, or null.
   *  IMG_20260312_153045.jpg, PXL_20260312_153045123.jpg, Screenshot_2026-03-12-15-30-45.png,
   *  WhatsApp Image 2026-03-12 at 3.30.45 PM.jpeg, 12-03-2026 15.30.jpg, 1710257445123.jpg, ... */
  function dateFromName(name) {
    const s = stripExt(name);
    let m, re;

    // year first: 2026-03-12, 2026_03_12, 2026.03.12, 20260312
    re = /(?<!\d)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/g;
    while ((m = re.exec(s))) {
      if (validDate(+m[1], +m[2], +m[3])) {
        return Date.UTC(+m[1], +m[2] - 1, +m[3]) + timeAfter(s.slice(m.index + m[0].length));
      }
    }
    // day first: 12-03-2026, 12.03.2026
    re = /(?<!\d)(0[1-9]|[12]\d|3[01])[-_.](0[1-9]|1[0-2])[-_.]((?:19|20)\d{2})(?!\d)/g;
    while ((m = re.exec(s))) {
      if (validDate(+m[3], +m[2], +m[1])) {
        return Date.UTC(+m[3], +m[2] - 1, +m[1]) + timeAfter(s.slice(m.index + m[0].length));
      }
    }
    // 12 Mar 2026 / Mar 12, 2026
    re = /(?<!\d)(\d{1,2})[-_.\s]+([A-Za-z]{3})[a-z]*[-_.,\s]+((?:19|20)\d{2})(?!\d)/g;
    while ((m = re.exec(s))) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo && validDate(+m[3], mo, +m[1])) return Date.UTC(+m[3], mo - 1, +m[1]) + timeAfter(s.slice(m.index + m[0].length));
    }
    re = /([A-Za-z]{3})[a-z]*[-_.\s]+(\d{1,2})[-_.,\s]+((?:19|20)\d{2})(?!\d)/g;
    while ((m = re.exec(s))) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo && validDate(+m[3], mo, +m[2])) return Date.UTC(+m[3], mo - 1, +m[2]) + timeAfter(s.slice(m.index + m[0].length));
    }
    // unix time (Telegram, Snapchat, some cameras): 1710257445 or 1710257445123
    m = /(?<!\d)(1[5-9]\d{8})(\d{3})?(?!\d)/.exec(s);
    if (m) return +m[1] * 1000 + (m[2] ? +m[2] : 0);
    return null;
  }

  /** A sequence number written in a file name, or null.
   *  1.jpg, page3.png, IMG_0042.jpg, scan (12).jpg, "Task 5 dry run 2" -> the most telling number. */
  function numberFromName(name) {
    const s = stripExt(name);
    let m = /\((\d{1,6})\)\s*$/.exec(s);                                   // "photo (12)"
    if (m) return +m[1];
    m = /(?<![A-Za-z])(?:page|pg|p|img|image|photo|pic|picture|scan|slide|sheet|step|part|no|num|number|#)[\s_\-.]*0*(\d{1,6})(?!\d)/i.exec(s);
    if (m) return +m[1];
    const all = [...s.matchAll(/(?<!\d)(\d{1,6})(?!\d)/g)];
    return all.length ? +all[all.length - 1][1] : null;
  }

  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  /**
   * entries: [{ name, modified }]  (modified = lastModified in ms, optional)
   * mode:    'auto' | 'date' | 'number' | 'name' | 'modified'
   * returns  { indices, method, labels }  indices = entry numbers in page order,
   *          method = the rule that was used, labels = a short note per entry
   */
  function order(entries, mode) {
    const info = entries.map((e, i) => ({
      i, name: e.name, modified: e.modified || 0,
      date: dateFromName(e.name), num: numberFromName(e.name),
      dup: (/\((\d{1,3})\)\s*\.?[A-Za-z0-9]{0,5}$/.exec(e.name) || [0, 0])[1] | 0,   // "photo (2)" copies come after the original
    }));
    const all = f => info.every(f);

    let method = mode;
    if (mode === 'auto') {
      if (info.length < 2) method = 'name';
      else if (all(x => x.date !== null)) method = 'date';
      else if (all(x => x.num !== null)) method = 'number';
      else if (new Set(info.map(x => x.modified)).size > 1 && all(x => x.modified > 0)) method = 'modified';
      else method = 'name';
    }

    const lastNull = (a, b) => (a === null) - (b === null);
    const cmp = {
      date: (x, y) => lastNull(x.date, y.date) || (x.date - y.date) || (x.dup - y.dup) || lastNull(x.num, y.num) || (x.num - y.num) || natural(x.name, y.name),
      number: (x, y) => lastNull(x.num, y.num) || (x.num - y.num) || natural(x.name, y.name),
      modified: (x, y) => (x.modified - y.modified) || natural(x.name, y.name),
      name: (x, y) => natural(x.name, y.name),
    }[method] || ((x, y) => x.i - y.i);

    const sorted = info.slice().sort(cmp);
    const fmt = t => {
      const d = new Date(t), p = n => String(n).padStart(2, '0');
      const day = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
      return t % 86400000 ? day + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) : day;
    };
    const labels = info.map(x =>
      method === 'date' ? (x.date !== null ? fmt(x.date) : 'no date found') :
      method === 'number' ? (x.num !== null ? 'number ' + x.num : 'no number found') :
      method === 'modified' ? (x.modified ? 'modified ' + new Date(x.modified).toLocaleString() : '') : '');
    return { indices: sorted.map(x => x.i), method, labels };
  }

  const METHOD_TEXT = {
    date: 'the date and time in the file names',
    number: 'the numbers in the file names',
    modified: 'when the files were last modified (the names have no usable order)',
    name: 'the file names, alphabetically',
  };

  /* ============================================================== images */

  const QUALITY = {
    high:     { max: 3000, q: 0.92 },
    balanced: { max: 2200, q: 0.85 },
    small:    { max: 1500, q: 0.75 },
  };

  /** Decode an image file and return { data: 'data:image/jpeg;base64,...', w, h }. */
  async function prepareImage(file, quality) {
    const preset = QUALITY[quality] || QUALITY.balanced;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('Could not read "' + file.name + '" as an image. If it is a HEIC photo, convert it to JPG or PNG first.'));
        im.src = url;
      });
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('"' + file.name + '" is empty or not an image.');
      const k = Math.min(1, preset.max / Math.max(w, h));
      w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';                  // PNGs with transparency would turn black in a JPEG
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return { data: c.toDataURL('image/jpeg', preset.q), w, h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ================================================================= PDF */

  const FAMILY = { Helvetica: 'helvetica', Times: 'times', Courier: 'courier' };

  /**
   * meta    {title, name, id, section, extra}
   * heading the line under the title (e.g. "Algorithms, Pseudocodes & Dry Runs")
   * pages   [{data, w, h}]  in page order
   * o       formatting options (LabPdf.parseOptions): page size, title style, colors ...
   * opt     { margin: pt around each image, valign: 'top' | 'middle' }
   */
  function buildPdf(meta, heading, pages, o, opt) {
    const jsPDF = (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
    if (!jsPDF) throw new Error('jsPDF failed to load.');
    opt = opt || {};
    const size = o.pageSize === 'Letter' ? [612, 792] : [595.2756, 841.8898];
    const PW = size[0], PH = size[1];
    const doc = new jsPDF({ unit: 'pt', format: size, orientation: 'portrait', compress: true });
    doc.setProperties({ title: [meta.title, heading].filter(Boolean).join(' - '), author: meta.name });
    if (root.LabFonts) root.LabFonts.register(doc, [o.headFont]);

    const hasBg = String(o.pageBg).toLowerCase() !== '#ffffff';
    const paintBg = () => { if (hasBg) { doc.setFillColor(o.pageBg); doc.rect(0, 0, PW, PH, 'F'); } };
    paintBg();

    let firstPageUsed = false;
    const nextPage = () => { if (firstPageUsed) { doc.addPage(size, 'portrait'); paintBg(); } firstPageUsed = true; };

    /* ---- title page: same geometry as the code report ---- */
    if (o.showTitlePage) {
      nextPage();
      const margin = +o.margin, PAD = 6;
      const fx = margin + PAD, fW = PW - 2 * margin - 2 * PAD;
      const hf = (root.LabPdf && root.LabPdf.fontFamily) ? root.LabPdf.fontFamily(o.headFont) : (FAMILY[o.headFont] || 'helvetica');
      const center = o.titleAlign === 'center';
      let y = margin + PAD + (+o.titleTop);
      const line = (text, bold, sz, lead, color) => {
        doc.setFont(hf, bold ? 'bold' : 'normal');
        doc.setFontSize(sz);
        doc.setTextColor(color);
        const lines = doc.splitTextToSize(String(text), fW);
        lines.forEach((l, i) => {
          const base = y + sz + i * lead;
          if (center) doc.text(l, PW / 2, base, { align: 'center' }); else doc.text(l, fx, base);
        });
        y += lines.length * lead;
      };
      line(meta.title, true, +o.titleSize, o.titleSize * 1.3, o.titleColor);
      [heading, meta.name, meta.id, meta.section, meta.extra].forEach(t => {
        if (t) line(t, false, +o.infoSize, o.infoSize * 1.5, o.infoColor);
      });
    }

    /* ---- one image per page ---- */
    const m = Math.max(0, +opt.margin || 0);
    const areaW = PW - 2 * m, areaH = PH - 2 * m;
    pages.forEach(p => {
      nextPage();
      const k = Math.min(areaW / p.w, areaH / p.h);
      const dw = p.w * k, dh = p.h * k;
      const x = m + (areaW - dw) / 2;
      const y = opt.valign === 'middle' ? m + (areaH - dh) / 2 : m;
      doc.addImage(p.data, 'JPEG', x, y, dw, dh);
    });
    return doc;
  }

  function fileName(meta, heading) {
    const t = (meta.title || '').replace(/ /g, '').replace(/[^A-Za-z0-9_\-]+/g, '') || 'Lab';
    const h = (heading || '').replace(/ /g, '').replace(/[^A-Za-z0-9_\-]+/g, '') || 'Notes';
    return (meta.id || 'report') + '_' + t + '_' + h + '.pdf';
  }

  const api = { order, dateFromName, numberFromName, METHOD_TEXT, QUALITY, prepareImage, buildPdf, fileName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotesPdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
