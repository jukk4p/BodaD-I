# Rediseño premium de la galería — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Google-Drive-backed live gallery with media served from the project's own VPS, and rebuild `galeria.html`/`js/gallery.js` as an "Editorial Masonry" layout with real aspect ratios, a native video player, and a navigable lightbox.

**Architecture:** Two n8n workflows (`Boda Daniel & Irene - Subida de fotos a Drive`, id `UWHftSKj8sNiaOjt`; `Boda Daniel & Irene - Listado de fotos`, id `lHim7mpMSvvhKiwD`) are edited node-by-node in place — the Drive upload/search nodes are replaced with filesystem writes, `ffmpeg`-based processing, and an append-only manifest file on a Coolify-managed persistent volume shared between the `n8n` service and the `Boda-Dani` static site. The frontend (`galeria.html`, `js/gallery.js`) is rewritten to consume the new manifest shape directly (no more Drive URL construction) and to render a CSS-columns masonry grid.

**Tech Stack:** n8n (Webhook / Code / Execute Command / Write Binary File nodes), `ffmpeg` for image/video processing, Coolify-managed Docker volumes, nginx (`Boda-Dani`'s static image) for serving, vanilla HTML/CSS/JS frontend (no build step, no test framework present in this repo).

**Spec:** `docs/superpowers/specs/2026-10-19-gallery-premium-redesign-design.md`

## Global Constraints

- Wedding date lock: `galleryActive`/`uploadActive` compare `Date.now()` against `new Date('2026-10-24T00:00:00').getTime()` — this mechanism and timestamp must not change.
- Upload limits unchanged: 50MB max file size, `image/*` and `video/*` accepted (enforced client-side today in `js/upload.js`; this plan does not touch that file).
- Filenames must not embed the guest's original filename in the stored path; the id is `{timestampMs}_{random8hex}` so paths stay non-guessable. The original filename is preserved only inside the manifest's `name` field (JSON string, not a path).
- `/uploads/` must not allow directory listing (`autoindex off` in nginx).
- Disk budget: VPS-2, 73GB total, 51GB free / 31% used confirmed 2026-10-19 — stay well inside this.
- CPU budget: shared VPS (n8n + Postgres + ~10 other Coolify services). Process one upload at a time; no batch/background re-processing jobs.
- Keep existing visual tokens from `galeria.html`'s `:root` (`--ink`, `--ink-deep`, `--gold`, etc.), fonts (Fraunces/Archivo), and all existing Spanish copy not explicitly changed by a task.
- Both n8n workflows keep their existing webhook paths (`boda-daniel-irene-fotos`, `boda-daniel-irene-galeria`) and stay `Published` — `subir.html`/`js/upload.js`/`js/gallery.js` hardcode these URLs and are not being changed to point elsewhere.
- Do not delete the Google Drive folder, credential, or the old Drive nodes' configuration history — out of scope, no cleanup required there.

## Review Focus

- **A near-50MB video upload**: `ffmpeg` transcoding must complete without the webhook timing out or leaving a partial/corrupt file behind if it fails midway. (Task 4)
- **iPhone photos/videos (HEIC stills, HEVC `.mov`)**: these are the majority real-world input per the design doc's "mayormente con el móvil" — processing must handle them, not just generic JPEG/MP4. (Tasks 3, 4)
- **Two guests uploading at the same moment**: concurrent `ffmpeg` Execute Command runs on the shared VPS must not be left unbounded — the plan must state what protects the other co-hosted services. (Task 4)
- **A failed/partial upload** (guest loses signal mid-upload): no entry should appear in `manifest.jsonl` unless the original file and all derivatives were written successfully — a partial entry would show a broken tile to every guest. (Task 5)
- **The manifest growing to hundreds of lines over the wedding day**: the listing workflow re-reads and the frontend re-polls every 20s — response time must stay reasonable as the file grows across a single day's uploads. (Task 6)

---

## File Structure

- Modify: `js/gallery.js` — data layer (`fetchAndRender`, `render`), tile creation (`createPhotoTile`, `createVideoTile`), lightbox (`openLightbox`).
- Modify: `galeria.html` — grid CSS (masonry), tile CSS (real aspect ratio, video poster + play icon), lightbox CSS (nav arrows + counter), lightbox markup additions.
- n8n workflow `Boda Daniel & Irene - Subida de fotos a Drive` (id `UWHftSKj8sNiaOjt`) — edited in the n8n editor, no local file. Renamed to `Boda Daniel & Irene - Subida de fotos`.
- n8n workflow `Boda Daniel & Irene - Listado de fotos` (id `lHim7mpMSvvhKiwD`) — edited in the n8n editor, no local file.
- Create: `n8n-backups/boda-daniel-irene-subida.json`, `n8n-backups/boda-daniel-irene-listado.json` — exported workflow JSON, committed for rollback.
- Coolify: persistent storage config on the `Boda-Dani` app and the `n8n` service (GUI config, no local file) + `Boda-Dani`'s Custom Nginx Configuration field.

## Data Contract (pins Tasks 2–7 together)

Shared volume layout, mounted at host path `/data/boda-daniel-irene/uploads` in both the `n8n` service (container path `/data/uploads`, read-write) and the `Boda-Dani` app (container path `/usr/share/nginx/html/uploads`, read-only is fine):

```
uploads/
  originals/{id}.{ext}       # exactly as uploaded
  grid/{id}.jpg              # photos only: resized grid thumbnail
  posters/{id}.jpg           # videos only: first-frame poster
  video/{id}.mp4             # videos only: transcoded H.264/AAC
  manifest.jsonl             # append-only, one JSON object per line
```

`id` = `{Date.now() in ms}_{8 random hex chars}`, computed once per upload and reused for every derivative filename.

One manifest line, photo:
```json
{"id":"1792424443123_a1b2c3d4","name":"IMG_0231.jpg","mimeType":"image/jpeg","width":1440,"height":1920,"url":"https://bodadaniyirene.ivangonzalez.cloud/uploads/originals/1792424443123_a1b2c3d4.jpg","gridUrl":"https://bodadaniyirene.ivangonzalez.cloud/uploads/grid/1792424443123_a1b2c3d4.jpg"}
```

One manifest line, video (`mimeType` is always `video/mp4` post-transcode, regardless of the original container):
```json
{"id":"1792424443123_f7e6d5c4","name":"VID_0098.mov","mimeType":"video/mp4","width":1080,"height":1920,"url":"https://bodadaniyirene.ivangonzalez.cloud/uploads/video/1792424443123_f7e6d5c4.mp4","posterUrl":"https://bodadaniyirene.ivangonzalez.cloud/uploads/posters/1792424443123_f7e6d5c4.jpg"}
```

The listing webhook (`boda-daniel-irene-galeria`) responds with a JSON array of these objects — same outer shape (`Array<Item>`) as today, so `js/gallery.js`'s existing `render(items)` filter/sort/dedupe structure is preserved; only field names and tile-building change.

---

### Task 1: Infraestructura — volumen persistente, ruta estática, backup de workflows

**Files:**
- Create: `n8n-backups/boda-daniel-irene-subida.json`
- Create: `n8n-backups/boda-daniel-irene-listado.json`
- Coolify GUI: `Boda-Dani` app → Persistent Storage, Advanced (Custom Nginx Configuration); `n8n` service → Persistent Storage.

**Interfaces:**
- Produces: the shared volume at host path `/data/boda-daniel-irene/uploads`, writable from `n8n` at `/data/uploads`, served read-only by `Boda-Dani` at `/usr/share/nginx/html/uploads` → public URL prefix `https://bodadaniyirene.ivangonzalez.cloud/uploads/`. All later tasks assume this exists.

- [ ] **Step 1: Export both n8n workflows**

In the n8n editor, open each workflow → `...` menu → Download. Save as `n8n-backups/boda-daniel-irene-subida.json` (from `UWHftSKj8sNiaOjt`) and `n8n-backups/boda-daniel-irene-listado.json` (from `lHim7mpMSvvhKiwD`) in the repo.

- [ ] **Step 2: Commit the backups**

```bash
git add n8n-backups/boda-daniel-irene-subida.json n8n-backups/boda-daniel-irene-listado.json
git commit -m "chore: backup n8n workflows before Drive-to-VPS media migration"
```

- [ ] **Step 3: Add a persistent volume to the `Boda-Dani` app in Coolify**

Coolify → `Boda-Dani` → Persistent Storage → Add: source `/data/boda-daniel-irene/uploads` (host path), destination `/usr/share/nginx/html/uploads` (container path).

- [ ] **Step 4: Add the same host path as a volume on the `n8n` service in Coolify**

Coolify → `n8n` service → Persistent Storage → Add: source `/data/boda-daniel-irene/uploads` (same host path as Step 3), destination `/data/uploads` (container path n8n will read/write).

- [ ] **Step 5: Disable directory listing for `/uploads/`**

In `Boda-Dani` → Configuration → Custom Nginx Configuration, add a `location /uploads/ { autoindex off; }` block (or confirm the generated default config already has `autoindex off` globally — Coolify's default nginx config typically does; verify rather than assume).

- [ ] **Step 6: Redeploy both services and verify the mount**

Redeploy `Boda-Dani` and restart `n8n` from Coolify so the new volumes attach. From n8n, use a one-off Execute Command node (delete it after) to run `echo "ok" > /data/uploads/healthcheck.txt`, then confirm `https://bodadaniyirene.ivangonzalez.cloud/uploads/healthcheck.txt` returns `ok` in a browser. Delete `healthcheck.txt` afterward (via another Execute Command) and remove the throwaway node.

- [ ] **Step 7: Confirm `ffmpeg` is available in the n8n container**

Add a throwaway Execute Command node running `ffmpeg -version`. If it fails (command not found), note this — Tasks 3 and 4 need `ffmpeg` on the same host n8n's Execute Command runs on; if missing, the fix (custom n8n image with `ffmpeg` installed, or an init script) must land before Task 3 starts. Delete the throwaway node once confirmed either way.

---

### Task 2: Workflow de subida — escribir el original con id no adivinable

**Files:**
- n8n workflow `Boda Daniel & Irene - Subida de fotos a Drive` (id `UWHftSKj8sNiaOjt`), rename to `Boda Daniel & Irene - Subida de fotos`.

**Interfaces:**
- Consumes: Webhook node's existing binary property `data` (field name already configured, unchanged), `$binary.data.fileName`, `$binary.data.mimeType`.
- Produces: workflow variable/Code-node output `{ id, ext, mimeType, name }` available to Tasks 3–5 via n8n's standard item-passing (each downstream node reads `$json.id` etc. from this Code node's output); the original file written to `/data/uploads/originals/{id}.{ext}`.

- [ ] **Step 1: Add a Code node right after Webhook, named "Build id"**

JavaScript body computes and returns one item:
```js
const id = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
const originalName = $binary.data.fileName || 'archivo';
const ext = (originalName.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
return [{ json: { id, ext, mimeType: $binary.data.mimeType, name: originalName }, binary: { data: $binary.data } }];
```

- [ ] **Step 2: Add a Write Binary File node, named "Save original", after "Build id"**

File Name (expression): `/data/uploads/originals/{{ $json.id }}.{{ $json.ext }}`. Input Binary Field: `data`.

- [ ] **Step 3: Remove the old "Google Drive" (upload) node and rewire**

Delete the Google Drive node. Connect "Save original"'s output to wherever "Success"/"Respond OK" previously received the Google Drive node's `Success` output (this task does not change Respond OK/Respond Error's own configuration, only what feeds them — final rewiring to Respond OK happens in Task 5 once the full chain exists; for now, temporarily connect "Save original" directly to Respond OK so the workflow is runnable and testable in isolation).

- [ ] **Step 4: Test with a manual execution**

Use n8n's "Listen for test event" on the Webhook node, POST a small test image to the test webhook URL with field name `data` (e.g. via `curl -F data=@test.jpg <test-url>`), then confirm in the n8n editor that "Save original" ran and that the file exists at the expected path (check via the Task 1 technique: a throwaway Execute Command `ls /data/uploads/originals/`, or confirm the file is reachable at `https://bodadaniyirene.ivangonzalez.cloud/uploads/originals/{id}.{ext}`).

- [ ] **Step 5: Save the workflow**

Save in the n8n editor (n8n auto-persists; no git commit for this step since the workflow has no local file yet — Task 1's exported JSON is the pre-migration backup, not kept in sync node-by-node).

---

### Task 3: Workflow de subida — rama de fotos (miniatura + dimensiones)

**Files:**
- Same n8n workflow as Task 2.

**Interfaces:**
- Consumes: `{ id, ext, mimeType, name }` from Task 2's "Build id" node; original file at `/data/uploads/originals/{id}.{ext}`.
- Produces: `/data/uploads/grid/{id}.jpg` when `mimeType` starts with `image/`; a Code node output adding `{ width, height }` (pixels) to the item for Task 5's manifest line.

- [ ] **Step 1: Add an IF node, named "¿Es foto?", after "Save original"**

Condition: `{{ $json.mimeType.startsWith('image/') }}` is `true`.

- [ ] **Step 2: On the true branch, add an Execute Command node, named "Generar miniatura"**

Command (expression-built): `ffmpeg -y -i /data/uploads/originals/{{ $json.id }}.{{ $json.ext }} -vf "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease" -q:v 3 /data/uploads/grid/{{ $json.id }}.jpg`. This also implicitly handles HEIC input if the n8n host's `ffmpeg` build includes `libheif` — if Task 1 Step 7's `ffmpeg -version` check shows no HEIC support, this step must instead shell out to `magick`/`heif-convert` first; record which path was used.

- [ ] **Step 3: Add an Execute Command node, named "Leer dimensiones"**

Command: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 /data/uploads/originals/{{ $('Build id').item.json.id }}.{{ $('Build id').item.json.ext }}` — note the `$('Build id').item.json...` reference, not `$json`: this node follows "Generar miniatura" (an Execute Command node), whose own output replaces `$json` with `{ stdout, stderr, exitCode }`, so `id`/`ext` are no longer directly on `$json` here. Output is a single `WIDTHxHEIGHT` token on stdout (`-of csv=s=x:p=0`).

- [ ] **Step 4: Add a Code node, named "Adjuntar dimensiones (foto)"**

Parses the previous node's stdout and merges onto the item:
```js
const [width, height] = $input.first().json.stdout.trim().split('x').map(Number);
return [{ json: { ...$('Build id').first().json, width, height } }];
```

- [ ] **Step 5: Test with a manual execution, including a HEIC photo**

Re-run the Task 2 test image through the workflow, then repeat with a HEIC photo (the default format on recent iPhones, and the realistic majority case per the design doc) — export or find a `.heic` test file rather than skipping this. Confirm `/data/uploads/grid/{id}.jpg` exists and is reachable over HTTPS for both, and that "Adjuntar dimensiones (foto)"'s output item has numeric `width`/`height` matching each test image's real dimensions. If the HEIC case fails, resolve it now (per Step 2's `libheif`/`heif-convert` note) rather than deferring — this is the dominant real-world input per the Review Focus.

---

### Task 4: Workflow de subida — rama de vídeo (póster + transcodificación + dimensiones)

**Files:**
- Same n8n workflow as Task 2.

**Interfaces:**
- Consumes: same as Task 3, on the IF node's false branch (`mimeType` starts with `video/`).
- Produces: `/data/uploads/posters/{id}.jpg`, `/data/uploads/video/{id}.mp4`; a Code node output adding `{ width, height }` for Task 5.

- [ ] **Step 1: On "¿Es foto?"'s false branch, add an Execute Command node, named "Generar póster"**

Command: `ffmpeg -y -i /data/uploads/originals/{{ $json.id }}.{{ $json.ext }} -vframes 1 -q:v 3 /data/uploads/posters/{{ $json.id }}.jpg`. This node directly follows the IF node's false branch, so `$json` is still "Build id"'s output here — the node-reference form (needed in Steps 2–3 below) isn't required yet.

- [ ] **Step 2: Add an Execute Command node, named "Transcodificar vídeo"**

Command: `ffmpeg -y -i /data/uploads/originals/{{ $('Build id').item.json.id }}.{{ $('Build id').item.json.ext }} -c:v libx264 -preset veryfast -crf 23 -vf "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease" -c:a aac -b:a 128k -movflags +faststart /data/uploads/video/{{ $('Build id').item.json.id }}.mp4`. Uses the `$('Build id').item.json...` reference because this node follows "Generar póster" (an Execute Command node), whose output replaces `$json` with `{ stdout, stderr, exitCode }`. `-preset veryfast` and `-crf 23` are the time/CPU-vs-quality tradeoff point for the shared VPS under the 5-day deadline — do not raise quality at the cost of significantly longer processing without re-checking the CPU constraint.

- [ ] **Step 3: Add an Execute Command node, named "Leer dimensiones (vídeo)"**

Command: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 /data/uploads/video/{{ $('Build id').item.json.id }}.mp4` (same node-reference reasoning as Step 2; probes the transcoded output, not the original, so dimensions match what's actually served).

- [ ] **Step 4: Add a Code node, named "Adjuntar dimensiones (vídeo)"**

Same parsing pattern as Task 3 Step 4, merged onto `{ ...$('Build id').first().json, mimeType: 'video/mp4', width, height }` — note `mimeType` is overwritten to `video/mp4` here per the Data Contract, regardless of the original container.

- [ ] **Step 5: Guard against concurrent heavy processing**

In n8n → Settings (or this workflow's Settings tab) confirm/set the webhook's execution mode so uploads process one at a time rather than spawning unbounded parallel `ffmpeg` processes (n8n's default queue concurrency for a single workflow is effectively sequential per execution unless explicitly parallelized — confirm this is the case rather than assuming; if not, add a Wait/semaphore pattern). This exists to satisfy the Global Constraint on shared-VPS CPU usage.

- [ ] **Step 6: Test with a manual execution, including a near-50MB video and a concurrency check**

POST a short test video first (`curl -F data=@test.mp4 <test-url>`), then repeat with a video close to the 50MB client-side limit (e.g. 30-45MB, a minute or more of 1080p footage) and time how long the webhook response takes — it must complete, not time out, and must not leave a partial/corrupt file in `/data/uploads/video/` if anything in the chain fails (cross-check with Task 5 Step 4's failure-path test). Then fire two test videos back-to-back (two terminal tabs, near-simultaneous `curl`) and confirm both produce distinct, uncorrupted `{id}.mp4` outputs — their different `id`s prevent filename collisions, but this confirms Step 5's sequential-processing assumption actually holds under the n8n instance's real configuration. For all cases, confirm `/data/uploads/posters/{id}.jpg` and `/data/uploads/video/{id}.mp4` exist and are reachable over HTTPS, that the transcoded video plays (open the URL directly in a browser tab), and that "Adjuntar dimensiones (vídeo)" produced correct numeric `width`/`height`.

---

### Task 5: Workflow de subida — escribir en el manifiesto y responder

**Files:**
- Same n8n workflow as Task 2.

**Interfaces:**
- Consumes: the merged item from Task 3's "Adjuntar dimensiones (foto)" or Task 4's "Adjuntar dimensiones (vídeo)" (both branches rejoin here).
- Produces: one appended line in `/data/uploads/manifest.jsonl` per successful upload; final wiring to the existing Respond OK / Respond Error nodes.

- [ ] **Step 1: Add a Merge node (or let both IF branches point to one shared next node) named "Construir línea de manifiesto" (Code node)**

```js
const d = $json;
const base = { id: d.id, name: d.name, mimeType: d.mimeType, width: d.width, height: d.height };
const root = 'https://bodadaniyirene.ivangonzalez.cloud/uploads/';
let extra;
if (d.mimeType.startsWith('image/')) {
  extra = { url: `${root}originals/${d.id}.${d.ext}`, gridUrl: `${root}grid/${d.id}.jpg` };
} else {
  extra = { url: `${root}video/${d.id}.mp4`, posterUrl: `${root}posters/${d.id}.jpg` };
}
return [{ json: { ...base, ...extra, line: JSON.stringify({ ...base, ...extra }) } }];
```
Note photos keep `d.ext` in their original-file URL (Task 2's write path), consistent with the Data Contract's photo example.

- [ ] **Step 2: Add an Execute Command node, named "Añadir al manifiesto"**

Command (expression): ``echo '{{ $json.line.replace(/'/g, "'\\''") }}' >> /data/uploads/manifest.jsonl``. The replace guards against single quotes inside `name` breaking the shell command.

- [ ] **Step 3: Rewire to Respond OK / Respond Error**

Connect "Añadir al manifiesto"'s success output to the existing Respond OK node (undoing Task 2 Step 3's temporary direct wiring). Any node in the chain (Save original, ffmpeg steps, manifest append) that errors should route to the existing Respond Error node — use n8n's per-node "On Error: Continue to Error Output" setting on each new node added in Tasks 2–5 so a failure anywhere in the chain reaches Respond Error instead of silently stopping, and so that a failure never results in a manifest line being written for an incomplete upload (Review Focus item: no ghost entries).

- [ ] **Step 4: Test end-to-end with both a photo and a video, and a deliberate failure**

Re-run both Task 3 and Task 4's test files through the full chain. Confirm `manifest.jsonl` gained exactly one well-formed JSON line per upload, matching the Data Contract shapes, and that the webhook's HTTP response is the same success/error shape `js/upload.js` already expects (it only checks `response.ok`, so this just needs to still return 2xx on success). Then deliberately break one upload (e.g. POST a corrupt/truncated video that `ffmpeg` will fail on) and confirm **no line is appended to `manifest.jsonl`** for it — this is the Review Focus guarantee that a partial upload never produces a broken tile in the gallery.

- [ ] **Step 5: Publish/save the workflow**

Confirm the workflow is still `Published` with the original webhook path `boda-daniel-irene-fotos` intact.

---

### Task 6: Workflow de listado — leer el manifiesto en vez de Drive

**Files:**
- n8n workflow `Boda Daniel & Irene - Listado de fotos` (id `lHim7mpMSvvhKiwD`).

**Interfaces:**
- Produces: the webhook `boda-daniel-irene-galeria` responds with a JSON array of Data-Contract items — this is what `js/gallery.js` (Task 7) consumes.

- [ ] **Step 1: Add an Execute Command node, named "Leer manifiesto", right after Webhook**

Command: `cat /data/uploads/manifest.jsonl 2>/dev/null || true` (the `|| true` so a not-yet-existing file doesn't error out before the first upload of the day).

- [ ] **Step 2: Add a Code node, named "Parsear manifiesto"**

```js
const raw = $input.first().json.stdout || '';
const items = raw.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
return [{ json: { items } }];
```
The `try/catch` per line protects against a line that was only partially flushed to disk if this read ever races a concurrent write — one malformed line is dropped rather than failing the whole response.

- [ ] **Step 3: Remove the old "Search files and folders" (Google Drive) node and rewire**

Delete it. Connect Webhook → "Leer manifiesto" → "Parsear manifiesto" → the existing "Respond to Webhook" node, configuring Respond to Webhook's response body to `{{ $json.items }}` (an array), matching the Data Contract.

- [ ] **Step 4: Test with a manual execution, including a growth check**

GET the test webhook URL (or "Listen for test event" + browser request). Confirm the response is a JSON array containing the items written by Task 5's two test uploads, with all Data-Contract fields present and correctly typed. Then temporarily append ~100 synthetic valid JSON lines to `manifest.jsonl` (copy-paste one real line, adjusting `id`, in a loop) and re-request the webhook — response time should stay well under a second, since this design deliberately avoids re-probing media on every poll (Review Focus: manifest growth over the wedding day). Remove the synthetic lines afterward.

- [ ] **Step 5: Publish/save the workflow**

Confirm the workflow is still `Published` with the original webhook path `boda-daniel-irene-galeria` intact.

---

### Task 7: Frontend — capa de datos de `js/gallery.js`

**Files:**
- Modify: `js/gallery.js`

**Interfaces:**
- Consumes: the JSON array described in the Data Contract, from `GALLERY_WEBHOOK_URL` (unchanged URL).
- Produces: `render(items)` populates `photoGrid`/`videoGrid` with tiles built by Task 9's `createPhotoTile`/`createVideoTile` (this task defines their new call signature; Task 9 implements their bodies).

- [ ] **Step 1: Replace `uploadTimestamp(name)` with `uploadTimestamp(id)`**

Same regex (`^(\d+)_`), now applied to `item.id` instead of `item.name` (the id itself carries the timestamp prefix per the Data Contract; `name` is now just the original filename and may not start with digits).

- [ ] **Step 2: Update `render(items)`'s sort calls**

Change `uploadTimestamp(b.name)` / `uploadTimestamp(a.name)` to `uploadTimestamp(b.id)` / `uploadTimestamp(a.id)` in both the `photos` and `videos` sort comparators. No other change to `render`'s filter/dedupe/insert structure.

- [ ] **Step 3: Update `createPhotoTile(item)`'s image source**

Replace the `https://drive.google.com/thumbnail?id=...` construction with `item.gridUrl` directly; remove the `error` listener's fallback to `drive.google.com/uc?export=view` (no longer applicable — if `gridUrl` 404s there is no Drive fallback to fall back to, so leave `img.src = item.gridUrl` unguarded). The existing `img.addEventListener('click', () => openLightbox(item.id))` call stays as-is — Task 10 changes what `openLightbox` does internally with that `id`, not how it's called.

- [ ] **Step 4: Manual verification**

With Task 6 already returning real data from the two test uploads, open `galeria.html` on production (per this project's established pattern, Drive/webhook quirks mean production is the reliable place to test, not `localhost`), confirm the two test tiles render with correct images in `#photo-grid`/`#video-grid` (ugly/un-styled is fine at this point — Task 8 handles layout; `openLightbox` itself is still Drive-based and untouched — Task 10 rewrites it fully, so don't test clicking into it yet).

---

### Task 8: Frontend — layout masonry y proporciones reales

**Files:**
- Modify: `galeria.html` (CSS only, lines ~159–209 per current file: `.gallery-grid`, `.gallery-tile`, `.video-tile`, `.skeleton-tile` rules)

**Interfaces:**
- Consumes: Task 7's rendered `<img>`/tile elements inside `#photo-grid`/`#video-grid`.

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

`.video-tile iframe` and `.video-shield` rules are deleted in this task (Task 9 replaces the video tile's internal markup and adds its own CSS for the poster+play-icon look).

- [ ] **Step 4: Update `.skeleton-tile` to a fixed height instead of `aspect-ratio: 1/1`**

Masonry columns can't predict a skeleton's eventual aspect ratio before the real item loads, so use a representative fixed height instead: `.skeleton-tile { height: 220px; break-inside: avoid; margin-bottom: 0.9rem; }` (keep the existing shimmer animation/background rules). Remove the now-unused `.skeleton-tile.video-skeleton { aspect-ratio: 16/10; }` override.

- [ ] **Step 5: Manual verification**

Reload the gallery with the two Task 7 test items plus a handful of temporary cloned tiles (same technique used earlier in this project: temporarily duplicate a tile in devtools, remove after) to confirm columns wrap, tiles keep real aspect ratio without cropping, and nothing overlaps at phone width (375px) and desktop width.

---

### Task 9: Frontend — tarjeta de vídeo con póster propio y reproductor nativo

**Files:**
- Modify: `js/gallery.js` (`createVideoTile`)
- Modify: `galeria.html` (new CSS for the poster/play-icon tile)

**Interfaces:**
- Consumes: `item.posterUrl`, `item.url` (the transcoded mp4) from the Data Contract.
- Produces: a tile whose click behavior matches `createPhotoTile`'s (opens the lightbox via whatever mechanism Task 7 Step 3 set up / Task 10 finalizes).

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

With the Task 4 test video now flowing through Tasks 7–9, confirm the video tile shows the poster with a centered play icon (no Drive branding anywhere) at its correct aspect ratio (no black bars forced by a 16:9 container). `openLightbox` is still Drive-based and untouched at this point — Task 10 rewrites it to actually play the video with native controls (`<video controls playsinline>`, matching the plan's deadline-driven decision to skip custom player chrome), so don't test clicking into it yet.

---

### Task 10: Frontend — lightbox con navegación y contador

**Files:**
- Modify: `js/gallery.js` (`openLightbox`)
- Modify: `galeria.html` (CSS for nav buttons + counter)

**Interfaces:**
- Consumes: the full sorted list of currently-rendered items (photos + videos combined in display order) and the clicked item's `id`.
- Produces: final `openLightbox` signature other code calls — `openLightbox(id)`, looking up position internally (keeps Task 9's call site unchanged).

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
    if (mediaEl) mediaEl.remove();
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

With at least 3 mixed test items rendered (reuse Task 8's temporary clones or upload one more real test photo), open the lightbox from any tile, confirm the counter shows the correct `N / total`, arrow buttons and ← → keys both move between items without closing the overlay, videos pause/stop correctly when navigating away (verify no audio keeps playing after `mediaEl.remove()` — if it does, call `mediaEl.pause()` before removal), and Escape/click-outside still closes it.

---

### Task 11: Validación end-to-end

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

Remove the test entries' files and manifest lines so the gallery is empty and ready for real guests before 2026-10-24 (manifest.jsonl is a plain text file — remove the relevant lines directly; delete the corresponding files under `originals/`, `grid/`/`posters/`/`video/`).
