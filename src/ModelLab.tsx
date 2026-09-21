import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Beaker,
  Check,
  ChevronDown,
  FlaskConical,
  GitBranch,
  Info,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Analysis, ModelResult } from './types'
import { api, compact, errorMessage, label, number } from './api'
import { Badge, ErrorBox, Spinner } from './ui'

const metricLabels: Record<string, string> = {
  r2: 'R² score',
  mae: 'Mean absolute error',
  rmse: 'Root mean squared error',
  accuracy: 'Accuracy',
  balanced_accuracy: 'Balanced accuracy',
  f1_weighted: 'Weighted F1',
}
const metricText = (key: string, value: number | null) =>
  value === null
    ? '—'
    : ['accuracy', 'balanced_accuracy', 'f1_weighted'].includes(key)
      ? `${(value * 100).toFixed(1)}%`
      : number(value, key === 'r2' ? 3 : 2)

export function ModelLab({ data }: { data: Analysis }) {
  const validTargets = data.columns.filter(
    (c) => ['numeric', 'categorical', 'boolean'].includes(c.kind) && c.unique > 1
  )
  const [target, setTarget] = useState(data.suggested_target || validTargets[0]?.name || '')
  const [task, setTask] = useState('auto')
  const [split, setSplit] = useState(data.columns.some((c) => c.kind === 'date') ? 'time' : 'random')
  const [features, setFeatures] = useState<string[]>(
    data.columns
      .filter(
        (c) =>
          ['numeric', 'categorical', 'boolean'].includes(c.kind) &&
          c.unique > 1 &&
          c.name !== (data.suggested_target || validTargets[0]?.name)
      )
      .map((c) => c.name)
      .slice(0, 30)
  )
  const [result, setResult] = useState<ModelResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState('')
  const [showFeatures, setShowFeatures] = useState(false)
  const initialRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    initialRequest.current = controller
    api<ModelResult | null>(`/datasets/${data.id}/model`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setResult(result)
        if (result) {
          setTarget(result.target)
          setTask(result.task)
          setSplit(result.split)
          setFeatures(result.features)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false)
      })
    return () => controller.abort()
  }, [data.id])
  const changeTarget = (next: string) => {
    setTarget(next)
    setFeatures(
      data.columns
        .filter(
          (c) => ['numeric', 'categorical', 'boolean'].includes(c.kind) && c.unique > 1 && c.name !== next
        )
        .map((c) => c.name)
        .slice(0, 30)
    )
  }
  const train = async () => {
    initialRequest.current?.abort()
    setError('')
    setLoading(true)
    try {
      setResult(
        await api<ModelResult>(`/datasets/${data.id}/model`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target, task, split, features }),
        })
      )
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }
  const settingsChanged =
    result &&
    (result.target !== target ||
      (task !== 'auto' && result.task !== task) ||
      result.split !== split ||
      result.features.length !== features.length ||
      result.features.some((feature) => !features.includes(feature)))
  const maxImportance = Math.max(
    ...(result?.feature_importance.map((f) => Math.abs(f.importance || 0)) || []),
    0.0001
  )
  const predictionMax = Math.max(...(result?.predictions?.flatMap((p) => [p.actual, p.predicted]) || [1]))
  const predictionMin = Math.min(...(result?.predictions?.flatMap((p) => [p.actual, p.predicted]) || [0]))
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A QUESTION WORTH TESTING</div>
          <h1>Find the signal. Test the idea.</h1>
          <p>A careful first experiment, with an honest baseline to compare against.</p>
        </div>
        <Badge tone="neutral">
          <FlaskConical size={14} />
          EXPERIMENTAL
        </Badge>
      </div>
      <div className="model-layout">
        <section className="panel experiment-settings">
          <div className="panel-heading">
            <div>
              <h2>Design your experiment</h2>
              <p>One target. A few useful questions.</p>
            </div>
            <Beaker size={20} className="muted" />
          </div>
          <div className="form-body">
            <fieldset disabled={loading || restoring}>
              <label className="form-label" htmlFor="target">
                <span className="step-number">01</span> What would you like to predict?
              </label>
              <select
                className="form-select"
                id="target"
                value={target}
                onChange={(event) => changeTarget(event.target.value)}
              >
                {validTargets.length ? (
                  validTargets.map((c) => (
                    <option key={c.name} value={c.name}>
                      {label(c.name)} · {c.kind}
                    </option>
                  ))
                ) : (
                  <option value="">No eligible targets</option>
                )}
              </select>
              <label className="form-label" htmlFor="task">
                <span className="step-number">02</span> What kind of question is it?
              </label>
              <select
                className="form-select"
                id="task"
                value={task}
                onChange={(event) => setTask(event.target.value)}
              >
                <option value="auto">Auto-detect the task</option>
                <option value="regression">Regression · predict a number</option>
                <option value="classification">Classification · predict a label</option>
              </select>
              <p className="field-hint">
                Auto treats small integer label sets as classes. Override for counts or ratings.
              </p>
              <label className="form-label" htmlFor="split">
                <span className="step-number">03</span> How should we test it?
              </label>
              <select
                className="form-select"
                id="split"
                value={split}
                onChange={(event) => setSplit(event.target.value)}
              >
                <option value="random">Random split · 80% / 20%</option>
                <option value="time" disabled={!data.columns.some((c) => c.kind === 'date')}>
                  Chronological · earlier → later
                </option>
              </select>
              <p className="field-hint">
                {split === 'time'
                  ? 'Earlier dates train the model. Later dates test it. Equal timestamps stay together.'
                  : 'A reproducible random holdout. Classification splits preserve class proportions.'}
              </p>
              <button
                className="feature-toggle"
                aria-expanded={showFeatures}
                onClick={() => setShowFeatures(!showFeatures)}
              >
                <span>{features.length} selected features</span>
                <ChevronDown size={15} className={showFeatures ? 'rotated' : ''} />
              </button>
              {showFeatures && (
                <div className="feature-list">
                  {data.columns
                    .filter((c) => c.name !== target)
                    .map((c) => {
                      const eligible = ['numeric', 'categorical', 'boolean'].includes(c.kind) && c.unique > 1
                      return (
                        <label key={c.name} className={!eligible ? 'disabled' : ''}>
                          <input
                            type="checkbox"
                            checked={features.includes(c.name)}
                            disabled={!eligible || (features.length >= 30 && !features.includes(c.name))}
                            onChange={(event) =>
                              setFeatures(
                                event.target.checked
                                  ? [...features, c.name]
                                  : features.filter((f) => f !== c.name)
                              )
                            }
                          />
                          <span>
                            {c.name}
                            <small>{eligible ? c.kind : `${c.kind} · excluded`}</small>
                          </span>
                        </label>
                      )
                    })}
                </div>
              )}
            </fieldset>
            <button
              className="button primary train-button"
              disabled={loading || restoring || !target || !features.length || data.row_count < 60}
              onClick={train}
            >
              {loading ? (
                <Spinner text="Running experiment…" />
              ) : (
                <>
                  <Play size={15} fill="currentColor" /> Train baseline <ArrowRight size={16} />
                </>
              )}
            </button>
            {data.row_count < 60 && (
              <p className="field-hint">Upload at least 60 distinct rows to run an experiment.</p>
            )}
            <div className="training-note">
              <ShieldCheck size={16} />
              <span>
                Training-only preprocessing.
                <br />
                Reproducible seed. Held-out evaluation.
              </span>
            </div>
          </div>
        </section>
        <div className="model-content">
          {error && <ErrorBox message={error} />}
          {data.is_demo && (
            <div className="info-note">
              <Info size={16} />
              <span>
                This is synthetic data. Revenue is calculated from units, price, and discount. A revenue model
                will learn that formula—not predict future business performance.
              </span>
            </div>
          )}
          {!result ? (
            <section className="panel model-empty">
              <div className="experiment-illustration" aria-hidden="true">
                <div className="illustration-node">
                  <DatabaseGlyph />
                </div>
                <span />
                <div className="illustration-node main-node">
                  <GitBranch size={30} />
                </div>
                <span />
                <div className="illustration-node">
                  <Sparkles size={25} />
                </div>
              </div>
              <Badge tone="neutral">CURIOSITY, MEET A CONTROL GROUP</Badge>
              <h2>
                A score is only useful
                <br />
                with a little context.
              </h2>
              <p>
                We’ll train a random forest, compare it with a naive baseline, and show you which features the
                model relies on.
              </p>
              <div className="experiment-promises">
                <span>
                  <Check size={15} /> No test data used in training
                </span>
                <span>
                  <Check size={15} /> Exact duplicates removed before splitting
                </span>
                <span>
                  <Check size={15} /> Transparent metrics and caveats
                </span>
              </div>
              {loading ? (
                <Spinner text="Fitting, evaluating, and checking feature importance…" />
              ) : (
                <span className="empty-prompt">Set up your experiment to the left, then hit train.</span>
              )}
            </section>
          ) : (
            <div className="model-results">
              {settingsChanged && (
                <div className="info-note">
                  <Info size={16} />
                  These are the last completed results. Train again to evaluate your current settings.
                </div>
              )}
              <div className="result-heading">
                <div>
                  <Badge>
                    <Check size={12} />
                    EXPERIMENT COMPLETE
                  </Badge>
                  <h2>
                    {label(result.target)} · {label(result.task)}
                  </h2>
                  <p>
                    {number(result.train_rows)} training rows <span>·</span> {number(result.test_rows)}{' '}
                    held-out rows <span>·</span> {result.split === 'time' ? 'Chronological' : 'Random'} split
                  </p>
                </div>
                {loading && <Spinner text="Retraining…" />}
              </div>
              <div className="model-metric-grid">
                {Object.entries(result.metrics).map(([key, value]) => (
                  <div className="panel model-metric" key={key}>
                    <span>{metricLabels[key] || key}</span>
                    <strong>{metricText(key, value)}</strong>
                    <small>
                      Naive baseline <b>{metricText(key, result.baseline_metrics[key])}</b>
                    </small>
                    <span className="metric-direction">
                      {['mae', 'rmse'].includes(key) ? 'Lower is better' : 'Higher is better'}
                    </span>
                  </div>
                ))}
              </div>
              <section className="panel importance-panel">
                <div className="panel-heading">
                  <div>
                    <h2>What is the model leaning on?</h2>
                    <p>Permutation importance · held-out data · 3 shuffles</p>
                  </div>
                </div>
                <div className="importance-list">
                  {result.feature_importance.map((feature) => (
                    <div className="importance-row" key={feature.feature}>
                      <span>{label(feature.feature)}</span>
                      <div className="bar-track">
                        <span
                          style={{
                            width: `${(Math.abs(feature.importance || 0) / maxImportance) * 100}%`,
                            background: (feature.importance || 0) < 0 ? '#c2b79e' : '#779665',
                          }}
                        />
                      </div>
                      <strong>{number(feature.importance, 3)}</strong>
                    </div>
                  ))}
                </div>
                <p className="panel-note">
                  {result.importance_unit === 'MAE'
                    ? 'Increase in mean absolute error after shuffling a feature.'
                    : 'Decrease in accuracy after shuffling a feature.'}{' '}
                  Larger positive values indicate more reliance. Negative values indicate no positive signal
                  in this run.
                </p>
              </section>
              {result.predictions && (
                <section className="panel prediction-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Predictions meet reality</h2>
                      <p>
                        First {result.predictions.length} held-out rows · the line marks a perfect prediction
                      </p>
                    </div>
                  </div>
                  <div className="prediction-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 24, bottom: 22, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 5" stroke="#e9ede5" />
                        <XAxis
                          type="number"
                          dataKey="actual"
                          name="Actual"
                          tickFormatter={compact}
                          tick={{ fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          label={{
                            value: 'Actual value',
                            position: 'bottom',
                            offset: 4,
                            fontSize: 11,
                            fill: '#7b8375',
                          }}
                        />
                        <YAxis
                          type="number"
                          dataKey="predicted"
                          name="Predicted"
                          tickFormatter={compact}
                          tick={{ fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(value) => number(Number(value), 2)}
                          cursor={{ strokeDasharray: '3 3' }}
                        />
                        <ReferenceLine
                          segment={[
                            { x: predictionMin, y: predictionMin },
                            { x: predictionMax, y: predictionMax },
                          ]}
                          stroke="#b5bba9"
                          strokeDasharray="5 5"
                          ifOverflow="extendDomain"
                        />
                        <Scatter
                          isAnimationActive={false}
                          data={result.predictions}
                          fill="#608357"
                          fillOpacity={0.65}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}
              {result.confusion && (
                <section className="panel confusion-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Where the classes get confused</h2>
                      <p>Rows: actual label · columns: predicted label</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Actual / predicted</th>
                          {result.confusion.labels.map((value) => (
                            <th key={value}>{value}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.confusion.matrix.map((row, index) => (
                          <tr key={index}>
                            <th>{result.confusion?.labels[index]}</th>
                            {row.map((value, column) => (
                              <td key={column} className={index === column ? 'correct-cell' : ''}>
                                {number(value)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              <details className="panel model-caveats" open>
                <summary>
                  <Info size={17} /> The fine print is part of the finding <ChevronDown size={15} />
                </summary>
                <ul>
                  {result.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                {result.excluded.length > 0 && (
                  <div className="excluded-features">
                    <strong>Automatically excluded</strong>
                    {result.excluded.map((item) => (
                      <p key={item.name}>
                        <code>{item.name}</code> — {item.reason}
                      </p>
                    ))}
                  </div>
                )}
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function DatabaseGlyph() {
  return (
    <svg
      width="28"
      height="30"
      viewBox="0 0 28 30"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <ellipse cx="14" cy="6" rx="11" ry="4" />
      <path d="M3 6v17c0 6 22 6 22 0V6M3 14c0 6 22 6 22 0" />
    </svg>
  )
}
