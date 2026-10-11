/**
 * Web Push client-side helpers.
 *
 * Flow:
 *   1. Get the VAPID public key from GET /api/notifications/push/status.
 *   2. Ask for permission, subscribe via the service worker's PushManager.
 *   3. POST the subscription to /api/notifications/push/subscribe so the
 *      scheduler can fan reminders out to this device.
 *
 * iOS caveat: Safari only supports Web Push for HOME-SCREEN installed PWAs
 * (iOS 16.4+). `pushSupport()` reflects that; the UI shows install steps
 * instead of a broken button when unsupported.
 */

import { isIosSafari, isStandalone } from './pwa.js';

/** Can this browser receive Web Push at all (installed PWA on iOS)? */
export function pushSupport() {
  if (typeof window === 'undefined') return false;
  const basic = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!basic) return false;
  // iOS Safari: only installed (home-screen) PWAs can receive push.
  if (isIosSafari() && !isStandalone()) return false;
  return true;
}

/** iOS Safari that isn't installed yet — needs "Add to Home Screen" first. */
export function pushNeedsInstall() {
  return isIosSafari() && !isStandalone();
}

/** base64url VAPID key -> Uint8Array (required by the Push API). */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/**
 * Current subscription for this device, or null.
 * Uses the same registration the app registers in main.jsx.
 */
export async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Subscribe this device. Returns the subscription JSON on success.
 * Throws Error with .code === 'PERMISSION_DENIED' when blocked.
 */
export async function subscribePush(publicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    const err = new Error('Notification permission was not granted.');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  const reg = await navigator.serviceWorker.ready;
  // Reuse an existing subscription if the browser still has one.
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing.toJSON();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true, // Chrome requires every push to show a notification
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return sub.toJSON();
}

/** Unsubscribe this device (best-effort). Returns the endpoint removed, if any. */
export async function unsubscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
