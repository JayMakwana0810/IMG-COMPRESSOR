/**
 * SQUISH — Image Compressor  |  script.js
 * All compression is done client-side using the Canvas API.
 * No files are ever sent to a server.
 */

// =========================================================
//  STATE
// =========================================================

/** @type {{ file: File, originalBlob: Blob, compressedBlob: Blob|null, id: string }[]} */
const imageStore = [];

let currentQuality  = 80;   // 1–100 (maps to 0.01–1.0 for canvas)
let currentFormat   = 'image/jpeg';

// =========================================================
//  DOM REFERENCES
// =========================================================

const dropZone      = document.getElementById('dropZone');
const fileInput     = document.getElementById('fileInput');
const errorBanner   = document.getElementById('errorBanner');
const controlsBar   = document.getElementById('controlsBar');
const imageQueue    = document.getElementById('imageQueue');
const bulkActions   = document.getElementById('bulkActions');
const loadingOverlay= document.getElementById('loadingOverlay');
const qualitySlider = document.getElementById('qualitySlider');
const qualityValue  = document.getElementById('qualityValue');
const themeToggle   = document.getElementById('themeToggle');
const downloadAllBtn= document.getElementById('downloadAllBtn');
const fmtBtns       = document.querySelectorAll('.fmt-btn');

// =========================================================
//  THEME TOGGLE
// =========================================================

themeToggle.addEventListener('click', () => {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
});

// =========================================================
//  DRAG AND DROP
// =========================================================

// Prevent browser defaults for drag events
['dragenter','dragover','dragleave','drop'].forEach(evt => {
  dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
  document.body.addEventListener(evt, e => e.preventDefault());
});

dropZone.addEventListener('dragenter', () => dropZone.classList.add('drag-active'));
dropZone.addEventListener('dragover',  () => dropZone.classList.add('drag-active'));
dropZone.addEventListener('dragleave', e => {
  // Only remove when truly leaving the zone (not entering a child)
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-active');
});
dropZone.addEventListener('drop', e => {
  dropZone.classList.remove('drag-active');
  const files = Array.from(e.dataTransfer.files);
  handleFiles(files);
});

// Click / keyboard activation
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

fileInput.addEventListener('change', () => {
  handleFiles(Array.from(fileInput.files));
  fileInput.value = ''; // reset so the same file can be re-added
});

// =========================================================
//  QUALITY SLIDER
// =========================================================

qualitySlider.addEventListener('input', () => {
  currentQuality = parseInt(qualitySlider.value, 10);
  qualityValue.textContent = currentQuality + '%';

  // Re-compress all existing images with new quality
  imageStore.forEach(item => recompress(item.id));
});

// =========================================================
//  FORMAT BUTTONS
// =========================================================

fmtBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    fmtBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFormat = btn.dataset.fmt;
    // Re-compress all with new format
    imageStore.forEach(item => recompress(item.id));
  });
});

// =========================================================
//  DOWNLOAD ALL
// =========================================================

downloadAllBtn.addEventListener('click', () => {
  imageStore.forEach(item => {
    if (item.compressedBlob) downloadBlob(item.compressedBlob, buildFilename(item.file.name));
  });
});

// =========================================================
//  FILE HANDLING
// =========================================================

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB   = 20;

/**
 * Entry point — validates files then queues them for compression.
 * @param {File[]} files
 */
async function handleFiles(files) {
  hideError();

  const valid   = [];
  const errors  = [];

  files.forEach(file => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      errors.push(`"${file.name}" is not a supported format (JPG, PNG, WebP only).`);
    } else if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      errors.push(`"${file.name}" exceeds the ${MAX_SIZE_MB} MB size limit.`);
    } else {
      valid.push(file);
    }
  });

  if (errors.length) showError(errors.join(' '));
  if (!valid.length) return;

  // Show controls
  controlsBar.classList.remove('hidden');
  imageQueue.classList.remove('hidden');
  if (valid.length > 1 || imageStore.length > 0) bulkActions.classList.remove('hidden');

  // Process each valid file
  for (const file of valid) {
    const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const entry = { id, file, originalBlob: file, compressedBlob: null };
    imageStore.push(entry);
    createCard(entry);
    await compress(entry); // compress sequentially to avoid memory spikes
  }

  // Show "Download All" if more than one image
  if (imageStore.length > 1) bulkActions.classList.remove('hidden');
}

// =========================================================
//  COMPRESSION (Canvas API)
// =========================================================

/**
 * Compresses an image entry and updates its card.
 * @param {{ id: string, file: File, originalBlob: Blob }} entry
 */
