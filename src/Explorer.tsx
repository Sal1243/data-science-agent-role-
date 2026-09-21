import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Database,
  Filter,
  Search,
  Table2,
} from 'lucide-react'
import { api, errorMessage, label, number } from './api'
import type { Analysis, Column, RowsPage } from './types'
import { Badge, ErrorBox, Spinner } from './ui'

function ColumnDetail({ column }: { column: Column }) {
  return (
    <div className="column-detail">
      {column.stats &&
        Object.entries(column.stats).map(([key, value]) => (
          <div key={key}>
            <span>{label(key)}</span>
            <strong>{number(value, 3)}</strong>
          </div>
        ))}
      {column.date_range && (
        <>
          <div>
            <span>First date</span>
            <strong>{column.date_range[0]}</strong>
          </div>
          <div>
            <span>Last date</span>
            <strong>{column.date_range[1]}</strong>
          </div>
          <div>
            <span>Unparseable dates</span>
            <strong>{number(column.invalid_dates)}</strong>
          </div>
        </>
      )}
      {column.top_values?.map((value) => (
        <div key={value.label}>
          <span title={value.label}>{value.label}</span>
          <strong>{number(value.count)} rows</strong>
        </div>
      ))}
      {column.kind === 'identifier' && (
        <p>Likely an identifier based on its name and uniqueness. Excluded from automated model features.</p>
      )}
      {column.kind === 'empty' && (
        <p>This column contains only missing values and is excluded from models.</p>
      )}
      {column.outliers !== undefined && (
        <div>
          <span>IQR outlier flags</span>
          <strong>{number(column.outliers)}</strong>
        </div>
      )}
    </div>
  )
}

