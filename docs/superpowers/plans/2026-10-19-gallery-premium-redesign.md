# Rediseño premium de la galería — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Google-Drive-backed live gallery with media served from the project's own VPS, and rebuild `galeria.html`/`js/gallery.js` as an "Editorial Masonry" layout with real aspect ratios, a native video player, and a navigable lightbox.

**Architecture:** A new small Node.js/Express service (`media-service`), deployed as its own Coolify-managed container on the internal Docker network only (no public domain), does all file processing (`ffmpeg`/`ffprobe` via `child_process.spawn` with explicit argument arrays — never shell string interpolation) and owns the shared persistent volume. The two n8n workflows become thin HTTP-forwarding proxies (Webhook → HTTP Request → Respond) — this replaced an earlier design that used n8n's "Execute Command" node directly, discovered mid-implementation to be disabled by default since n8n 2.0 for security reasons (a public-webhook-facing instance is exactly the case n8n warns about). The frontend (`galeria.html`, `js/gallery.js`) is rewritten to consume `media-service`'s JSON shape directly and to render a CSS-columns masonry grid.

**Tech Stack:** Node.js 20 + Express + `multer` (multipart parsing) for `media-service`; `ffmpeg`/`ffprobe` (installed in the service's own Docker image) for image/video processing; Node's built-in `node:test` for unit tests on the deterministic (non-ffmpeg) logic; n8n (Webhook / HTTP Request / Respond to Webhook nodes only — no Code or Execute Command nodes); Coolify-managed Docker volumes and networking; nginx (`Boda-Dani`'s static image) for serving; vanilla HTML/CSS/JS frontend (no build step, no test framework present in this repo).

**Spec:** `docs/superpowers/specs/2026-10-19-gallery-premium-redesign-design.md`

## Global Constraints

- Wedding date lock: `galleryActive`/`uploadActive` compare `Date.now()` against `new Date('2026-10-24T00:00:00').getTime()` — this mechanism and timestamp must not change.
- Upload limits unchanged: 50MB max file size, `image/*` and `video/*` accepted (enforced client-side today in `js/upload.js`; this plan does not touch that file). `media-service` additionally enforces the same 50MB limit server-side (defense in depth, via `multer`'s `limits.fileSize`).
- Filenames must not embed the guest's original filename in the stored path; the id is `{timestampMs}_{random8hex}` (generated with `crypto.randomBytes`, not `Math.random`) so paths stay non-guessable. The original filename is preserved only inside the manifest's `name` field (JSON value, not a path, and never passed through a shell).
- `/uploads/` must not allow directory listing — already satisfied: nginx's `autoindex` defaults to `off` and `Boda-Dani` has no custom config overriding it (verified 2026-10-19, no action needed).
- Disk budget: VPS-2, 73GB total, 51GB free / 31% used confirmed 2026-10-19 — stay well inside this.
- CPU budget: shared VPS (n8n + Postgres + ~10 other Coolify services). `media-service` processes one upload at a time (Express's default single-process request handling already serializes this per-process; do not add worker pools/queues).
- Keep existing visual tokens from `galeria.html`'s `:root` (`--ink`, `--ink-deep`, `--gold`, etc.), fonts (Fraunces/Archivo), and all existing Spanish copy not explicitly changed by a task.
- Both n8n workflows keep their existing webhook paths (`boda-daniel-irene-fotos`, `boda-daniel-irene-galeria`) and stay `Published` — `subir.html`/`js/upload.js`/`js/gallery.js` hardcode these URLs and are not being changed to point elsewhere.
- `media-service` is reached by n8n over the Coolify-internal Docker network by service/container name — it gets **no public domain/FQDN**. It is not meant to be reachable from the public internet at all.
- `media-service`'s shared volume mount: host path `/data/boda-daniel-irene/uploads` (same as `Boda-Dani` and `n8n`'s existing mounts — already configured, see Task 1) → container path `/data/uploads` (same convention n8n already uses).
- `media-service` builds public URLs for manifest entries from a `PUBLIC_BASE_URL` environment variable, defaulting to `https://bodadaniyirene.ivangonzalez.cloud/uploads` if unset.
- Do not delete the Google Drive folder, credential, or the old Drive nodes' configuration history — out of scope, no cleanup required there.
- Do not re-run Task 1 Steps 1-6 (persistent volumes on `Boda-Dani` and `n8n`, nginx autoindex check, `Boda-Dani` redeploy) — already done and verified; see the ledger. Task 1 Step 7 (confirm `ffmpeg` in the n8n container) is superseded — `ffmpeg` now lives in `media-service`'s own image instead (Task 2).

## Review Focus

- **A near-50MB video upload**: `ffmpeg` transcoding must complete without the HTTP request timing out or leaving a partial/corrupt file behind if it fails midway. (Task 5, Task 7)
- **iPhone photos/videos (HEIC stills, HEVC `.mov`)**: these are the majority real-world input per the design doc's "mayormente con el móvil" — processing must handle them, not just generic JPEG/MP4. (Tasks 4, 5)
- **Two guests uploading at the same moment**: Node's single-threaded event loop combined with `spawn`-based subprocesses already serializes CPU-heavy work reasonably, but two concurrent `ffmpeg` child processes can still both run — confirm this doesn't starve the shared VPS. (Task 7)
- **A failed/partial upload** (guest loses signal mid-upload, or `ffmpeg` fails): no entry should appear in `manifest.jsonl` unless the original file and all derivatives were written successfully, and partial derivative files should be cleaned up — a partial entry would show a broken tile to every guest. (Task 7)
- **The manifest growing to hundreds of lines over the wedding day**: `GET /list` re-reads the file on every call and the frontend re-polls every 20s — response time must stay reasonable as the file grows across a single day's uploads. (Task 6)

---

## File Structure

- Create: `media-service/package.json`, `media-service/Dockerfile`, `media-service/src/server.js`, `media-service/src/id.js`, `media-service/src/paths.js`, `media-service/src/ffmpeg.js`, `media-service/src/processPhoto.js`, `media-service/src/processVideo.js`, `media-service/src/manifest.js`
- Create: `media-service/test/id.test.js`, `media-service/test/paths.test.js`, `media-service/test/manifest.test.js`, `media-service/test/ffmpeg.test.js`
- Modify: `js/gallery.js` — data layer (`fetchAndRender`, `render`), tile creation (`createPhotoTile`, `createVideoTile`), lightbox (`openLightbox`).
- Modify: `galeria.html` — grid CSS (masonry), tile CSS (real aspect ratio, video poster + play icon), lightbox CSS (nav arrows + counter), lightbox markup additions.
- n8n workflow `Boda Daniel & Irene - Subida de fotos a Drive` (id `UWHftSKj8sNiaOjt`) — edited in the n8n editor, no local file. Renamed to `Boda Daniel & Irene - Subida de fotos`.
- n8n workflow `Boda Daniel & Irene - Listado de fotos` (id `lHim7mpMSvvhKiwD`) — edited in the n8n editor, no local file.
- Coolify: new Application `media-service` (Dockerfile build pack, base directory `/media-service`, internal network only, persistent storage) — GUI config, no local file.

## Data Contract (pins Tasks 2–11 together)

Shared volume layout, mounted at host path `/data/boda-daniel-irene/uploads` — already mounted in `n8n` (container path `/data/uploads`) and `Boda-Dani` (container path `/usr/share/nginx/html/uploads`, read-only is fine); `media-service` mounts the same host path at container path `/data/uploads` too (Task 8):

```
uploads/
  originals/{id}.{ext}       # exactly as uploaded
  grid/{id}.jpg              # photos only: resized grid thumbnail
  posters/{id}.jpg           # videos only: first-frame poster
  video/{id}.mp4             # videos only: transcoded H.264/AAC
  manifest.jsonl             # append-only, one JSON object per line
```

`id` = `{Date.now() in ms}_{8 random hex chars via crypto.randomBytes(4).toString('hex')}`, computed once per upload and reused for every derivative filename.

One manifest line, photo:
```json
{"id":"1792424443123_a1b2c3d4","name":"IMG_0231.jpg","mimeType":"image/jpeg","width":1440,"height":1920,"url":"https://bodadaniyirene.ivangonzalez.cloud/uploads/originals/1792424443123_a1b2c3d4.jpg","gridUrl":"https://bodadaniyirene.ivangonzalez.cloud/uploads/grid/1792424443123_a1b2c3d4.jpg"}
```

One manifest line, video (`mimeType` is always `video/mp4` post-transcode, regardless of the original container):
```json
{"id":"1792424443123_f7e6d5c4","name":"VID_0098.mov","mimeType":"video/mp4","width":1080,"height":1920,"url":"https://bodadaniyirene.ivangonzalez.cloud/uploads/video/1792424443123_f7e6d5c4.mp4","posterUrl":"https://bodadaniyirene.ivangonzalez.cloud/uploads/posters/1792424443123_f7e6d5c4.jpg"}
```

`GET /list` on `media-service` (and therefore the `boda-daniel-irene-galeria` webhook) responds with a JSON array of these objects — `js/gallery.js`'s existing `render(items)` filter/sort/dedupe structure is preserved; only field names and tile-building change (same as the original plan — unaffected by the architecture change).

`POST /upload` on `media-service` accepts `multipart/form-data` with a single file field named `data` (matching the field name the existing Webhook/`subir.html` flow already uses end to end) and responds with one JSON object in the same shape as a manifest line on success (HTTP 200/201), or `{ "error": "<message>" }` on failure (HTTP 4xx/5xx).

---

### Task 1: Infraestructura — ya completada

**Status: done.** Persistent volumes mounted on `Boda-Dani` and `n8n` (host path `/data/boda-daniel-irene/uploads`), `n8n` workflow backups committed to `n8n-backups/`, nginx `autoindex off` confirmed as the default with no override needed, `Boda-Dani` redeployed. See the ledger for exact commits. Step 7 (confirm `ffmpeg` in the n8n container) is superseded by Task 2 — `ffmpeg` now lives in `media-service`'s own image.

No further action in this task. Proceed to Task 2.

---

### Task 2: `media-service` — esqueleto del proyecto

**Files:**
- Create: `media-service/package.json`
- Create: `media-service/src/server.js`
- Create: `media-service/Dockerfile`

**Interfaces:**
- Produces: an Express app listening on `process.env.PORT || 3000`, with `GET /health` returning `200 { "status": "ok" }`. Every later task adds routes/middleware to this same `app` instance exported from `src/server.js`.

- [ ] **Step 1: Write `media-service/package.json`**

```json
{
  "name": "media-service",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1"
  }
}
```

- [ ] **Step 2: Write `media-service/src/server.js`**

```js
const express = require('express');
const app = express();

app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`media-service listening on ${port}`));
}

module.exports = { app };
```

- [ ] **Step 3: Install dependencies and verify locally**

Run: `cd media-service && npm install`
Then: `node src/server.js &` and `curl http://localhost:3000/health`
Expected: `{"status":"ok"}`. Stop the background process afterward.

- [ ] **Step 4: Write `media-service/Dockerfile`**

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
```

- [ ] **Step 5: Commit**

```bash
git add media-service/package.json media-service/package-lock.json media-service/src/server.js media-service/Dockerfile
git commit -m "feat(media-service): project skeleton with health check"
```

---

### Task 3: `media-service` — utilidades puras (id, rutas)

**Files:**
- Create: `media-service/src/id.js`
- Create: `media-service/src/paths.js`
- Test: `media-service/test/id.test.js`
- Test: `media-service/test/paths.test.js`

**Interfaces:**
- Produces: `generateId(): string` (matches `/^\d+_[0-9a-f]{8}$/`); `sanitizeExt(filename: string): string` (lowercase alphanumeric only, falls back to `'bin'` if empty); `paths.UPLOAD_ROOT: string` (from `process.env.UPLOAD_ROOT`, default `/data/uploads`); `paths.originalPath(id, ext)`, `paths.gridPath(id)`, `paths.posterPath(id)`, `paths.videoPath(id)`, `paths.manifestPath()` — all return absolute path strings under `UPLOAD_ROOT`.

- [ ] **Step 1: Write the failing tests for `id.js`**

```js
// media-service/test/id.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { generateId, sanitizeExt } = require('../src/id');

test('generateId matches timestamp_hex8 shape', () => {
  const id = generateId();
  assert.match(id, /^\d+_[0-9a-f]{8}$/);
});

test('generateId produces distinct ids', () => {
  assert.notStrictEqual(generateId(), generateId());
});

test('sanitizeExt lowercases and strips non-alphanumerics', () => {
  assert.strictEqual(sanitizeExt('IMG_0231.JPG'), 'jpg');
  assert.strictEqual(sanitizeExt('clip.mov'), 'mov');
});

test('sanitizeExt falls back to bin for no extension', () => {
  assert.strictEqual(sanitizeExt('noext'), 'bin');
  assert.strictEqual(sanitizeExt(''), 'bin');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd media-service && node --test test/id.test.js`
Expected: FAIL (`../src/id` not found)

- [ ] **Step 3: Implement `media-service/src/id.js`**

```js
const crypto = require('crypto');

function generateId() {
  return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function sanitizeExt(filename) {
  const raw = (filename || '').split('.').pop() || '';
  const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean || 'bin';
}

module.exports = { generateId, sanitizeExt };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/id.test.js`
Expected: PASS, 4/4

- [ ] **Step 5: Write the failing tests for `paths.js`**

```js
// media-service/test/paths.test.js
const { test } = require('node:test');
const assert = require('node:assert');

test('path helpers build correct absolute paths under UPLOAD_ROOT', () => {
  process.env.UPLOAD_ROOT = '/tmp/uploads-test';
  delete require.cache[require.resolve('../src/paths')];
  const paths = require('../src/paths');
  assert.strictEqual(paths.originalPath('abc_123', 'jpg'), '/tmp/uploads-test/originals/abc_123.jpg');
  assert.strictEqual(paths.gridPath('abc_123'), '/tmp/uploads-test/grid/abc_123.jpg');
  assert.strictEqual(paths.posterPath('abc_123'), '/tmp/uploads-test/posters/abc_123.jpg');
  assert.strictEqual(paths.videoPath('abc_123'), '/tmp/uploads-test/video/abc_123.mp4');
  assert.strictEqual(paths.manifestPath(), '/tmp/uploads-test/manifest.jsonl');
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `node --test test/paths.test.js`
Expected: FAIL (`../src/paths` not found)

- [ ] **Step 7: Implement `media-service/src/paths.js`**

```js
const path = require('path');

const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/data/uploads';

const originalPath = (id, ext) => path.join(UPLOAD_ROOT, 'originals', `${id}.${ext}`);
const gridPath = (id) => path.join(UPLOAD_ROOT, 'grid', `${id}.jpg`);
const posterPath = (id) => path.join(UPLOAD_ROOT, 'posters', `${id}.jpg`);
const videoPath = (id) => path.join(UPLOAD_ROOT, 'video', `${id}.mp4`);
const manifestPath = () => path.join(UPLOAD_ROOT, 'manifest.jsonl');

module.exports = { UPLOAD_ROOT, originalPath, gridPath, posterPath, videoPath, manifestPath };
```

- [ ] **Step 8: Run to verify it passes**

Run: `node --test test/`
Expected: PASS, all tests green (id + paths)

- [ ] **Step 9: Commit**

```bash
git add media-service/src/id.js media-service/src/paths.js media-service/test/id.test.js media-service/test/paths.test.js
git commit -m "feat(media-service): id generation and path helpers"
```

---

### Task 4: `media-service` — wrapper de ffmpeg y rama de fotos

**Files:**
- Create: `media-service/src/ffmpeg.js`
- Create: `media-service/src/processPhoto.js`
- Test: `media-service/test/ffmpeg.test.js`

**Interfaces:**
- Consumes: `paths` from Task 3.
- Produces: `runCommand(cmd: string, args: string[]): Promise<{ stdout: string }>` (rejects with an `Error` whose message includes `stderr` on non-zero exit — **never builds a shell string**, always `spawn(cmd, args)` with `args` as a literal array); `processPhoto({ id, ext }): Promise<{ width: number, height: number }>` — reads `paths.originalPath(id, ext)`, writes `paths.gridPath(id)`, returns real pixel dimensions of the original.

- [ ] **Step 1: Write the failing test for `runCommand`'s wrapper behavior**

Use a real, always-available command (not `ffmpeg`) so this test runs in any environment:

```js
// media-service/test/ffmpeg.test.js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd media-service && node --test test/ffmpeg.test.js`
Expected: FAIL (`../src/ffmpeg` not found)

- [ ] **Step 3: Implement `media-service/src/ffmpeg.js`**

```js
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
```

`{ shell: false }` (Node's default for `spawn`, stated explicitly) is what makes shell injection impossible regardless of what the guest's filename contains — arguments are passed to the OS process directly, never interpreted by `/bin/sh`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/ffmpeg.test.js`
Expected: PASS, 3/3

- [ ] **Step 5: Implement `media-service/src/processPhoto.js`**

```js
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
```

This step has no automated test here (it needs a real image file and a working `ffmpeg`/`ffprobe` on the machine running the test, which isn't guaranteed in every environment) — Task 7's manual verification step covers it end to end with real test photos, including a HEIC one per the Review Focus. If the HEIC case fails there, come back and adjust this function (e.g. a `magick`/`heif-convert` pre-step) before Task 7 is considered done.

- [ ] **Step 6: Commit**

```bash
git add media-service/src/ffmpeg.js media-service/src/processPhoto.js media-service/test/ffmpeg.test.js
git commit -m "feat(media-service): ffmpeg wrapper and photo processing"
```

---

### Task 5: `media-service` — rama de vídeo

**Files:**
- Create: `media-service/src/processVideo.js`

**Interfaces:**
- Consumes: `runFfmpeg`/`runFfprobe` from Task 4, `paths` from Task 3.
- Produces: `processVideo({ id, ext }): Promise<{ width: number, height: number }>` — writes `paths.posterPath(id)` and `paths.videoPath(id)`.

- [ ] **Step 1: Implement `media-service/src/processVideo.js`**

```js
const { runFfmpeg, runFfprobe } = require('./ffmpeg');
const paths = require('./paths');

async function processVideo({ id, ext }) {
  const original = paths.originalPath(id, ext);
  await runFfmpeg(['-y', '-i', original, '-vframes', '1', '-q:v', '3', paths.posterPath(id)]);
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
```

`-preset veryfast` / `-crf 23` is the time/CPU-vs-quality tradeoff point for the shared VPS under the 5-day deadline — don't raise quality at the cost of significantly longer processing without re-checking the CPU constraint. Dimensions are probed from the transcoded output (not the original) so they match what's actually served.

No automated test here for the same reason as Task 4 Step 5 (needs real `ffmpeg` + a real video file) — covered by Task 7's manual verification, including the near-50MB and HEVC `.mov` cases per the Review Focus.

- [ ] **Step 2: Commit**

```bash
git add media-service/src/processVideo.js
git commit -m "feat(media-service): video processing (poster + transcode)"
```

---

### Task 6: `media-service` — manifiesto

**Files:**
- Create: `media-service/src/manifest.js`
- Test: `media-service/test/manifest.test.js`

**Interfaces:**
- Consumes: `paths.manifestPath()` from Task 3.
- Produces: `appendLine(item: object): void` (synchronous append, one JSON line); `readAll(): object[]` (returns `[]` if the file doesn't exist yet, skips any line that fails to parse).

- [ ] **Step 1: Write the failing tests**

```js
// media-service/test/manifest.test.js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd media-service && node --test test/manifest.test.js`
Expected: FAIL (`../src/manifest` not found)

- [ ] **Step 3: Implement `media-service/src/manifest.js`**

```js
const fs = require('fs');
const paths = require('./paths');

function appendLine(item) {
  fs.mkdirSync(require('path').dirname(paths.manifestPath()), { recursive: true });
  fs.appendFileSync(paths.manifestPath(), JSON.stringify(item) + '\n');
}

function readAll() {
  if (!fs.existsSync(paths.manifestPath())) return [];
  const raw = fs.readFileSync(paths.manifestPath(), 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

module.exports = { appendLine, readAll };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/`
Expected: PASS, all tests green (id + paths + ffmpeg + manifest)

- [ ] **Step 5: Commit**

```bash
git add media-service/src/manifest.js media-service/test/manifest.test.js
git commit -m "feat(media-service): manifest append/read"
```

---

### Task 7: `media-service` — endpoints `POST /upload` y `GET /list`

**Files:**
- Modify: `media-service/src/server.js`

**Interfaces:**
- Consumes: everything from Tasks 3-6 (`id`, `paths`, `processPhoto`, `processVideo`, `manifest`).
- Produces: the two public HTTP endpoints per the Data Contract — this is what the n8n workflows (Tasks 9-10) call.

- [ ] **Step 1: Wire `POST /upload` in `media-service/src/server.js`**

```js
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
    fs.mkdirSync(require('path').dirname(originalPath), { recursive: true });
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
```

The `catch` block deletes every derivative path unconditionally (unlink on a non-existent file is wrapped in its own try/catch and ignored) — this is what guarantees the Review Focus requirement: a failed upload leaves no manifest line and no orphaned files.

- [ ] **Step 2: Manual verification — start the service locally**

Run: `cd media-service && UPLOAD_ROOT=/tmp/media-test node src/server.js`

- [ ] **Step 3: Manual verification — photo upload, including HEIC**

```bash
curl -F data=@test.jpg http://localhost:3000/upload
```
Expected: `201` with a JSON item matching the Data Contract's photo shape; `/tmp/media-test/originals/` and `/tmp/media-test/grid/` contain the files; `manifest.jsonl` has one new line.

Repeat with a HEIC test file (the default format on recent iPhones, and the realistic majority case per the design doc). If it fails, fix `processPhoto` now (Task 4 Step 5's note) rather than deferring.

- [ ] **Step 4: Manual verification — video upload, including near-50MB and a concurrency check**

```bash
curl -F data=@test.mp4 http://localhost:3000/upload
```
Expected: `201`, item matches the video shape, `posters/` and `video/` populated, transcoded file plays when opened directly. Repeat with a video close to the 50MB limit (30-45MB, a minute or more of 1080p) and time the response — must complete, not hang. Then fire two uploads back-to-back (two terminal tabs) and confirm both succeed with distinct, uncorrupted outputs.

- [ ] **Step 5: Manual verification — failure path produces no manifest line**

```bash
curl -F data=@/dev/null;type=video/mp4 http://localhost:3000/upload
```
(or any deliberately corrupt/truncated video `ffmpeg` will reject). Expected: non-2xx response, and `manifest.jsonl`'s line count is unchanged from before this request — confirms the Review Focus guarantee.

- [ ] **Step 6: Manual verification — `GET /list` and a growth check**

```bash
curl http://localhost:3000/list
```
Expected: JSON array containing the items from Steps 3-4. Then append ~100 synthetic valid JSON lines to `manifest.jsonl` directly (copy one real line in a loop, changing `id`) and re-request `/list` — response should stay well under a second (Review Focus: manifest growth over the wedding day). Remove the synthetic lines afterward, stop the local server.

- [ ] **Step 7: Commit**

```bash
git add media-service/src/server.js
git commit -m "feat(media-service): wire POST /upload and GET /list"
```

---

### Task 8: Despliegue de `media-service` en Coolify

**Files:** none (Coolify GUI configuration).

**Interfaces:**
- Produces: `media-service` running and reachable from the `n8n` container over the internal Docker network at some hostname — record the exact hostname/port here once deployed, Tasks 9-10 need it verbatim.

- [ ] **Step 1: Create a new Coolify Application for `media-service`**

Project `Web` (same as `Boda-Dani`) or a new project — either is fine since this isn't a non-goal constraint. Source: the same git repo, Base Directory `/media-service`, Build Pack: Dockerfile. Do **not** set a public domain/FQDN for it (Global Constraint: internal-only).

- [ ] **Step 2: Add the persistent volume**

Same pattern as Task 1: Directory Mount, source `/data/boda-daniel-irene/uploads` (same host path already used by `Boda-Dani` and `n8n`) → destination `/data/uploads`.

- [ ] **Step 3: Ensure it joins the same internal network as `n8n`**

Enable "Connect To Predefined Network" (same setting already seen enabled on the `n8n` and `Boda-Dani` services) so `n8n`'s containers can resolve `media-service` by name.

- [ ] **Step 4: Deploy and verify**

Deploy the application. Once running, determine the internal hostname Coolify assigned (typically the Coolify service/container name) — verify reachability by adding a throwaway Execute-Command-equivalent check is not available (that node is disabled — see the spec), so instead verify via a throwaway n8n HTTP Request node in a scratch workflow: `GET http://<internal-hostname>:3000/health`, confirm `{"status":"ok"}`, then delete/archive the scratch workflow. Record the working internal URL here in the plan (edit this step with the actual value) for Tasks 9-10 to use verbatim.

---

### Task 9: n8n — workflow de subida simplificado

**Files:**
- n8n workflow `Boda Daniel & Irene - Subida de fotos a Drive` (id `UWHftSKj8sNiaOjt`), rename to `Boda Daniel & Irene - Subida de fotos`.

**Interfaces:**
- Consumes: `media-service`'s internal URL from Task 8.
- Produces: the public webhook `boda-daniel-irene-fotos` forwards uploads to `media-service` and relays its response.

- [ ] **Step 1: Delete the Google Drive node**

- [ ] **Step 2: Add an HTTP Request node, named "Reenviar a media-service", between Webhook and the Respond nodes**

Method: POST. URL: `http://<media-service internal hostname from Task 8>:3000/upload`. Body: "Send Binary Data" / multipart form-data, binary property `data`, form field name `data` (matching what `media-service` expects). On Error: "Continue to Error Output" (so a non-2xx response routes to Respond Error instead of stopping the workflow).

- [ ] **Step 3: Rewire**

Webhook → "Reenviar a media-service" → (success) Respond OK, (error) Respond Error. Leave Respond OK/Respond Error's own configuration untouched.

- [ ] **Step 4: Test with a manual execution**

Use "Listen for test event", `curl -F data=@test.jpg <test-url>`, confirm `media-service` received it (check its logs or the resulting file under `/data/uploads/originals/` via the Task 8 verification technique) and the webhook returned success.

- [ ] **Step 5: Publish/save**

Confirm still `Published`, webhook path `boda-daniel-irene-fotos` unchanged.

---

### Task 10: n8n — workflow de listado simplificado

**Files:**
- n8n workflow `Boda Daniel & Irene - Listado de fotos` (id `lHim7mpMSvvhKiwD`).

**Interfaces:**
- Produces: the public webhook `boda-daniel-irene-galeria` forwards to `media-service`'s `GET /list` and relays its body — this is what `js/gallery.js` (Task 11) consumes.

- [ ] **Step 1: Delete the "Search files and folders" (Google Drive) node**

- [ ] **Step 2: Add an HTTP Request node, named "Consultar media-service"**

Method: GET. URL: `http://<media-service internal hostname from Task 8>:3000/list`.

- [ ] **Step 3: Rewire**

Webhook → "Consultar media-service" → "Respond to Webhook", with Respond to Webhook configured to return the HTTP Request node's response body directly (array passthrough).

- [ ] **Step 4: Test with a manual execution**

GET the test webhook URL, confirm the response is the same JSON array `media-service`'s own `/list` returns.

- [ ] **Step 5: Publish/save**

Confirm still `Published`, webhook path `boda-daniel-irene-galeria` unchanged.

---

### Task 11: Frontend — capa de datos de `js/gallery.js`

**Files:**
- Modify: `js/gallery.js`

**Interfaces:**
- Consumes: the JSON array described in the Data Contract, from `GALLERY_WEBHOOK_URL` (unchanged URL).
- Produces: `render(items)` populates `photoGrid`/`videoGrid` with tiles built by Task 13's `createPhotoTile`/`createVideoTile` (this task defines their new call signature; Task 13 implements their bodies).

- [ ] **Step 1: Replace `uploadTimestamp(name)` with `uploadTimestamp(id)`**

Same regex (`^(\d+)_`), now applied to `item.id` instead of `item.name` (the id itself carries the timestamp prefix per the Data Contract; `name` is now just the original filename and may not start with digits).

- [ ] **Step 2: Update `render(items)`'s sort calls**

Change `uploadTimestamp(b.name)` / `uploadTimestamp(a.name)` to `uploadTimestamp(b.id)` / `uploadTimestamp(a.id)` in both the `photos` and `videos` sort comparators. No other change to `render`'s filter/dedupe/insert structure.

- [ ] **Step 3: Update `createPhotoTile(item)`'s image source**

Replace the `https://drive.google.com/thumbnail?id=...` construction with `item.gridUrl` directly; remove the `error` listener's fallback to `drive.google.com/uc?export=view` (no longer applicable — if `gridUrl` 404s there is no Drive fallback to fall back to, so leave `img.src = item.gridUrl` unguarded). The existing `img.addEventListener('click', () => openLightbox(item.id))` call stays as-is — Task 14 changes what `openLightbox` does internally with that `id`, not how it's called.

- [ ] **Step 4: Manual verification**

With Task 10 already returning real data from the test uploads, open `galeria.html` on production (per this project's established pattern, Drive/webhook quirks mean production is the reliable place to test, not `localhost`), confirm the test tiles render with correct images in `#photo-grid`/`#video-grid` (ugly/un-styled is fine at this point — Task 12 handles layout; `openLightbox` itself is still Drive-based and untouched — Task 14 rewrites it fully, so don't test clicking into it yet).

---

### Task 12: Frontend — layout masonry y proporciones reales

**Files:**
- Modify: `galeria.html` (CSS only, lines ~159–209 per current file: `.gallery-grid`, `.gallery-tile`, `.video-tile`, `.skeleton-tile` rules)

**Interfaces:**
- Consumes: Task 11's rendered `<img>`/tile elements inside `#photo-grid`/`#video-grid`.

- [ ] **Step 1: Replace `.gallery-grid` with a CSS multi-column layout**

```css
.gallery-grid {
  column-count: 2;
  column-gap: 0.9rem;
}
@media (min-width: 640px) { .gallery-grid { column-count: 3; } }
@media (min-width: 960px) { .gallery-grid { column-count: 4; } }
```
Remove the old `grid-template-columns`/`.video-grid` auto-fit override — both photo and video grids use the same column rule now (no separate video-specific column count).

- [ ] **Step 2: Replace `.gallery-tile`'s forced `aspect-ratio: 1/1` with natural sizing**

```css
.gallery-tile {
  display: block;
  break-inside: avoid;
  margin-bottom: 0.9rem;
  border-radius: 16px;
  overflow: hidden;
  /* keep existing background/border/box-shadow/transition/hover rules unchanged */
}
.gallery-tile img { width: 100%; height: auto; display: block; cursor: zoom-in; }
```
Keep the existing `:hover` transform/zoom rules as-is (they don't depend on `aspect-ratio`).

- [ ] **Step 3: Remove `.video-tile { aspect-ratio: 16/9; }` and the iframe-specific rules**

`.video-tile iframe` and `.video-shield` rules are deleted in this task (Task 13 replaces the video tile's internal markup and adds its own CSS for the poster+play-icon look).

- [ ] **Step 4: Update `.skeleton-tile` to a fixed height instead of `aspect-ratio: 1/1`**

Masonry columns can't predict a skeleton's eventual aspect ratio before the real item loads, so use a representative fixed height instead: `.skeleton-tile { height: 220px; break-inside: avoid; margin-bottom: 0.9rem; }` (keep the existing shimmer animation/background rules). Remove the now-unused `.skeleton-tile.video-skeleton { aspect-ratio: 16/10; }` override.

- [ ] **Step 5: Manual verification**

Reload the gallery with the Task 11 test items plus a handful of temporary cloned tiles (same technique used earlier in this project: temporarily duplicate a tile in devtools, remove after) to confirm columns wrap, tiles keep real aspect ratio without cropping, and nothing overlaps at phone width (375px) and desktop width.

---

### Task 13: Frontend — tarjeta de vídeo con póster propio y reproductor nativo

**Files:**
- Modify: `js/gallery.js` (`createVideoTile`)
- Modify: `galeria.html` (new CSS for the poster/play-icon tile)

**Interfaces:**
- Consumes: `item.posterUrl`, `item.url` (the transcoded mp4) from the Data Contract.
- Produces: a tile whose click behavior matches `createPhotoTile`'s (opens the lightbox via whatever mechanism Task 11 Step 3 set up / Task 14 finalizes).

- [ ] **Step 1: Rewrite `createVideoTile(item)` to build a poster-image tile**

```js
function createVideoTile(item) {
  const tile = document.createElement('div');
  tile.className = 'gallery-tile video-tile';
  const img = document.createElement('img');
  img.src = item.posterUrl;
  img.alt = item.name || '';
  img.loading = 'lazy';
  img.addEventListener('click', () => openLightbox(item.id));
  const playIcon = document.createElement('div');
  playIcon.className = 'play-icon';
  tile.appendChild(img);
  tile.appendChild(playIcon);
  return tile;
}
```
No `<iframe>`, no `.video-shield` — those only existed to cope with Drive's embed, which is gone.

- [ ] **Step 2: Add CSS for `.video-tile` and `.play-icon`**

```css
.video-tile { position: relative; }
.play-icon {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 46px; height: 46px; border-radius: 50%;
  background: rgba(246,247,245,0.92); box-shadow: 0 4px 14px rgba(31,51,71,0.35);
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.play-icon::after {
  content: ''; width: 0; height: 0; margin-left: 3px;
  border-top: 8px solid transparent; border-bottom: 8px solid transparent;
  border-left: 13px solid var(--gold);
}
```

- [ ] **Step 3: Manual verification**

With a test video now flowing through Tasks 11-13, confirm the video tile shows the poster with a centered play icon (no Drive branding anywhere) at its correct aspect ratio (no black bars forced by a 16:9 container). `openLightbox` is still Drive-based and untouched at this point — Task 14 rewrites it to actually play the video with native controls (`<video controls playsinline>`, matching the plan's deadline-driven decision to skip custom player chrome), so don't test clicking into it yet.

---

### Task 14: Frontend — lightbox con navegación y contador

**Files:**
- Modify: `js/gallery.js` (`openLightbox`)
- Modify: `galeria.html` (CSS for nav buttons + counter)

**Interfaces:**
- Consumes: the full sorted list of currently-rendered items (photos + videos combined in display order) and the clicked item's `id`.
- Produces: final `openLightbox` signature other code calls — `openLightbox(id)`, looking up position internally (keeps Task 13's call site unchanged).

- [ ] **Step 1: Track a flat, ordered list of all rendered items for navigation**

In the closure that already holds `renderedIds`, add `let orderedItems = [];` and, inside `render(items)`, after computing `photos`/`videos`, set `orderedItems = [...photos, ...videos];` (display order: photos tab items then videos tab items, matching the two grids' own internal order — exact tie-break behavior between mixed sets is acceptable as long as it's the same list both tabs' tiles index into).

- [ ] **Step 2: Rewrite `openLightbox` to take just the clicked `id` and navigate via `orderedItems`**

```js
function openLightbox(id) {
  let index = orderedItems.findIndex(i => i.id === id);
  if (index === -1) return;
  const overlay = document.createElement('div');
  overlay.className = 'gallery-lightbox';
  const counter = document.createElement('div');
  counter.className = 'lightbox-counter';
  const prevBtn = document.createElement('button');
  prevBtn.className = 'lightbox-nav lightbox-prev'; prevBtn.type = 'button'; prevBtn.setAttribute('aria-label', 'Anterior'); prevBtn.textContent = '‹';
  const nextBtn = document.createElement('button');
  nextBtn.className = 'lightbox-nav lightbox-next'; nextBtn.type = 'button'; nextBtn.setAttribute('aria-label', 'Siguiente'); nextBtn.textContent = '›';
  const close = document.createElement('button');
  close.className = 'lightbox-close'; close.type = 'button'; close.setAttribute('aria-label', 'Cerrar'); close.textContent = '✕';
  let mediaEl = null;

  function renderMedia() {
    if (mediaEl) { if (mediaEl.tagName === 'VIDEO') mediaEl.pause(); mediaEl.remove(); }
    const item = orderedItems[index];
    if (item.mimeType === 'video/mp4') {
      mediaEl = document.createElement('video');
      mediaEl.controls = true; mediaEl.playsInline = true; mediaEl.src = item.url; mediaEl.poster = item.posterUrl;
    } else {
      mediaEl = document.createElement('img');
      mediaEl.src = item.url;
    }
    overlay.insertBefore(mediaEl, counter);
    counter.textContent = `${index + 1} / ${orderedItems.length}`;
  }

  function go(delta) {
    index = (index + delta + orderedItems.length) % orderedItems.length;
    renderMedia();
  }

  function closeLightbox() {
    if (mediaEl && mediaEl.tagName === 'VIDEO') mediaEl.pause();
    overlay.classList.remove('is-open');
    document.removeEventListener('keydown', onKeydown);
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  }
  function onKeydown(e) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  }

  overlay.appendChild(prevBtn);
  overlay.appendChild(counter);
  overlay.appendChild(nextBtn);
  overlay.appendChild(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLightbox(); });
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  close.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', onKeydown);
  document.body.appendChild(overlay);
  renderMedia();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}
```

Note the explicit `mediaEl.pause()` calls (on navigation and on close) before removing/replacing a `<video>` element — this is what keeps audio from continuing to play after the element is gone.

- [ ] **Step 3: Add CSS for `.lightbox-nav` and `.lightbox-counter`**

```css
.lightbox-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 44px; height: 44px; border-radius: 50%;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25);
  color: #f6f7f5; font-size: 1.4rem; line-height: 1; cursor: pointer;
}
.lightbox-prev { left: 1rem; }
.lightbox-next { right: 1rem; }
.lightbox-counter {
  position: absolute; bottom: 1.1rem; left: 50%; transform: translateX(-50%);
  font-size: 0.78rem; letter-spacing: 0.05em; color: #f6f7f5;
  background: rgba(0,0,0,0.35); padding: 0.3rem 0.8rem; border-radius: 999px;
}
```

- [ ] **Step 4: Manual verification**

With at least 3 mixed test items rendered (reuse Task 12's temporary clones or upload one more real test photo), open the lightbox from any tile, confirm the counter shows the correct `N / total`, arrow buttons and ← → keys both move between items without closing the overlay, a playing video stops (no audio continuing) when navigating away or closing, and Escape/click-outside still closes it.

---

### Task 15: Validación end-to-end

**Files:** none (manual QA pass across everything above).

- [ ] **Step 1: Confirm the date lock is untouched**

Open `galeria.html` and `subir.html` in a browser with the system clock unchanged (still before 2026-10-24); confirm the lock card / disabled upload button still show, exactly as before this plan started.

- [ ] **Step 2: Real mobile upload — vertical photo**

From an actual phone, upload one vertical photo via `subir.html` in production. Confirm it appears in the masonry grid within one poll cycle (≤20s), in its real portrait aspect ratio, with no Drive branding anywhere, and opens correctly in the lightbox.

- [ ] **Step 3: Real mobile upload — vertical video**

From an actual phone, upload one short vertical video. Confirm the poster tile appears, plays correctly via native controls when opened, in its real aspect ratio, in at least two browser/device combinations (e.g. Safari iOS and Chrome Android, per Review Focus).

- [ ] **Step 4: Resource check**

After the two test uploads, re-check Coolify's CPU/RAM metrics (as earlier in this project) and disk usage (`df -h` on the VPS, same method used earlier) to confirm nothing spiked unexpectedly.

- [ ] **Step 5: Clean up test uploads**

Remove the test entries' files and manifest lines so the gallery is empty and ready for real guests before 2026-10-24 (`manifest.jsonl` is a plain text file — remove the relevant lines directly; delete the corresponding files under `originals/`, `grid/`/`posters/`/`video/`).
