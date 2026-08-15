const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = ['.next', 'out', 'dist'];

for (const target of targets) {
  const fullPath = path.join(root, target);
  fs.rmSync(fullPath, { recursive: true, force: true });
  console.log(`[clean:electron] removed ${target}`);
}
