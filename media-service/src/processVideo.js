const { runFfmpeg, runFfprobe } = require('./ffmpeg');
const paths = require('./paths');

async function processVideo({ id, ext }) {
  const original = paths.originalPath(id, ext);
  await runFfmpeg(['-y', '-i', original, '-vframes', '1', '-q:v', '3', '-update', '1', paths.posterPath(id)]);
  await runFfmpeg([
    '-y', '-i', original,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease",
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    paths.videoPath(id)
  ]);
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    paths.videoPath(id)
  ]);
  const [width, height] = stdout.split('x').map(Number);
  return { width, height };
}

module.exports = { processVideo };
