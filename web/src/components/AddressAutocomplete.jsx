import { useEffect, useRef, useState } from 'react';
import { getAccuratePosition } from '../lib/geo.js';
import { SURAU } from '../lib/constants.js';

/**
 * Address input with type-ahead suggestions.
 *
 * Uses Photon (photon.komoot.io) — a free, key-less OpenStreetMap geocoder that
 * is designed for autocomplete and sends CORS headers, so it can be called
 * straight from the browser. (Nominatim is the other free option, but its usage
 * policy explicitly forbids autocomplete.)
 *
 * Results are biased towards the surau's coordinates so nearby addresses rank
 * first, which is what members will almost always want.
 *
 * Also offers "use my current location", which reverse-geocodes the device's
 * position into a starting address — handy when the member is standing at home.
 */

const PHOTON = 'https://photon.komoot.io';
const MIN_CHARS = 4;
const DEBOUNCE_MS = 350;

/**
 * Bounding box around Kajang/Bangi (minLon,minLat,maxLon,maxLat).
 *
 * Photon's `lat`/`lon` only *bias* ranking, which is not enough: searching
 * "Jalan Cerdik" without a box returned a same-named street in Kuala Lumpur
 * ahead of the real one in Bangi Lama. A bbox restricts results to the area the
 * surau actually serves, which is what members want.
 */
const AREA_BBOX = '101.70,2.85,101.95,3.05';

/**
 * Build a readable single-line address from Photon's properties.
 *
 * `locality` is the taman/neighbourhood (e.g. "Taman Universiti") and is
 * essential — without it a reverse-geocoded address is missing the part
 * Malaysian members actually recognise. `house_number` is included when OSM
 * has it.
 */
function formatAddress(p) {
  const parts = [
    p.name,
    p.house_number,
    p.street,
    p.locality,
    p.district,
    p.city,
    p.state,
    p.postcode,
    p.country,
  ];
  return parts
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i) // drop duplicates (name === street)
    .join(', ');
}

/** Normalise a string for loose comparison (case/punctuation-insensitive). */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Does a Photon result plausibly match what we searched for?
 *
 * We compare the result's name/street against the FIRST comma-segment of the
 * attempt (the street part), because that is the part Photon most often gets
 * wrong. Every meaningful token of that segment must appear in the result.
 */
function matchesQuery(props, attempt) {
  const first = norm(attempt.split(',')[0]);
  if (!first) return true;
  const hay = norm(`${props.name || ''} ${props.street || ''}`);
  if (!hay) return false;
  const tokens = first.split(' ').filter((t) => t.length > 1);
  if (!tokens.length) return true;
  return tokens.every((t) => hay.includes(t));
}

/**
 * Search Photon, recovering from its free-text parser's biggest weakness.
 *
 * Photon is easily confused by a house number combined with a postcode:
 * "48 Jalan Cerdik 5, Taman Universiti, 43000 Kajang" resolves to a completely
 * different street ("Jalan CP 5/48" in 43200). Dropping trailing segments
 * (postcode, then taman) recovers the correct street.
 *
 * We try the full query first, then progressively drop trailing comma-segments,
 * and finally the street segment with the house number stripped. The first
 * attempt whose results actually match the street the user typed wins;
 * otherwise we fall back to the first non-empty result set.
 */
