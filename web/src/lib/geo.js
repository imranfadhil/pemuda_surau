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
 * Returns { latitude, longitude, accuracy } or throws with a friendly message.
 * Requires HTTPS (or localhost) — the same requirement as the camera.
 *
 * `maximumAge: 0` forces a FRESH fix. This matters for geofencing: a cached
 * position from where the user was a minute ago would otherwise be reused and
 * report a bogus distance.
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
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

/**
 * Like {@link getPosition}, but keeps watching until the fix is accurate enough
 * (or `timeout` elapses) and returns the BEST fix seen.
 *
 * A single `getCurrentPosition` call often returns a coarse Wi-Fi/cell fix
 * first — indoors that can be hundreds of metres off, which is useless for a
 * 150 m geofence. Watching lets the GPS settle and gives us a usable position.
 *
 * `onProgress` receives the best accuracy so far, so the UI can say
 * "improving location accuracy…".
 */
export function getAccuratePosition({
  desiredAccuracy = 50,
  timeout = 15000,
  onProgress,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported on this device.'));
      return;
    }

    let best = null;
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      navigator.geolocation.clearWatch(watchId);
      fn(arg);
    };

    const timer = setTimeout(() => {
      // Out of time: use the best fix we managed to get.
      if (best) finish(resolve, best);
      else finish(reject, new Error('Location request timed out. Please try again.'));
    }, timeout);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (onProgress) onProgress(fix.accuracy);
        if (fix.accuracy <= desiredAccuracy) finish(resolve, fix);
      },
      (err) => {
        // Only fail outright if we never got any fix at all.
        if (best) return;
        const messages = {
          1: 'Location permission denied. Please allow location access and try again.',
          2: 'Location unavailable. Please try again.',
          3: 'Location request timed out. Please try again.',
        };
        finish(reject, new Error(messages[err.code] || 'Could not get your location.'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}
