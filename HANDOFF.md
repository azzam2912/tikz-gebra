# Handoff — TikZGeo

Last updated: 2026-11-26. Branches: `main` (stable MVP) and `dev` (work, ahead of `main` with
the multi-language work below; merge only when the user asks).

## Status

The MVP is complete, and the editor now reads **tkz-euclide, plain TikZ and Asymptote**, converts
between tkz-euclide and Asymptote, and edits dragged points **in place**. A GeoGebra-style tool row creates objects by clicking,
points can sit **on objects** (gliders) or at **crossings**, and a **properties panel** restyles objects in place.
There are 282 tests and strict `tsc` is clean.

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
| M11 | Points on objects and crossings, properties panel, tangent / arc / semicircle / sector / rotate / dilate / translate tools (see below) | ✅ |

### M11 in short (2026-11-26)

- **Gliders.** With a point input, a click on a segment / line / side makes
  `\tkzDefPointOnLine[pos=t](A,B)` (Asymptote `interp(A, B, t)`), a click on a circle or arc makes
  `\tkzDefPointBy[rotation=center O angle a](T)` (Asymptote `rotate(a, O)*T`), T = the circle's
  through point. Such points are teal and draggable: the drag rewrites only t / the angle / a
  homothety ratio (`Literal` kind `param`, `ui/literal.ts` `paramEdits`). On a segment or polygon
  side (and no drawn line AB) t stays in 0..1. Any `homothety`/`rotation` written with a plain
  number in the user's code is draggable the same way.
- **Crossings.** `tools.ts` `crossings()` lists where two drawn curves meet (segments, lines,
  polygon sides, circles, arcs; not at an existing point). While a tool waits for a point they show
  as small × marks; a click within 10 px makes `\tkzInterLL/LC/CC` (the other point of a pair gets
  an internal name → `\tkzGetFirstPoint` / `\tkzGetSecondPoint`). Shift+click puts a glider on
  the clicked object instead.
- **Properties panel** (`ui/PropsPanel.tsx`, logic in `ui/props.ts`): in Move mode a click on an
  object or point opens it. Colour, line width, line style, fill + opacity (closed shapes, tkz only),
  equal marks on the clicked side (adds/edits/removes `\tkzMarkSegment[mark=||]`), angle marks
  (`arc=ll`, `size=`, a `\tkzLabelAngle`), label position of a point (splits it out of a
  `\tkzLabelPoints` list). Edits change the `[options]` key by key (unknown keys stay) through
  `DrawStatement.opt` spans; Asymptote edits the pen argument of `draw`/`fill` and the direction
  of `dot`/`label`. The panel takes a `text` prop so nagori can translate it.
- **New tools:** tangent (at a point on the circle, or the two from a point outside, built as
  midpoint + `\tkzInterCC`), arc, semicircle (on a diameter), sector, rotate (angle), dilate
  (factor), translate (vector). Rotate/dilate/translate/reflect accept a point or a whole object
  (segment, polygon, circle, arc, marks); the images of the user's points are named `A_1`, `B_1`…
  A reflection swaps the ends of arcs and angle marks so they keep their side.
- **Engine:** `onLine` construction; drawings `tkzDrawArc`, `tkzDrawSemiCircle`, `tkzDrawSector`,
  `tkzFillSector`, `tkzLabelAngle` (parse, render, tkz + Asymptote codegen, Asymptote front end);
  multi-bar segment marks and multi-arc angle marks are drawn; `%` in Asymptote expressions.

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

0. **Tools:** no delete tool yet (use Undo); new points are labelled `above right` / `NE`.
   Not done from the Studio-TikZ comparison: common tangents of two circles, the circle by
   three conditions (Apollonius), polar/pole, inversion, regular polygon, free text labels,
   clipping, several sheets / save to a file / `.ggb` import, AoPS export, dark theme.

1. **GitHub housekeeping (needs you):** set the repo's default branch to `main`
   (Settings → General → Default branch). After that, the old branch
   `claude/practical-feynman-f0m445` can be deleted.
2. **Arcs:** `\tkzDrawArc(O,A)(B)` (towards), `\tkzDrawSemiCircle`, `\tkzDrawSector` and Asymptote
   `arc(…)` are drawn; the other `\tkzDrawArc` types and plain TikZ `arc` are still a warning.
   Properties panel gaps: fills in Asymptote, Asymptote segment/angle marks, and point colours.
   Selecting a drawing keeps it by command + points, so it survives edits.
3. **Asymptote:** `point(path, t)`, `relpoint`, user functions and loops (skipped now).
   `tests/asymptote.test.ts` is where any new function must be verified.
4. **Labels** are plain text (subscripts, primes, a few symbols), not KaTeX.
5. **Bundle size:** CodeMirror makes one chunk > 500 kB (the nagori integration lazy-loads it).
6. **nagori-simulation** vendors this engine (`frontend/src/vendor/tikzgebra/`, refreshed with
   `frontend/scripts/sync-tikzgebra.sh`); its page is a port of `src/ui/App.tsx`. When the
   App's behaviour changes, port it there too.
