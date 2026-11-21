# TikZGeo

A bidirectional **geometry code ⇄ interactive figure** editor that runs entirely in the browser.
It reads three kinds of olympiad-style figure code:

- **tkz-euclide** (the main language),
- **plain TikZ** (`\coordinate`, `\draw`, `\node`, `\fill`, `\pic` … including GeoGebra exports),
- **Asymptote** with `olympiad.asy` / `geometry.asy` (AoPS style, including GeoGebra exports and
  Evan Chen's cse5 `Drawing` / `MP` helpers).

What it does:

- Write code on the left, and it renders live as an SVG figure on the right.
- Drag a **free point** and the dependent objects follow. Only the numbers of that point change
  in the code, **in place**: comments, formatting and every construction stay exactly as written.
  Points written as `(angle:r)`, `dir(angle)` or `r*dir(angle)` move along their circle.
- **Convert** a figure between tkz-euclide and Asymptote with one click. Constructions stay
  symbolic (`foot(C,A,B)` ⇄ `\tkzDefPointBy[projection=onto A--B](C)`, `2*I-A` ⇄
  `[symmetry=center I]`, …), and every point keeps its exact position.
- There's no LaTeX or Asymptote compiler involved. The preview comes from our own geometry
  engine, which follows tkz-euclide 5.06c and Asymptote 2.87 (see [`docs/assumptions.md`](docs/assumptions.md)).

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL (usually http://localhost:5173).

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the Vitest suite (parsers, geometry, graph, round trips, conversion, export,
real-world figures). Three parts compare with the real programs when they are installed and are
skipped otherwise:

| Test | Needs | Checks |
|---|---|---|
| `tests/latex.test.ts` (`npm run test:latex`) | `pdflatex` + `tkz-euclide.sty` | ~480 random constructions: every point matches LaTeX, intersection order included |
| `tests/asymptote.test.ts` (`npm run test:asy`) | `asy` | random Asymptote figures and tkz → Asymptote conversions match real Asymptote |
| `tests/corpus.test.ts` (`npm run test:corpus`) | either | real figures from Geometry-Everyday-Project load, convert, and match both programs |

Set `GEP_DIR=/path/to/Geometry-Everyday-Project` to run the corpus test on a whole checkout.
`npm run build` type-checks (strict) and produces a static build in `dist/`.

## Using it

| Action | How |
|---|---|
| Edit | Type in the editor. It re-parses after 150 ms. On an error the last valid figure stays visible and the error is underlined and listed (click a message to jump to it). Unknown commands are skipped with a warning, so the rest still draws. |
| Language | Detected automatically (`\begin{asy}`, `pair …;`, `draw(…)` → Asymptote). The menu forces one. |
| Move a point | Drag a **blue** (free) point. Grey free points have computed coordinates and can't be dragged. Derived points are smaller and dark; faded ones are not drawn as points by the figure itself. |
| Snap | Rounds dragged coordinates to a 0.5 grid (polar points: 5°). Otherwise 2 decimals. |
| Undo a drag | Ctrl+Z in the editor undoes a whole drag (and a conversion). |
| Pan / zoom | Drag on empty canvas / mouse wheel. "Fit view" re-centres the figure. |
| Hover | Hovering an object highlights its code, and hovering code highlights the object. |
| Convert | "Convert to Asymptote / tkz-euclide" rewrites the figure in the other language. |
| Export | **Copy code** copies the drawing code. **Copy full document** wraps it in a compilable `standalone` document (`asymptote` package for Asymptote). |

Examples are in [`examples/`](examples) and in the "Load example…" menu.

## Supported subset

### tkz-euclide

```latex
\tkzDefPoint(x,y){A}   \tkzDefPoint(angle:r){A}   \tkzDefPoints{x/y/A, x/y/B}   % free points
\tkzDefShiftPoint[A](x,y){B}        \tkzDefShiftPoint[A](angle:r){B}
\tkzDefMidPoint(A,B) \tkzGetPoint{M}
\tkzDefPointBy[projection=onto A--B](C) \tkzGetPoint{H}
\tkzDefPointBy[reflection=over A--B](C)            \tkzDefPointBy[symmetry=center I](C)
\tkzDefPointBy[homothety=center A ratio k](C)      \tkzDefPointBy[rotation=center A angle a](C)
\tkzDefPointBy[translation=from A to B](C)
\tkzDefLine[orthogonal=through C](A,B) \tkzGetPoint{c}      % also perpendicular=
\tkzDefLine[parallel=through C](A,B) \tkzGetPoint{c}
\tkzDefLine[tangent at=C](O) \tkzGetPoint{t}
\tkzDefMidArc(O,A,B) \tkzGetPoint{M}
\tkzInterLL(A,B)(C,D) \tkzGetPoint{P}
\tkzInterLC[common=X|near](A,B)(O,C) \tkzGetPoints{P}{Q}    % or \tkzGetFirstPoint / \tkzGetSecondPoint
\tkzInterCC[common=X](O,A)(O',B) \tkzGetPoints{P}{Q}
\tkzDefTriangleCenter[circum|in|ex|centroid|ortho|euler](A,B,C) \tkzGetPoint{O}
\tkzCircumCenter(A,B,C)  \tkzInCenter(A,B,C)  \tkzExCenter(A,B,C) …   \tkzGetPoint{O}
```

Drawing: `\tkzDrawSegment(s)`, `\tkzDrawLine(s)`, `\tkzDrawPolygon`, `\tkzDrawPolySeg`,
`\tkzDrawCircle(s)`, `\tkzFillPolygon`, `\tkzFillCircle`, `\tkzDrawPoint(s)`, `\tkzLabelPoint(s)`,
`\tkzMarkRightAngle`, `\tkzMarkAngle`, `\tkzMarkSegment(s)`. Options are kept verbatim; colours
(xcolor names, mixes like `green!60!black`, `\definecolor`), dashes, widths and fills are drawn.

### Plain TikZ

`\coordinate[label=…] (A) at (…);` with `(x,y)`, `(angle:r)`, `($(A)!t!(B)$)`, `($(A)!(P)!(B)$)`,
`($(A)+(x,y)$)` and `(intersection of A--B and C--D)`; `\draw`/`\fill`/`\filldraw`/`\path` with
`--`, `cycle`, `circle (r)`, `node {…}` and `+(…)`; `\node at (…) {…}`; `\pic {angle = A--B--C}`;
`\definecolor`; simple `\foreach \x in {A,B,C}`. Numeric coordinates that repeat (GeoGebra) are one
draggable point. Arcs, `.. controls ..`, `shift`ed paths and the like are skipped with a warning.

### Asymptote

`pair`/`point`/`real`/`line`/`circle`/`path`/`triangle`/`pen` variables (also arrays such as
`pair X[] = intersectionpoints(…)`), arithmetic on pairs, `dir`, `unit`, `abs`, `rotate`,
`reflect`, `shift`, `scale`, `interp`, `foot`, `extension`, `midpoint`, `incenter`,
`circumcenter`, `orthocenter`, `centroid`, `excenter`, `circumcircle`, `incircle`, `circle`,
`Circle`, `unitcircle`, `line`, `segment`, `perpendicular`, `parallel`, `intersectionpoint(s)`
(with Asymptote's own order of the points), `rightanglemark`, `anglemark`; `draw`, `filldraw`,
`fill`, `dot`, `label`, `Drawing`, `MP`. Loops and function definitions are skipped with a warning.

Pair expressions with no tkz-euclide counterpart (e.g. `A + unit(B-A)`) are evaluated
numerically; converting them to tkz-euclide writes a fixed point and says so.

## Architecture

```
code ──parse (tkz/TikZ or Asymptote)──▶ statements ──build──▶ Graph ──evaluate──▶ coords ──▶ SVG
  ▲                                                             │
  ├──── drag: rewrite the dragged point's numbers in place ─────┤
  └──── generate (tkz-euclide or Asymptote) ◀────────────────────┘   (convert, export)
```

| Folder | Role |
|---|---|
| `src/parser/` | tkz-euclide + plain TikZ parser (`parser.ts`, `tikzpath.ts`), shared statement types (`ast.ts`). Every statement keeps its source span; free points keep the spans of their numbers. |
| `src/asy/` | Asymptote lexer/parser, numeric evaluator (`expr.ts`) and the symbolic front end (`front.ts`) that maps it to the same statements. |
| `src/graph/` | Graph types; builder that checks duplicate names, undefined references and cycles, and sorts topologically. |
| `src/geom/` | Pure math (`constructions.ts`) and the evaluator. Degenerate cases give `null` (hidden), never NaN. |
| `src/codegen/` | Graph → tkz-euclide (`codegen.ts`) or Asymptote (`asy.ts`); body extraction for export. |
| `src/style.ts` | TikZ options / Asymptote pens → one neutral style (and back). |
| `src/ui/` | React: CodeMirror editor, SVG canvas, pure helpers (`shapes.ts`, `literal.ts`, `hover.ts`, …). |

Only free points (`op: 'free'`) carry coordinates. Every other node stores its operation
and its parent point names. Codegen never flattens a derived point into numbers (except an
Asymptote-only expression converted to tkz-euclide, which is reported).
