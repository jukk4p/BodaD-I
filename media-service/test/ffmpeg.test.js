const { test } = require('node:test');
const assert = require('node:assert');
const { runCommand } = require('../src/ffmpeg');

test('runCommand resolves with stdout on success', async () => {
  const { stdout } = await runCommand('node', ['-e', 'process.stdout.write("hello")']);
  assert.strictEqual(stdout, 'hello');
});

test('runCommand rejects on non-zero exit', async () => {
  await assert.rejects(() => runCommand('node', ['-e', 'process.exit(1)']));
});

test('runCommand never invokes a shell (argument with shell metacharacters is passed literally)', async () => {
  const { stdout } = await runCommand('node', ['-e', 'console.log(process.argv[1])', '$(echo pwned)']);
  assert.match(stdout, /\$\(echo pwned\)/);
});
