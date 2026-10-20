const { runFfmpeg, runFfprobe, detectAndValidateFormat } = require('./ffmpeg');
const paths = require('./paths');

async function processVideo({ id, ext }) {
  const original = paths.originalPath(id, ext);
  // Validate the real content-sniffed format BEFORE any other ffmpeg/ffprobe
  // call touches this untrusted file, then pin it explicitly on every call
  // below so ffmpeg never re-probes (auto-selects) the demuxer itself.
  const format = await detectAndValidateFormat(original);
  await runFfmpeg(['-y', '-protocol_whitelist', 'file', '-f', format, '-i', original, '-vframes', '1', '-q:v', '3', '-update', '1', paths.posterPath(id)]);
  await runFfmpeg([
    '-y', '-protocol_whitelist', 'file', '-f', format, '-i', original,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '23',
    '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    paths.videoPath(id)
  ]);
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    '-protocol_whitelist', 'file', '-i', paths.videoPath(id)
  ]);
  const [width, height] = stdout.split('x').map(Number);
  return { width, height };
}

module.exports = { processVideo };
