#!/usr/bin/env node
/**
 * Fresh install without waiting on slow `rm -rf` under iCloud Desktop.
 *
 * Renaming `node_modules` → `node_modules.__trash_<time>` is one metadata
 * operation on APFS (same volume) and is effectively instant. The trashed
 * folder is removed in a background process so `npm install` can run right away.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');

function deleteDirInBackground(dir) {
  if (!fs.existsSync(dir)) return;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'rmdir', '/s', '/q', dir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } else {
    spawn('rm', ['-rf', dir], { detached: true, stdio: 'ignore' }).unref();
  }
}

console.log('\n→ Replacing node_modules (rename is fast; old tree deletes in background)…\n');

if (fs.existsSync(nm)) {
  const trash = path.join(root, `node_modules.__trash_${Date.now()}`);
  try {
    fs.renameSync(nm, trash);
    deleteDirInBackground(trash);
    console.log(
      '  Moved old node_modules aside. If a background `rm` stalls, delete the\n' +
        `  folder "${path.basename(trash)}" later in Finder or Terminal.\n`
    );
  } catch (err) {
    console.error(
      '\n  Rename failed — something is locking node_modules (Cursor, Metro, antivirus).\n' +
        '  Quit those apps, then run this script again.\n'
    );
    console.error(`  ${err.message}\n`);
    process.exit(1);
  }
}

console.log('→ npm install…\n');
const result = spawnSync('npm', ['install'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
