# TikZGeo

A bidirectional **tkz-euclide ⇄ interactive geometry** editor that runs entirely in the browser.

- Write tkz-euclide code on the left, and it renders live as an SVG figure on the right.
- Drag a **free point** and the dependent objects follow. The code regenerates
  **symbolically**: `\tkzInterLL`, `\tkzDefMidPoint` and the other constructions stay as
  they are, and only free points carry numbers.
- There's no LaTeX compiler involved. The preview comes from our own geometry engine,
  which follows tkz-euclide 5.06c's conventions (see [`docs/assumptions.md`](docs/assumptions.md)).

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

`npm test` runs the Vitest suite (parser, geometry, graph, round-trip, export). If
`pdflatex` and tkz-euclide are installed, it also runs `tests/latex.test.ts`, which
compiles about 300 constructions with real LaTeX and checks that the preview's
coordinates match (`npm run test:latex` runs only that part). Without LaTeX that test
is skipped. `npm run build`
type-checks (strict) and produces a static build in `dist/`.

## Using it

| Action | How |
|---|---|
| Edit | Type in the editor. It re-parses after 150 ms. On an error the last valid figure stays visible and the error is underlined and listed (click a message to jump to it). |
| Move a point | Drag a **blue** (free) point. Derived points are smaller and dark. Faded points exist but aren't listed in `\tkzDrawPoints`, so LaTeX won't draw them. |
| Snap | Tick "Snap to 0.5" to round dragged coordinates to a 0.5 grid. Otherwise they're rounded to 2 decimals. |
| Undo a drag | Ctrl+Z in the editor undoes a whole drag, and brings back your original formatting and comments. |
| Pan / zoom | Drag on empty canvas / mouse wheel. "Fit view" re-centres the figure. |
| Hover | Hovering an object highlights its code, and hovering code highlights the object. |
| Export | **Copy code** copies the tkz-euclide body. **Copy full document** wraps it in a compilable `standalone` document. |

> Dragging regenerates the code in canonical form: definitions in dependency order, then
> drawings, then labels. Comments and custom formatting are dropped. The UI says so too.

Examples are in [`examples/`](examples) and in the "Load example…" menu.

## Supported tkz-euclide subset

Definitions:

```latex
\tkzDefPoint(x,y){A}            \tkzDefPoints{x/y/A, x/y/B}          % free points
\tkzDefMidPoint(A,B) \tkzGetPoint{M}
\tkzDefPointBy[projection=onto A--B](C) \tkzGetPoint{H}
\tkzDefLine[orthogonal=through C](A,B) \tkzGetPoint{c}               % c = C + rot90(B-A)
\tkzDefLine[parallel=through C](A,B) \tkzGetPoint{c}                 % c = C + (B-A)
\tkzInterLL(A,B)(C,D) \tkzGetPoint{P}
\tkzInterLC(A,B)(O,C) \tkzGetPoints{P}{Q}
\tkzInterCC(O,A)(O',B) \tkzGetPoints{P}{Q}
\tkzDefTriangleCenter[circum|in|centroid|ortho](A,B,C) \tkzGetPoint{O}
```

Drawing:

```latex
\tkzDrawSegment(A,B)   \tkzDrawSegments(A,B B,C)   \tkzDrawLine(A,B)
\tkzDrawPolygon(A,B,C) \tkzDrawCircle(O,A)          \tkzDrawPoints(A,B,C)
\tkzLabelPoints[above right](A,B)
```

The `\documentclass`, `\usepackage`, `document` and `tikzpicture` wrappers are accepted
and ignored, so a whole document can be pasted in. Any other command is reported as an
error with its line number. See [`docs/assumptions.md`](docs/assumptions.md) for the exact
semantics (including the order of the two intersection points) and for the choices made
where tkz-euclide's behaviour is unclear.

## Architecture

```
code text ──parse──▶ AST ──build──▶ Construction Graph ──evaluate──▶ coordinates ──▶ SVG
    ▲                                       │
    └──────────────── generate ◀────────────┘   (drag edits the graph's free points)
```

| Folder | Role |
|---|---|
| `src/parser/` | Hand-written tokenizer + parser (`ast.ts`, `tokenizer.ts`, `parser.ts`). No macro expansion. Every statement keeps its source span. |
| `src/graph/` | Graph types; builder that checks duplicate names, undefined references and cycles, and sorts topologically. |
| `src/geom/` | Pure math (`constructions.ts`) and the evaluator. Degenerate cases give `null` (hidden), never NaN. |
| `src/codegen/` | Graph → canonical tkz-euclide code; body extraction for export. |
| `src/ui/` | React: CodeMirror editor, SVG canvas (pan/zoom/drag), hover linking. |

Only free points (`op: 'free'`) carry coordinates. Every other node stores its operation
and its parent point names. Codegen never flattens a derived point into numbers.
