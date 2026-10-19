const { spawn } = require('child_process');

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: stdout.trim() });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

const runFfmpeg = (args) => runCommand('ffmpeg', args);
const runFfprobe = (args) => runCommand('ffprobe', args);

module.exports = { runCommand, runFfmpeg, runFfprobe };
