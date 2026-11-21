# Handoff — TikZGeo

Last updated: 2026-11-21. Branches: `main` (stable MVP) and `dev` (work, ahead of `main` with
the multi-language work below; merge only when the user asks).

## Status

The MVP is complete, and the editor now reads **tkz-euclide, plain TikZ and Asymptote**, converts
between tkz-euclide and Asymptote, and edits dragged points **in place**. A GeoGebra-style tool row creates objects by clicking.
There are 244 tests and
strict `tsc` is clean.

| Milestone | Contents | State |
|---|---|---|
| M1–M5 | MVP: parser, graph, geometry, codegen, SVG canvas, drag, CodeMirror, hover, export, examples | ✅ |
| Extra | `tests/latex.test.ts`: ~480 random constructions vs real pdflatex + tkz-euclide 5.06c (worst 0.0028 cm) | ✅ |
| M6 | More tkz-euclide: polar points, reflection/symmetry/homothety/rotation/translation, `\tkzDefShiftPoint`, tangent, `\tkzDefMidArc`, `[ex]`/`[euler]`, centre shortcuts, `common=`/`near`, `\tkzGetFirst/SecondPoint`, more drawing commands, marks, styles/colours | ✅ |
| M7 | Plain TikZ: `\coordinate`, `\draw`/`\fill` paths, `\node`, `\pic` angles, `\definecolor`, calc, simple `\foreach`, GeoGebra exports | ✅ |
| M8 | Asymptote (olympiad/geometry): symbolic front end, Asymptote's intersection order, pens, cse5 helpers, GeoGebra exports | ✅ |
| M9 | Conversion tkz-euclide ⇄ Asymptote, in-place drag, language picker, Asymptote highlighting | ✅ |
| Extra | `tests/asymptote.test.ts`: random figures + conversions vs real Asymptote 2.87. `tests/corpus.test.ts`: real figures vs both programs | ✅ |
| M10 | GeoGebra-style construction tools (21 tools, second toolbar row), Undo/Redo buttons, Esc to cancel; code written in the current language | ✅ |

**Real-world check:** all 90 diagram files of
[Geometry-Everyday-Project](https://github.com/azzam2912/Geometry-Everyday-Project) (34 Asymptote,
56 TikZ/tkz-euclide, commit c951c73) load without errors. Every named point agrees with real
`asy` (≤ 1e-13) or pdflatex (≤ 0.01 cm, TeX rounding), and every file converts to the other
language with all points within 1e-4. The converted code itself runs in real `asy` / pdflatex
with the same points. 15 of these files are fixtures in `tests/fixtures/corpus/`; run
`GEP_DIR=/path/to/checkout npm run test:corpus` for all of them.

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

**Optional cross-checks.** `tests/latex.test.ts` needs `pdflatex` + `tkz-euclide.sty`;
`tests/asymptote.test.ts` needs `asy` (`olympiad.asy` is in `tests/asy/`, because Debian doesn't
ship it). `tests/corpus.test.ts` uses whichever is there. Missing programs → those parts are skipped.

macOS (BasicTeX, then add the packages; Asymptote comes with MacTeX or `brew install asymptote`):
```bash
sudo tlmgr update --self && sudo tlmgr install tkz-euclide pgf standalone
```

Debian/Ubuntu:
```bash
sudo apt-get install --no-install-recommends texlive-latex-base texlive-latex-recommended texlive-pictures texlive-latex-extra asymptote
```

Windows: MiKTeX installs missing packages on first use; Asymptote has its own installer.

Check what you have:
```bash
kpsewhich tkz-euclide.sty && asy -version
```

⚠ Verified against **tkz-euclide 5.06c** (TeX Live 2023) and **Asymptote 2.87**. If a
cross-check fails on newer versions, real behaviour changed: update `src/geom/constructions.ts`,
`src/asy/` and `docs/assumptions.md` rather than the test.

Cloud sessions: a personal environment called **tikz-gebra** exists, with a setup script
that installs TeX Live and runs `npm ci`. It doesn't install `asymptote` yet; add
`apt-get install -y asymptote` to it if the Asymptote checks should run there.

## Where things are

