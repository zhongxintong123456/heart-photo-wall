// Add { type: 'image', src: 'photos/example.jpg', title: '…', description: '…' } for each personal photo.
const personalPhotos = [];

function createPlaceholder() {
  const card = document.createElement('canvas');
  card.width = 240;
  card.height = 336;
  const ink = card.getContext('2d');
  const paper = ink.createLinearGradient(0, 0, card.width, card.height);
  paper.addColorStop(0, '#5f515e');
  paper.addColorStop(1, '#413b48');
  ink.fillStyle = paper;
  ink.fillRect(0, 0, card.width, card.height);
  ink.strokeStyle = '#d980a9';
  ink.lineWidth = 2;
  ink.strokeRect(1, 1, card.width - 2, card.height - 2);
  ink.fillStyle = '#d1b8c6';
  ink.textAlign = 'center';
  ink.textBaseline = 'middle';
  ink.font = 'italic 26px Georgia, serif';
  ink.fillText('Memory', card.width / 2, card.height / 2);
  return { type: 'image', title: '留影', src: card.toDataURL() };
}

window.mediaData = personalPhotos.length ? personalPhotos : [createPlaceholder()];

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
