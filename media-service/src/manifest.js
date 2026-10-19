const fs = require('fs');
const path = require('path');
const paths = require('./paths');

function appendLine(item) {
  fs.mkdirSync(path.dirname(paths.manifestPath()), { recursive: true });
  fs.appendFileSync(paths.manifestPath(), JSON.stringify(item) + '\n');
}

function readAll() {
  if (!fs.existsSync(paths.manifestPath())) return [];
  const raw = fs.readFileSync(paths.manifestPath(), 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

module.exports = { appendLine, readAll };
