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
| 1 | server/utils (all subfolders) | 46 | done |
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
Each has a `NOTE:` comment at the line.
- server/utils/generators/opmlGenerator.ts: reads `podcast.itunesPageUrl` but the Podcast model field is `itunesPageURL`, so the OPML outline never gets an `htmlUrl`.
- server/utils/podcastUtils.ts `extractImage`: xml2js puts `<image>` in an array, so `channel.image.url` is always undefined and the RSS `<image><url>` is never used (always falls back to `itunes:image`).
- server/utils/podcastUtils.ts `extractEpisodeData`: the second `media:content` find does not require a url, so an audio `media:content` without a url makes `enclosure.url.trim()` throw.
- server/utils/scandir.ts `groupFileItemsIntoLibraryItemDirs`: a media file in the folder root is stored as a string group; if a directory has the same name, `.push` is called on that string and throws (2 places).
- server/utils/parsers/parseFullName.ts: `fixCase !== 'undefined'` compares with the string 'undefined' instead of using typeof, so that part of the check is always true.
- server/utils/parsers/parseFullName.ts `fixParsedNameCase`: the suffix check indexes `namePartLabels[j]` (word index) instead of `namePartLabels[i]` (label index).
- server/utils/comicBookExtractors.ts `CbzComicBookExtractor.open`: `getBuffer()` can return null, which is passed to `Archive.open` unchecked (the class is not used by `createComicBookExtractor` at the moment).
- server/utils/migrations/dbMigration.ts `handleOldLibraries`: maps `oldDbIdMap.libraries[library.oldLibraryId]`, but the Library model has no `oldLibraryId` (it was just written to `extraData`), so the key is "undefined" and old library ids in users' `librariesAccessible` are mapped to undefined and dropped.

## Log
### Batch 1: server/utils (46 files, all converted, none skipped)
- New type files: `server/utils/types.ts` (shared utils types, `declare global` for the `global.*` values used in utils, and typed views of untyped vendored libs/models), `server/utils/parsers/types.ts`, `server/utils/queries/types.ts`, and `server/utils/ssrf-req-filter.d.ts` (ssrf-req-filter has no types; tsconfig excludes `*.d.ts`, so it is pulled in with a `/// <reference>` from `server/utils/types.ts`).
- devDependencies added (rule 10): `@types/express`, `@types/xml2js`, `@types/uuid`. They were already in node_modules as extraneous packages; `npm install` also pruned the other extraneous ones locally (`@types/passport`, `@types/cookie-parser`, `@types/express-session`, `@types/passport-strategy` ...), so later batches must add those to devDependencies when they need them.
- No files outside server/utils were changed (apart from package.json/package-lock.json and this file). No tests were changed.
- Module style: every module now ends in `export = <object/class/function>`. Modules that used `module.exports.x = ...` export one object literal with the same keys; checked that no utils module is in a require cycle, so assembling the export object at the end is safe. Internal `this.x()` / `module.exports.x()` calls go through that object, so sinon stubs on exports keep working. Compared `Object.keys`/`typeof` of every compiled module against HEAD: identical, except `parseFullName` is now a `function` declaration (needed for overloads) instead of an arrow function, so it has a `prototype`.
- Typed views for untyped JS (each a single commented `as` where the module is required): `FsExtra` for libs/fsExtra (its fs API is built at runtime), `ArchiverFactory` for libs/archiver, `SortInstance` for libs/fastSort, the fuse.js constructor in podcastUtils, ffprobe in prober, libarchive in comicBookExtractors.
- `TypedDatabase` (utils/types.ts): the JS models override `Model.init` with a different signature, so TypeScript rejects their static query methods (`findAll`, `count`, ...). Files that query cast `require('../../Database')` to `TypedDatabase` (same object; model getters still read lazily). It also types `sequelize` as set and `libraryFilterData`. Batch 3 (models) should make this unnecessary.
- Model associations (`book.libraryItem`, `series.bookSeries`, `mediaProgress.mediaItem`, ...) and JSON columns (`user.permissions`, `user.extraData`, `playbackSession.mediaMetadata`) are not declared on the JS models; the queries describe the loaded rows locally and cast once per query result. Sequelize's types are stricter than what it accepts at runtime (arrays of where options, `limit: null`, `[literal]` order items, a single nested include object, `distinct` on findAll, `limit` on count); those option objects use `QueryFindOptions` or are cast at the call with a comment.
- Behaviour-neutral code changes made for typing: `new Date() - n` became `new Date().valueOf() - n` (same coercion); a few repeated reads were pulled into a commented local (`permissions`, `mediaMetadata`, `models`); `getMediaGroupQuery` in libraryItemsBookFilters writes properties through a `mediaWhereHash` alias of the same object; `libraryFilters.getFilterData` replaces its sets with arrays through a typed alias of the same object; zipHelpers no longer requires express at runtime (it was only used for a JSDoc type); dbMigration no longer destructures the unused `QueryInterface` value from sequelize.
- JSDoc in not yet converted JS files that points at typedefs which moved (`import('../utils/fileUtils').FilePathItem`, `import('../utils/podcastUtils').RssPodcast*`, `import('./parseEbookMetadata').EBookFileScanData`) now resolves to `any` in those JS files; point them at `server/utils/types.ts`, `podcastUtils.ts` or `parsers/types.ts` when those files are converted.
- Incremental tsc crash: changing `server/utils/types.ts` (its `declare global` block) makes `tsc` crash with `Debug Failure. False expression` in `getSpecifierForModuleSymbol` while re-emitting signatures of JS files. A clean build works; fix with `rm dist-server/.tsbuildinfo`.
- Result: `npm run build:server` reports 0 `error TS`; `npm test` 356 passing, 0 failing.

