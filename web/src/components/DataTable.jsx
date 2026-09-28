import { useMemo, useState } from 'react';

/**
 * Lightweight data table: search, sortable columns and pagination.
 *
 * Deliberately dependency-free — the app only needs these three features, and
 * a full DataTables/jQuery bundle would be far larger than the whole app.
 *
 * `columns` is an array of:
 *   {
 *     key,            // unique id
 *     label,          // header text
 *     sortable,       // click the header to sort
 *     sortValue(row), // value to sort by (defaults to row[key])
 *     searchValue(row),// text to match against (defaults to row[key])
 *     render(row),    // cell content (defaults to row[key])
 *     align,          // 'right' | 'center'
 *   }
 */
export default function DataTable({
  columns,
  rows,
  getRowKey = (row) => row.id,
  initialSort = null,
  searchPlaceholder = 'Search…',
  emptyMessage = 'Nothing to show.',
  pageSizeOptions = [10, 25, 50],
  defaultPageSize = 10,
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((col) => {
        const value = col.searchValue ? col.searchValue(row) : row[col.key];
        return String(value ?? '').toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, query]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const valueOf = col.sortValue || ((row) => row[col.key]);
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      // Missing values always sort last, regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return (
        String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir
      );
    });
  }, [filtered, columns, sort]);

  const total = sorted.length;
  const allShown = pageSize === 'all';
  const pageCount = allShown ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = allShown ? 0 : (currentPage - 1) * pageSize;
  const visible = allShown ? sorted : sorted.slice(start, start + pageSize);

  function toggleSort(col) {
    if (!col.sortable) return;
    setPage(1);
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' };
      return null; // third click clears the sort
    });
  }

  return (
    <div className="datatable">
      <div className="datatable-toolbar">
        <input
          className="datatable-search"
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <div className="datatable-meta">
          <span>
            {total === rows.length ? `${total} rows` : `${total} of ${rows.length}`}
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              const v = e.target.value;
              setPageSize(v === 'all' ? 'all' : Number(v));
              setPage(1);
            }}
            title="Rows per page"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="datatable-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={`${col.sortable ? 'sortable' : ''} ${active ? 'sorted' : ''} ${
                      col.align ? `ta-${col.align}` : ''
                    }`}
                    onClick={() => toggleSort(col)}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {col.label}
                    {col.sortable && (
                      <span className="sort-ind" aria-hidden="true">
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td className="datatable-empty" colSpan={columns.length}>
                  {rows.length === 0 ? emptyMessage : 'No rows match your search.'}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={getRowKey(row)}>
                  {columns.map((col) => (
                    <td key={col.key} className={col.align ? `ta-${col.align}` : undefined}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="datatable-pager">
          <button
            className="btn btn-sm btn-secondary"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            ‹ Prev
          </button>
          <span>
            Page {currentPage} of {pageCount}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
