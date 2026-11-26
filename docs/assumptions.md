# Assumptions and verified semantics

**Reference version:** tkz-euclide **5.06c (2024/02/04)**, read from the TeX Live 2023
package `texlive-pictures` (the `.sty`/`.tex` sources) and `texlive-pictures-doc`
(the manual's LaTeX sources and PDF). CTAN itself was not reachable from the build
environment. Newer releases (5.1x) could differ in the details below; if you use one,
please re-check the items marked ⚠.

The source files that were read are named in each section, so every claim can be
checked again.

**Confirmed with real LaTeX.** `tests/latex.test.ts` compiles one document with
pdflatex + tkz-euclide 5.06c. It contains the examples and about 480 seeded
random configurations covering every supported construction. The test reads every
point back with `\tkzGetPointCoord` and compares it with the preview engine. All of
them agree, including the order of the two intersection points. The worst deviation
is ≈ 0.003 cm, which comes from TeX's fixed-point arithmetic. A deliberately swapped
`\tkzInterCC` order makes the test fail, so the check is real. The test is skipped
when `pdflatex` / `tkz-euclide.sty` are not installed.

## Verified against the source code

### `\tkzInterLC(A,B)(O,C) \tkzGetPoints{P}{Q}` — order of the two points
Source: `tkz-tools-eu-intersections.tex`, `\tkz@InterLC`, `\tkzInterLCR`, plus
`tkz-tools-eu-angles.tex`, `\tkzFindAngle`.

With no options, tkz-euclide computes two candidates and then calls
`\tkzFindAngle(Second, First, O)`. That is the counter-clockwise angle at First, from
the ray First→Second to the ray First→O. If the angle is ≥ 180° it swaps the points.
So:

> **The first point F is the one for which the centre O lies to the left of the
> directed segment F→S.**
> Equivalently: if O is left of A→B, F is the first point met when travelling from
> A towards B. If O is right of A→B, F is the last point met.

This matches the manual's figure in §18.2.2: with La=(−2,4), Lb=(5,0), O=(1,1), D is
the point near Lb. There's a unit test for it.

⚠ **Line through the centre.** `\tkzInterLCR` sets Second = O + r·û (û = unit vector
of B−A) and First = O − r·û. The angle test that follows is then ≈ 0° or ≈ 360°,
depending on rounding, and the manual says that "you cannot compare the angles" in
this case and recommends the `near` option. We use **F = O − r·û** (no swap). With
pdflatex this matched in all four configurations tested (horizontal, reversed,
diagonal, steep), but because it depends on rounding inside TeX, other inputs could
still come out swapped. We use tkz-euclide's own threshold for "through the centre"
(distance < 0.05 pt ≈ 0.00176 cm).

### `\tkzInterCC(O1,A)(O2,B) \tkzGetPoints{P}{Q}` — order of the two points
Source: `\tkz@InterCC`, `\tkzInterCCR`.

`\tkzInterCCR` places the first point at `mid + h·rot90(O2−O1)/d`, which is on the
left of O1→O2. The follow-up test `\tkzFindAngle(O1, First, O2) < 180°` confirms the
same rule. So:

> **The first point lies to the left of the directed line O1→O2.**

This matches the manual's figures in §18.3.3: D (first) is the upper point for O=(0,0)
and B=(2,2). It also matches the §18.3 example where A=(1,1) and B=(5,1) give C (the
first point) above the line.

The manual's own wording ("the point that forms the clockwise angle") is ambiguous.
The code is what we follow.

### Undefined (degenerate) cases
| Construction | What LaTeX does | What the preview does |
|---|---|---|
| `\tkzInterLL`, parallel or identical lines | division by ~0 → TeX error or garbage | point is undefined and hidden |
| `\tkzInterLC`, no intersection | `acos` of a value > 1 → TeX error | both points undefined |
| `\tkzInterCC`, no intersection | ⚠ takes `sqrt(abs(…))` and **silently** produces two bogus points | both points undefined |
| `\tkzInterCC`, concentric circles | division by 0 | undefined |
| triangle centres of collinear points | division by ~0 | undefined (centroid is still defined) |
| projection, orthogonal or parallel with A = B | meaningless (direction 0) | undefined |

Anything that depends on an undefined point is also undefined, and drawings that
reference one are hidden.

Tangent configurations (within a relative tolerance of 1e-9) give a double point: P = Q.

### `\tkzDefLine[orthogonal=through C](A,B) \tkzGetPoint{c}`
Source: `tkz-obj-eu-lines.tex` (`\tkzDefOrthLine`) and `tkz-obj-eu-points-with.tex`
(`\tkz@VecKOrth`, `\tkz@VecKCoLinear`). With the default `K=1`:
**c = C + rot90°ccw(B − A)**, i.e. c = C + (−(yB−yA), xB−xA). `perpendicular=through`
is an alias. `normed` and `K=` are not supported.

### `\tkzDefLine[parallel=through C](A,B) \tkzGetPoint{c}`
Source: `\tkz@DefLineLL`. **c = C + (B − A)**.

### `\tkzDefPointBy[projection=onto A--B](C) \tkzGetPoint{H}`
Orthogonal projection of C onto line AB. The key syntax `projection/.code args={onto #1--#2}`
comes from `tkz-obj-eu-points-by.tex`.

### `\tkzDefTriangleCenter[...](A,B,C) \tkzGetPoint{X}`
Source: `tkz-obj-eu-points-spc.tex`. The keys `circum`, `in`, `centroid` and `ortho`
exist. **The default key is `circum`**, so `\tkzDefTriangleCenter(A,B,C)` with no
option is accepted as a circumcentre. Regenerated code always writes the option
explicitly.

### `\tkzDefPoints{x/y/A, ...}`
Implemented as `\foreach \ptx/\pty/\name in {#2}` over `\tkzDefPoint`. Comments inside
the braces are allowed.

### Drawing commands
| Command | Source | Preview |
|---|---|---|
| `\tkzDrawSegment(A,B)` | `\draw[line style, add=0 and 0]` | segment AB |
| `\tkzDrawSegments(A,B B,C)` | pairs split on **spaces** (`\tkz@multiDrawSeg#1 #2\@nil`) | so `(A, B)` is a syntax error, as in LaTeX |
| `\tkzDrawLine(A,B)` | `line style` has `add = .2 and .2` | **finite**: extends 20 % of \|AB\| beyond A and B, like LaTeX |
| `\tkzDrawPolygon(A,B,C,…)` | closed path | closed polygon |
| `\tkzDrawCircle(O,A)` | `circle through=(A)` at O | centre O, radius \|OA\| |
| `\tkzDrawPoints(A,B,…)` | `\foreach` over names | dots |
| `\tkzLabelPoints[pos](A,B,…)` | `label style` default anchor is **`below`** | label `$A$` placed by `pos` |

### Whitespace rules (match TeX's delimited arguments)
Commands such as `\tkz@InterLL(#1,#2)(#3,#4)` use `)(` and `](` as delimiters, so a
space between `)` and `(` or between `]` and `(` breaks the command in LaTeX. The
parser reports these as errors. Whitespace before the first argument and before `{…}`
arguments is allowed, because TeX skips it there.

## Choices made for the MVP (not taken from tkz-euclide)
- **Redefining a point name** (allowed in TeX, where the last definition wins) is an
  error, because a name has to identify one graph node.
- **Using a point before it is defined** is a *warning*, not an error. LaTeX would fail
  on it, but the graph is order-independent and the regenerated code puts definitions
  in dependency order. Real cycles are errors.
- `\tkzGetPoint{..}` / `\tkzGetPoints{..}{..}` / `\tkzGetFirstPoint{..}` /
  `\tkzGetSecondPoint{..}` must **directly** follow their defining command (only whitespace
  and comments in between). The point that isn't named gets an internal name (`~n`). The
  options `R` and `with nodes` are not supported.
- **Only numeric literals** are accepted in `\tkzDefPoint`: `(x,y)` or polar `(angle:r)`, no
  expressions. Plain TikZ coordinates and radii also accept simple pgfmath (`{sqrt(13)/2}`),
  but such numbers can't be rewritten by a drag.
- **Point names** may use letters, digits, `_` and `'`.
- **Options on drawing commands** are kept verbatim so they survive regeneration. Colour,
  dash, line width, fill and the label position are drawn; other keys are ignored.
- **Recognised and ignored:** `\documentclass`, `\usepackage`, `\usetikzlibrary`,
  `\tikzset`, `\tkzInit`/`\tkzClip`/`\tkzSetUp…`, `\clip`, size commands, and environments
  such as `document`, `tikzpicture`, `center`, `scope`, `scriptsize`. `rotate`/`shift`/`xscale`
  options on `tikzpicture`/`scope` give a warning (a uniform `scale` doesn't change the figure).
  **Unknown commands are skipped with a warning** (code `ignored`), so a file with one
  unsupported command still draws. Errors inside supported commands are still errors.
- **Dragging** rewrites only the dragged point's numbers where they are written (2 decimals,
  0.5 when snapping; polar points keep their radius and get a new angle, 0.01° or 5°).
  Comments and formatting stay. A numeric TikZ coordinate written several times (GeoGebra)
  is one point; all its occurrences change together.
- **Canonical output** (export with forward references, conversion): definitions (topological
  order, one `\tkzDefPoint` per free point), a blank line, drawings in source order, a blank
  line, labels in source order. Comments and custom formatting are dropped. Coordinates are
  rounded to 2 decimals; conversions keep up to 6 decimals.

## Added after the MVP (verified against the sources and with real LaTeX)

All of these are part of the random cases in `tests/latex.test.ts`.

| Command | Source | Semantics |
|---|---|---|
| `\tkzDefPoint(a:r){A}` | TikZ polar coordinate | (r cos a, r sin a), degrees |
| `[reflection=over A--B](P)` | `tkz-obj-eu-points-by.tex`, `\tkzUSymOrth` | mirror image of P in line AB |
| `[symmetry=center C](P)` | `\tkzUCSym` | 2C − P |
| `[homothety=center C ratio k](P)` | `\tkzUHomo`, ratio via `\pgfmathparse` | C + k(P − C); we accept a number or a fraction a/b |
| `[rotation=center C angle a](P)` | `\tkzURotateAngle` | counter-clockwise by a degrees |
| `[translation=from A to B](P)` | `\tkzUTranslation` | P + B − A |
| `\tkzDefShiftPoint[A](x,y){B}` | `\path[shift={(A)}] (x,y)` | A + (x, y); also `(angle:r)` |
| `\tkzDefLine[tangent at=C](O)` | `\tkzTgtAt` → `\tkz@VecKOrthNorm[-1](C,O)` | **C − rot90°ccw((O − C)/\|OC\|)**: 1 cm from C |
| `\tkzDefMidArc(O,A,B)` | `tkz-draw-eu-angles.tex` | middle of the arc of radius \|OA\| from slope(O,A) to slope(O,B) after `\tkzNormalizeAngle` (if the first angle is > 0 and larger, subtract 360 from it; otherwise, if it is larger, add 360 to the second) |
| `[ex](A,B,C)`, `\tkzExCenter(A,B,C)` | `\tkzExCenter(#1,#2,#3)` intersects the external bisectors at #1 and #3 | centre of the excircle **opposite the middle vertex B** |
| `[euler](A,B,C)` | `\tkzEulerCenter` | nine-point centre = midpoint of O and H |
| `\tkzCircumCenter`, `\tkzDefCircumCenter`, `\tkzInCenter`, `\tkzDefInCenter`, `\tkzOrthoCenter`, `\tkzCentroid` | `\let` aliases | same as the matching `\tkzDefTriangleCenter` |
| `\tkzInterLC[common=X]`, `\tkzInterCC[common=X]` | `tkz-tools-eu-intersections.tex` | after the usual computation, the points are swapped unless the second is within 1 pt (LC) / 0.05 pt (CC) of X: **the second point is X, the first the other one** |
| `\tkzInterLC[near](A,B)(O,C)` | same file | the first point is the one nearer to A |
| `\tkzDefPointOnLine[pos=t](A,B)` | `tkz-obj-eu-points-spc.tex`: `\path (A) to [pos=t] coordinate (tkzPointResult) (B)` | A + t(B − A); t outside 0..1 extends the line (checked with pdflatex for t = −0.4, 1.7 and random t in −1..2) |

Drawings added for the tools and the properties panel (no points to compare; `tests/latex.test.ts`
compiles them and checks the log has no errors):

| Command | Source | Semantics |
|---|---|---|
| `\tkzDrawArc(O,A)(B)` | `tkz-draw-eu-angles.tex`, `\tkz@DrawArcN` (the default `towards` type) | radius \|OA\|, from slope(O,A) to slope(O,B) after `\tkzNormalizeAngle`, counter-clockwise. Other types (`rotate`, `angles`, `R`, `R with nodes`) stay a warning. `delta` is ignored by the preview. |
| `\tkzDrawSemiCircle(O,A)` | `tkz-draw-eu-circles.tex` | `\tkzDrawArc(O,A)(A')` with A' = 2O − A: the half counter-clockwise from A |
| `\tkzDrawSector(O,A)(B)`, `\tkzFillSector` | `tkz-draw-eu-sectors.tex`, `towards` | O, then the arc above, closed |
| `\tkzLabelAngle[dist=d](A,B,C){text}` | `tkz-draw-eu-angles.tex` | node at B + d·(direction of the bisector of the normalised angle from BA to BC), d = 1 by default. The older key `pos=` is read as `dist=`. |
| `\tkzMarkSegment[mark=…]` | `tkz-draw-eu-lines.tex`: default `mark=\|`; `tkz-lib-eu-marks.tex` defines `\|\|`, `\|\|\|`, `s\|`… | the preview draws the number of bars; `mark=none` draws nothing |
| `\tkzMarkAngle[arc=ll]` | `/tkzmkangle` keys, `arc=l\|ll\|lll` | 1–3 concentric arcs |

Asymptote counterparts written by the converter: `interp(A, B, t)` for `\tkzDefPointOnLine`,
`arc(O, A, B)` (plain.asy: counter-clockwise from the direction of A to that of B, radius
\|OA\|), `arc(O, A, 2*O - A)` for a semicircle, `O--arc(O, A, B)--cycle` for a sector, and for an
angle label `label(…, B + d*dir(degrees(A - B) + ((degrees(C - B) - degrees(A - B)) % 360)/2))`
(`degrees(pair)` is in [0, 360) and `x % y` takes the sign of y, both checked in `asy`). The front
end reads `arc(c, A, B[, CCW])` and `arc(c, r, a1, a2)`; clockwise arcs are a warning.

Plain TikZ: `($(A)!t!(B)$)` is the homothety of B with centre A and ratio t, `($(A)!(P)!(B)$)`
the projection of P on AB. A `circle (r)` is drawn through a helper point r to the right of the
centre. `\fill (A) circle (≤ 0.1cm)` is a dot, not a circle.

## Asymptote (verified with real Asymptote 2.87)

`tests/asymptote.test.ts` runs random figures and converted figures through `asy` (with
`olympiad.asy` from `tests/asy/`) and compares every named point. `tests/corpus.test.ts` does the
same for real figures. Read from `/usr/share/asymptote/geometry.asy`, `plain_pens.asy` and
`olympiad.asy`:

- **Which `circumcircle`.** With pair arguments, olympiad's `circumcircle(A,B,C)` / `incircle`
  return a *path*; `circumcircle(triangle)`, `circle(A,B,C)` and `circle((point)O, r)` are
  geometry *circle* objects; `circle(pair, r)` and `Circle(…)` are paths. If a file imports
  `geometry` but not `olympiad`, `circumcircle(A,B,C)` is geometry's circle. With no import at
  all we assume olympiad (AoPS snippets); ⚠ the user's own `asydef` may differ.
- **Order of `intersectionpoints`** (measured on random configurations, then cross-checked):
  - geometry `line`/`circle` objects (line–circle, circle–circle): the quadratic is solved
    in y, so the points come by **ascending y** (ascending x for a horizontal line; for two
    circles the line is their radical axis);
  - with a path involved: by **time along the first path**. Circle paths start at angle 0
    and run counter-clockwise; a segment `A--B` runs from A to B;
  - `intersectionpoints(line, path)` orders by the path; `intersectionpoints(path, line)` does
    not exist in Asymptote;
  - **segments** (`A--B`, `segment(A,B)`) only keep intersection points that lie on them, so
    `X[0]` may be the only point.
- `excenter(A,B,C)` (geometry) is the centre of the excircle tangent to (AB), i.e. opposite C;
  `excenter(t.BC)` is opposite A.
- `perpendicular(M, line l)` is the line through M perpendicular to l.
- `rightanglemark(A,B,C,s)` / `anglemark(A,B,C,t)`: size `s·markscalefactor` (default
  8 · 0.03) in user units. The preview uses 0.24 units.
- Named pens are taken from `plain_pens.asy` exactly (Asymptote's `purple` is (0.5,0,1), not
  xcolor's). Pen variables are resolved by name.
- `Drawing("A", P, dir)` / `MP("A", P, dir)` follow Evan Chen's cse5 definitions in `azzam.sty`
  (dot + label `$A$`, default direction S).
- Expressions that aren't a known construction become `expr` steps, evaluated with our
  numeric evaluator (`src/asy/expr.ts`): complex products of pairs, transforms, `dir`, `unit`,
  `abs`, trigonometry in radians (`sin`) or degrees (`Sin`).
- Not supported: loops, `if`, function definitions (skipped with a warning), `point(path,t)`,
  arcs, `?:`. A failed `draw`/`dot`/`label` is skipped with a warning; a failed definition is
  an error.
