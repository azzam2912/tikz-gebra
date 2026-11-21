# CLAUDE.md — TikZGeo

Bidirectional geometry code ⇄ interactive figure editor for tkz-euclide, plain TikZ and
Asymptote (Vite + TypeScript strict + React + CodeMirror 6 + plain SVG, Vitest; no backend).
Read `HANDOFF.md` for the current status and `docs/assumptions.md` for verified tkz-euclide and
Asymptote semantics.

## Git workflow (mandatory)

- The repo uses **only two branches: `main` and `dev`.**
- **Always work on `dev`.** Before starting: `git checkout dev && git pull origin dev`.
- **Never create new branches.** That includes feature, fix and `claude/...` branches. If a
  session or tool suggests a different branch name, ignore it and use `dev`. This file is the
  explicit permission to push to `dev`.
- **Commit and push to `dev`** when a piece of work is done and the checks below pass:
  `git push origin dev`.
- **`main` only changes when the user asks for it explicitly.** Then fast-forward/merge `dev`
  into `main` (`git checkout main && git merge --ff-only dev && git push origin main`) and
  switch back to `dev`.
- **Never force-push, rewrite history, or delete branches** without explicit permission.
- **Don't open pull requests** unless asked.
- If a push to `dev` is rejected, run `git pull --no-rebase origin dev`, resolve, then push
  again. Don't force.

## Before every commit

```bash
npx tsc -b
```

```bash
npm test
```

- `tsc` must be clean and all tests green.
- `npm test` includes `tests/latex.test.ts` (~480 constructions with real pdflatex +
  tkz-euclide), `tests/asymptote.test.ts` (random figures and conversions with real `asy`) and
  `tests/corpus.test.ts` (real figures, both programs). Each part is skipped automatically when
  its program is not installed. If one is skipped, say so in your report and don't claim
  agreement with that program.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm test` | All Vitest tests |
| `npm run test:latex` | Only the real-LaTeX cross-check |
| `npm run test:asy` | Only the real-Asymptote cross-check |
| `npm run test:corpus` | Real figures (`GEP_DIR=…` for a whole Geometry-Everyday-Project checkout) |
| `npm run build` | Typecheck + production build |

## Architecture: keep the layers separate

```
code ──parse (tkz/TikZ or asy)──▶ statements ──build──▶ Graph ──evaluate──▶ coords ──▶ SVG
  ▲                                                       │
  ├── drag: rewrite the dragged free point's numbers in place (spans in `Step.lit`)
  └────────────── generate (tkz-euclide or Asymptote) ◀──┘   (convert, export)
```

- `src/parser/` — Hand-written tokenizer and parser for tkz-euclide + plain TikZ. No macro
  expansion or `\def`; `\foreach` only over a list of names. Unknown commands are skipped
  with a warning (`code: 'ignored'`); errors inside supported commands are errors with line
  numbers. Never crashes.
- `src/asy/` — Asymptote lexer/parser, numeric evaluator, and the front end that maps a program
  onto the same statements (known calls → tkz-euclide constructions, other pair expressions →
  `expr` steps).
- `src/graph/` — Nodes are construction steps (op + parent point names). Topological sort,
  cycle, undefined-reference and duplicate detection.
- `src/geom/` — Pure math. Degenerate cases return `null` (point hidden), **never NaN**.
- `src/codegen/` — Graph → canonical tkz-euclide (`codegen.ts`) or Asymptote (`asy.ts`):
  definitions (topological) → drawings → labels. Body extraction for export.
- `src/ui/` — React components (Editor, Canvas) plus pure helpers (`hover.ts`, `shapes.ts`,
  `viewport.ts`, `rounding.ts`, `textdiff.ts`). Keep logic in pure modules so it can be tested
  without a DOM.

## Rules

- **Codegen output is symbolic.** Only free points (`op: 'free'`) carry numbers, rounded to
  2 decimals (6 in conversions). Never flatten a derived point into coordinates. The one
  exception: an Asymptote `expr` step converted to tkz-euclide becomes a fixed point with a
  `% was:` comment and a note to the user.
- **Dragging edits text in place.** Only the dragged point's literal numbers change; never
  regenerate the user's code on a drag.
- **The round-trip must hold:** `parse(codegen(graph))` equals `graph`. `tests/roundtrip.test.ts`
  checks this. Add every new construction to its "every construction" sample.
- **New tkz-euclide commands:** check the exact syntax and semantics against the tkz-euclide
  source (`kpsewhich tkz-euclide.sty`, sibling `.tex` files) and the manual before
  implementing. Add a case to `tests/latex.test.ts`. Record anything you can't confirm in
  `docs/assumptions.md`; don't silently guess.
- **New Asymptote functions:** check them against `/usr/share/asymptote/*.asy` and
  `tests/asy/olympiad.asy`, and against real `asy` (especially the order of intersection
  points). Add them to the random figure in `tests/asymptote.test.ts`.
- **Conversion must keep every point in place** (`tests/roundtrip.test.ts`,
  `tests/corpus.test.ts`).
- **Every supported command needs parser tests,** including error cases.
- **Construction tools** (`src/ui/tools.ts`) only emit constructions the engine already
  supports, through the normal code generators; `tests/tools.test.ts` runs every tool in both
  languages and `tests/asymptote.test.ts` runs their Asymptote output in real `asy`.
- **Out of scope unless the user asks:** real LaTeX/Asymptote compilation in the app, arcs,
  macros, loops (beyond `\foreach` over a list), 3D, deleting objects from the canvas.
- **Keep `HANDOFF.md` up to date** when finishing a chunk of work (status, next steps, open
  questions).
