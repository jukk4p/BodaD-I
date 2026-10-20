const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { generateId, sanitizeExt } = require('./id');
const paths = require('./paths');
const { processPhoto } = require('./processPhoto');
const { processVideo } = require('./processVideo');
const manifest = require('./manifest');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://bodadaniyirene.ivangonzalez.cloud/uploads';

const app = express();
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/upload', upload.single('data'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing file field "data"' });
  const id = generateId();
  const ext = sanitizeExt(req.file.originalname);
  const isImage = req.file.mimetype.startsWith('image/');
  const isVideo = req.file.mimetype.startsWith('video/');
  if (!isImage && !isVideo) return res.status(400).json({ error: 'unsupported mimeType' });

  const originalPath = paths.originalPath(id, ext);
  let safeExt;
  try {
    const nodePath = require('path');
    [originalPath, paths.gridPath(id), paths.posterPath(id), paths.videoPath(id)]
      .forEach((p) => fs.mkdirSync(nodePath.dirname(p), { recursive: true }));
    fs.writeFileSync(originalPath, req.file.buffer);

    let item;
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