### Batch 1 fixes (after independent review)
- abmetadataGenerator: restored the original `validated.series?.length` truthiness check (the batch had changed it to `Array.isArray(...) && ...length`); `series` is now typed `unknown[]` instead of using an `as`.
- Class fields declared without an initialiser in comicBookExtractors, utils/index (ValidationError, NotFoundError), rateLimiterFactory and longTimeout compiled to `field;` lines that created own properties set to undefined. They are now `declare` fields (rule 12) and compile to nothing, as in the JavaScript.
- Tried `"useDefineForClassFields": false` in tsconfig.server.json first and reverted it: it changed the compiled output of 21 files, including about 10 JS files that are not converted yet (ApiCacheManager, Database, Logger, TokenManager, MigrationManager, BinaryManager, User, DeviceInfo, ServerSettings, BookScanner), where real field initialisers move into the constructor body after parameter defaults. ApiCacheManager's `new LRUCache(this.defaultCacheOptions)` default then reads undefined and throws (348 passing, 1 failing).

## Extra rules
9. If a file cannot be typed cleanly without changing behaviour, first use the smallest possible `as` with a one-line comment and a line in the Bugs section. If that still fails, leave the file as .js, list it under Skipped with the reason, and move on.
10. You may add missing @types packages to devDependencies in package.json (for example express, passport, cookie-parser). Mention them in the Log.
11. Add the types in the same edit as the rename: `git mv`, then edit the file before running the build, because a bare rename can crash incremental tsc.
12. Declare class fields that the JavaScript did not initialise with `declare` (for example `declare timeout: NodeJS.Timeout`), so they compile to nothing whatever the tsconfig says. Fields the JavaScript did initialise stay as normal fields.

## Known deviations to clean up at the end
- The Phase 2 finders and providers (server/finders, server/providers) have the same class field issue: fields declared without an initialiser compile to `field;` lines (already present at 9c4185a0, for example `baseUrl;` in Audnexus and OpenLibrary). Mark them `declare` (rule 12).

## Skipped files
(none yet; batch 1 skipped nothing)
