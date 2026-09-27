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

// Reused offscreen canvas for downscaling frames before detection.
let frameCanvas = null;

/**
 * Downscale a video frame to at most `maxWidth` px wide.
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
  // Metadata not ready yet, or already small enough - use the video directly.
  if (!vw || !vh || vw <= maxWidth) return video;

  const scale = maxWidth / vw;
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  if (!frameCanvas) frameCanvas = document.createElement('canvas');
  if (frameCanvas.width !== w || frameCanvas.height !== h) {
    frameCanvas.width = w;
    frameCanvas.height = h;
  }
  frameCanvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return frameCanvas;
}

/**
 * Capture a single face descriptor from a video element.
 * Returns { descriptor: number[128], detection } or null if no single face found.
 */
export async function captureDescriptor(video) {
  await loadModels();
  const result = await faceapi
    .detectSingleFace(downscaleFrame(video), DETECTOR_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!result) return null;
  return {
    descriptor: Array.from(result.descriptor),
    detection: result.detection,
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
