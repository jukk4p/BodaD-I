const express = require('express');
const multer = require('multer');
const fs = require('fs');
const nodePath = require('path');
const { generateId, sanitizeExt } = require('./id');
const paths = require('./paths');
const { processPhoto } = require('./processPhoto');
const { processVideo } = require('./processVideo');
const manifest = require('./manifest');
const { createLimiter } = require('./concurrencyLimit');

const originalsDir = nodePath.dirname(paths.originalPath('x', 'x'));

// Caps simultaneous ffmpeg transcodes so a burst of guest uploads can't all
// spawn child processes at once and starve the shared VPS (n8n, Postgres,
// ~10 other services). Excess requests queue in-process and still complete,
// just one after another instead of all competing for CPU together.
const MAX_CONCURRENT_PROCESSING = Number(process.env.MAX_CONCURRENT_PROCESSING) || 2;
const processingLimiter = createLimiter(MAX_CONCURRENT_PROCESSING);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(originalsDir, { recursive: true });
      cb(null, originalsDir);
    },
    filename: (req, file, cb) => {
      const id = generateId();
      const ext = sanitizeExt(file.originalname);
      req.uploadId = id;
      req.uploadExt = ext;
      cb(null, `${id}.${ext}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://bodadaniyirene.ivangonzalez.cloud/uploads';

const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/upload', upload.single('data'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing file field "data"' });
  const id = req.uploadId;
  const ext = req.uploadExt;
  const isImage = req.file.mimetype.startsWith('image/');
  const isVideo = req.file.mimetype.startsWith('video/');
  if (!isImage && !isVideo) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'unsupported mimeType' });
  }

  const originalPath = paths.originalPath(id, ext);
  let safeExt;
  try {
    [paths.gridPath(id), paths.posterPath(id), paths.videoPath(id)]
      .forEach((p) => fs.mkdirSync(nodePath.dirname(p), { recursive: true }));

    let item;
    await processingLimiter.run(async () => {
      if (isImage) {
        const photo = await processPhoto({ id, ext });
        const { width, height } = photo;
        safeExt = photo.safeExt;
        // Serve the original under the extension of its validated content
        // format, never the guest-supplied one (stored-XSS via e.g. x.html).
        if (safeExt !== ext) {
          fs.renameSync(paths.originalPath(id, ext), paths.originalPath(id, safeExt));
        }
        item = {
          id, name: req.file.originalname, mimeType: req.file.mimetype, width, height,
          url: `${PUBLIC_BASE_URL}/originals/${id}.${safeExt}`,
          gridUrl: `${PUBLIC_BASE_URL}/grid/${id}.jpg`
        };
      } else {
        const video = await processVideo({ id, ext });
        const { width, height } = video;
        safeExt = video.safeExt;
        if (safeExt !== ext) {
          fs.renameSync(paths.originalPath(id, ext), paths.originalPath(id, safeExt));
        }
        item = {
          id, name: req.file.originalname, mimeType: 'video/mp4', width, height,
          url: `${PUBLIC_BASE_URL}/video/${id}.mp4`,
          posterUrl: `${PUBLIC_BASE_URL}/posters/${id}.jpg`
        };
      }
    });
    manifest.appendLine(item);
    res.status(201).json(item);
  } catch (err) {
    const cleanup = [paths.originalPath(id, ext), paths.gridPath(id), paths.posterPath(id), paths.videoPath(id)];
    if (safeExt) cleanup.push(paths.originalPath(id, safeExt));
    cleanup.forEach((p) => { try { fs.unlinkSync(p); } catch {} });
    console.error('upload failed:', err);
    res.status(500).json({ error: 'upload processing failed' });
  }
});

app.get('/list', (req, res) => res.json(manifest.readAll()));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file too large (max 50MB)' });
  }
  console.error('unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`media-service listening on ${port}`));
}

module.exports = { app };
