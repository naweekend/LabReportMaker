/* C / C++ syntax highlighting: a small tokenizer plus colour themes.
 *
 *   Highlight.tokenize(text)  -> Uint8Array, one class number per character of text
 *   Highlight.CLASSES         -> class names; the number is the index
 *   Highlight.THEMES          -> { key: { label, dark, bg, fg, <class name>: '#rrggbb', ... } }
 *   Highlight.list()          -> [{ key, label, dark }]
 *
 * Used by the PDF builder and by the live preview, so both look the same.
 */
(function (root) {
  const CLASSES = ['plain', 'keyword', 'type', 'string', 'number', 'comment', 'preproc', 'func', 'constant', 'op', 'lineno'];
  const C = {}; CLASSES.forEach((n, i) => { C[n] = i; });

  const KEYWORDS = new Set(('alignas alignof asm auto break case catch class const consteval constexpr constinit const_cast continue ' +
    'co_await co_return co_yield decltype default delete do dynamic_cast else enum explicit export extern final for friend goto if ' +
    'inline mutable namespace new noexcept operator override private protected public register reinterpret_cast requires return ' +
    'sizeof static static_assert static_cast struct switch template this thread_local throw try typedef typeid typename union ' +
    'using virtual volatile while and or not xor and_eq or_eq not_eq bitand bitor compl').split(' '));
  const TYPES = new Set(('void bool char char8_t char16_t char32_t wchar_t short int long float double signed unsigned size_t ssize_t ' +
    'ptrdiff_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intmax_t uintmax_t FILE ' +
    'string wstring string_view vector array deque list forward_list set multiset map multimap unordered_map unordered_set ' +
    'stack queue priority_queue pair tuple bitset optional variant any function shared_ptr unique_ptr weak_ptr ' +
    'istream ostream iostream ifstream ofstream fstream stringstream istringstream ostringstream ' +
    'iterator mutex thread atomic complex ios streambuf').split(' '));
  const CONSTANTS = new Set(['true', 'false', 'nullptr', 'NULL', 'EOF', 'INT_MAX', 'INT_MIN', 'LLONG_MAX', 'LLONG_MIN', 'RAND_MAX', 'M_PI']);
  const DECL_WORDS = new Set(['class', 'struct', 'enum', 'union', 'typename']);

  const isIdStart = c => /[A-Za-z_]/.test(c);
  const isId = c => /[A-Za-z0-9_]/.test(c);
  const isDigit = c => c >= '0' && c <= '9';

  function tokenize(text) {
    const n = text.length;
    const out = new Uint8Array(n);                 // all 0 = plain
    const fill = (a, b, k) => { for (let i = a; i < b && i < n; i++) out[i] = k; };
    let i = 0, lineStart = true, afterDecl = false, afterInclude = false;

    while (i < n) {
      const c = text[i], d = text[i + 1];

      if (c === '\n') { i++; lineStart = true; afterInclude = false; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }

      /* comments */
      if (c === '/' && d === '/') {
        let j = i; while (j < n && text[j] !== '\n') { if (text[j] === '\\' && text[j + 1] === '\n') j++; j++; }
        fill(i, j, C.comment); i = j; continue;
      }
      if (c === '/' && d === '*') {
        let j = text.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
        fill(i, j, C.comment); i = j; lineStart = false; continue;
      }

      /* preprocessor: # and the directive word, e.g. #include */
      if (c === '#' && lineStart) {
        let j = i + 1; while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
        const k = j; while (j < n && isId(text[j])) j++;
        fill(i, j, C.preproc);
        afterInclude = /^(include|import)$/.test(text.slice(k, j));
        i = j; lineStart = false; continue;
      }
      lineStart = false;

      /* #include <header> */
      if (afterInclude && c === '<') {
        let j = i + 1; while (j < n && text[j] !== '>' && text[j] !== '\n') j++;
        if (text[j] === '>') j++;
        fill(i, j, C.string); i = j; afterInclude = false; continue;
      }

      /* strings and characters (with optional L, u, U, u8, R prefixes) */
      if (c === '"' || c === '\'') {
        const q = c; let j = i + 1;
        // a ' between digits is a digit separator, not a character literal (1'000'000)
        if (q === '\'' && i > 0 && /[0-9A-Fa-f]/.test(text[i - 1]) && /[0-9A-Fa-f]/.test(d || '')) { i++; continue; }
        while (j < n && text[j] !== q && text[j] !== '\n') { if (text[j] === '\\') j++; j++; }
        if (text[j] === q) j++;
        fill(i, Math.min(j, n), C.string); i = Math.min(j, n); afterInclude = false; continue;
      }
      if (c === 'R' && d === '"') {                // raw string R"delim( ... )delim"
        const m = /^R"([^()\\\s]{0,16})\(/.exec(text.slice(i, i + 24));
        if (m) {
          const endTok = ')' + m[1] + '"';
          let j = text.indexOf(endTok, i + m[0].length); j = j < 0 ? n : j + endTok.length;
          fill(i, j, C.string); i = j; continue;
        }
      }

      /* numbers */
      if (isDigit(c) || (c === '.' && isDigit(d || ''))) {
        let j = i;
        if (c === '0' && /[xX]/.test(d || '')) { j += 2; while (j < n && /[0-9A-Fa-f']/.test(text[j])) j++; }
        else if (c === '0' && /[bB]/.test(d || '')) { j += 2; while (j < n && /[01']/.test(text[j])) j++; }
        else {
          while (j < n && /[0-9']/.test(text[j])) j++;
          if (text[j] === '.') { j++; while (j < n && /[0-9']/.test(text[j])) j++; }
          if (/[eE]/.test(text[j] || '') && /[0-9+\-]/.test(text[j + 1] || '')) { j += 2; while (j < n && isDigit(text[j])) j++; }
        }
        while (j < n && /[uUlLfF]/.test(text[j])) j++;   // suffixes
        fill(i, j, C.number); i = j; continue;
      }

      /* words */
      if (isIdStart(c)) {
        let j = i + 1; while (j < n && isId(text[j])) j++;
        const w = text.slice(i, j);
        let k = j; while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
        let cls = C.plain;
        if (afterDecl) cls = C.type;
        else if (KEYWORDS.has(w)) cls = C.keyword;
        else if (CONSTANTS.has(w)) cls = C.constant;
        else if (TYPES.has(w)) cls = C.type;
        else if (text[k] === '(') cls = C.func;
        else if (/^[A-Z][A-Za-z0-9]*$/.test(w) && /[a-z]/.test(w) && k > j && isIdStart(text[k] || '')) cls = C.type; // Student s;
        fill(i, j, cls);
        afterDecl = DECL_WORDS.has(w) || (w === 'namespace' && false);
        i = j; continue;
      }

      /* everything else is an operator / punctuation */
      if (!/[\s\w;,.(){}\[\]]/.test(c)) out[i] = C.op;     // brackets, ; , . stay plain
      afterDecl = false;
      i++;
    }
    return out;
  }

  /* ---------------------------------------------------------------- themes */
  const T = (label, dark, bg, fg, keyword, type, string, number, comment, preproc, func, constant, op, lineno) =>
    ({ label, dark, bg, fg, plain: fg, keyword, type, string, number, comment, preproc, func, constant, op, lineno });

  const THEMES = {
    vslight:   T('VS Code Light+',   false, '#ffffff', '#000000', '#0000ff', '#267f99', '#a31515', '#098658', '#008000', '#af00db', '#795e26', '#0000ff', '#000000', '#237893'),
    githublight: T('GitHub Light',   false, '#f6f8fa', '#24292f', '#cf222e', '#953800', '#0a3069', '#0550ae', '#6e7781', '#cf222e', '#8250df', '#0550ae', '#24292f', '#8c959f'),
    atomlight: T('Atom One Light',   false, '#fafafa', '#383a42', '#a626a4', '#c18401', '#50a14f', '#986801', '#a0a1a7', '#a626a4', '#4078f2', '#986801', '#0184bc', '#9d9d9f'),
    solarlight: T('Solarized Light', false, '#fdf6e3', '#657b83', '#859900', '#b58900', '#2aa198', '#d33682', '#93a1a1', '#cb4b16', '#268bd2', '#cb4b16', '#657b83', '#93a1a1'),
    print:     T('Print-friendly (grays)', false, '#ffffff', '#000000', '#000000', '#303030', '#505050', '#505050', '#8a8a8a', '#606060', '#000000', '#303030', '#000000', '#a0a0a0'),
    vsdark:    T('VS Code Dark+',    true,  '#1e1e1e', '#d4d4d4', '#569cd6', '#4ec9b0', '#ce9178', '#b5cea8', '#6a9955', '#c586c0', '#dcdcaa', '#569cd6', '#d4d4d4', '#858585'),
    githubdark: T('GitHub Dark',     true,  '#0d1117', '#c9d1d9', '#ff7b72', '#ffa657', '#a5d6ff', '#79c0ff', '#8b949e', '#ff7b72', '#d2a8ff', '#79c0ff', '#c9d1d9', '#6e7681'),
    onedark:   T('One Dark',         true,  '#282c34', '#abb2bf', '#c678dd', '#e5c07b', '#98c379', '#d19a66', '#5c6370', '#c678dd', '#61afef', '#d19a66', '#56b6c2', '#636d83'),
    monokai:   T('Monokai',          true,  '#272822', '#f8f8f2', '#f92672', '#66d9ef', '#e6db74', '#ae81ff', '#75715e', '#f92672', '#a6e22e', '#ae81ff', '#f92672', '#90908a'),
    dracula:   T('Dracula',          true,  '#282a36', '#f8f8f2', '#ff79c6', '#8be9fd', '#f1fa8c', '#bd93f9', '#6272a4', '#ff79c6', '#50fa7b', '#bd93f9', '#ff79c6', '#6272a4'),
    nord:      T('Nord',             true,  '#2e3440', '#d8dee9', '#81a1c1', '#8fbcbb', '#a3be8c', '#b48ead', '#616e88', '#5e81ac', '#88c0d0', '#81a1c1', '#81a1c1', '#4c566a'),
    gruvbox:   T('Gruvbox Dark',     true,  '#282828', '#ebdbb2', '#fb4934', '#fabd2f', '#b8bb26', '#d3869b', '#928374', '#fe8019', '#8ec07c', '#d3869b', '#ebdbb2', '#7c6f64'),
    solardark: T('Solarized Dark',   true,  '#002b36', '#839496', '#859900', '#b58900', '#2aa198', '#d33682', '#586e75', '#cb4b16', '#268bd2', '#cb4b16', '#839496', '#586e75'),
  };

  const list = () => Object.keys(THEMES).map(k => ({ key: k, label: THEMES[k].label, dark: THEMES[k].dark }));
  const colors = key => { const t = THEMES[key]; return t ? CLASSES.map(n => t[n]) : null; };   // class number -> '#rrggbb'

  const api = { CLASSES, THEMES, tokenize, list, colors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Highlight = api;
})(typeof window !== 'undefined' ? window : globalThis);
