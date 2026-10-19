const { runFfmpeg, runFfprobe, detectAndValidateFormat } = require('./ffmpeg');
const paths = require('./paths');

async function processPhoto({ id, ext }) {
  const original = paths.originalPath(id, ext);
  // Validate the real content-sniffed format BEFORE any other ffmpeg/ffprobe
  // call touches this untrusted file, then pin it explicitly on every call
  // below so ffmpeg never re-probes (auto-selects) the demuxer itself.
  const format = await detectAndValidateFormat(original);
  await runFfmpeg([
    '-y', '-protocol_whitelist', 'file', '-f', format, '-i', original,
    '-vf', "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease",
    '-q:v', '3', '-update', '1',
    paths.gridPath(id)
  ]);
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    '-protocol_whitelist', 'file', '-f', format, '-i', original
  ]);
  const [width, height] = stdout.split('x').map(Number);
  return { width, height };
}

module.exports = { processPhoto };
