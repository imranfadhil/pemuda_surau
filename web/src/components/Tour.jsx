import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { onboardedKey, tourForRole } from '../lib/onboarding.js';

/**
 * Lightweight, dependency-free onboarding tour.
 *
 * Why not react-joyride? The app is mobile-first and already has its own card /
 * teal design language; a custom overlay keeps the bundle small, matches the
 * look exactly, and gives us full control over cross-route navigation (which is
 * fiddly in joyride). The engine is ~150 lines and does everything we need:
 * spotlight, tooltip, next/back/skip, keyboard, and auto-start once per user.
 */

const TourContext = createContext(null);

const TOOLTIP_WIDTH = 320;
const HIGHLIGHT_PAD = 6;

export function TourProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState([]);
  const [rect, setRect] = useState(null);
  const [ready, setReady] = useState(false);
  const targetRef = useRef(null);
  const autoStarted = useRef(false);

  const start = useCallback(() => {
    if (!user) return;
    setSteps(tourForRole(user.role));
    setIndex(0);
    setRect(null);
    setReady(false);
    setActive(true);
  }, [user]);

  const finish = useCallback(() => {
    setActive(false);
    setRect(null);
    setReady(false);
    if (user) {
      try {
        localStorage.setItem(onboardedKey(user.id), '1');
      } catch {
        /* localStorage may be unavailable (private mode) — ignore */
      }
    }
  }, [user]);

  const next = useCallback(() => {
    if (index >= steps.length - 1) {
      finish();
      return;
    }
    setIndex((i) => i + 1);
  }, [index, steps.length, finish]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Auto-start the first time a user lands in the app. We hold off while the
  // user is still on the registration page so the tour doesn't cover the
  // face-enrol step they need to finish first.
  useEffect(() => {
    if (!user || autoStarted.current) return;
    if (location.pathname === '/register') return;
    let shouldStart = false;
    try {
      shouldStart = !localStorage.getItem(onboardedKey(user.id));
    } catch {
      shouldStart = false;
    }
    if (shouldStart) {
      autoStarted.current = true;
      start();
    }
  }, [user, start, location.pathname]);

  // Navigate to the step's route, then locate + scroll to its target.
  useEffect(() => {
    if (!active) return undefined;
    const step = steps[index];
    if (!step) return undefined;

    if (step.route && location.pathname !== step.route) {
      navigate(step.route);
      return undefined;
    }

    let attempts = 0;
    let timer;
    setReady(false);

    const tryMeasure = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      if (el) {
        targetRef.current = el;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // Give the smooth scroll a moment to settle before measuring.
        timer = setTimeout(() => {
          const r = el.getBoundingClientRect();
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          setReady(true);
        }, 300);
      } else if (step.target && attempts < 25) {
        attempts += 1;
        timer = setTimeout(tryMeasure, 100);
      } else {
        // No target (welcome/done) or the element never appeared — centre it.
        targetRef.current = null;
        setRect(null);
        setReady(true);
      }
    };

    tryMeasure();
    return () => clearTimeout(timer);
  }, [active, index, steps, location.pathname, navigate]);

  // Keep the spotlight aligned while the page scrolls or resizes.
  useEffect(() => {
    if (!active || !ready) return undefined;
    const el = targetRef.current;
    if (!el) return undefined;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [active, ready, index]);

  // Escape skips the tour.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish, next, back]);

  const value = useMemo(
    () => ({ active, start, finish, next, back, index, total: steps.length }),
    [active, start, finish, next, back, index, steps.length],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && steps[index] && (
        <TourOverlay
          step={steps[index]}
          index={index}
          total={steps.length}
          rect={ready ? rect : null}
          pending={Boolean(steps[index].target) && !ready}
          onNext={next}
          onBack={back}
          onSkip={finish}
        />
      )}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within TourProvider');
  return ctx;
}

/** A button that (re)starts the tour — used on the Profile page. */
export function TourButton({ className = 'btn btn-sm btn-secondary', children = '🎓 Take a tour' }) {
  const { start } = useTour();
  return (
    <button type="button" className={className} onClick={start}>
      {children}
    </button>
  );
}

function computeTooltipStyle(rect, tipW, tipH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 14;

  if (!rect) {
    return {
      left: Math.max(margin, (vw - tipW) / 2),
      top: Math.max(margin, (vh - tipH) / 2),
      width: tipW,
    };
  }

  const spaceBelow = vh - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const placeBelow = spaceBelow >= spaceAbove;

  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - tipW / 2, margin),
    Math.max(margin, vw - tipW - margin),
  );
  const rawTop = placeBelow ? rect.top + rect.height + 14 : rect.top - tipH - 14;
  // Clamp so the tooltip never runs off the top or bottom, even on a short
  // viewport (e.g. a landscape phone).
  const top = Math.min(Math.max(rawTop, margin), Math.max(margin, vh - tipH - margin));

  return { left, top, width: tipW };
}

function TourOverlay({ step, index, total, rect, pending, onNext, onBack, onSkip }) {
  const isLast = index === total - 1;
  const isFirst = index === 0;
  const ref = useRef(null);
  const [style, setStyle] = useState({ width: TOOLTIP_WIDTH, visibility: 'hidden' });

  // Measure the rendered tooltip, then place it next to the target. Measuring
  // (rather than estimating) keeps long copy from overflowing the screen. While
  // the target is still being located (`pending`) we keep it hidden so it
  // doesn't flash in the centre first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = computeTooltipStyle(rect, el.offsetWidth, el.offsetHeight);
    setStyle(pending ? { ...next, visibility: 'hidden' } : next);
  }, [rect, step, pending]);

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="App tour">
      {/* Full-screen blocker that stops clicks reaching the app underneath.
          The dimming comes from the highlight's box-shadow, which leaves a
          clear "hole" over the target element. Clicking it does NOT skip the
          tour — use Next / Back / Skip so an accidental tap can't dismiss it. */}
      <div className="tour-blocker" />

      {rect && (
        <div
          className="tour-highlight"
          style={{
            top: rect.top - HIGHLIGHT_PAD,
            left: rect.left - HIGHLIGHT_PAD,
            width: rect.width + HIGHLIGHT_PAD * 2,
            height: rect.height + HIGHLIGHT_PAD * 2,
          }}
        />
      )}

      <div className="tour-tooltip" ref={ref} style={style}>
        <div className="tour-progress">
          <span>
            Step {index + 1} of {total}
          </span>
          <button type="button" className="tour-skip" onClick={onSkip}>
            Skip
          </button>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={onBack}
            disabled={isFirst}
          >
            Back
          </button>
          <button type="button" className="btn btn-sm" onClick={onNext}>
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
