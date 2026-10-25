/* Input scanner for Lab Report Maker.
 *
 * Reads a C++ source file and lists every place where the program reads from
 * the keyboard, together with the variable and its data type:
 *
 *   cin >> a >> b;             cin.get(c);          cin.getline(buf, 50);
 *   getline(cin, s);           scanf("%d %f", &a, &b);
 *   fgets(buf, n, stdin);      gets(buf);           c = getchar();
 *
 * InputScan.analyze(source) -> [{ name, type, kind, loop, line, start, end, warn, value }]
 *   start/end  character offsets of the variable in the source (for highlighting)
 *   kind  'token' (cin >> x, scanf), 'line' (a whole line), 'char' (one character)
 *   loop  true when the read sits inside a for / while / do loop
 *   warn  optional text, e.g. getline right after cin >> (reads an empty line)
 *
 * This is a static reader, not a compiler: it follows the order the reads appear
 * in the source. Types come from the nearest earlier declaration of the variable.
 */
(function (root) {
  'use strict';

  /* ----------------------------------------------------------- scrubbing */
  // Returns the source twice with comments blanked out. In `masked` the contents
  // of string and character literals are blanked too. Offsets and newlines are kept.
  function scrub(src) {
    let a = '', b = '';
    const n = src.length;
    let i = 0;
    const blank = ch => (ch === '\n' ? '\n' : ' ');
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') {
        while (i < n && src[i] !== '\n') { a += ' '; b += ' '; i++; }
        continue;
      }
      if (c === '/' && d === '*') {
        a += '  '; b += '  '; i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { const x = blank(src[i]); a += x; b += x; i++; }
        if (i < n) { a += '  '; b += '  '; i += 2; }
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c;
        a += c; b += c; i++;
        while (i < n && src[i] !== q && src[i] !== '\n') {
          if (src[i] === '\\' && i + 1 < n) { a += src[i] + src[i + 1]; b += '  '; i += 2; continue; }
          a += src[i]; b += ' '; i++;
        }
        if (i < n && src[i] === q) { a += q; b += q; i++; }
        continue;
      }
      a += c; b += c; i++;
    }
    // preprocessor lines are not code we need to read
    const kill = m => m.replace(/[^\n]/g, ' ');
    b = b.replace(/^[ \t]*#[^\n]*(?:\\\n[^\n]*)*/gm, kill);
    return { a, b };
  }

  function tokenize(b) {
    const re = /[A-Za-z_]\w*|\d[\w.]*|->|::|>>=|<<=|>>|<<|\+\+|--|&&|\|\||[<>=!+\-*\/%&|^]=|\S/g;
    const toks = [];
    let m;
    while ((m = re.exec(b))) toks.push({ t: m[0], p: m.index, e: m.index + m[0].length });
    return toks;
  }

  /* ------------------------------------------------------------ type words */
  const BASIC = new Set(['unsigned', 'signed', 'long', 'short', 'int', 'char', 'float', 'double', 'bool', 'void', 'wchar_t']);
  const QUAL = new Set(['const', 'static', 'volatile', 'register', 'extern', 'constexpr', 'inline', 'mutable',
    'struct', 'class', 'enum', 'typename', 'thread_local']);
  const STOP = new Set(['return', 'else', 'delete', 'new', 'goto', 'throw', 'case', 'using', 'namespace', 'typedef',
    'template', 'public', 'private', 'protected', 'default', 'break', 'continue', 'do', 'if', 'for', 'while',
    'switch', 'sizeof', 'cout', 'cin', 'cerr', 'endl', 'true', 'false', 'this', 'operator', 'friend', 'virtual',
    'explicit', 'and', 'or', 'not', 'try', 'catch']);
  const KNOWN0 = ['string', 'vector', 'array', 'deque', 'list', 'map', 'set', 'unordered_map', 'unordered_set',
    'multimap', 'multiset', 'pair', 'queue', 'stack', 'priority_queue', 'bitset', 'tuple', 'optional', 'complex',
    'size_t', 'ptrdiff_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'auto', 'wstring', 'string_view', 'FILE'];
  const MANIP = new Set(['ws', 'skipws', 'noskipws', 'hex', 'dec', 'oct', 'boolalpha', 'noboolalpha', 'setw',
    'setprecision', 'setbase', 'setfill', 'get_money', 'get_time', 'quoted', 'endl', 'flush']);

  const isIdent = s => /^[A-Za-z_]\w*$/.test(s);

  function normBasic(words) {
    const uns = words.includes('unsigned');
    const longs = words.filter(w => w === 'long').length;
    const base = words.find(w => ['char', 'float', 'double', 'bool', 'void', 'wchar_t'].includes(w));
    if (base === 'double') return longs ? 'long double' : 'double';
    if (base) return (uns ? 'unsigned ' : words.includes('signed') && base === 'char' ? 'signed ' : '') + base;
    let t = words.includes('short') ? 'short' : longs >= 2 ? 'long long' : longs === 1 ? 'long' : 'int';
    return (uns ? 'unsigned ' : '') + t;
  }

  function joinTokens(ts) {
    let s = '';
    for (let k = 0; k < ts.length; k++) {
      const t = ts[k].t, prev = ts[k - 1];
      if (prev && /\w$/.test(prev.t) && /^\w/.test(t)) s += ' ';
      else if (prev && prev.t === ',') s += ' ';
      s += t;
    }
    return s;
  }

  function splitTop(text) {               // split "a, map<b,c>, d" at top-level commas
    const out = []; let depth = 0, cur = '';
    for (const ch of text) {
      if (ch === '<' || ch === '(' || ch === '[') depth++;
      else if (ch === '>' || ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function elementType(type) {
    const m = /^(vector|array|deque|list|map|unordered_map|multimap|set|unordered_set)<(.+)>$/.exec(type);
    if (!m) return null;
    const args = splitTop(m[2]);
    return /map$/.test(m[1]) ? (args[1] || null) : (args[0] || null);
  }

  /* --------------------------------------------------------------- analyze */
  function analyze(src) {
    const { a, b } = scrub(src);
    const toks = tokenize(b);

    // matching brackets
    const match = {};
    {
      const st = [];
      toks.forEach((tk, i) => {
        if (tk.t === '(' || tk.t === '[' || tk.t === '{') st.push(i);
        else if (tk.t === ')' || tk.t === ']' || tk.t === '}') {
          const o = st.pop();
          if (o !== undefined) { match[o] = i; match[i] = o; }
        }
      });
    }

    // aliases: #define / typedef / using
    const alias = {};
    const typeish = s => /^[\w\s:<>,*&]+$/.test(s);
    let m;
    const reDef = /^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+([^\n]+)$/gm;
    while ((m = reDef.exec(a))) {
      const rhs = m[2].trim();
      if (rhs.split(/\s+/).every(w => BASIC.has(w) || w === 'string' || alias[w])) alias[m[1]] = rhs.split(/\s+/).map(w => alias[w] || w).join(' ');
    }
    const reTd = /\btypedef\s+([\w\s:<>,*&]+?)\s+(\w+)\s*;/g;
    while ((m = reTd.exec(a))) if (typeish(m[1])) alias[m[2]] = m[1].trim().replace(/^std::/, '');
    const reUs = /\busing\s+(\w+)\s*=\s*([^;]+);/g;
    while ((m = reUs.exec(a))) if (typeish(m[2])) alias[m[1]] = m[2].trim().replace(/^std::/, '');

    // struct / class bodies (for members such as p.age)
    const KNOWN = new Set(KNOWN0);
    const structs = [];
    for (let i = 0; i < toks.length - 2; i++) {
      if ((toks[i].t === 'struct' || toks[i].t === 'class') && isIdent(toks[i + 1].t)) {
        let j = i + 2;
        while (j < toks.length && toks[j].t !== '{' && toks[j].t !== ';') j++;
        if (toks[j] && toks[j].t === '{' && match[j] !== undefined) {
          structs.push({ name: toks[i + 1].t, start: toks[j].p, end: toks[match[j]].p });
          KNOWN.add(toks[i + 1].t);
        }
      }
    }
    Object.keys(alias).forEach(k => KNOWN.add(k));
    const structAt = pos => structs.find(s => pos > s.start && pos < s.end) || null;

    /* ---- types ---- */
    function parseType(i) {
      let j = i;
      while (j < toks.length && QUAL.has(toks[j].t)) j++;
      if (j >= toks.length) return null;
      const w = toks[j].t;
      let type, known = false;
      if (BASIC.has(w)) {
        const words = [];
        while (j < toks.length && BASIC.has(toks[j].t)) words.push(toks[j++].t);
        type = words.length === 1 && alias[words[0]] ? alias[words[0]] : normBasic(words); known = true;
      } else if (isIdent(w) && !STOP.has(w)) {
        let name = w; j++;
        while (toks[j] && toks[j].t === '::' && toks[j + 1] && isIdent(toks[j + 1].t)) { name += '::' + toks[j + 1].t; j += 2; }
        name = name.replace(/^std::/, '');
        let targs = '';
        if (toks[j] && toks[j].t === '<') {
          let depth = 0, k = j, ok = false;
          for (; k < toks.length; k++) {
            const t = toks[k].t;
            if (t === ';' || t === '{' || t === '}' || t === ')') break;
            if (t === '<') depth++; else if (t === '>') depth--; else if (t === '>>') depth -= 2;
            if (depth < 0) break;
            if (depth === 0) { ok = true; break; }
          }
          if (!ok) return null;
          targs = joinTokens(toks.slice(j, k + 1));
          j = k + 1;
        }
        const base = name.replace(/^.*::/, '');
        known = KNOWN.has(base) || !!alias[base];
        type = alias[name] && !targs ? alias[name] : name + targs;
        if (alias[name]) known = true;
      } else return null;
      return { type: type.replace(/^std::/, ''), next: j, known };
    }

    /* ---- declarations ---- */
    const decls = [];
    const OK_NEXT = new Set(['=', ';', ',', ')', '(', '{', ':']);
    const RESERVED = n => STOP.has(n) || BASIC.has(n) || QUAL.has(n);

    function skipInit(j) {
      let depth = 0;
      for (; j < toks.length; j++) {
        const t = toks[j].t;
        if (t === '(' || t === '[' || t === '{') depth++;
        else if (t === ')' || t === ']' || t === '}') { if (depth === 0) return j; depth--; }
        else if (depth === 0 && (t === ',' || t === ';')) return j;
      }
      return j;
    }

    function declAt(i, ctx) {
      const pt = parseType(i);
      if (!pt) return;
      let j = pt.next;
      for (;;) {
        let ptr = '';
        let stars = false;
        while (toks[j] && (toks[j].t === '*' || toks[j].t === '&' || toks[j].t === '&&')) { if (toks[j].t === '*') ptr += '*'; stars = true; j++; }
        if (stars && !pt.known) return;
        if (ctx === 'open' && !pt.known) return;
        const nm = toks[j];
        if (!nm || !isIdent(nm.t) || RESERVED(nm.t)) return;
        j++;
        let dims = '';
        while (toks[j] && toks[j].t === '[' && match[j] !== undefined) { dims += joinTokens(toks.slice(j, match[j] + 1)); j = match[j] + 1; }
        const n = toks[j];
        if (!n || !OK_NEXT.has(n.t)) return;
        decls.push({ name: nm.t, type: pt.type + ptr, dims, pos: nm.p });
        if (n.t === '=') j = skipInit(j + 1);
        else if (n.t === '(' || n.t === '{' || n.t === ':') return;
        if (toks[j] && toks[j].t === ',') { j++; continue; }
        return;
      }
    }

    for (let i = 0; i < toks.length; i++) {
      const prev = toks[i - 1];
      if (!prev || prev.t === ';' || prev.t === '{' || prev.t === '}' || prev.t === ':') declAt(i, 'stmt');
      else if (prev.t === '(' || prev.t === ',') declAt(i, 'open');
    }

    function lookup(name, pos) {
      const here = structAt(pos);
      let best = null;
      for (const d of decls) {
        if (d.name !== name || d.pos > pos) continue;
        const s = structAt(d.pos);
        if (s && s !== here) continue;
        if (!best || d.pos > best.pos) best = d;
      }
      return best;
    }
    function memberOf(typeName, member) {
      const base = typeName.replace(/\*+$/, '');
      const s = structs.find(x => x.name === base);
      if (!s) return null;
      return decls.find(d => d.name === member && d.pos > s.start && d.pos < s.end) || null;
    }
    const splitDims = d => d.match(/\[[^\]]*\]/g) || [];

    /* ---- loops ---- */
    const loops = [];
    toks.forEach((tk, i) => {
      if ((tk.t === 'for' || tk.t === 'while') && toks[i + 1] && toks[i + 1].t === '(' && match[i + 1] !== undefined) {
        const close = match[i + 1];
        let j = close + 1, end = close;
        if (toks[j] && toks[j].t === '{' && match[j] !== undefined) end = match[j];
        else {
          for (; j < toks.length; j++) {
            const t = toks[j].t;
            if (t === '(' || t === '[') { j = match[j] !== undefined ? match[j] : j; continue; }
            if (t === '{') { end = match[j] !== undefined ? match[j] : j; break; }
            if (t === ';') { end = j; break; }
          }
        }
        loops.push([toks[i].p, toks[Math.min(end, toks.length - 1)].p]);
      } else if (tk.t === 'do' && toks[i + 1] && toks[i + 1].t === '{' && match[i + 1] !== undefined) {
        loops.push([tk.p, toks[match[i + 1]].p]);
      }
    });
    const inLoop = pos => loops.some(([s, e]) => pos >= s && pos <= e);
    const lineOf = pos => src.slice(0, pos).split('\n').length;

    /* ---- operands ---- */
    function resolveOperand(ts, pos, fmtType) {
      let k = 0, deref = 0;
      while (k < ts.length && (ts[k].t === '*' || ts[k].t === '&')) { if (ts[k].t === '*') deref++; k++; }
      if (ts[k] && ts[k].t === 'std' && ts[k + 1] && ts[k + 1].t === '::') k += 2;
      const base = ts[k];
      if (!base || !isIdent(base.t) || MANIP.has(base.t) || RESERVED(base.t)) return null;
      const name = src.slice(base.p, ts[ts.length - 1].e).replace(/\s+/g, '');
      const d = lookup(base.t, pos);
      let type = d ? d.type : null;
      let dims = d ? splitDims(d.dims) : [];
      let j = k + 1;
      while (j < ts.length) {
        const t = ts[j].t;
        if (t === '[') {
          let depth = 0, e = j;
          for (; e < ts.length; e++) { if (ts[e].t === '[') depth++; else if (ts[e].t === ']' && --depth === 0) break; }
          if (dims.length) dims.shift();
          else if (type) type = elementType(type) || (type.endsWith('*') ? type.slice(0, -1) : type);
          j = e + 1;
        } else if ((t === '.' || t === '->') && ts[j + 1]) {
          const mem = type ? memberOf(type, ts[j + 1].t) : null;
          type = mem ? mem.type : null;
          dims = mem ? splitDims(mem.dims) : [];
          j += 2;
        } else break;
      }
      for (; deref > 0 && type && type.endsWith('*'); deref--) type = type.slice(0, -1);
      if (!type) type = fmtType || '?';
      else if (dims.length) type = type + dims.join('');
      return { name, type, start: base.p, end: ts[ts.length - 1].e };
    }

    function args(open) {                   // split the call at `open` into argument token lists
      const out = []; let cur = [], depth = 0;
      const close = match[open];
      if (close === undefined) return out;
      for (let j = open + 1; j < close; j++) {
        const t = toks[j].t;
        if (t === '(' || t === '[' || t === '{') depth++;
        else if (t === ')' || t === ']' || t === '}') depth--;
        if (t === ',' && depth === 0) { out.push(cur); cur = []; } else cur.push(toks[j]);
      }
      if (cur.length) out.push(cur);
      return out;
    }
    const stripStd = ts => (ts[0] && ts[0].t === 'std' && ts[1] && ts[1].t === '::') ? ts.slice(2) : ts;

    /* ---- reads ---- */
    const reads = [];
    function add(ts, kind, pos, fmtType) {
      ts = stripStd(ts);
      if (!ts.length) return;
      const r = resolveOperand(ts, pos, fmtType);
      if (!r) return;
      reads.push({ name: r.name, type: r.type, kind, loop: inLoop(pos), line: lineOf(r.start), start: r.start, end: r.end, pos, value: '' });
    }
    const FMT = { d: 'int', i: 'int', u: 'unsigned int', o: 'unsigned int', x: 'unsigned int', X: 'unsigned int',
      f: 'float', e: 'float', g: 'float', E: 'float', G: 'float', a: 'float', c: 'char', s: 'char[]', p: 'void*' };
    function fmtTypes(fmt) {
      const out = [];
      const re = /%(\*)?(\d+)?(hh|h|ll|l|L|j|z|t)?([diouxXeEfFgGaAcsp]|\[[^\]]*\]|%)/g;
      let q;
      while ((q = re.exec(fmt))) {
        if (q[4] === '%' || q[1]) continue;
        const c = q[4][0] === '[' ? 's' : q[4];
        const len = q[3] || '';
        let t = FMT[c] || '?';
        if ('diouxX'.includes(c)) {
          const u = 'ouxX'.includes(c) ? 'unsigned ' : '';
          t = len === 'll' ? u + 'long long' : len === 'l' ? u + 'long' : len === 'h' ? u + 'short' : len === 'hh' ? u + 'char' : u + 'int';
        } else if ('eEfFgGaA'.includes(c)) t = len === 'l' ? 'double' : len === 'L' ? 'long double' : 'float';
        out.push(t);
      }
      return out;
    }

    for (let i = 0; i < toks.length; i++) {
      const t = toks[i].t, nx = toks[i + 1], pv = toks[i - 1];
      if (t === 'cin') {
        if (nx && nx.t === '>>') {
          let j = i + 1;
          while (toks[j] && toks[j].t === '>>') {
            j++;
            const s = j; let depth = 0;
            for (; j < toks.length; j++) {
              const q = toks[j].t;
              if (q === '(' || q === '[' || q === '{') depth++;
              else if (q === ')' || q === ']' || q === '}') { if (depth === 0) break; depth--; }
              else if (depth === 0 && ['>>', ';', '&&', '||', ',', '?', ':', '==', '!='].includes(q)) break;
            }
            add(toks.slice(s, j), 'token', toks[i].p);
          }
        } else if (nx && nx.t === '.' && toks[i + 2] && toks[i + 3] && toks[i + 3].t === '(') {
          const fn = toks[i + 2].t, a2 = args(i + 3);
          if (fn === 'get' && a2.length === 1) add(a2[0], 'char', toks[i].p, 'char');
          else if ((fn === 'getline' || fn === 'get') && a2.length >= 2) add(a2[0], 'line', toks[i].p, 'char[]');
        }
      } else if (t === 'getline' && nx && nx.t === '(' && !(pv && (pv.t === '.' ))) {
        const a2 = args(i + 1);
        if (a2.length >= 2 && stripStd(a2[0]).map(x => x.t).join('') === 'cin') add(a2[1], 'line', toks[i].p, 'string');
      } else if ((t === 'scanf' || t === 'scanf_s') && nx && nx.t === '(') {
        const a2 = args(i + 1);
        if (a2.length >= 2 && a2[0].length) {
          const fmt = a.slice(a2[0][0].p, a2[0][a2[0].length - 1].e);
          const types = fmtTypes(fmt);
          a2.slice(1).forEach((ts, k) => add(ts, types[k] === 'char' ? 'char' : (types[k] === 'char[]' ? 'token' : 'token'), toks[i].p, types[k]));
        }
      } else if ((t === 'fgets' || t === 'gets' || t === 'gets_s') && nx && nx.t === '(') {
        const a2 = args(i + 1);
        if (a2.length && (t !== 'fgets' || (a2[2] && stripStd(a2[2]).map(x => x.t).join('') === 'stdin'))) add(a2[0], 'line', toks[i].p, 'char[]');
      } else if ((t === 'getchar' || t === 'getc' || t === 'fgetc') && nx && nx.t === '(' && pv && pv.t === '=') {
        // c = getchar();  /  int c = getchar();
        const lhs = toks[i - 2];
        if (lhs && isIdent(lhs.t)) add([lhs], 'char', toks[i].p, 'char');
      }
    }

    reads.sort((x, y) => x.pos - y.pos);

    // getline right after a "cin >> x" (no ignore) reads the left-over newline
    reads.forEach((r, k) => {
      const p = reads[k - 1];
      if (r.kind === 'line' && p && p.kind !== 'line') {
        const between = a.slice(p.pos, r.pos);
        if (!/\bignore\b|\bws\b|\bgetline\b|\.get\s*\(|getchar|fflush/.test(between)) {
          r.warn = 'Comes right after a cin >> read, so it will read the rest of that line (empty) unless you call cin.ignore() first.';
        }
      }
    });

    return reads.map(({ pos, ...rest }) => rest);
  }

  /* ------------------------------------------------------------- helpers */
  const INT_RE = /^(unsigned |signed )?(short|int|long|long long|size_t|ptrdiff_t)$|^u?int(8|16|32|64)_t$/;
  const FLOAT_RE = /^(float|double|long double)$/;

  function placeholder(r) {
    const t = r.type;
    let ex = '';
    if (INT_RE.test(t)) ex = '5';
    else if (FLOAT_RE.test(t)) ex = '3.14';
    else if (t === 'char') ex = 'a';
    else if (t === 'bool') ex = '1';
    else if (/^string$|^char\[/.test(t)) ex = r.kind === 'line' ? 'a whole line of text' : 'hello';
    if (r.loop) return ex ? 'e.g. ' + ex + ' ' + ex + ' ' + ex + '  (all values)' : 'all values, in order';
    return ex ? 'e.g. ' + ex : 'value';
  }

  // null when fine, otherwise a short message
  function check(r) {
    const v = (r.value || '').trim();
    if (!v || r.kind === 'line') return null;
    const parts = r.loop ? v.split(/\s+/) : [v];
    if (INT_RE.test(r.type)) {
      if (parts.some(p => !/^[+-]?\d+$/.test(p))) return 'Expected a whole number (' + r.type + ')';
      if (/^unsigned/.test(r.type) && parts.some(p => p[0] === '-')) return 'Expected a non-negative number';
    } else if (FLOAT_RE.test(r.type)) {
      if (parts.some(p => !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(p))) return 'Expected a number (' + r.type + ')';
    } else if (r.type === 'bool') {
      if (parts.some(p => !/^[01]$/.test(p))) return 'Expected 0 or 1';
    }
    return null;
  }

  // the text the program will see, one line per entry
  function toLines(reads) {
    const out = [];
    reads.forEach(r => String(r.value || '').split(/\r?\n/).forEach(l => { l = l.trim(); if (l !== '') out.push(l); }));
    return out;
  }

  const api = { analyze, placeholder, check, toLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InputScan = api;
})(typeof window !== 'undefined' ? window : globalThis);