async function compress(entry) {
  setCardLoading(entry.id, true);
  try {
    const blob = await compressImage(entry.originalBlob, currentQuality, currentFormat);
    entry.compressedBlob = blob;
    updateCard(entry);
  } catch (err) {
    console.error('Compression failed:', err);
    showError(`Failed to compress "${entry.file.name}". The file may be corrupted.`);
  } finally {
    setCardLoading(entry.id, false);
  }
}

/**
 * Re-compress an existing entry (after quality/format change).
 * @param {string} id
 */
async function recompress(id) {
  const entry = imageStore.find(e => e.id === id);
  if (entry) await compress(entry);
}

/**
 * Core canvas-based compression.
 * @param {Blob}   blob     - Source image blob
 * @param {number} quality  - 1–100
 * @param {string} format   - MIME type
 * @returns {Promise<Blob>}
 */
function compressImage(blob, quality, format) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img  = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      // For PNG there is no quality parameter — canvas always outputs lossless.
      // We still pass it so future format switches work.
      const canvas  = document.createElement('canvas');
      const ctx     = canvas.getContext('2d');

      // Respect natural image dimensions (no upscale)
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;

      // White background for formats that don't support transparency (JPEG)
      if (format === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);

      // quality: canvas expects 0.0–1.0; clamp to avoid edge case at q=100 → 1.0
      const q = Math.min(quality / 100, 1.0);

      canvas.toBlob(
        resultBlob => {
          if (resultBlob) resolve(resultBlob);
          else reject(new Error('Canvas toBlob returned null'));
        },
        format,
        q
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image failed to load'));
    };

    img.src = url;
  });
}

// =========================================================
//  CARD CREATION & UPDATE
// =========================================================

/**
 * Creates a card DOM element for an image entry and appends it to the queue.
 * @param {{ id: string, file: File }} entry
 */
function createCard(entry) {
  const card = document.createElement('div');
  card.className = 'img-card';
  card.id        = 'card_' + entry.id;

  const origUrl = URL.createObjectURL(entry.originalBlob);

  card.innerHTML = `
    <!-- Header -->
    <div class="img-card__header">
      <span class="img-card__filename" title="${escHtml(entry.file.name)}">${escHtml(entry.file.name)}</span>
      <div class="img-card__actions">
        <button class="btn btn--danger" data-action="remove" data-id="${entry.id}" title="Remove image">✕</button>
      </div>
    </div>

    <!-- Loading state -->
    <div class="img-card__loading" id="loading_${entry.id}">
      <div class="mini-spinner"></div>
      <span class="mini-spinner-label">Compressing…</span>
    </div>

    <!-- Preview body (dual panes) -->
    <div class="img-card__body" id="body_${entry.id}">
      <!-- Original -->
      <div class="preview-pane">
        <span class="preview-label">Original</span>
        <div class="preview-img-wrap">
          <img src="${origUrl}" alt="Original ${escHtml(entry.file.name)}" id="origImg_${entry.id}" />
        </div>
      </div>

      <!-- Compressed + before/after slider -->
      <div class="preview-pane">
        <span class="preview-label">Compressed <small style="font-size:0.6em;color:var(--text-muted)">← drag to compare</small></span>
        <div class="comparison-wrap" id="cmpWrap_${entry.id}">
          <!-- "before" = original, shown on right half -->
          <img class="img-before" src="${origUrl}" alt="Before" draggable="false" />
          <!-- "after" = compressed, shown on left half -->
          <img class="img-after"  src=""           alt="Compressed" draggable="false" id="cmpImg_${entry.id}" />
          <div class="comparison-handle" id="handle_${entry.id}"></div>
        </div>
      </div>
    </div>

    <!-- Stats bar -->
    <div class="img-card__stats" id="stats_${entry.id}">
      <div class="stat-item">
        <span class="stat-label">Original</span>
        <span class="stat-val">${formatBytes(entry.file.size)}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Compressed</span>
        <span class="stat-val" id="compSize_${entry.id}">—</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Saved</span>
        <span class="stat-val" id="saved_${entry.id}">—</span>
      </div>
      <button class="btn btn--primary" id="dlBtn_${entry.id}" disabled>↓ Download</button>
    </div>
  `;

  imageQueue.appendChild(card);

  // Attach event: remove card
  card.querySelector('[data-action="remove"]').addEventListener('click', () => removeCard(entry.id));

  // Attach event: download this card's compressed image
  card.querySelector(`#dlBtn_${entry.id}`).addEventListener('click', () => {
    const e = imageStore.find(x => x.id === entry.id);
    if (e && e.compressedBlob) downloadBlob(e.compressedBlob, buildFilename(e.file.name));
  });

  // Attach before/after comparison drag
  initComparisonSlider(entry.id);
}

/**
 * Updates the card's compressed preview and stats after compression.
 * @param {{ id: string, file: File, compressedBlob: Blob }} entry
 */
