const { runFfmpeg, runFfprobe } = require('./ffmpeg');
const paths = require('./paths');

async function processPhoto({ id, ext }) {
  const original = paths.originalPath(id, ext);
  await runFfmpeg([
    '-y', '-i', original,
    '-vf', "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease",
    '-q:v', '3',
    paths.gridPath(id)
  ]);
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    original
  ]);
  const [width, height] = stdout.split('x').map(Number);
  return { width, height };
}

module.exports = { processPhoto };
