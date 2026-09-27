import { useEffect, useRef, useState } from 'react';
import { analyzeFrame, qualityMessage } from '../lib/face.js';

/**
 * Shared "how to get a good scan" guidance, shown next to every camera view so
 * the advice is identical wherever a face is enrolled or scanned.
 *
 * Photography framing guidance (turning to the light, a plain background, no
 * glare/tint) is genuinely useful, so it is spelled out once here rather than
 * repeated per page.
 */
export const FACE_TIPS = [
  { icon: '💡', text: 'Face a window or lamp — even light on your face, no shadows.' },
  { icon: '🚫', text: 'Avoid bright light or a window directly behind you.' },
  { icon: '🧱', text: 'Use a plain, uncluttered background (a blank wall is ideal).' },
  { icon: '🕶️', text: 'Remove glasses, cap, mask or anything covering your face.' },
  { icon: '🙂', text: 'Look straight at the camera, eyes open, neutral expression.' },
  { icon: '📏', text: 'Hold the phone at eye level, about an arm\'s length away.' },
  { icon: '🤚', text: 'Hold still while it scans — no moving or turning away.' },
];

export function FaceTips({ title = 'Tips for a good scan', compact = false }) {
  return (
    <div className={`face-tips ${compact ? 'compact' : ''}`}>
      <div className="face-tips-title">{title}</div>
      <ul>
        {FACE_TIPS.map((tip) => (
          <li key={tip.text}>
            <span aria-hidden="true">{tip.icon}</span> {tip.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Live camera feedback: while `active` is true, polls the video a few times a
 * second and reports the current framing/lighting issues, so the user can
 * adjust *before* tapping the capture button instead of only being told after
 * a failed attempt. Feedback is deliberately coarse (no per-frame flicker) and
 * analysis never overlaps itself.
 *
 * Returns a human-readable hint string, or '' while the first frame is pending.
 */
export function useFaceFeedback(videoRef, active, { enabled = true } = {}) {
  const [hint, setHint] = useState('');
  const busyRef = useRef(false);

  useEffect(() => {
    if (!active || !enabled) {
      setHint('');
      return undefined;
    }

    let cancelled = false;
    const tick = async () => {
      if (busyRef.current || cancelled) return;
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      busyRef.current = true;
      try {
        const res = await analyzeFrame(video);
        if (cancelled) return;
        if (!res.face) setHint(qualityMessage(['no-face']));
        else if (res.issues.length) setHint(qualityMessage(res.issues));
        else setHint('Looks good — hold still.');
      } catch {
        // Detection hiccups (e.g. canvas not ready) are non-fatal.
      } finally {
        busyRef.current = false;
      }
    };

    const id = setInterval(tick, 500);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, enabled, videoRef]);

  return hint;
}
