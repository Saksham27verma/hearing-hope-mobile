#!/usr/bin/env node
/**
 * Delete node_modules and reinstall. Uses fs.rmSync retries for busy files (IDE watchers).
 * If the project lives on iCloud Desktop, deletion can take a long time — do not cancel early.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');

console.log('\n→ Removing node_modules…');
console.log(
  '  If this folder is on Desktop & iCloud, expect 15–40+ minutes. Leave it running.\n'
);

if (fs.existsSync(nm)) {
  fs.rmSync(nm, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 400,
  });
}

console.log('→ npm install…\n');
const result = spawnSync('npm', ['install'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
