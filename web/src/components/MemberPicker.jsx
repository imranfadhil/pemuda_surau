import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Searchable drop-in replacement for a long `<select>` of members.
 *
 * A plain `<select>` with 60+ members is painful to use on a phone — you have
 * to scroll a list with no keyboard search. This renders a text input that
 * filters as you type and a list you pick from, which is much faster for a
 * teacher standing in front of a class.
 *
 * Keyboard: ↑/↓ move, Enter selects, Esc closes. Typing filters by name (and
 * optionally by extra text such as a phone number).
 *
 * Props:
 *   options   [{ value, label, sublabel?, searchText? }]
 *   value     selected value ('' = none)
 *   onChange  (value) => void
 *   placeholder, emptyLabel (e.g. "Myself (Ali)"), disabled
 *   required  only affects validation styling, not enforced here
 */
export default function MemberPicker({
  options,
  value,
  onChange,
  placeholder = 'Type a name to search…',
  emptyLabel = '',
  noResultsLabel = 'No members match.',
  disabled = false,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const haystack = `${o.label ?? ''} ${o.searchText ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  // Close on outside click, so tapping elsewhere behaves like a native select.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight];
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function choose(option) {
    onChange?.(option.value);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((h) => Math.min(Math.max(h + delta, 0), Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === 'Enter') {
      // Only intercept Enter while the list is open; otherwise let the form
      // submit as usual.
      if (open && filtered[highlight]) {
        e.preventDefault();
        choose(filtered[highlight]);
      }
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  // What the input shows: while closed, the chosen member's name.
  const displayValue = open ? query : selected?.label || '';

  return (
    <div className="member-picker" ref={wrapRef}>
      <input
        type="text"
        value={displayValue}
        placeholder={selected ? selected.label : emptyLabel || placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open && (
        <ul className="member-picker-list" role="listbox" ref={listRef}>
          {emptyLabel && !query.trim() && (
            <li
              className={`member-picker-opt ${value === '' ? 'selected' : ''}`}
              role="option"
              aria-selected={value === ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose({ value: '' })}
            >
              {emptyLabel}
            </li>
          )}

          {filtered.length === 0 ? (
            <li className="member-picker-empty">{noResultsLabel}</li>
          ) : (
            filtered.map((option, i) => (
              <li
                key={option.value}
                className={`member-picker-opt ${i === highlight ? 'active' : ''} ${
                  option.value === value ? 'selected' : ''
                }`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
              >
                <span className="member-picker-name">{option.label}</span>
                {option.sublabel && (
                  <span className="member-picker-sub">{option.sublabel}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
