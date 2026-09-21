import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Columns3,
  Download,
  FileSpreadsheet,
  Layers3,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { Analysis, Charts, Page } from './types'
import { api, compact, downloadReport, errorMessage, label, number } from './api'
import { Badge, ErrorBox, InsightItem, Spinner } from './ui'

export function Dashboard({
  data,
  navigate,
  notify,
}: {
  data: Analysis
  navigate: (page: Page) => void
  notify: (message: string) => void
}) {
  const [charts, setCharts] = useState<Charts>(data.charts)
  const [metric, setMetric] = useState(data.charts.metric || '')
  const [aggregation, setAggregation] = useState<'sum' | 'mean'>('sum')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!metric) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api<Charts>(
      `/datasets/${data.id}/charts?metric=${encodeURIComponent(metric)}&aggregation=${aggregation}`,
      { signal: controller.signal }
    )
      .then(setCharts)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [data.id, metric, aggregation])
  const topInsights = [
    data.insights.find((i) => i.kind === 'trend') || data.insights[0],
    data.insights.find((i) => i.importance === 'warning'),
    data.insights.find((i) => i.kind === 'relationship'),
  ].filter((item, index, items) => item && items.indexOf(item) === index)
  const remaining = data.insights.filter((i) => !topInsights.includes(i))
  const visibleInsights = [...topInsights, ...remaining].slice(0, 3)
  const breakdownMax = Math.max(...charts.breakdown.map((p) => Math.abs(p.value || 0)), 1)
  const timeRange = data.columns.find((c) => c.kind === 'date')?.date_range
  const timeDescription = timeRange
    ? timeRange
        .map((value) =>
          new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        )
        .join(' – ')
    : 'All uploaded rows'
  const exportReport = () => downloadReport(data.id, 'markdown').catch((error) => notify(errorMessage(error)))
  const chartProps = { data: charts.trend, margin: { top: 12, right: 8, left: -20, bottom: 0 } }
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9ede5" />
      <XAxis
        dataKey="label"
        axisLine={false}
        tickLine={false}
        tick={{ fill: '#68765f', fontSize: 12 }}
        tickMargin={13}
        minTickGap={25}
        tickFormatter={(value) =>
          charts.kind === 'time' && charts.period === 'month' ? value.split(' ')[0] : value
        }
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={{ fill: '#68765f', fontSize: 12 }}
        tickFormatter={compact}
        tickMargin={8}
      />
      <Tooltip
        contentStyle={{
          borderRadius: 10,
          border: '1px solid #e1e6db',
          boxShadow: '0 4px 20px #213e3210',
          fontSize: 12,
        }}
        formatter={(value) => [
          number(Number(value), 2),
          charts.kind === 'histogram' ? 'Rows' : label(charts.metric),
        ]}
      />
    </>
  )

  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A FRESH PERSPECTIVE</div>
          <h1>A little clarity for your data.</h1>
          <p>The big picture, the small details, and what to explore next.</p>
        </div>
        <button className="button secondary" onClick={exportReport}>
          <Download size={16} /> Export report
        </button>
      </div>

      <div className="dataset-strip">
        <span className="file-icon">
          <FileSpreadsheet size={21} />
        </span>
        <div className="dataset-strip-name">
          <strong>{data.name}</strong>
          <span>{timeDescription}</span>
        </div>
        <Badge tone={data.is_demo ? 'neutral' : 'green'}>
          {data.is_demo ? 'SYNTHETIC DEMO' : 'YOUR DATASET'}
        </Badge>
        <div className="strip-spacer" />
        <span className="complete-label">
          <span className="status-dot" /> Analysis complete
        </span>
        <button
          className="icon-button"
          aria-label="Explore this dataset"
          onClick={() => navigate('explorer')}
        >
          <ArrowUpRight size={19} />
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            Total rows <Layers3 size={17} />
          </div>
          <div className="stat-value">
            {number(data.row_count)}
            <span className="stat-unit">rows</span>
          </div>
          <span className="stat-foot">
            <span className="mini-dot" /> Every observation accounted for
          </span>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Variables <Columns3 size={17} />
          </div>
          <div className="stat-value">
            {data.column_count}
            <span className="stat-unit">columns</span>
          </div>
          <span className="stat-foot">
            {data.numeric_count} numeric <span className="dot-separator">·</span> {data.categorical_count}{' '}
            categorical
          </span>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Data quality{' '}
            <span title={data.methodology.quality}>
              <CircleHelp
                size={16}
                aria-label="Quality is 80% completeness and 20% row uniqueness; not accuracy or bias."
              />
            </span>
          </div>
          <div className="stat-value">
            {number(data.quality_score, 1)}
            <span className="stat-unit">/ 100</span>
            <span className={`tiny-check ${data.quality_score < 95 ? 'needs-review' : ''}`}>
              {data.quality_score >= 95 ? <Check size={13} /> : <AlertCircle size={13} />}
            </span>
          </div>
          <span className="stat-foot">Completeness + row uniqueness</span>
        </div>
        <div className="stat-card insight-stat">
          <div className="stat-label">
            Insights uncovered <Sparkles size={17} />
          </div>
          <div className="stat-value">
            {String(data.insights.length).padStart(2, '0')}
            <span className="stat-unit">observations</span>
          </div>
          <button className="stat-foot text-link" onClick={() => navigate('reports')}>
            A few things worth a closer look <ArrowRight size={13} />
          </button>
        </div>
      </div>

      <div className="main-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>The performance picture</h2>
              <p>
                {charts.kind === 'time'
                  ? `${label(charts.period)}-by-${charts.period} perspective`
                  : charts.kind === 'histogram'
                    ? 'How your values are distributed'
                    : 'A snapshot of your dataset'}
              </p>
            </div>
            <div className="chart-controls">
              {data.numeric_count > 0 && (
                <>
                  <select
                    aria-label="Chart metric"
                    value={metric}
                    onChange={(event) => setMetric(event.target.value)}
                  >
                    {data.columns
                      .filter((c) => c.kind === 'numeric')
                      .map((c) => (
                        <option value={c.name} key={c.name}>
                          {label(c.name)}
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label="Chart aggregation"
                    value={aggregation}
                    onChange={(event) => setAggregation(event.target.value as 'sum' | 'mean')}
                  >
                    <option value="sum">Sum</option>
                    <option value="mean">Mean</option>
                  </select>
                </>
              )}
            </div>
          </div>
          {error ? (
            <ErrorBox message={error} />
          ) : (
            <>
              <div className="chart-summary">
                <div>
                  <span className="eyebrow">
                    {charts.aggregation === 'mean' ? 'AVERAGE' : 'TOTAL'} {label(charts.metric).toUpperCase()}
                  </span>
                  <strong>{number(charts.total, 2)}</strong>
                </div>
                {charts.change_pct !== null && charts.kind === 'time' && (
                  <div className="chart-change">
                    <Badge tone={charts.change_pct >= 0 ? 'green' : 'amber'}>
                      {charts.change_pct >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                      {Math.abs(charts.change_pct)}%
                    </Badge>
                    <span>vs. previous {charts.period}</span>
                  </div>
                )}
                {loading && (
                  <span className="chart-loading">
                    <Spinner text="Updating" />
                  </span>
                )}
              </div>
              <div
                className="main-chart"
                role="img"
                aria-label={`${label(charts.metric)} ${charts.kind === 'time' ? 'over time' : 'distribution'}. ${charts.trend.map((p) => `${p.label}: ${number(p.value, 2)}`).join('; ')}`}
              >
                {charts.trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    {charts.kind === 'time' ? (
                      <AreaChart {...chartProps}>
                        <defs>
                          <linearGradient id="greenArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#90ae83" stopOpacity={0.32} />
                            <stop offset="100%" stopColor="#cde0b8" stopOpacity={0.04} />
                          </linearGradient>
                        </defs>
                        {axes}
                        <Area
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="value"
                          stroke="#48734d"
                          strokeWidth={2.5}
                          fill="url(#greenArea)"
                          dot={{ r: 3, fill: '#fff', strokeWidth: 2 }}
                          activeDot={{ r: 5, stroke: '#fff', strokeWidth: 3 }}
                        />
                      </AreaChart>
                    ) : (
                      <BarChart {...chartProps}>
                        {axes}
                        <Bar
                          isAnimationActive={false}
                          dataKey="value"
                          fill="#7b9b6c"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={44}
                        />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-chart">
                    <Layers3 size={28} />
                    <p>No chartable fields yet.</p>
                    <span>Try a dataset with numeric or categorical values.</span>
                  </div>
                )}
              </div>
              <div className="chart-footer">
                <span className="legend-dot" />
                {charts.kind === 'time'
                  ? `${label(charts.aggregation)} by ${charts.period} · ${charts.date_column}`
                  : charts.kind === 'histogram'
                    ? 'Count of non-missing values per bin'
                    : 'Observed categories'}
                <span className="chart-footer-right">
                  {charts.kind === 'time'
                    ? 'Coverage may vary by period'
                    : `${number(charts.valid_rows)} valid rows`}
                </span>
              </div>
            </>
          )}
        </section>

        <section className="panel agent-panel">
          <div className="panel-heading">
            <div className="agent-title">
              <span className="agent-icon">
                <Sparkles size={18} />
              </span>
              <div>
                <h2>Worth a closer look</h2>
                <p>A note from your data agent</p>
              </div>
            </div>
            <span className="live-dot" />
          </div>
          <div className="agent-insights">
            {visibleInsights.map((insight) => insight && <InsightItem key={insight.id} insight={insight} />)}
          </div>
          <button className="full-width-link" onClick={() => navigate('reports')}>
            Explore all {data.insights.length} insights <ArrowRight size={16} />
          </button>
        </section>
      </div>

      <div className="bottom-grid">
        <section className="panel breakdown-panel">
          <div className="panel-heading">
            <div>
              <h2>
                {charts.category
                  ? `${label(charts.metric)} by ${charts.category.replace(/_/g, ' ')}`
                  : 'Category breakdown'}
              </h2>
              <p>
                {charts.aggregation === 'sum'
                  ? charts.breakdown.length >= 6
                    ? 'Top six categories · missing values separate'
                    : 'The pieces of the bigger picture'
                  : 'Comparing category averages'}
              </p>
            </div>
          </div>
          <div className="breakdown-list">
            {charts.breakdown.length ? (
              charts.breakdown.slice(0, 6).map((point, index) => (
                <div className="breakdown-item" key={point.label}>
                  <div>
                    <span>{point.label}</span>
                    <strong>{compact(point.value || 0)}</strong>
                  </div>
                  <div className="bar-track">
                    <span
                      style={{
                        width: `${(Math.abs(point.value || 0) / breakdownMax) * 100}%`,
                        background: ['#456a42', '#83a16d', '#a4ba8a', '#bdccaa', '#d2dcc3', '#e2e7dc'][index],
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="muted empty-small">No categorical columns were detected.</div>
            )}
          </div>
        </section>

        <section className="panel quality-panel">
          <div className="panel-heading">
            <div>
              <h2>A healthy starting point?</h2>
              <p>Small checks. More confidence.</p>
            </div>
            <ShieldCheck size={19} className="muted" />
          </div>
          <div className="quality-score">
            <div className="score-ring">
              <svg viewBox="0 0 96 96" aria-hidden="true">
                <circle cx="48" cy="48" r="40" fill="none" stroke="#eef1e9" strokeWidth="7" />
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  fill="none"
                  stroke="#719063"
                  strokeWidth="7"
                  strokeDasharray={`${(data.quality_score / 100) * 251.33} 251.33`}
                  transform="rotate(-90 48 48)"
                  strokeLinecap="round"
                />
              </svg>
              <strong>
                {Math.round(data.quality_score)}
                <span>/ 100</span>
              </strong>
            </div>
            <div>
              <strong>
                {data.quality_score >= 95
                  ? 'A solid foundation'
                  : data.quality_score >= 80
                    ? 'Room to improve'
                    : 'Needs a closer review'}
              </strong>
              <span>{number(data.completeness, 1)}% of cells are complete</span>
              <p>Quality is more than a score.</p>
            </div>
          </div>
          <div className="quality-lines">
            <div>
              <span>Missing cells</span>
              <span>
                {number(data.missing_cells)}
                <i className={data.missing_cells ? 'amber-dot' : 'green-dot'} />
              </span>
            </div>
            <div>
              <span>Duplicate rows</span>
              <span>
                {number(data.duplicate_rows)}
                <i className={data.duplicate_rows ? 'amber-dot' : 'green-dot'} />
              </span>
            </div>
          </div>
          <button className="text-link" onClick={() => navigate('explorer')}>
            Take a look at the columns <ChevronRight size={15} />
          </button>
        </section>

        <section className="next-card">
          <div className="next-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <span className="orbit-node node-one" />
            <span className="orbit-node node-two" />
            <span className="orbit-node node-three" />
            <Sparkles size={28} />
          </div>
          <span className="eyebrow">GO ONE QUESTION FURTHER</span>
          <h2>
            What could your
            <br />
            data predict?
          </h2>
          <p>
            Choose a target. Test a baseline.
            <br />
            Find the signal, not just a score.
          </p>
          <button className="button lime" onClick={() => navigate('models')}>
            Explore the model lab <ArrowUpRight size={17} />
          </button>
        </section>
      </div>
      <div className="page-footnote">
        <ShieldCheck size={13} /> Real calculations. Transparent methods. No external AI calls.
        <span>Made for a more thoughtful kind of analysis.</span>
      </div>
    </div>
  )
}
