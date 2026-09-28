/**
 * Geofencing helpers.
 *
 * The surau's coordinates come from config.prayer (the same ones used for
 * prayer times). A check-in is only accepted when the device is within
 * `radiusMeters` of the surau.
 */

const EARTH_RADIUS_M = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in metres. */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function isValidCoordinate(lat, lon) {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Human-friendly distance for user-facing messages: metres below 1 km,
 * kilometres above it (150 m, 1.5 km).
 */
export function formatDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m)) return `${meters} m`;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * Check whether a point is inside the surau's geofence.
 * Returns { ok, distance } where distance is metres from the surau.
 */
export function withinGeofence(lat, lon, { latitude, longitude, radiusMeters }) {
  const distance = distanceMeters(lat, lon, latitude, longitude);
  return { ok: distance <= radiusMeters, distance: Math.round(distance) };
}
