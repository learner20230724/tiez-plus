'use strict';
// Windows subst is canonicalized back to F:\... by Expo autolinking. Keep the
// private build's logical ASCII drive consistent, otherwise RN codegen attempts
// to relativize files on different drives. This preload is build-process-only.
const fs = require('node:fs');
const path = require('node:path');
const source = process.env.TIEZ_PLUS_BUILD_ROOT;
const mapped = process.env.TIEZ_PLUS_BUILD_DRIVE;
if (source && mapped && process.platform === 'win32') {
  const root = path.resolve(source).replace(/[\\/]+$/, '');
  const prefix = root.toLowerCase() + '\\';
  const rewrite = value => {
    const text = Buffer.isBuffer(value) ? value.toString() : value;
    if (typeof text !== 'string') return value;
    const normalized = text.replaceAll('/', '\\');
    const same = normalized.toLowerCase() === root.toLowerCase();
    if (!same && !normalized.toLowerCase().startsWith(prefix)) return value;
    const result = path.join(mapped, same ? '' : normalized.slice(root.length + 1));
    return Buffer.isBuffer(value) ? Buffer.from(result) : result;
  };
  const wrapSync = original => function (...args) { return rewrite(original.apply(this, args)); };
  const wrapAsync = original => function (...args) {
    const callback = args.pop();
    return original.call(this, ...args, (error, value) => callback(error, error ? value : rewrite(value)));
  };
  const sync = fs.realpathSync, async = fs.realpath;
  fs.realpathSync = wrapSync(sync); fs.realpathSync.native = wrapSync(sync.native);
  fs.realpath = wrapAsync(async); fs.realpath.native = wrapAsync(async.native);
  const promiseRealpath = fs.promises.realpath.bind(fs.promises);
  fs.promises.realpath = async (...args) => rewrite(await promiseRealpath(...args));
}
