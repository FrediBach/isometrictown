# Reviewed React Doctor findings

Reviewed on 2026-11-15 with React Doctor 0.9.23, full project scope and the default
categories. The schema 3 report contained no errors and 136 warnings, with no
skipped checks. No rules are disabled by this document. Recheck the predicates
below before treating a future finding as reviewed.

## `react-doctor/public-debug-artifact`

The 134 occurrences at `lab/out/*/report.json:1` are rejected as production
exposure findings while these predicates hold:

- `lab/run.mjs` writes these files as local LOD comparison reports, as documented
  in `docs/lod.md`.
- The `.gitignore` entry `out` ignores `lab/out`, and no files under that directory
  are tracked by Git.
- `vite.config.ts` does not copy lab output into the application. The production
  build writes `dist`, and inspection of the built files found no lab reports.
  `public` also contains no lab reports.

The rule recognises an `out` path as potentially public; that name alone does not
establish production exposure here. This review does not establish what a remote
hosting service publishes. Reassess if deployment starts serving the repository
root, lab reports are copied into public assets, or the output configuration changes.

## `react-doctor/async-await-in-loop`

The occurrences in `lab/run.mjs` at the `lab.runCase` call (line 102 at review)
and the screenshot loop (line 148) are observations, not confirmed performance
defects:

- `lab/lab.ts` loads data asynchronously but renders, plans and measures each
  drawing synchronously. Concurrent promises would not parallelise that CPU work.
  The runner already permits up to four network requests at once.
- Each `shot` opens a browser page, captures it, then closes it. Sequential calls
  bound the number of open screenshot pages to one. Running all cases together
  would increase browser resource use.

No comparative runtime measurement was made, so no speedup is claimed or ruled
out. Keep the current behaviour unless a measured bottleneck justifies bounded
concurrency while preserving resource limits, case ordering and failure handling.

## Validation

`npm run build` and `npm test` passed (19 test files, 653 tests). The build retains
its existing large-chunk warning. No React or drawing code changed; browser
interaction checks and LOD comparisons were not run for this documentation change.