| Path | What |
|---|---|
| `src/parser/` | `parser.ts` (tkz-euclide + plain TikZ, signature-driven, error recovery), `tikzpath.ts` (TikZ paths/coordinates/calc), `tokenizer.ts`, `ast.ts` (shared statement + construction types) |
| `src/asy/` | `parser.ts` (lexer + recursive descent), `front.ts` (Asymptote → statements: known calls → constructions, rest → `expr` steps; `asyRegion`), `expr.ts` (numeric evaluator), `pgf.ts` (pgfmath subset for TikZ) |
| `src/graph/` | `types.ts` (Graph, Step with `lit` spans, Drawing, `structure`), `build.ts` (checks + topological sort) |
| `src/geom/` | `constructions.ts` (all math, tkz + Asymptote ordering rules), `evaluate.ts`, `vec.ts` |
| `src/codegen/` | `codegen.ts` (tkz-euclide, `fullDocument`, `nameMap`), `asy.ts` (Asymptote, `fullAsyDocument`, `extractAsyBody`), `export.ts` |
| `src/style.ts` | TikZ/xcolor options and Asymptote pens ⇄ neutral `Style` |
| `src/ui/` | `tools.ts` (construction tools: picks → constructions → code), `ToolIcons.tsx`, `App.tsx`, `Editor.tsx` (language-aware highlighting), `Canvas.tsx`, pure helpers: `shapes.ts` (scene: styled shapes, labels, handles, TeX label text), `literal.ts` (in-place drag edits), `hover.ts`, `viewport.ts` |
| `src/pipeline.ts` | `detectLang`, `compile(src, lang)` |
| `tests/` | parser, parser-extra, asy, style-ui, geom, graph, roundtrip (+ conversion), export, ui-helpers, rounding, latex, asymptote, corpus |
| `examples/` | three tkz-euclide figures, a plain-TikZ figure, an Asymptote figure (`.asy`) |
| `docs/assumptions.md` | Verified semantics (tkz-euclide and Asymptote), open assumptions, design choices |

## Decisions to keep in mind

- **One model for all languages.** Every front end produces the same statements; the
  construction set is "tkz-euclide shaped". Asymptote pair expressions with no tkz-euclide
  counterpart become `expr` steps (numeric). Internal helper points have names starting with `~`
  (hidden unless they are free points with numbers in the code).
- **Intersection order is part of a construction** (`order`: `tkz`, `common`, `near`, `asy-y`,
  `asy-path1`, `asy-path2`; `seg` for Asymptote segments). Converting picks names/indices from
  the current positions so every point stays where it is; a later drag in the other language may
  swap them, as it would in that program.
- **Dragging rewrites numbers in place** (`Step.lit` spans; `ui/literal.ts`). Polar / `dir()`
  points keep their radius. Repeated numeric TikZ coordinates are one point.
- **Unknown commands are warnings**, not errors, so real files with one unsupported thing still
  draw. Errors inside supported commands remain errors and keep the last valid figure.
- **Using a point before defining it** is a warning; export reorders. Redefining a name is an
  error in tkz-euclide; in Asymptote a reassigned variable gets a new point (the old one is
  renamed internally).
- **Conversions keep 6 decimals** for free points; canonical codegen otherwise uses 2.
- **Diagnostics carry an optional `code`** (`'forward-ref'`, `'ignored'`). Don't match on text.

## Open items / possible next steps

0. **Tools:** no delete tool yet (use Undo); no "point on object" (a click on an object with
   the point tool makes a free point there); new points are labelled `above right` / `NE`.

1. **GitHub housekeeping (needs you):** set the repo's default branch to `main`
   (Settings → General → Default branch). After that, the old branch
   `claude/practical-feynman-f0m445` can be deleted.
2. **Arcs** (`\tkzDrawArc`, TikZ `arc`, Asymptote `arc`) are skipped with a warning. They are
   the most common remaining unsupported drawing (GeoGebra angle markers).
3. **Asymptote:** `point(path, t)`, `relpoint`, user functions and loops (skipped now).
   `tests/asymptote.test.ts` is where any new function must be verified.
4. **Labels** are plain text (subscripts, primes, a few symbols), not KaTeX.
5. **Bundle size:** CodeMirror makes one chunk > 500 kB (the nagori integration lazy-loads it).
6. **nagori-simulation** vendors this engine (`frontend/src/vendor/tikzgebra/`, refreshed with
   `frontend/scripts/sync-tikzgebra.sh`); its page is a port of `src/ui/App.tsx`. When the
   App's behaviour changes, port it there too.
