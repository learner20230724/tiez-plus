'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.TIEZ_PLUS_BUILD_ROOT;
const mapped = process.env.TIEZ_PLUS_BUILD_DRIVE;
if (!root || !mapped) throw new Error('Private build mapping required');
const file = path.join(mapped, 'apps/mobile/android/build/generated/autolinking/autolinking.json');
if (fs.existsSync(file)) {
  const normalizedRoot = root.replaceAll('\\','/').replace(/\/$/,'');
  const rewrite = value => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,rewrite(v)]));
    if (typeof value === 'string') {
      const normalized = value.replaceAll('\\','/');
      if (normalized === normalizedRoot || normalized.startsWith(normalizedRoot+'/')) return path.join(mapped,normalized.slice(normalizedRoot.length)).replaceAll('\\','/');
      if (normalized.toLowerCase().startsWith(mapped.replaceAll('\\','/').toLowerCase())) return normalized;
    }
    return value;
  };
  fs.writeFileSync(file, JSON.stringify(rewrite(JSON.parse(fs.readFileSync(file,'utf8')))));
}
