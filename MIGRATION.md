# Server TypeScript migration (Phase 3)

Goal: convert every first-party .js file under server/ and index.js to TypeScript, one batch (directory) at a time. The vendored code in server/libs and all files under test/ stay as they are.

## Rules (apply to every batch)
1. At the end of every batch `npm run build:server` must report 0 "error TS" and `npm test` must show 356 passing, 0 failing. Never end a session with a red build.
2. Do not edit, skip or delete any test. Do not change files outside the batch unless a type error in the batch cannot be fixed otherwise; list any such change in the Log below.
3. Runtime behaviour must not change. Do not fix bugs. When types expose a bug, keep the behaviour, add a `NOTE:` comment at that line and add one line to the Bugs section below.
4. No `any`, no `@ts-ignore`, no `@ts-nocheck`, no `@ts-expect-error`. Use `unknown` and narrow it. Every type assertion (`as`) needs a one-line comment.
5. Module style (copied from Phase 1 and 2): local modules use `import X = require('./X')` and `export = X`, so existing require() callers, tests and sinon stubs keep working. Third-party packages with a default export use `import x from 'pkg'`.
6. Shared types live next to the data they describe (see server/providers/types.ts). Add a types.ts in the directory when two or more files share a type.
7. Convert with `git mv X.js X.ts` so history is kept. Keep JSDoc descriptions and drop JSDoc type annotations that the signature now carries.
8. At the end of each batch: update the Progress table, commit with the message `phase3 batch N: <directory>`, and stop.

## Progress
| Batch | Directory | Files | Status |
| --- | --- | --- | --- |
| 1 | server/utils (all subfolders) | 46 | todo |
| 2 | server/objects (all subfolders) | 18 | todo |
| 3 | server/models | 25 | todo |
| 4 | server/auth and server/routers | 6 | todo |
| 5 | server/managers | 18 | todo |
| 6 | server/scanner | 13 | todo |
| 7 | server/controllers (remaining 22) | 22 | todo |
| 8 | server/migrations | 15 | todo |
| 9 | server top-level files (Logger, Database, Auth, SocketAuthority, Watcher, Server) and index.js | 7 | todo |
| 10 | Packaging: package.json scripts, Dockerfile and anything else that references a .js entry point | 0 | todo |

Already done in Phase 2: server/finders, server/providers, server/controllers/SearchController.

## Bugs found (not fixed)
(none yet)

## Log
(none yet)

## Extra rules
9. If a file cannot be typed cleanly without changing behaviour, first use the smallest possible `as` with a one-line comment and a line in the Bugs section. If that still fails, leave the file as .js, list it under Skipped with the reason, and move on.
10. You may add missing @types packages to devDependencies in package.json (for example express, passport, cookie-parser). Mention them in the Log.
11. Add the types in the same edit as the rename: `git mv`, then edit the file before running the build, because a bare rename can crash incremental tsc.

## Skipped files
(none yet)
