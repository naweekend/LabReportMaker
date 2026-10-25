/* PDF builder for Lab Report Maker (browser port of pdfgen.py).
 * Uses jsPDF. The page-flow rules mimic ReportLab's platypus engine so that the
 * output looks the same as the Python version:
 *   - the frame has 6pt of padding inside the page margin
 *   - a task heading is kept together with its code box
 *   - the "Output" label is kept together with its box (optional)
 *   - long boxes split between rows and continue on the next page
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- options */
  const DEFAULTS = {
    // page
    pageSize: 'A4', margin: 54,
    // fonts
    headFont: 'Helvetica', codeFont: 'Courier',
    codeSize: 8.5, lineExtra: 2.0,
    headSize: 14, labelSize: 12,
    // spacing
    padV: 9, padH: 8, taskGap: 14, codeOutGap: 6,
    // title page
    showTitlePage: true, titleAlign: 'center',
    titleSize: 34, infoSize: 24, titleTop: 250,
    // extras
    syntax: 'none',
    lineNumbers: false, pageNumbers: 'none', newPagePerTask: false,
    keepOutput: true, radius: 0, borderW: 0,
    taskWord: 'Task', outputWord: 'Output',
    // colors
    titleColor: '#1a73e8', infoColor: '#3c4043', textColor: '#000000',
    pageBg: '#ffffff', codeBg: '#f2f2f2', codeFg: '#000000',
    outBg: '#212226', outFg: '#e6e6e6', borderColor: '#cccccc',
  };

  const LIMITS = {
    margin: [20, 100], codeSize: [5, 14], lineExtra: [0, 12],
    headSize: [9, 28], labelSize: [8, 24],
    padV: [0, 40], padH: [0, 40], taskGap: [0, 80], codeOutGap: [0, 40],
    titleSize: [14, 72], infoSize: [8, 48], titleTop: [0, 500],
    radius: [0, 14], borderW: [0, 3],
  };
  const CHOICES = {
    pageSize: ['A4', 'Letter'],
    titleAlign: ['center', 'left'],
    pageNumbers: ['none', 'center', 'right'],
  };
  const syntaxKeys = () => ['none'].concat(root.Highlight ? Object.keys(root.Highlight.THEMES) : []);
  const COLOR_KEYS = Object.keys(DEFAULTS).filter(k => typeof DEFAULTS[k] === 'string' && DEFAULTS[k][0] === '#');
  const BOOL_KEYS = Object.keys(DEFAULTS).filter(k => typeof DEFAULTS[k] === 'boolean');
  const TEXT_KEYS = ['taskWord', 'outputWord'];

  /** Validate / clamp options coming from the UI (object or JSON string). */
  function parseOptions(raw) {
    let data = raw;
    if (typeof raw === 'string') {
      try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    const o = Object.assign({}, DEFAULTS);
    for (const k in LIMITS) {
      if (k in data) {
        const n = parseFloat(data[k]);
        if (isFinite(n)) o[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n));
      }
    }
    for (const k in CHOICES) if (CHOICES[k].includes(data[k])) o[k] = data[k];
    if (syntaxKeys().includes(data.syntax)) o.syntax = data.syntax;
    for (const k of COLOR_KEYS) {
      if (typeof data[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(data[k])) o[k] = data[k];
    }
    for (const k of BOOL_KEYS) if (k in data) o[k] = !!data[k];
    for (const k of TEXT_KEYS) {
      if (typeof data[k] === 'string') o[k] = data[k].trim().slice(0, 30) || DEFAULTS[k];
    }
    for (const k of ['headFont', 'codeFont']) if (typeof data[k] === 'string') o[k] = data[k];
    return o;
  }

  /* ------------------------------------------------------------------ fonts */
  // The three PDF built-in font families are always available.
  const FONTS = {
    Helvetica: { label: 'Helvetica', family: 'helvetica', mono: false },
    Times:     { label: 'Times',     family: 'times',     mono: false },
    Courier:   { label: 'Courier',   family: 'courier',   mono: true  },
  };
  // Extra embedded fonts (see fonts/fonts.js). Their PDF family name is the same as the key.
  const EXTRA = (root.LabFonts && root.LabFonts.LIST) || [];
  for (const f of EXTRA) FONTS[f.key] = { label: f.label, family: f.key, mono: f.mono, kind: f.kind, embedded: true };
  const fontList = () => Object.keys(FONTS).map(k => ({
    key: k, label: FONTS[k].label, mono: FONTS[k].mono, kind: FONTS[k].kind || (FONTS[k].mono ? 'mono' : k === 'Times' ? 'serif' : 'sans'),
    embedded: !!FONTS[k].embedded,
  }));
  /** PDF family name for a font key (used by notesgen). */
  const fontFamily = k => (FONTS[k] || FONTS.Helvetica).family;
  /** Await this before buildPdf so the embedded fonts the options use are loaded. */
  const prepareFonts = o => (root.LabFonts ? root.LabFonts.ensure([o.headFont, o.codeFont]) : Promise.resolve([]));

  /* ------------------------------------------------------------- text boxes */
  // Built-in PDF fonts only cover Latin-1, like the original (latin-1 + replace).
  const EXTRA_CP = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2190, 0x2191, 0x2192, 0x2193, 0x21D2, 0x2260, 0x2264, 0x2265, 0x221E]);
  function normalize(text, embedded) {
    text = text.replace(/\t/g, '    ');
    let out = '';
    for (const ch of text) {
      const c = ch.codePointAt(0);
      const ok = !(c > 255 || (c >= 0x80 && c < 0xA0)) || (embedded && EXTRA_CP.has(c));
      out += ok ? ch : '?';
    }
    return out;
  }

  // Same wrapping as before, but every piece also carries one colour class per character.
  // cls: class number of each character of `line` (or null when not highlighting). Pieces are
  // { text, cls }; the line-number prefix gets class `preCls`, the wrap indent plain (0).
  function wrapLine(line, maxc, firstPre, restPre, cls, preCls) {
    const mk = (pre, preK, body, from) => {
      const text = pre + body;
      if (!cls) return { text, cls: null };
      const c = new Uint8Array(text.length);
      c.fill(preK, 0, pre.length);
      for (let i = 0; i < body.length; i++) c[pre.length + i] = i + from >= 0 && from >= 0 ? cls[from + i] : 0;
      return { text, cls: c };
    };
    const avail = Math.max(8, maxc - firstPre.length);
    if (line.length <= avail) return [mk(firstPre, preCls, line, 0)];
    const indent = line.length - line.replace(/^ +/, '').length;
    const pad = ' '.repeat(indent + 4);
    const out = [mk(firstPre, preCls, line.slice(0, avail), 0)];
    let at = avail;
    const step = Math.max(4, maxc - restPre.length - pad.length);
    while (at < line.length) {
      const piece = line.slice(at, at + step);
      const r = mk(restPre + pad, 0, piece, at);
      out.push(r);
      at += step;
    }
    return out;
  }

  const padLeft = (s, n) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

  function makeBox(doc, text, o, kind, width) {
    let f = FONTS[o.codeFont] || FONTS.Courier;
    if (!f.mono) f = FONTS.Courier;
    const size = +o.codeSize;
    const leading = size + +o.lineExtra;
    const padH = +o.padH, padV = +o.padV;
    const bg = kind === 'code' ? o.codeBg : o.outBg;
    const fg = kind === 'code' ? o.codeFg : o.outFg;

    const raw = normalize(text, f.embedded).split('\n');
    doc.setFont(f.family, 'normal');
    doc.setFontSize(size);
    const cw = doc.getStringUnitWidth('M') * size || 5;
    const maxc = Math.max(20, Math.floor((width - 2 * padH) / cw));
    const numbered = kind === 'code' && o.lineNumbers;
    const nw = String(raw.length).length;

    // syntax highlighting (code boxes only)
    const hl = kind === 'code' && o.syntax && o.syntax !== 'none' && root.Highlight ? root.Highlight.colors(o.syntax) : null;
    if (hl) hl[0] = fg;            // plain text follows the code colour setting
    let allCls = null, offs = null;
    if (hl) {
      allCls = root.Highlight.tokenize(raw.join('\n'));
      offs = []; let at = 0; raw.forEach(l => { offs.push(at); at += l.length + 1; });
    }

    let lines = [];
    raw.forEach((line0, i) => {
      const line = line0.replace(/\s+$/, '');
      const first = numbered ? padLeft(String(i + 1), nw) + '  ' : '';
      const rest = ' '.repeat(first.length);
      const cls = hl ? allCls.subarray(offs[i], offs[i] + line.length) : null;
      lines.push(...wrapLine(line, maxc, first, rest, cls, root.Highlight ? root.Highlight.CLASSES.indexOf('lineno') : 0));
    });
    if (!lines.length) lines = [{ text: '', cls: null }];

    const rows = [];
    if (padV > 0) rows.push({ h: padV, text: null });
    for (const l of lines) rows.push({ h: leading, text: l.text, cls: l.cls });
    if (padV > 0) rows.push({ h: padV, text: null });

    return { kind: 'table', rows, width, bg, fg, family: f.family, size, padH, palette: hl, before: 0, after: 0 };
  }

  /** Rectangle with an individual radius per corner: [topLeft, topRight, bottomRight, bottomLeft]. */
  function roundedPath(doc, x, y, w, h, radii, style) {
    const [tl, tr, br, bl] = radii;
    const k = 0.5523;
    const seg = [];
    seg.push([w - tl - tr, 0]);
    if (tr > 0) seg.push([k * tr, 0, tr, (1 - k) * tr, tr, tr]);
    seg.push([0, h - tr - br]);
    if (br > 0) seg.push([0, k * br, -(1 - k) * br, br, -br, br]);
    seg.push([-(w - br - bl), 0]);
    if (bl > 0) seg.push([-k * bl, 0, -bl, -(1 - k) * bl, -bl, -bl]);
    seg.push([0, -(h - bl - tl)]);
    if (tl > 0) seg.push([0, -k * tl, (1 - k) * tl, -tl, tl, -tl]);
    doc.lines(seg, x + tl, y, [1, 1], style, true);
  }

  /* ------------------------------------------------------------ the builder */
  /**
   * meta : {title, name, id, section, extra}
   * tasks: [{num, code, transcript}]
   * o    : options (already passed through parseOptions)
   * returns a jsPDF document
   */
  function buildPdf(meta, tasks, o) {
    const jsPDF = (root.jspdf && root.jspdf.jsPDF) || root.jsPDF;
    if (!jsPDF) throw new Error('jsPDF failed to load.');

    const size = o.pageSize === 'Letter' ? [612, 792] : [595.2756, 841.8898];
    const PW = size[0], PH = size[1];
    const margin = +o.margin;
    const doc = new jsPDF({ unit: 'pt', format: size, orientation: 'portrait', compress: true });
    doc.setProperties({ title: meta.title, author: meta.name });
    if (root.LabFonts) root.LabFonts.register(doc, [o.headFont, o.codeFont]);

    const hf = FONTS[o.headFont] || FONTS.Helvetica;
    const tableWidth = PW - 2 * margin;

    // ReportLab's default frame keeps 6pt of padding inside the margins.
    const PAD = 6;
    const fx = margin + PAD;
    const fW = PW - 2 * margin - 2 * PAD;
    const topY = margin + PAD;
    const botY = PH - margin - PAD;
    const FUZZ = 1e-6;

    /* ---- page handling ---- */
    const hasBg = o.pageBg.toLowerCase() !== '#ffffff';
    let pageCount = 1;
    let y = topY;
    let atTop = true;

    function paintBg() {
      if (!hasBg) return;
      doc.setFillColor(o.pageBg);
      doc.rect(0, 0, PW, PH, 'F');
    }
    function newPage() {
      doc.addPage(size, 'portrait');
      pageCount++;
      paintBg();
      y = topY;
      atTop = true;
    }
    paintBg();

    /* ---- flowable constructors ---- */
    const spacer = h => ({ kind: 'spacer', h });
    const pageBreak = () => ({ kind: 'break' });
    function para(text, style) {
      doc.setFont(style.family, style.bold ? 'bold' : 'normal');
      doc.setFontSize(style.size);
      const lines = doc.splitTextToSize(String(text), fW);
      return Object.assign({ kind: 'para', lines, before: 0, after: 0 }, style);
    }
    const paraHeight = p => p.lines.length * p.leading;
    const tableHeight = (t, from = 0, to = t.rows.length) => {
      let h = 0;
      for (let i = from; i < to; i++) h += t.rows[i].h;
      return h;
    };
    const group = items => ({ kind: 'group', items });

    /* ---- drawing ---- */
    function drawPara(p, top) {
      doc.setFont(p.family, p.bold ? 'bold' : 'normal');
      doc.setFontSize(p.size);
      doc.setTextColor(p.color);
      p.lines.forEach((line, i) => {
        const base = top + p.size + i * p.leading;
        if (p.align === 'center') doc.text(line, PW / 2, base, { align: 'center' });
        else doc.text(line, fx, base);
      });
    }

    function drawTableChunk(t, from, to, top, isFirst, isLast) {
      const h = tableHeight(t, from, to);
      const x = margin;
      const r = +o.radius;
      const bw = +o.borderW;
      doc.setFillColor(t.bg);
      if (bw > 0) {
        doc.setDrawColor(o.borderColor);
        doc.setLineWidth(bw);
      }
      const style = bw > 0 ? 'FD' : 'F';
      if (r > 0) {
        // only the outer corners of a box are rounded; a box split across pages
        // keeps square edges where it is cut
        const rr = Math.min(r, h / 2, t.width / 2);
        roundedPath(doc, x, top, t.width, h, [isFirst ? rr : 0, isFirst ? rr : 0, isLast ? rr : 0, isLast ? rr : 0], style);
      } else {
        doc.rect(x, top, t.width, h, style);
      }

      doc.setFont(t.family, 'normal');
      doc.setFontSize(t.size);
      doc.setTextColor(t.fg);
      let ry = top;
      for (let i = from; i < to; i++) {
        const row = t.rows[i];
        if (row.text !== null && row.text !== '') {
          if (t.palette && row.cls) {
            // draw runs of one colour; the font is monospaced so each run starts after the previous one
            let cx = x + t.padH, a = 0;
            while (a < row.text.length) {
              let b = a + 1;
              while (b < row.text.length && row.cls[b] === row.cls[a]) b++;
              const piece = row.text.slice(a, b);
              if (piece.trim() !== '') { doc.setTextColor(t.palette[row.cls[a]] || t.fg); doc.text(piece, cx, ry + t.size); }
              cx += doc.getTextWidth(piece);
              a = b;
            }
          } else doc.text(row.text, x + t.padH, ry + t.size);
        }
        ry += row.h;
      }
    }

    /* ---- the frame: places flowables, splitting tables across pages ---- */
    function place(f) {
      switch (f.kind) {
        case 'break':
          newPage();
          return;

        case 'spacer':
          if (!atTop && y + f.h > botY + FUZZ) { newPage(); return; }
          y += f.h;
          atTop = false;
          return;

        case 'para': {
          let before = atTop ? 0 : f.before;
          const h = paraHeight(f);
          if (!atTop && y + before + h > botY + FUZZ) { newPage(); before = 0; }
          drawPara(f, y + before);
          y += before + h + f.after;
          atTop = false;
          return;
        }

        case 'table': {
          let from = 0;
          const n = f.rows.length;
          while (from < n) {
            const before = atTop ? 0 : f.before;
            const avail = botY - (y + before);
            const total = tableHeight(f, from, n);
            if (total <= avail + FUZZ) {
              drawTableChunk(f, from, n, y + before, from === 0, true);
              y += before + total + f.after;
              atTop = false;
              return;
            }
            // how many rows fit?
            let k = from, used = 0;
            while (k < n && used + f.rows[k].h <= avail + FUZZ) { used += f.rows[k].h; k++; }
            if (k === from) {
              if (atTop) k = from + 1;             // a single row taller than the page: force it
              else { newPage(); continue; }
            }
            drawTableChunk(f, from, k, y + before, from === 0, false);
            from = k;
            newPage();
          }
          return;
        }

        case 'group': {
          // KeepTogether: if the whole group doesn't fit in what is left of the page,
          // start a new page first (unless we are already at the top).
          const items = f.items;
          let H = 0;
          items.forEach((it, i) => {
            if (i > 0 || !atTop) H += (it.before || 0);
            H += it.kind === 'para' ? paraHeight(it) : it.kind === 'table' ? tableHeight(it) : (it.h || 0);
            if (i < items.length - 1) H += (it.after || 0);
          });
          if (!atTop && H > botY - y + FUZZ) newPage();
          items.forEach(place);
          return;
        }
      }
    }

    /* ---- styles ---- */
    const alignTitle = o.titleAlign === 'center' ? 'center' : 'left';
    const titleStyle = { family: hf.family, bold: true,  size: +o.titleSize, leading: o.titleSize * 1.3, align: alignTitle, color: o.titleColor };
    const infoStyle  = { family: hf.family, bold: false, size: +o.infoSize,  leading: o.infoSize * 1.5,  align: alignTitle, color: o.infoColor };
    const headStyle  = { family: hf.family, bold: true,  size: +o.headSize,  leading: o.headSize * 1.3,  align: 'left', color: o.textColor, before: +o.taskGap, after: 6 };
    const labelStyle = { family: hf.family, bold: true,  size: +o.labelSize, leading: o.labelSize * 1.35, align: 'left', color: o.textColor, before: 10, after: 4 };

    /* ---- story ---- */
    const story = [];
    if (o.showTitlePage) {
      story.push(spacer(+o.titleTop));
      story.push(para(meta.title, titleStyle));
      for (const key of ['name', 'id', 'section', 'extra']) {
        if (meta[key]) story.push(para(meta[key], infoStyle));
      }
      story.push(pageBreak());
    }

    tasks.forEach((t, i) => {
      if (o.newPagePerTask && i > 0) story.push(pageBreak());
      const head = para(`${o.taskWord} ${t.num}`, headStyle);
      const codeBox = makeBox(doc, t.code, o, 'code', tableWidth);
      story.push(group([head, codeBox]));           // heading keeps with its code box
      story.push(spacer(+o.codeOutGap));
      const label = para(o.outputWord, labelStyle);
      const outBox = makeBox(doc, t.transcript, o, 'out', tableWidth);
      if (o.keepOutput) story.push(group([label, outBox]));
      else { story.push(label); story.push(outBox); }
    });

    story.forEach(place);

    /* ---- page numbers (after the title page) ---- */
    if (o.pageNumbers !== 'none') {
      for (let p = 1; p <= pageCount; p++) {
        const n = p - (o.showTitlePage ? 1 : 0);
        if (n < 1) continue;
        doc.setPage(p);
        doc.setFont(hf.family, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(o.textColor);
        const base = PH - margin / 2.2;
        if (o.pageNumbers === 'center') doc.text(String(n), PW / 2, base, { align: 'center' });
        else doc.text(String(n), PW - margin, base, { align: 'right' });
      }
    }
    return doc;
  }

  /** "<roll>_<Title>_LabReport.pdf", same rule as the Python version. */
  function reportFileName(meta) {
    const safe = (meta.title || '').replace(/ /g, '').replace(/[^A-Za-z0-9_\-]+/g, '') || 'Lab';
    return `${meta.id || 'report'}_${safe}_LabReport.pdf`;
  }

  /** Task number from a file name: task3.cpp -> 3, lab_12.cpp -> 12, else fallback. */
  function taskNumber(filename, fallback) {
    let m = filename.match(/task[\s_\-]*(\d+)/i);
    if (m) return +m[1];
    const nums = [...filename.replace(/\.[^.]+$/, '').matchAll(/(?<!\d)(\d{1,3})(?!\d)/g)];
    return nums.length ? +nums[nums.length - 1][1] : fallback;
  }

  root.LabPdf = { DEFAULTS, parseOptions, fontList, fontFamily, prepareFonts, buildPdf, reportFileName, taskNumber };
})(typeof window !== 'undefined' ? window : globalThis);
