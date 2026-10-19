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
  try {
    const nodePath = require('path');
    [originalPath, paths.gridPath(id), paths.posterPath(id), paths.videoPath(id)]
      .forEach((p) => fs.mkdirSync(nodePath.dirname(p), { recursive: true }));
    fs.writeFileSync(originalPath, req.file.buffer);

    let item;
    if (isImage) {
      const { width, height } = await processPhoto({ id, ext });
      item = {
        id, name: req.file.originalname, mimeType: req.file.mimetype, width, height,
        url: `${PUBLIC_BASE_URL}/originals/${id}.${ext}`,
        gridUrl: `${PUBLIC_BASE_URL}/grid/${id}.jpg`
      };
    } else {
      const { width, height } = await processVideo({ id, ext });
      item = {
        id, name: req.file.originalname, mimeType: 'video/mp4', width, height,
        url: `${PUBLIC_BASE_URL}/video/${id}.mp4`,
        posterUrl: `${PUBLIC_BASE_URL}/posters/${id}.jpg`
      };
    }
    manifest.appendLine(item);
    res.status(201).json(item);
  } catch (err) {
    [paths.originalPath(id, ext), paths.gridPath(id), paths.posterPath(id), paths.videoPath(id)]
      .forEach((p) => { try { fs.unlinkSync(p); } catch {} });
    res.status(500).json({ error: err.message });
  }
});

app.get('/list', (req, res) => res.json(manifest.readAll()));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`media-service listening on ${port}`));
}

module.exports = { app };
