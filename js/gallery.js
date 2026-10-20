// Lógica de la galería en vivo: sincroniza con el listado de media-service
// vía el webhook de n8n. Usada por galeria.html.

const GALLERY_WEBHOOK_URL = 'https://n8n.ivangonzalez.cloud/webhook/boda-daniel-irene-galeria';
const GALLERY_POLL_INTERVAL_MS = 20000;
const GALLERY_SKELETON_COUNT = 6;

function initGallery({ photoGridId, videoGridId, photoEmptyId, videoEmptyId, errorId, photoCountId, videoCountId }) {
  const photoGrid = document.getElementById(photoGridId);
  const videoGrid = document.getElementById(videoGridId);
  const photoEmpty = document.getElementById(photoEmptyId);
  const videoEmpty = document.getElementById(videoEmptyId);
  const errorState = document.getElementById(errorId);
  const photoCount = document.getElementById(photoCountId);
  const videoCount = document.getElementById(videoCountId);
  if (!photoGrid || !videoGrid) return;

  const renderedIds = new Set();
  let orderedItems = [];
  let pollTimer = null;
  let firstLoadDone = false;

  // El id de cada archivo lleva su timestamp de subida como prefijo
  // ({timestampMs}_{hex}) — lo usamos para ordenar sin depender de
  // metadatos adicionales.
  function uploadTimestamp(id) {
    const match = /^(\d+)_/.exec(id || '');
    return match ? parseInt(match[1], 10) : 0;
  }

  function renderSkeletons(grid, count, extraClass) {
    for (let i = 0; i < count; i++) {
      const tile = document.createElement('div');
      tile.className = extraClass ? `skeleton-tile ${extraClass}` : 'skeleton-tile';
      grid.appendChild(tile);
    }
  }

  function clearSkeletons(grid) {
    grid.querySelectorAll('.skeleton-tile').forEach(el => el.remove());
  }

  function createPhotoTile(item) {
    const tile = document.createElement('div');
    tile.className = 'gallery-tile';
    const img = document.createElement('img');
    img.src = item.gridUrl;
    img.alt = item.name || '';
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(item.id));
    tile.appendChild(img);
    return tile;
  }

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

  function openLightbox(id) {
    const list = orderedItems;
    let index = list.findIndex(i => i.id === id);
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
      const item = list[index];
      if (item.mimeType.startsWith('video/')) {
        mediaEl = document.createElement('video');
        mediaEl.controls = true; mediaEl.playsInline = true; mediaEl.src = item.url; mediaEl.poster = item.posterUrl;
      } else {
        mediaEl = document.createElement('img');
        mediaEl.src = item.url;
      }
      overlay.insertBefore(mediaEl, counter);
      counter.textContent = `${index + 1} / ${list.length}`;
    }

    function go(delta) {
      index = (index + delta + list.length) % list.length;
      renderMedia();
    }

    function closeLightbox() {
      if (mediaEl && mediaEl.tagName === 'VIDEO') mediaEl.pause();
      overlay.classList.remove('is-open');
      document.removeEventListener('keydown', onKeydown);
      // Con reduced-motion la transición está desactivada en CSS y
      // transitionend nunca se dispara: quitar el overlay directamente.
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) {
        overlay.remove();
      } else {
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
      }
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

  function render(items) {
    const validItems = items.filter(item => item.mimeType && (item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/')));
    const photos = validItems.filter(item => item.mimeType.startsWith('image/')).sort((a, b) => uploadTimestamp(b.id) - uploadTimestamp(a.id));
    const videos = validItems.filter(item => item.mimeType.startsWith('video/')).sort((a, b) => uploadTimestamp(b.id) - uploadTimestamp(a.id));
    orderedItems = [...photos, ...videos];

    if (!firstLoadDone) {
      clearSkeletons(photoGrid);
      clearSkeletons(videoGrid);
      firstLoadDone = true;
    }

    if (photoEmpty) photoEmpty.hidden = photos.length > 0;
    if (videoEmpty) videoEmpty.hidden = videos.length > 0;
    if (photoCount) photoCount.textContent = photos.length;
    if (videoCount) videoCount.textContent = videos.length;

    photos.filter(item => !renderedIds.has(item.id)).reverse().forEach(item => {
      renderedIds.add(item.id);
      photoGrid.insertBefore(createPhotoTile(item), photoGrid.firstChild);
    });
    videos.filter(item => !renderedIds.has(item.id)).reverse().forEach(item => {
      renderedIds.add(item.id);
      videoGrid.insertBefore(createVideoTile(item), videoGrid.firstChild);
    });
  }

  async function fetchAndRender() {
    try {
      const res = await fetch(GALLERY_WEBHOOK_URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const items = await res.json();
      render(Array.isArray(items) ? items : []);
      if (errorState) errorState.hidden = true;
    } catch (err) {
      if (errorState) errorState.hidden = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    fetchAndRender();
    pollTimer = setInterval(fetchAndRender, GALLERY_POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });

  renderSkeletons(photoGrid, GALLERY_SKELETON_COUNT);
  renderSkeletons(videoGrid, Math.round(GALLERY_SKELETON_COUNT / 2), 'video-skeleton');
  startPolling();
}
