// Add { type: 'image', src: 'photos/example.jpg', title: '…', description: '…' } for each personal photo.
const personalPhotos = [];
const PHOTO_LIMIT = 16;

function createPlaceholder() {
  const card = document.createElement('canvas');
  const width = 240;
  const height = 336;
  card.width = width * 2;
  card.height = height * 2;
  const ink = card.getContext('2d');
  ink.scale(2, 2);
  const paper = ink.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, '#5f515e');
  paper.addColorStop(1, '#413b48');
  ink.fillStyle = paper;
  ink.fillRect(0, 0, width, height);
  ink.strokeStyle = '#d980a9';
  ink.lineWidth = 2;
  ink.strokeRect(1, 1, width - 2, height - 2);
  ink.fillStyle = '#d1b8c6';
  ink.textAlign = 'center';
  ink.textBaseline = 'middle';
  ink.font = 'italic 26px Georgia, serif';
  ink.fillText('Memory', width / 2, height / 2);
  return { type: 'image', title: '留影', src: card.toDataURL(), isPlaceholder: true };
}

const placeholder = createPlaceholder();
window.mediaData = personalPhotos.length ? personalPhotos.slice(0, PHOTO_LIMIT) : [placeholder];
window.photoWallItems = () => Array.from({ length: PHOTO_LIMIT }, (_, slot) => window.mediaData[slot] || placeholder);

const uploadDialog = document.querySelector('#photo-upload-dialog');
const uploadStatus = document.querySelector('#photo-upload-status');
const filePicker = document.querySelector('#photo-files');
const addPhotos = document.querySelector('#add-photos');
const replacePhotos = document.querySelector('#replace-photos');
let uploadedPhotos = [];
let uploadReady = false;
let uploadBusy = false;
let replacingPhotos = false;
let database;

function openPhotoDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('heart-photo-wall', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('album');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Album storage is unavailable'));
  });
}

async function accessSavedPhotos(photos) {
  database ||= openPhotoDatabase();
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('album', photos ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('album');
    const request = photos ? store.put(photos, 'photos') : store.get('photos');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

function setUploadedPhotos(photos) {
  const oldMedia = window.mediaData;
  uploadedPhotos = photos;
  window.mediaData = photos.map(({ blob, title }) => ({
    type: 'image',
    title,
    src: URL.createObjectURL(blob),
  }));
  window.dispatchEvent(new Event('heart-photos-changed'));
  for (const { src } of oldMedia) {
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  }
}

function updateUploadStatus(message = '') {
  const count = uploadedPhotos.length || Math.min(personalPhotos.length, PHOTO_LIMIT);
  uploadStatus.textContent = message || `已添加 ${count} / ${PHOTO_LIMIT} 张`;
  addPhotos.disabled = !uploadReady || uploadBusy || count >= PHOTO_LIMIT;
  replacePhotos.hidden = count === 0;
  replacePhotos.disabled = !uploadReady || uploadBusy;
}

async function encodePhoto(image, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not prepare photo');
  return blob;
}

async function preparePhoto(file) {
  const uri = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = uri;
    await image.decode();
    const blob = await encodePhoto(image, 1920, 0.95);
    return { blob, title: file.name.replace(/\.[^.]+$/, '') || '照片' };
  } finally {
    URL.revokeObjectURL(uri);
  }
}

document.querySelector('#upload-photos').addEventListener('click', () => {
  updateUploadStatus();
  uploadDialog.showModal();
});
addPhotos.addEventListener('click', () => {
  replacingPhotos = false;
  filePicker.click();
});
replacePhotos.addEventListener('click', () => {
  replacingPhotos = true;
  filePicker.click();
});

filePicker.addEventListener('change', async () => {
  const files = Array.from(filePicker.files);
  filePicker.value = '';
  if (!files.length || uploadBusy) return;
  const existing = replacingPhotos ? [] : uploadedPhotos;
  const selected = files.slice(0, PHOTO_LIMIT - existing.length);
  uploadBusy = true;
  updateUploadStatus('正在读取照片…');
  let message;
  try {
    const added = [];
    for (const file of selected) {
      try {
        added.push(await preparePhoto(file));
      } catch {
        // An unreadable selection should not discard the other photos.
      }
    }
    if (added.length) {
      const photos = [...existing, ...added];
      setUploadedPhotos(photos);
      const skipped = files.length - added.length;
      message = `已添加 ${photos.length} / ${PHOTO_LIMIT} 张${skipped ? `，${skipped} 张未添加` : ''}`;
      try {
        await accessSavedPhotos(photos);
      } catch {
        message += '。浏览器存储不可用，本次照片只保留到页面关闭。';
      }
    } else {
      message = '没有读到可用的照片，请试试 JPG、PNG 或 WebP。';
    }
  } finally {
    uploadBusy = false;
    updateUploadStatus(message);
  }
});

accessSavedPhotos().then(photos => {
  if (photos?.length) setUploadedPhotos(photos.slice(0, PHOTO_LIMIT));
}).catch(() => {
  // Uploads can still be previewed when local storage is unavailable.
}).finally(() => {
  uploadReady = true;
  updateUploadStatus();
});

const photoDialog = document.querySelector('#media-viewer-overlay');
let photoIndex = 0;

function showPhoto(index) {
  photoIndex = (index + window.mediaData.length) % window.mediaData.length;
  const photo = window.mediaData[photoIndex];
  const image = document.createElement('img');
  image.src = photo.src;
  image.alt = photo.title;
  photoDialog.querySelector('.viewer-media-wrapper').replaceChildren(image);
  photoDialog.querySelector('h3').textContent = photo.title;
  photoDialog.querySelector('.viewer-desc').textContent = photo.description || '';
  if (!photoDialog.open) photoDialog.showModal();
}

window.showPhoto = showPhoto;
document.querySelector('#browse').addEventListener('click', () => showPhoto(0));
document.querySelector('#previous').addEventListener('click', () => showPhoto(photoIndex - 1));
document.querySelector('#next').addEventListener('click', () => showPhoto(photoIndex + 1));
document.querySelector('.viewer-close-btn').addEventListener('click', () => photoDialog.close());
photoDialog.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') showPhoto(photoIndex - 1);
  if (event.key === 'ArrowRight') showPhoto(photoIndex + 1);
});
let swipeStart;
photoDialog.addEventListener('touchstart', (event) => { swipeStart = event.changedTouches[0].screenX; }, { passive: true });
photoDialog.addEventListener('touchend', (event) => {
  const delta = event.changedTouches[0].screenX - swipeStart;
  if (Math.abs(delta) >= 50) showPhoto(photoIndex + (delta > 0 ? -1 : 1));
}, { passive: true });
