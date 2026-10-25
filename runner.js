/* C++ compile-and-run for Lab Report Maker, fully inside the browser.
 *
 * Replaces app.py's g++ subprocess with Clang compiled to WebAssembly.
 * The compiler lives in a Web Worker so that
 *   - the page never freezes while compiling or running, and
 *   - a program stuck in an infinite loop can be killed (worker.terminate()).
 *
 * Behaviour mirrors app.py:
 *   - typed input is echoed into the transcript exactly where the program reads it,
 *   - a program that wants more input than was provided is stopped there,
 *   - output is capped at 20000 characters,
 *   - compile errors are returned instead of program output.
 *
 * Files needed next to index.html (see README):
 *   lib/clang-toolchain.src.js       the Clang driver, as a string (for the worker)
 *   clang/*.js                       clang / lld / sysroot, base64 (works from file://)
 */
(function (root) {
  'use strict';

  const ORIGIN = 'https://clang-local.invalid/';       // fake origin served by the worker's fetch shim
  const ASSETS = [                                       // name used by the runtime  ->  script file
    ['runtime-manifest.v1.json', 'clang/runtime-manifest.v1.json.js'],
    ['bin/memfs.wasm.gz',        'clang/memfs.wasm.gz.js'],
    ['bin/clang.wasm.gz',        'clang/clang.wasm.gz.js'],
    ['bin/lld.wasm.gz',          'clang/lld.wasm.gz.js'],
    ['bin/sysroot.tar.gz',       'clang/sysroot.tar.gz.js'],
  ];
  const RUN_LIMIT_MS = 10000;        // a running program is stopped after this long
  const COMPILE_LIMIT_MS = 180000;   // generous: the very first compile is slow
  const MAX_OUTPUT = 20000;          // characters kept per program

  /* ------------------------------------------------------------------------
   * Worker code. It is converted to a string and run inside a Blob worker, so it
   * must not reference anything outside itself.
   * --------------------------------------------------------------------- */
  function workerMain() {
    const ORIGIN = '__ORIGIN__';
    let files = null, tc = null;

    // Serve the embedded runtime files to the compiler, which expects to fetch() them.
    const realFetch = self.fetch ? self.fetch.bind(self) : null;
    self.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (url.indexOf(ORIGIN) === 0) {
        const key = url.slice(ORIGIN.length).split('?')[0];
        const bytes = files && files[key];
        if (!bytes) return Promise.resolve(new Response('not found', { status: 404 }));
        return Promise.resolve(new Response(bytes, {
          status: 200,
          headers: { 'content-type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
        }));
      }
      return realFetch(input, init);
    };

    // g++ users often write #include <bits/stdc++.h>, which libc++ does not have.
    const BITS = [
      'algorithm', 'array', 'bitset', 'cassert', 'cctype', 'cerrno', 'cfloat', 'chrono', 'climits',
      'cmath', 'complex', 'cstdint', 'cstdio', 'cstdlib', 'cstring', 'ctime', 'deque', 'exception',
      'fstream', 'functional', 'iomanip', 'iostream', 'iterator', 'limits', 'list', 'map', 'memory',
      'numeric', 'optional', 'queue', 'random', 'ratio', 'set', 'sstream', 'stack', 'stdexcept',
      'string', 'string_view', 'tuple', 'type_traits', 'unordered_map', 'unordered_set', 'utility',
      'variant', 'vector',
    ].map(h => '#include <' + h + '>').join('\n') + '\n';

    const post = msg => self.postMessage(msg);
    const STOP = '__LRM_NO_MORE_INPUT__';

    async function init(m) {
      files = m.files;
      tc = await self.clangWasmToolchain.createToolchain({
        baseUrl: ORIGIN,
        onProgress: v => post({ type: 'progress', value: v }),
      });
      tc.addFile('bits/stdc++.h', BITS);
      post({ type: 'ready' });
    }

    async function run(m) {
      const T = self.clangWasmToolchain;
      const result = await tc.lock(async () => {
        const c = await tc.captureCompilerOutput(() => tc.runtime.compileArtifact(m.code, {
          language: 'CPP',
          fileName: 'main.cpp',
          compileArgs: [...T.CLANG_DRIVER_DEFAULT_ARGS, '-std=c++17', '-I.'],
        }));
        if (c.error) {
          let lines = T.compilerDiagnostics(c.raw);
          if (!lines.length) lines = [String((c.error && c.error.message) || c.error)];
          return { compileError: lines };
        }

        post({ type: 'running' });
        const lines = m.lines;
        let next = 0;
        let stoppedForInput = false;
        let exitCode = null;
        try {
          const r = await tc.execute(c.result, {
            args: [],
            // Called whenever the program reads stdin: hand over one typed line and echo it,
            // like a terminal would. When the lines run out, stop the program there.
            stdin: () => {
              if (next < lines.length) {
                const l = lines[next++] + '\n';
                post({ type: 'out', text: l });
                return l;
              }
              stoppedForInput = true;
              throw new Error(STOP);
            },
            stdout: s => post({ type: 'out', text: s }),
            stderr: s => post({ type: 'out', text: s }),
          });
          exitCode = r && r.exitCode;
        } catch (err) {
          if (!(stoppedForInput || String((err && err.message) || err).indexOf(STOP) >= 0)) {
            // a crash inside the program (e.g. out-of-bounds access): keep what it printed
            post({ type: 'out', text: '' });
          }
        }
        return { exitCode, stoppedForInput };
      });
      post({ type: 'done', result });
    }

    self.onmessage = async e => {
      const m = e.data;
      try {
        if (m.type === 'init') await init(m);
        else if (m.type === 'run') await run(m);
      } catch (err) {
        post({ type: 'fatal', message: String((err && err.message) || err) });
      }
    };
  }

  /* ------------------------------------------------------------------------ */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => { s.remove(); resolve(); };
      s.onerror = () => reject(new Error('Could not load "' + src + '". Keep the lib/ and clang/ folders next to index.html.'));
      document.head.appendChild(s);
    });
  }

  function b64ToBytes(b64) {
    let pad = 0;
    if (b64.endsWith('==')) pad = 2; else if (b64.endsWith('=')) pad = 1;
    const out = new Uint8Array((b64.length / 4) * 3 - pad);
    const CH = 1 << 20;                       // multiple of 4
    let o = 0;
    for (let i = 0; i < b64.length; i += CH) {
      const bin = atob(b64.slice(i, i + CH));
      for (let j = 0; j < bin.length; j++) out[o++] = bin.charCodeAt(j);
    }
    return out;
  }

  function cleanTranscript(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
  }

  class CppRunner {
    /** onStatus(text, fraction|null) is called while the compiler is loading. */
    constructor(onStatus) {
      this.onStatus = onStatus || (() => {});
      this.files = null;          // decoded runtime files (kept so the worker can be restarted)
      this.worker = null;
      this.ready = null;          // promise
      this.loading = null;
    }

    /** Download/decode the compiler once and start the worker. Safe to call many times. */
    load() {
      if (!this.loading) {
        this.loading = this._load().catch(err => { this.loading = null; throw err; });
      }
      return this.loading;
    }

    async _load() {
      if (!this.files) {
        this.onStatus('Loading C++ compiler files…', 0);
        root.__CLANG_ASSETS = root.__CLANG_ASSETS || {};
        await loadScript('lib/clang-toolchain.src.js');
        this.workerSource = root.__CLANG_TOOLCHAIN_SRC;
        const files = {};
        for (let i = 0; i < ASSETS.length; i++) {
          const [name, src] = ASSETS[i];
          this.onStatus('Loading C++ compiler files…', i / ASSETS.length);
          await loadScript(src);
          const b64 = root.__CLANG_ASSETS[name];
          if (typeof b64 !== 'string') throw new Error('Compiler file missing: ' + name);
          files[name] = b64ToBytes(b64);
          delete root.__CLANG_ASSETS[name];           // free the base64 text
        }
        delete root.__CLANG_TOOLCHAIN_SRC;
        this.files = files;
      }
      await this._spawn();
    }

    _spawn() {
      this._kill();
      const code = this.workerSource + '\n;(' + workerMain.toString().replace('__ORIGIN__', ORIGIN) + ')();';
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const w = new Worker(url);
      this.worker = w;
      this.handler = null;
      w.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress') this.onStatus('Starting C++ compiler…', m.value);
        if (this.handler) this.handler(m);
      };
      w.onerror = e => { if (this.handler) this.handler({ type: 'fatal', message: e.message || 'worker error' }); };
      this.onStatus('Starting C++ compiler…', null);
      this.ready = new Promise((resolve, reject) => {
        this.handler = m => {
          if (m.type === 'ready') { this.handler = null; resolve(); }
          else if (m.type === 'fatal') { this.handler = null; reject(new Error(m.message)); }
        };
      });
      w.postMessage({ type: 'init', files: this.files });
      return this.ready;
    }

    _kill() {
      if (this.worker) { this.worker.terminate(); this.worker = null; }
    }

    /**
     * Compile and run one program.
     * returns { transcript, note }   note is set when the run was cut short (timeout, output cap)
     */
    async run(code, inputLines, displayName, onPhase) {
      await this.load();
      if (!this.worker) await this._spawn();
      await this.ready;

      const w = this.worker;
      let out = '';
      let note = '';

      return new Promise(resolve => {
        let phase = 'compile';
        let timer = setTimeout(() => finish('compile-timeout'), COMPILE_LIMIT_MS);
        let finished = false;

        const finish = (why, payload) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          this.handler = null;

          if (why === 'compile-timeout') {
            this._kill();
            return resolve({ transcript: 'Compilation timed out.', note: 'compilation timed out' });
          }
          if (why === 'fatal') {
            this._kill();
            return resolve({ transcript: 'Internal error: ' + payload, note: 'internal error' });
          }
          if (why === 'run-timeout') { this._kill(); note = 'was stopped after ' + RUN_LIMIT_MS / 1000 + ' seconds'; }
          if (why === 'too-long')    { this._kill(); note = 'output was cut at ' + MAX_OUTPUT + ' characters'; }

          if (why === 'done' && payload && payload.compileError) {
            const name = displayName || 'main.cpp';
            let text = payload.compileError
              .filter(l => !/^Error: process exited with code \d+/.test(l))
              .join('\n')
              .replace(/main\.cpp:/g, name + ':')
              .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
            text = 'Compilation failed:\n' + text.split('\n').slice(0, 25).join('\n');
            return resolve({ transcript: text, note: 'did not compile' });
          }
          if (why === 'done' && payload && payload.stoppedForInput) note = 'asked for more input than you provided';
          resolve({ transcript: cleanTranscript(out), note });
        };

        this.handler = m => {
          if (m.type === 'running') {
            phase = 'run';
            clearTimeout(timer);
            timer = setTimeout(() => finish('run-timeout'), RUN_LIMIT_MS);
            if (onPhase) onPhase('run');
          } else if (m.type === 'out') {
            out += m.text;
            if (out.length > MAX_OUTPUT) { out += '\n... output truncated ...'; finish('too-long'); }
          } else if (m.type === 'done') {
            finish('done', m.result);
          } else if (m.type === 'fatal') {
            finish('fatal', m.message);
          }
        };

        if (onPhase) onPhase('compile');
        w.postMessage({ type: 'run', code, lines: inputLines });
      });
    }
  }

  root.CppRunner = CppRunner;
})(window);
