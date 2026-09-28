/**
 * Human-friendly distance for display: metres below 1 km, kilometres above it
 * (150 m, 1.5 km). Mirrors `formatDistance` in server/src/utils/geo.js.
 */
export function formatDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m)) return `${meters} m`;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * Browser geolocation helper.
 *
 * Returns { latitude, longitude } or throws with a friendly message.
 * Requires HTTPS (or localhost) — the same requirement as the camera.
 */
export function getPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => {
        const messages = {
          1: 'Location permission denied. Please allow location access and try again.',
          2: 'Location unavailable. Please try again.',
          3: 'Location request timed out. Please try again.',
        };
        reject(new Error(messages[err.code] || 'Could not get your location.'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}
