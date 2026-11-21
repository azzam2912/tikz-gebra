# Handoff — TikZGeo

Last updated: 2026-11-21. Branches: `main` (stable) and `dev` (work). Both are at the same
commit right now.

## Status

The MVP is **complete** (all five milestones). There are 103 tests and strict `tsc` is clean.

| Milestone | Contents | State |
|---|---|---|
| M1 | Parser, construction graph, geometry, codegen, tests | ✅ |
| M2 | Static SVG render, grid/axes, pan + zoom, fit view | ✅ |
| M3 | Drag free points → live symbolic codegen, 2-decimal rounding, 0.5 snap | ✅ |
| M4 | CodeMirror editor, 150 ms debounced parse, error underlines, two-way hover, one-step undo of a drag | ✅ |
| M5 | "Copy code" / "Copy full document", 3 examples, README | ✅ |
| Extra | `tests/latex.test.ts`: 318 constructions compared with real pdflatex + tkz-euclide 5.06c. All agree, intersection order included (worst deviation 0.0033 cm). | ✅ |

## Continue on your machine

```bash
git clone https://github.com/azzam2912/tikz-gebra.git
```

```bash
cd tikz-gebra && git checkout dev
```

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

Requirements:
- **Node 20+.** It was developed with Node 22.
- **No backend.** Everything runs in the browser.

**Optional: real-LaTeX cross-check.** `tests/latex.test.ts` runs only when `pdflatex` and
`tkz-euclide.sty` are available; otherwise it is skipped.

macOS (BasicTeX, then add the packages):
```bash
sudo tlmgr update --self && sudo tlmgr install tkz-euclide pgf standalone
```

Debian/Ubuntu:
```bash
sudo apt-get install --no-install-recommends texlive-latex-base texlive-latex-recommended texlive-pictures texlive-latex-extra
```

Windows: MiKTeX installs missing packages on first use.

Check what you have:
```bash
kpsewhich tkz-euclide.sty
```

⚠ Everything was verified against **tkz-euclide 5.06c** (TeX Live 2023). A newer TeX Live
ships 5.1x. If `npm run test:latex` fails there, that means real behaviour changed, so
update `src/geom/constructions.ts` and `docs/assumptions.md` rather than the test.

Cloud sessions: a personal environment called **tikz-gebra** exists, with a setup script
that installs TeX Live and runs `npm ci`. Pick it when you start a cloud session on this
repo. The script has not yet been exercised on a fresh container.

## Where things are

| Path | What |
|---|---|
| `src/parser/` | `tokenizer.ts`, `parser.ts` (signature-driven, error recovery), `ast.ts` (shared types) |
| `src/graph/` | `types.ts` (Graph, Step, Drawing, `moveFreePoint`, `structure`), `build.ts` (checks + topological sort) |
| `src/geom/` | `constructions.ts` (all math, tkz ordering rules), `evaluate.ts`, `vec.ts` |
| `src/codegen/` | `codegen.ts` (canonical output, `fullDocument`), `export.ts` (`extractBody`) |
| `src/ui/` | `App.tsx` (state, debounce, drag, hover, export), `Editor.tsx`, `Canvas.tsx`, plus pure helpers |
| `src/pipeline.ts` | `compile(src)`: parse + build |
| `tests/` | parser, geom, graph, roundtrip, export, ui-helpers, rounding, latex |
| `examples/` | triangle-circumcircle, orthocenter, two-circles |
| `docs/assumptions.md` | Verified semantics, the open assumption, MVP design choices |

## Decisions to keep in mind

- **Intersection order (verified):**
  - `\tkzInterCC`: the first point is left of O1→O2.
  - `\tkzInterLC`: the first point F has the centre on the left of F→S.
  - When the line passes through the centre, F = O − r·û. LaTeX matched this in 4 tested
    layouts, but it depends on rounding inside TeX.
- **`\tkzDrawLine` is finite.** It extends 20% beyond each end, like LaTeX, not an infinite line.
- **Using a point before defining it** is only a warning. Codegen reorders. "Copy code" then
  exports the reordered version.
- **Redefining a point name** is an error.
- **Dragging regenerates the whole code** in canonical form and drops comments. A single
  Ctrl+Z brings back the pre-drag text.
- **Dragging is disabled while the code has errors**, so a drag can't overwrite text being typed.
- **Diagnostics carry an optional `code`** (currently only `'forward-ref'`). The UI reacts to
  it; don't match on message text.

## Open items / possible next steps

1. **GitHub housekeeping (needs you):** set the repo's default branch to `main`
   (Settings → General → Default branch). After that, the old branch
   `claude/practical-feynman-f0m445` can be deleted; all of its commits are in `main` and `dev`.
2. **Edit coordinates in place when dragging:** change only the numbers of the dragged
   `\tkzDefPoint` in the source instead of regenerating everything. That would keep
   comments and formatting.
3. **Small command additions:** `\tkzDrawPoint`, `\tkzDrawLines`, `\tkzDrawCircles`,
   `\tkzDrawPolygons`, `\tkzLabelPoint(A){text}`.
4. **Two-point retrieval:** `\tkzGetFirstPoint` / `\tkzGetSecondPoint`, and the `common=` /
   `near` options of `\tkzInterLC`/`\tkzInterCC`. The semantics are already read in
   `tkz-tools-eu-intersections.tex`.
5. **Expressions in coordinates** (`\tkzDefPoint(2*cos(30),1)`) and polar coordinates
   (`(r:θ)`). Both are currently rejected with a clear error.
6. **UI:** dark theme; show the coordinates of the hovered point in the status bar; select
   a point from the code cursor position (not only mouse hover).
7. **Bundle size:** the build warns about a chunk over 500 kB (CodeMirror). Code-splitting
   would fix it if it matters.
