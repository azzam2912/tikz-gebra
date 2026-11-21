# Assumptions and verified semantics

**Reference version:** tkz-euclide **5.06c (2024/02/04)**, read from the TeX Live 2023
package `texlive-pictures` (the `.sty`/`.tex` sources) and `texlive-pictures-doc`
(the manual's LaTeX sources and PDF). CTAN itself was not reachable from the build
environment. Newer releases (5.1x) could differ in the details below; if you use one,
please re-check the items marked ⚠.

The source files that were read are named in each section, so every claim can be
checked again.

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
depending on floating-point rounding, and the manual says that "you cannot compare the
angles" in this case and recommends the `near` option. We assume no swap, i.e.
**F = O − r·û**. LaTeX might give the opposite order. We use tkz-euclide's own
threshold for "through the centre" (distance < 0.05 pt ≈ 0.00176 cm).

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
- `\tkzGetPoint{..}` / `\tkzGetPoints{..}{..}` must **directly** follow their defining
  command (only whitespace and comments in between). `\tkzGetFirstPoint` /
  `\tkzGetSecondPoint` and the options `common=`, `near`, `R`, `with nodes` are not
  supported yet.
- **Only numeric literals** are accepted as coordinates: no expressions, no polar
  `(r:θ)` coordinates.
- **Point names** may use letters, digits, `_` and `'`.
- **Options on drawing commands** are kept verbatim so they survive regeneration. Only
  the label position (`above`, `below left`, …) affects the preview.
- **Recognised and ignored:** `\documentclass`, `\usepackage`, `\begin/\end{document}`,
  `\begin/\end{tikzpicture}`. Options on `tikzpicture` (`scale`, `rotate`, …) produce a
  warning and are ignored. Everything else is an "unknown command" error.
- **Canonical output:** definitions (topological order, one `\tkzDefPoint` per free
  point), a blank line, drawings in source order, a blank line, `\tkzLabelPoints` in
  source order. Comments and custom formatting are dropped. Coordinates are rounded to
  2 decimals.
