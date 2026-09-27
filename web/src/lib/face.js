import * as faceapi from 'face-api.js';

const MODEL_URL = '/models';
let modelsLoaded = false;
let loadingPromise = null;

export async function loadModels() {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
  })();

  return loadingPromise;
}

const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

/**
 * Quality thresholds. Deliberately lenient so ordinary indoor use passes, while
 * obviously bad frames (face tiny in frame, near-black, blown out) are caught.
 * The brightness floor is kept low so darker skin tones under normal lighting
 * are not flagged.
 */
const QUALITY = {
  minFaceRatio: 0.28, // face box width / frame width
  maxFaceRatio: 0.85,
  maxCenterOffset: 0.18, // fraction of frame width the face centre may drift
  darkLuma: 45,
  brightLuma: 215,
  minSharpness: 50, // variance of Laplacian; lower = blurrier
};

/** Human-readable guidance for each quality issue. */
const ISSUE_MESSAGES = {
  'no-face': 'No face detected — centre your face in the oval.',
  'too-far': 'Move a little closer to the camera.',
  'too-close': 'Move back a little — your whole face should fit.',
  'off-center': 'Centre your face in the oval.',
  'too-dark': 'Too dark — face a window or turn on a light.',
  'too-bright': 'Too bright — avoid strong backlight or glare.',
  blurry: 'Hold the phone steady — the image is blurry.',
};

/** Turn an array of issue codes into a single line of advice. */
export function qualityMessage(issues = []) {
  if (!issues.length) return '';
  return ISSUE_MESSAGES[issues[0]] || 'Adjust your position and try again.';
}

// Reused offscreen canvases (downscale for detection, tiny crop for pixel
// stats). Reusing them avoids per-frame allocation churn.
let frameCanvas = null;
let sampleCanvas = null;

/**
 * Downscale a video frame to at most `maxWidth` px wide, into a reusable canvas.
 *
 * getUserMedia width/height are only *hints*: front cameras usually honour
 * 640x480, but rear cameras often ignore them and deliver full sensor
 * resolution (e.g. 1920x1080). face-api.js draws the video at its native size
 * and then resizes to the detector's 320x320, so a full-res rear frame costs
 * ~6-9x more pixel work per scan - which is why the back camera feels slower.
 *
 * Drawing into a small canvas first makes both cameras cost the same. 640px
 * matches what the front camera already delivers, and leaves a face well above
 * the 150x150 the recognition net crops to.
 */
function downscaleFrame(video, maxWidth = 640) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const scale = Math.min(1, maxWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  if (!frameCanvas) frameCanvas = document.createElement('canvas');
  if (frameCanvas.width !== w || frameCanvas.height !== h) {
    frameCanvas.width = w;
    frameCanvas.height = h;
  }
  frameCanvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, w, h);
  return frameCanvas;
}

/**
 * Crop the detected face into a small fixed-size canvas and read its pixels.
 * We analyse a 96x96 grayscale-ish crop, which is plenty for lighting and
 * blur scoring and keeps the per-frame cost negligible.
 */
