# Real-world figures

Diagram files copied unchanged from
[Geometry-Everyday-Project](https://github.com/azzam2912/Geometry-Everyday-Project)
(commit c951c73, folders `Asymptote/` and `Tikzlatex/`). They cover what that project uses:
olympiad/geometry Asymptote, Evan Chen's cse5 `Drawing`/`MP` helpers, GeoGebra exports (TikZ and
Asymptote), tkz-euclide with `common=`, plain TikZ with `\coordinate`, `\pic`, `\foreach` and
pgfmath radii.

`tests/corpus.test.ts` parses, converts and (when `asy` / `pdflatex` are installed) cross-checks
each file. Set `GEP_DIR=/path/to/Geometry-Everyday-Project` to run the same checks on every file
of a checkout.
