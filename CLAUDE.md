# CLAUDE.md — TikZGeo

Bidirectional tkz-euclide ⇄ interactive geometry editor (Vite + TypeScript strict + React +
CodeMirror 6 + plain SVG, Vitest; no backend). Read `HANDOFF.md` for the current status and
`docs/assumptions.md` for verified tkz-euclide semantics.

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
- `npm test` includes `tests/latex.test.ts`, which compiles ~300 constructions with real
  pdflatex + tkz-euclide and compares coordinates. It is skipped automatically when LaTeX is
  not installed. If it's skipped, say so in your report and don't claim LaTeX agreement.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm test` | All Vitest tests |
| `npm run test:latex` | Only the real-LaTeX cross-check |
| `npm run build` | Typecheck + production build |

## Architecture: keep the layers separate

```
code ──parse──▶ AST ──build──▶ Graph ──evaluate──▶ coords ──▶ SVG
  ▲                              │
  └─────────── generate ◀────────┘   (drag edits free points only)
```

- `src/parser/` — Hand-written tokenizer and parser for the supported subset only. No macro
  expansion, `\foreach` or `\def`. Unknown commands become errors with line numbers, never
  crashes.
- `src/graph/` — Nodes are construction steps (op + parent point names). Topological sort,
  cycle, undefined-reference and duplicate detection.
- `src/geom/` — Pure math. Degenerate cases return `null` (point hidden), **never NaN**.
- `src/codegen/` — Graph → canonical code: definitions (topological) → drawings → labels.
  Body extraction for export.
- `src/ui/` — React components (Editor, Canvas) plus pure helpers (`hover.ts`, `shapes.ts`,
  `viewport.ts`, `rounding.ts`, `textdiff.ts`). Keep logic in pure modules so it can be tested
  without a DOM.

## Rules

- **Codegen output is symbolic.** Only free points (`op: 'free'`) carry numbers, rounded to
  2 decimals. Never flatten a derived point into coordinates.
- **The round-trip must hold:** `parse(codegen(graph))` equals `graph`. `tests/roundtrip.test.ts`
  checks this. Add every new construction to its "every construction" sample.
- **New tkz-euclide commands:** check the exact syntax and semantics against the tkz-euclide
  source (`kpsewhich tkz-euclide.sty`, sibling `.tex` files) and the manual before
  implementing. Add a case to `tests/latex.test.ts`. Record anything you can't confirm in
  `docs/assumptions.md`; don't silently guess.
- **Every supported command needs parser tests,** including error cases.
- **Out of scope unless the user asks:** real LaTeX compilation in the app, Asymptote, angle
  marks, arcs, styles/colours, macros, loops, creating objects from the toolbar.
- **Keep `HANDOFF.md` up to date** when finishing a chunk of work (status, next steps, open
  questions).
