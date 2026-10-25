# Lab Report Maker (browser edition)

Same tool as the Python version, but everything runs inside your browser. There is no server,
no Python, and no g++ to install. Your code never leaves your computer.

## Use

1. Keep the whole folder together and open `index.html` (double-click it, or host the folder on
   any static host such as GitHub Pages).
2. Fill in the title page, drop your `.cpp` files, fill in the value for each detected input
   variable, and click **Generate PDF**.

The first time you add a file the page loads the C++ compiler (about 40 MB read from the folder,
a few seconds). After that each file takes roughly 2 to 5 seconds to compile.

## What replaced what

| Python version            | Browser version                                              |
| ------------------------- | ------------------------------------------------------------ |
| Flask server (`app.py`)   | `index.html` + `runner.js`                                   |
| `g++` subprocess          | Clang compiled to WebAssembly (`clang/`, runs in a Web Worker) |
| ReportLab (`pdfgen.py`)   | jsPDF (`lib/`) + `pdfgen.js`, which reproduces ReportLab's page flow |

## Files

    favicon.svg, favicon-32.png, apple-touch-icon.png   the tab icon (braces) and its fallbacks
    index.html        the page (UI is unchanged)
    pdfgen.js         PDF builder (port of pdfgen.py)
    runner.js         compile and run C++ in a worker
    notesgen.js       images -> "Algorithms, Pseudocodes & Dry Runs" PDF, and page ordering from file names
    inputscan.js      finds the variables a program reads (cin, scanf, getline, ...) and their types
    highlight.js      C/C++ syntax highlighter and its colour themes
    fonts/            extra fonts (base64, loaded on demand) and their loader
    lib/              jsPDF and the Clang driver
    clang/            clang, lld and the C++ standard library (base64, so it works from file://)

## Input variables

When you add a file, the page scans the code for everything the program reads from the keyboard
(`cin >>`, `cin.get`, `cin.getline`, `getline(cin, s)`, `scanf`, `fgets`, `gets`, `getchar`).
Each one gets a row with the variable name, its data type (taken from where it was declared,
e.g. `int`, `double`, `string`, `char[50]`) and a box for its value.

- Rows are listed in the order they appear in the code, and the values are fed to the program in
  that order. Leave a box empty to skip it.
- A variable that is asked for more than once (a loop that repeats, e.g. `do { cin >> password; } while (password != 1234);`)
  gets one box per time it asks (#1, #2, #3 ...). Press **+ Add another value** (or Enter in a box) to add more,
  and the x button (or Backspace in an empty box) to remove one. Every box is fed to the program in order, and each
  value is echoed next to its prompt in the output. Values the program never asks for are ignored.
  Any variable can use this, not just ones inside a loop (useful when a function is called several times).
  You can still put several values separated by spaces in one box.
- A box turns red if the value does not fit the type (e.g. text for an `int`).
- A `getline` that directly follows `cin >>` shows a warning: it reads the leftover newline
  unless the code calls `cin.ignore()`, exactly like a real terminal.
- If the program asks in a different order than the code lists (branches, functions), open
  **Edit as plain text** under the rows and type the input yourself, one value per line.
- If nothing could be detected, you get the plain text box as before.
- Every task has a **View code** section (collapsed by default) showing the whole file with line
  numbers. The variables you type values for are highlighted. Click a highlight to jump to its box,
  or click into a box to see where it is read in the code.

## Algorithms, pseudocodes & dry runs (images to PDF)

The section at the bottom of the page turns photos or scans of handwritten work into a second PDF:
a title page (same Title page fields and Formatting as the code report, plus a customizable heading
line, default "Algorithms, Pseudocodes & Dry Runs"), then one image per page.

Page order is worked out from the file names. In Automatic mode it uses, in this order, the first
rule that works for every file:

1. A date and time in the name: `IMG_20260312_153045`, `PXL_20260312_153045123`,
   `Screenshot_2026-03-12-15-30-45`, `WhatsApp Image 2026-03-12 at 3.30.45 PM`, `12-03-2026 15.30`,
   `12 Mar 2026`, Unix times like `1710257445123`. Ties are broken by `(1)`-style copies and `WA0004`-style numbers.
2. A number in the name: `1`, `page 3`, `scan (12)`, `IMG_4821`, `task 2`.
3. The date each file was last modified (when the names carry no order).
4. The file name, A to Z (natural order, so `2` comes before `10`).

You can force any rule from the Page order menu, and rearrange by dragging rows or with the arrows.
Images are shrunk and saved as JPEG (choose the quality), so large phone photos do not make a huge PDF.
HEIC photos are only readable in Safari: convert them to JPG or PNG first.

## Syntax highlighting

The **Syntax highlighting** menu under Formatting colours the code in the lab report PDF (and in the live
preview): keywords, types, strings, numbers, comments, `#include` lines, function names, constants and
operators. It is **Off** by default.

Themes: VS Code Light+, GitHub Light, Atom One Light, Solarized Light, Print-friendly (grays), VS Code Dark+,
GitHub Dark, One Dark, Monokai, Dracula, Nord, Gruvbox Dark, Solarized Dark.

- Picking a highlighting theme also sets the code box background and text colour to match it. You can still change
  those afterwards under *Customize*, and choosing a page Theme keeps the highlighting colours.
- The output box is never highlighted. Line numbers (if on) are drawn in a muted colour.
- Pick *Off* to go back to plain single-colour code. *Reset* also turns it off.

## Behaviour (same as before)

- Tasks are ordered by the number in the file name.
- Input is echoed into the output exactly where the program reads it.
- A program that asks for more input than you typed is stopped there; output so far is kept.
- Compile errors are printed in the output box instead of the program output.
- Output is capped at 20000 characters per program.

## Differences to know about

- A running program is stopped after 10 seconds (infinite loops no longer hang anything).
  The page tells you which tasks were cut short or did not compile.
- Fonts: browsers cannot read the fonts installed on your computer, so the tool ships its own.
  Helvetica, Times and Courier are built into every PDF viewer. In addition, 13 free fonts live in
  `fonts/` and are embedded in the PDF when picked (loaded only on demand):
  sans: Arial-style (Liberation Sans), Calibri-style (Carlito), Verdana-style (DejaVu Sans), Work Sans;
  serif: Cambria-style (Caladea), Georgia-style (DejaVu Serif), Lora, IBM Plex Serif;
  monospace: Courier New-style (Liberation Mono), Consolas-style (DejaVu Sans Mono), JetBrains Mono,
  IBM Plex Mono, Red Hat Mono. They cover Latin text plus common symbols (arrows, curly quotes, bullets).
- The compiler is Clang 22 with C++17, so error message wording differs slightly from g++.
  `#include <bits/stdc++.h>` works. Windows-only headers (`conio.h`, `windows.h`) and `system()` do not.
- The page is split into shared settings (Title page, Formatting) and two parts: PDF 1 (lab report) and PDF 2 (algorithms, pseudocodes & dry runs). The shared settings apply to both.
- The formatting preview now shows both the code report and the algorithms/dry-run PDF side by side.
- Fixed: choosing several files with the file picker used to keep only the first one.
