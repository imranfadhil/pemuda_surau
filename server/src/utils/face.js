/**
 * Face descriptor utilities.
 *
 * The browser (face-api.js) produces a 128-float descriptor per face.
 * We store the enrolled descriptor and compare it against the descriptor
 * captured at check-in using Euclidean distance. Lower distance = more similar.
 */

export const DESCRIPTOR_LENGTH = 128;

export function isValidDescriptor(descriptor) {
  return (
    Array.isArray(descriptor) &&
    descriptor.length === DESCRIPTOR_LENGTH &&
    descriptor.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export function euclideanDistance(a, b) {
  if (!isValidDescriptor(a) || !isValidDescriptor(b)) {
    throw new Error('Invalid face descriptor');
  }
  let sum = 0;
  for (let i = 0; i < DESCRIPTOR_LENGTH; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Compare a live descriptor against a set of enrolled users.
 * Returns the best match (lowest distance) or null if none pass the threshold.
 */
export function findBestMatch(liveDescriptor, candidates, threshold) {
  let best = null;
  for (const candidate of candidates) {
    if (!isValidDescriptor(candidate.face_descriptor)) continue;
    const distance = euclideanDistance(liveDescriptor, candidate.face_descriptor);
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { user: candidate, distance };
    }
  }
  return best;
}