function sampleFacePixels(canvas, box, size = 96) {
  if (!sampleCanvas) sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = size;
  sampleCanvas.height = size;
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  // Clamp the crop to the frame so we never sample outside the image.
  const sx = Math.max(0, box.x);
  const sy = Math.max(0, box.y);
  const sw = Math.min(canvas.width - sx, box.width);
  const sh = Math.min(canvas.height - sy, box.height);
  if (sw <= 1 || sh <= 1) return null;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function meanLuma(data) {
  let sum = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / n;
}

/** Variance of the Laplacian: a sharp image has high variance, a blurry one low. */
function sharpness(data) {
  const size = Math.sqrt(data.length / 4);
  const gray = new Float32Array(size * size);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Detect a face and score the frame's quality (framing, lighting, sharpness).
 * Optionally also compute the descriptor in the same pass, so a capture does
 * not need a second detection round-trip.
 *
 * Returns:
 *   { face: false, issues: ['no-face'] } when no single face is found, or
 *   { face: true, box, ratio, issues: [...], descriptor?, detection }
 */
export async function analyzeFrame(video, { descriptor = false } = {}) {
  await loadModels();
  const canvas = downscaleFrame(video);
  if (!canvas) return { face: false, issues: ['no-face'] };

  let task = faceapi.detectSingleFace(canvas, DETECTOR_OPTIONS).withFaceLandmarks();
  if (descriptor) task = task.withFaceDescriptor();
  const result = await task;
  if (!result) return { face: false, issues: ['no-face'] };

  const box = result.detection.box;
  const issues = [];

  // Framing.
  const ratio = box.width / canvas.width;
  if (ratio < QUALITY.minFaceRatio) issues.push('too-far');
  else if (ratio > QUALITY.maxFaceRatio) issues.push('too-close');

  const faceCx = box.x + box.width / 2;
  const faceCy = box.y + box.height / 2;
  const offset = Math.hypot(faceCx - canvas.width / 2, faceCy - canvas.height / 2);
  if (offset > QUALITY.maxCenterOffset * canvas.width) issues.push('off-center');

  // Lighting + sharpness (only meaningful once the crop is valid).
  const pixels = sampleFacePixels(canvas, box);
  if (pixels) {
    const luma = meanLuma(pixels);
    if (luma < QUALITY.darkLuma) issues.push('too-dark');
    else if (luma > QUALITY.brightLuma) issues.push('too-bright');
    if (sharpness(pixels) < QUALITY.minSharpness) issues.push('blurry');
  }

  const out = { face: true, box, ratio, issues, detection: result.detection };
  if (descriptor && result.descriptor) out.descriptor = Array.from(result.descriptor);
  return out;
}

/**
 * Capture a single face descriptor from a video element.
 *
 * Returns { descriptor: number[128], detection, issues, box } or null if no
 * single face was found. `issues` is a (possibly empty) list of quality
 * problems — callers should surface `qualityMessage(issues)` and normally
 * refuse to use a frame with issues.
 */
export async function captureDescriptor(video) {
  const res = await analyzeFrame(video, { descriptor: true });
  if (!res.face || !res.descriptor) return null;
  return {
    descriptor: res.descriptor,
    detection: res.detection,
    box: res.box,
    issues: res.issues,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Capture several frames and average the descriptors.
 *
 * A single frame is sensitive to a passing blink, a slight turn or motion blur.
 * Averaging several descriptors produces a much more stable "centre of mass"
 * for the face, which measurably reduces both false accepts and false rejects
 * later. Clean (issue-free) frames are preferred; if too few are clean we fall
 * back to whatever was captured but report the quality so the caller can warn.
 *
 * Returns `{ descriptor, clean, total }` where `clean` is the number of
 * issue-free frames used, or null when no face was found at all.
 *
 * `onProgress(done, total)` is called before each frame so the UI can show
 * "Hold still… 2/5".
 */
export async function captureEnrollmentDescriptor(video, { shots = 5, onProgress } = {}) {
  const clean = [];
  const fallback = [];
  for (let i = 0; i < shots; i += 1) {
    if (onProgress) onProgress(i, shots);
    const shot = await captureDescriptor(video);
    if (shot) {
      if (shot.issues.length === 0) clean.push(shot.descriptor);
      else fallback.push(shot.descriptor);
    }
    if (i < shots - 1) await sleep(260);
  }

  const used = clean.length >= 2 ? clean : clean.concat(fallback);
  if (used.length === 0) return null;

  const avg = new Array(128).fill(0);
  for (const d of used) {
    for (let i = 0; i < 128; i += 1) avg[i] += d[i];
  }
  return {
    descriptor: avg.map((v) => v / used.length),
    clean: clean.length,
    total: used.length,
  };
}

/**
 * Start the camera.
 *
 * `facingMode` defaults to 'user' (front camera), which suits self-enrollment
 * and self check-in. Pass 'environment' when scanning *someone else's* face
 * (staff scanning a member, a guardian enrolling a child) so the rear camera
 * is used.
 *
 * Uses `ideal` rather than `exact` so a device without the requested camera
 * (e.g. a desktop with only a webcam) falls back gracefully instead of failing.
 */
export async function startCamera(video, facingMode = 'user') {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}