async function searchPhoton(query, signal) {
  const segments = query
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const attempts = [];
  for (let n = segments.length; n >= 1; n -= 1) {
    attempts.push(segments.slice(0, n).join(', '));
  }
  // "48 Jalan Cerdik 5" -> "Jalan Cerdik 5" (house numbers confuse Photon).
  // Handles Malaysian prefixes: "48", "48A", "No 12", "No. 12", "Lot 5", "Blok B".
  const streetOnly = segments[0]
    ?.replace(/^(no\.?|lot|blok|block|unit|tingkat)\s+[a-z0-9-]+\s+/i, '')
    .replace(/^\d+[a-z]?\s+/i, '')
    .trim();
  if (streetOnly && streetOnly !== segments[0]) attempts.push(streetOnly);

  let fallback = null;
  for (const attempt of attempts) {
    const url =
      `${PHOTON}/api/?q=${encodeURIComponent(attempt)}&limit=6&lang=en` +
      `&bbox=${AREA_BBOX}&lat=${SURAU.latitude}&lon=${SURAU.longitude}`;
    const res = await fetch(url, { signal });
    if (!res.ok) continue;
    const features = (await res.json()).features || [];
    if (!features.length) continue;
    if (!fallback) fallback = features;
    const matching = features.filter((f) => matchesQuery(f.properties, attempt));
    if (matching.length) return matching;
  }
  return fallback || [];
}

export default function AddressAutocomplete({
  value,
  onChange,
  placeholder = 'Start typing your address…',
  required = false,
  id = 'address',
}) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState('');
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const abortRef = useRef(null);

  // Keep the input in sync when the parent resets the value.
  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  // Debounced lookup. Aborts any in-flight request so a slow earlier response
  // cannot overwrite a newer one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const features = await searchPhoton(q, controller.signal);
        setSuggestions(
          features
            .map((f) => ({ label: formatAddress(f.properties), raw: f.properties }))
            .filter((s) => s.label),
        );
        setHighlight(0);
      } catch (err) {
        if (err.name !== 'AbortError') setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function choose(suggestion) {
    setQuery(suggestion.label);
    onChange?.(suggestion.label);
    setOpen(false);
    setSuggestions([]);
    setNote('');
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((h) => Math.min(Math.max(h + delta, 0), suggestions.length - 1));
      return;
    }
    if (e.key === 'Enter' && open && suggestions[highlight]) {
      e.preventDefault();
      choose(suggestions[highlight]);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  /** Reverse-geocode the device's position into a starting address. */
  async function useCurrentLocation() {
    setNote('');
    setLocating(true);
    try {
      const pos = await getAccuratePosition({ desiredAccuracy: 100, timeout: 12000 });
      const res = await fetch(`${PHOTON}/reverse?lat=${pos.latitude}&lon=${pos.longitude}&lang=en`);
      if (!res.ok) throw new Error('lookup failed');
      const body = await res.json();
      const feature = body.features?.[0];
      if (!feature) {
        setNote('Could not find an address for your location — please type it.');
        return;
      }
      const label = formatAddress(feature.properties);
      setQuery(label);
      onChange?.(label);
      // Be honest about precision: a coarse fix can land on a neighbouring
      // taman, so tell the member to check the result rather than trusting it.
      const acc = Math.round(pos.accuracy || 0);
      setNote(
        acc > 100
          ? `Filled from your location (±${acc} m — this may be a nearby street). Please check and edit.`
          : 'Filled from your current location — please check and edit if needed.',
      );
    } catch (err) {
      setNote(err.message || 'Could not get your location.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="address-autocomplete" ref={wrapRef}>
      <div className="address-row">
        <input
          id={id}
          type="text"
          value={query}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value);
            onChange?.(e.target.value);
            setOpen(true);
            setNote('');
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm address-locate"
          onClick={useCurrentLocation}
          disabled={locating}
          title="Fill in the address from your current location"
        >
          {locating ? '…' : '📍 Use my location'}
        </button>
      </div>

      {note && <div className="muted address-note">{note}</div>}

      {open && (query.trim().length >= MIN_CHARS || suggestions.length > 0) && (
        <ul className="address-suggestions" role="listbox" ref={listRef}>
          {loading && suggestions.length === 0 && (
            <li className="address-empty">Searching…</li>
          )}
          {!loading && suggestions.length === 0 && (
            <li className="address-empty">
              No matches — you can keep typing your address as normal.
            </li>
          )}
          {suggestions.map((s, i) => (
            <li
              key={`${s.label}-${i}`}
              className={`address-option ${i === highlight ? 'active' : ''}`}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
