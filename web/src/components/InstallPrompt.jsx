import { useState } from 'react';
import { useInstallPrompt } from '../lib/pwa.js';

/**
 * "Add to home screen" affordance.
 *
 * - Android/Chrome: uses the native `beforeinstallprompt` event.
 * - iOS Safari: shows the manual Share -> "Add to Home Screen" steps.
 * - Hidden once installed, or after the user dismisses it.
 *
 * `variant="card"` is the full card (Home page); `variant="button"` is a
 * compact button for the top bar.
 */
export default function InstallPrompt({ variant = 'card' }) {
  const { canInstall, promptInstall, installed, ios, dismissed, dismiss } = useInstallPrompt();
  const [busy, setBusy] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  if (installed || dismissed) return null;
  if (!canInstall && !ios) return null;

  const handleClick = async () => {
    if (ios) {
      setShowIosSteps((v) => !v);
      return;
    }
    setBusy(true);
    await promptInstall();
    setBusy(false);
  };

  if (variant === 'button') {
    return (
      <button className="btn-ghost install-btn" onClick={handleClick} disabled={busy}>
        📲 Install
      </button>
    );
  }

  return (
    <div className="card install-card">
      <div className="install-card-head">
        <span className="install-icon">📲</span>
        <div>
          <strong>Install the app</strong>
          <p className="install-sub">
            Add Pemuda Surau to your home screen for one-tap check-in — no browser needed.
          </p>
        </div>
        <button className="install-close" onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>

      {ios ? (
        <>
          <button className="btn btn-block" onClick={handleClick}>
            {showIosSteps ? 'Hide steps' : 'How to install on iPhone'}
          </button>
          {showIosSteps && (
            <ol className="install-steps">
              <li>
                Tap the <strong>Share</strong> button <span className="install-glyph">⬆️</span> in
                Safari's toolbar.
              </li>
              <li>
                Scroll down and tap <strong>Add to Home Screen</strong>{' '}
                <span className="install-glyph">➕</span>.
              </li>
              <li>
                Tap <strong>Add</strong> — the app icon appears on your home screen.
              </li>
            </ol>
          )}
        </>
      ) : (
        <button className="btn btn-block" onClick={handleClick} disabled={busy}>
          {busy ? 'Opening…' : 'Install app'}
        </button>
      )}
    </div>
  );
}
