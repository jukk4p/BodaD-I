const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshManifest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
  process.env.UPLOAD_ROOT = dir;
  delete require.cache[require.resolve('../src/paths')];
  delete require.cache[require.resolve('../src/manifest')];
  return require('../src/manifest');
}

test('readAll returns [] when manifest does not exist yet', () => {
  const manifest = freshManifest();
  assert.deepStrictEqual(manifest.readAll(), []);
});

test('appendLine then readAll round-trips an item', () => {
  const manifest = freshManifest();
  manifest.appendLine({ id: '1_a', name: 'x.jpg' });
  manifest.appendLine({ id: '2_b', name: 'y.mp4' });
  assert.deepStrictEqual(manifest.readAll(), [{ id: '1_a', name: 'x.jpg' }, { id: '2_b', name: 'y.mp4' }]);
});

test('readAll skips a malformed line without failing the rest', () => {
  const manifest = freshManifest();
  manifest.appendLine({ id: '1_a' });
  fs.appendFileSync(require('../src/paths').manifestPath(), 'not json\n');
  manifest.appendLine({ id: '2_b' });
  assert.deepStrictEqual(manifest.readAll(), [{ id: '1_a' }, { id: '2_b' }]);
});
