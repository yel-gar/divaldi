#!/usr/bin/env node
/**
 * Cross-platform setup for husky + commitlint + pre-commit hooks.
 * Run with: node scripts/setup-hooks.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const huskyDir = path.join(process.cwd(), '.husky');

if (!fs.existsSync(huskyDir)) {
  console.error('.husky directory not found. Run "npx husky init" first.');
  process.exit(1);
}

const hooks = {
  'commit-msg': 'npm run commitlint ${1}\n',
  'pre-commit': 'pre-commit run --all-files\n',
};

for (const [name, content] of Object.entries(hooks)) {
  const filePath = path.join(huskyDir, name);
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });

  // chmod is a no-op on Windows but required on Linux/macOS for the hook to run
  if (os.platform() !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  console.log(`Wrote ${filePath}`);
}

console.log('Hooks installed successfully.');