export function Explorer({ data }: { data: Analysis }) {
  const [tab, setTab] = useState<'rows' | 'schema' | 'relationships'>('rows')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState('')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [result, setResult] = useState<RowsPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    // Only a changed search resets pagination. A mount-time timer could otherwise
    // pull a fast click on "Next" back to page one.
    if (search === query) return
    const timer = window.setTimeout(() => {
      setQuery(search)
      setPage(0)
    }, 250)
    return () => clearTimeout(timer)
  }, [search, query])
  useEffect(() => {
    if (tab !== 'rows') return
    const controller = new AbortController()
    const params = new URLSearchParams({ offset: String(page * 25), limit: '25', search: query, direction })
    if (sort) params.set('sort', sort)
    setLoading(true)
    setError('')
    api<RowsPage>(`/datasets/${data.id}/rows?${params}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setResult(result)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [data.id, page, query, sort, direction, retry, tab])
  const sortBy = (name: string) => {
    setPage(0)
    if (sort === name) setDirection(direction === 'asc' ? 'desc' : 'asc')
    else {
      setSort(name)
      setDirection('asc')
    }
  }
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">GET TO KNOW YOUR DATA</div>
          <h1>A closer look, row by row.</h1>
          <p>Explore the raw material behind every finding. Nothing silently changed.</p>
        </div>
        <Badge tone="neutral">
          <Database size={13} />
          {number(data.row_count)} rows · {data.column_count} columns
        </Badge>
      </div>
      <div className="panel explorer-panel">
        <div className="explorer-toolbar">
          <div className="segmented" role="tablist" aria-label="Data views">
            {(['rows', 'schema', 'relationships'] as const).map((t) => (
              <button
                role="tab"
                aria-selected={tab === t}
                aria-controls={`view-${t}`}
                id={`tab-${t}`}
                key={t}
                className={tab === t ? 'active' : ''}
                onClick={() => setTab(t)}
              >
                {t === 'rows' ? (
                  <>
                    <Table2 size={15} />
                    Data rows
                  </>
                ) : t === 'schema' ? (
                  'Column profile'
                ) : (
                  'Relationships'
                )}
              </button>
            ))}
          </div>
          {tab === 'rows' && (
            <label className="search-box">
              <Search size={16} />
              <input
                value={search}
                maxLength={200}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search across all columns…"
                aria-label="Search dataset"
              />
              {search && (
                <button className="clear-search" onClick={() => setSearch('')} aria-label="Clear search">
                  ×
                </button>
              )}
            </label>
          )}
        </div>
        {tab === 'rows' && (
          <div id="view-rows" role="tabpanel" aria-labelledby="tab-rows">
            <div className="table-caption">
              <span>{data.name}</span>
              <span>
                {loading ? <Spinner text="Fetching rows" /> : `${number(result?.total)} matching rows`}
              </span>
            </div>
            {error ? (
              <div className="padded">
                <ErrorBox message={error} retry={() => setRetry((r) => r + 1)} />
              </div>
            ) : (
              <div className={`table-scroll ${loading ? 'table-loading' : ''}`} aria-busy={loading}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="row-index">#</th>
                      {data.columns.map((column) => (
                        <th
                          key={column.name}
                          aria-sort={
                            sort === column.name ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                        >
                          <button onClick={() => sortBy(column.name)}>
                            <span className={`type-dot ${column.kind}`} />
                            <span>{column.name}</span>
                            {sort === column.name ? (
                              direction === 'asc' ? (
                                <ArrowUp size={13} />
                              ) : (
                                <ArrowDown size={13} />
                              )
                            ) : (
                              <ArrowUpDown size={12} className="sort-idle" />
                            )}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result?.rows.map((row, index) => (
                      <tr key={index}>
                        <td className="row-index">{page * 25 + index + 1}</td>
                        {data.columns.map((column) => (
                          <td
                            key={column.name}
                            className={column.kind === 'numeric' ? 'numeric-cell' : ''}
                            title={row[column.name] === null ? 'Missing value' : String(row[column.name])}
                          >
                            {row[column.name] === null ? (
                              <span className="missing-value">null</span>
                            ) : typeof row[column.name] === 'number' ? (
                              number(row[column.name] as number, 4)
                            ) : (
                              String(row[column.name])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && result?.rows.length === 0 && (
                  <div className="empty-state small">
                    <Search size={28} />
                    <h3>No matching rows</h3>
                    <p>Try a different phrase, number, or category.</p>
                    <button className="button secondary" onClick={() => setSearch('')}>
                      Clear search
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="table-pagination">
              <span>
                {result?.total
                  ? `${number(page * 25 + 1)}–${number(Math.min((page + 1) * 25, result.total))} of ${number(result.total)} rows`
                  : '0 rows'}
                <span className="muted"> · 25 per page</span>
              </span>
              <div>
                <button
                  className="button secondary small-button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                >
                  <ArrowLeft size={14} /> Previous
                </button>
                <span className="page-number">
                  {page + 1} / {Math.max(1, Math.ceil((result?.total || 0) / 25))}
                </span>
                <button
                  className="button secondary small-button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!result || (page + 1) * 25 >= result.total || loading}
                >
                  Next <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
        {tab === 'schema' && (
          <div id="view-schema" role="tabpanel" aria-labelledby="tab-schema">
            <div className="schema-intro">
              <Filter size={17} />
              <p>Types are inferred. Select a column to see its distribution or summary statistics.</p>
            </div>
            <div className="schema-list">
              <div className="schema-header">
                <span>Column</span>
                <span>Inferred type</span>
                <span>Distinct values</span>
                <span>Missing values</span>
                <span />
              </div>
              {data.columns.map((column) => (
                <div className="schema-item" key={column.name}>
                  <button
                    className="schema-row"
                    aria-expanded={expanded === column.name}
                    onClick={() => setExpanded(expanded === column.name ? null : column.name)}
                  >
                    <span className="schema-name">
                      <span className={`type-dot ${column.kind}`} />
                      {column.name}
                    </span>
                    <span>
                      <Badge tone="neutral">{column.kind}</Badge>
                    </span>
                    <span>{number(column.unique)}</span>
                    <span className="missing-stat">
                      {column.missing_pct > 0 ? (
                        <>
                          <span className="missing-progress">
                            <i style={{ width: `${Math.max(3, column.missing_pct)}%` }} />
                          </span>
                          {column.missing_pct}% <small>({number(column.missing)})</small>
                        </>
                      ) : (
                        <span className="green-text">Complete</span>
                      )}
                    </span>
                    <ChevronDown size={16} className={expanded === column.name ? 'rotated' : ''} />
                  </button>
                  {expanded === column.name && <ColumnDetail column={column} />}
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'relationships' && (
          <div
            id="view-relationships"
            role="tabpanel"
            aria-labelledby="tab-relationships"
            className="relationships"
          >
            <div className="section-intro">
              <h2>What moves together?</h2>
              <p>
                Pearson correlation measures linear relationships, from −1 to +1. It does not establish cause
                and effect.
              </p>
            </div>
            {data.correlations.length ? (
              data.correlations.map((pair) => (
                <div className="correlation-row" key={`${pair.first}-${pair.second}`}>
                  <div>
                    <strong>
                      {label(pair.first)} <span>↔</span> {label(pair.second)}
                    </strong>
                    <span>{number(pair.n)} complete pairs</span>
                  </div>
                  <div className="correlation-track">
                    <span
                      style={{
                        width: `${Math.abs(pair.value) * 100}%`,
                        background: pair.value < 0 ? '#ae8762' : '#7b9b6c',
                      }}
                    />
                  </div>
                  <strong className="correlation-value">{pair.value.toFixed(2)}</strong>
                </div>
              ))
            ) : (
              <div className="empty-state small">
                <p>
                  We need at least two varying numeric columns with 10 complete pairs to measure a
                  relationship.
                </p>
              </div>
            )}
            <div className="info-note">
              Exploratory results, ranked by absolute strength. No multiple-comparison correction; validate
              promising relationships independently.
            </div>
          </div>
        )}
      </div>
      <p className="data-footnote">
        Empty cells are treated as missing. Dates are inferred from common numeric formats. Raw uploaded
        values are never edited by the explorer.
      </p>
    </div>
  )
}