function updateCard(entry) {
  const cmpImg   = document.getElementById('cmpImg_'  + entry.id);
  const compSize = document.getElementById('compSize_'+ entry.id);
  const savedEl  = document.getElementById('saved_'   + entry.id);
  const dlBtn    = document.getElementById('dlBtn_'   + entry.id);

  if (!cmpImg) return;

  // Revoke any previous object URL on the compressed image to avoid memory leak
  if (cmpImg.src && cmpImg.src.startsWith('blob:')) URL.revokeObjectURL(cmpImg.src);

  const newUrl = URL.createObjectURL(entry.compressedBlob);
  cmpImg.src   = newUrl;

  // Stats
  const origSize = entry.file.size;
  const compSz   = entry.compressedBlob.size;
  const delta    = origSize - compSz;
  const pct      = ((delta / origSize) * 100).toFixed(1);

  compSize.textContent = formatBytes(compSz);

  if (delta >= 0) {
    savedEl.textContent = `${formatBytes(delta)} (${pct}% smaller)`;
    savedEl.className   = 'stat-val saving';
  } else {
    savedEl.textContent = `+${formatBytes(-delta)} (${Math.abs(pct)}% larger)`;
    savedEl.className   = 'stat-val worse';
  }

  dlBtn.disabled = false;
}

// =========================================================
//  COMPARISON SLIDER
// =========================================================

/**
 * Wires up the drag-to-compare interaction for a card.
 * @param {string} id
 */
function initComparisonSlider(id) {
  const wrap   = document.getElementById('cmpWrap_' + id);
  const handle = document.getElementById('handle_'  + id);
  const after  = wrap.querySelector('.img-after');

  if (!wrap) return;

  let dragging = false;

  function setPosition(clientX) {
    const rect = wrap.getBoundingClientRect();
    let x = clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    const pct = (x / rect.width) * 100;
    // Show compressed on left portion
    after.style.clipPath  = `inset(0 ${100 - pct}% 0 0)`;
    handle.style.left     = pct + '%';
  }

  // Mouse events
  wrap.addEventListener('mousedown', e => { dragging = true; setPosition(e.clientX); });
  window.addEventListener('mousemove', e => { if (dragging) setPosition(e.clientX); });
  window.addEventListener('mouseup',   () => { dragging = false; });

  // Touch events
  wrap.addEventListener('touchstart', e => { dragging = true; setPosition(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchmove', e => { if (dragging) setPosition(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend',  () => { dragging = false; });
}

// =========================================================
//  CARD LOADING STATE
// =========================================================

function setCardLoading(id, isLoading) {
  const loadDiv = document.getElementById('loading_' + id);
  const bodyDiv = document.getElementById('body_'    + id);
  if (!loadDiv || !bodyDiv) return;
  if (isLoading) {
    loadDiv.classList.add('active');
    bodyDiv.classList.add('loading');
  } else {
    loadDiv.classList.remove('active');
    bodyDiv.classList.remove('loading');
  }
}

// =========================================================
//  REMOVE CARD
// =========================================================

function removeCard(id) {
  const idx = imageStore.findIndex(e => e.id === id);
  if (idx !== -1) imageStore.splice(idx, 1);
  const card = document.getElementById('card_' + id);
  if (card) card.remove();

  // Clean up if no images left
  if (imageStore.length === 0) {
    controlsBar.classList.add('hidden');
    imageQueue.classList.add('hidden');
    bulkActions.classList.add('hidden');
  } else if (imageStore.length < 2) {
    bulkActions.classList.add('hidden');
  }
}

// =========================================================
//  ERROR BANNER
// =========================================================

function showError(msg) {
  errorBanner.textContent = '⚠ ' + msg;
  errorBanner.classList.add('visible');
  // Auto-dismiss after 6 s
  setTimeout(hideError, 6000);
}
function hideError() {
  errorBanner.classList.remove('visible');
}

// =========================================================
//  HELPERS
// =========================================================

/**
 * Formats bytes to human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024)           return bytes + ' B';
  if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Builds a filename for the compressed output.
 * e.g. photo.jpg → photo_squished.jpg  or photo_squished.webp
 */
function buildFilename(originalName) {
  const dot = originalName.lastIndexOf('.');
  const base = dot !== -1 ? originalName.slice(0, dot) : originalName;
  const ext  = currentFormat === 'image/jpeg' ? 'jpg'
             : currentFormat === 'image/webp' ? 'webp'
             : 'png';
  return `${base}_squished.${ext}`;
}

/**
 * Triggers a file download in the browser.
 * @param {Blob}   blob
 * @param {string} filename
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Escapes HTML special characters to prevent XSS when rendering filenames.
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
