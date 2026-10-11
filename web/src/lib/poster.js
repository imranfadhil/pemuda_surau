/**
 * Poster handling for programs.
 *
 * Posters are stored inline as data URLs so no external file host is needed.
 * A phone photo can be several MB, which would blow past the API's JSON limit
 * and bloat every program list response, so we downscale it in the browser
 * before it is ever sent.
 */

const MAX_WIDTH = 900;
const MAX_HEIGHT = 1400;
const JPEG_QUALITY = 0.82;

/** Rough size of a data URL in bytes (base64 is ~4/3 of the raw bytes). */
export function dataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  return Math.round(((dataUrl.length - comma - 1) * 3) / 4);
}

/**
 * Read an image File and return a downscaled JPEG data URL.
 * Rejects when the file is not an image or cannot be decoded.
 */
export function fileToPosterDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode that image.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_WIDTH / img.width, MAX_HEIGHT / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // White background so transparent PNGs don't turn black in JPEG.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
