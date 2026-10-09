/**
 * Types for the vendored fs-extra (server/libs/fsExtra/index.js).
 * The vendored fs-extra builds its fs API at runtime (promisified graceful-fs), so the type TypeScript infers
 * from the JS lacks most fs methods. `require('../libs/fsExtra')` resolves to this file for types; the JS module
 * is still the one loaded and emitted. See FsExtra in server/utils/types.ts.
 */
import type { FsExtra } from '../utils/types'

declare const fsExtra: FsExtra
export = fsExtra
