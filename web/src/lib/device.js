import { useEffect, useState } from 'react';

/**
 * Device / viewport helpers.
 *
 * The kiosk (wall) dashboard is designed for a large landscape monitor, so we
 * need a reliable way to tell "small screen / touch device" from "big screen".
 * We combine two signals:
 *   - viewport width  → catches desktop windows that are simply resized narrow
 *   - pointer type    → catches touch devices (phones/tablets) and some TVs
 */

// Width at or below which we consider the layout "small".
export const MOBILE_MAX_WIDTH = 820;

function getMediaQueryList(query) {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  return window.matchMedia(query);
}

/** Subscribe to a CSS media query and re-render when it changes. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => getMediaQueryList(query)?.matches ?? false);

  useEffect(() => {
    const mql = getMediaQueryList(query);
    if (!mql) return undefined;
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    // addEventListener is unsupported on very old Safari; fall back to the
    // deprecated API there.
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

/** One-shot, non-reactive check (useful outside React render, e.g. guards). */
export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  const narrow = getMediaQueryList(`(max-width: ${MOBILE_MAX_WIDTH}px)`)?.matches ?? false;
  const coarse = getMediaQueryList('(pointer: coarse)')?.matches ?? false;
  return narrow || coarse;
}

/**
 * Reactive version of {@link isMobileDevice}. Pass `true` to only treat narrow
 * viewports as mobile and ignore touch input.
 */
export function useIsMobile({ widthOnly = false } = {}) {
  const narrow = useMediaQuery(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
  const coarse = useMediaQuery('(pointer: coarse)');
  return widthOnly ? narrow : narrow || coarse;
}
