const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const hashes = JSON.parse(fs.readFileSync(path.join(root, 'docs/original-source-hashes.json'), 'utf8'));
const changed = Object.entries(hashes).filter(([name, hash]) => {
  const file = path.resolve(root, '..', name);
  return !fs.existsSync(file) || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash;
});
if (changed.length) { console.error('Original source differs:', changed.map(([name]) => name)); process.exitCode = 1; }
else console.log(`PASS: ${Object.keys(hashes).length} original source files unchanged`);
