import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Code2,
  FileText,
  Info,
  ShieldCheck,
} from 'lucide-react'
import type { Analysis, ModelResult, Page } from './types'
import { api, datasetName, downloadReport, errorMessage, label, number } from './api'
import { Badge, BrandMark, InsightItem } from './ui'

export function Reports({
  data,
  navigate,
  notify,
}: {
  data: Analysis
  navigate: (page: Page) => void
  notify: (message: string) => void
}) {
  const [model, setModel] = useState<ModelResult | null>(null)
  const [modelError, setModelError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api<ModelResult | null>(`/datasets/${data.id}/model`, { signal: controller.signal })
      .then(setModel)
      .catch((error) => {
        if (!controller.signal.aborted) setModelError(errorMessage(error))
      })
    return () => controller.abort()
  }, [data.id])
  const exportFile = (format: 'markdown' | 'json') =>
    downloadReport(data.id, format).catch((error) => notify(errorMessage(error)))
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE TAKEAWAY</div>
          <h1>From findings to next steps.</h1>
          <p>A clear, portable record of what we found—and how we found it.</p>
        </div>
        <button className="button primary" onClick={() => exportFile('markdown')}>
          <ArrowDownToLine size={16} />
          Download report
        </button>
      </div>
      <div className="report-layout">
        <article className="report-document">
          <div className="report-brand">
            <div>
              <BrandMark small />
              <strong>fieldnote</strong>
              <span>RESEARCH NOTES</span>
            </div>
            <span>01 / DATASET ANALYSIS</span>
          </div>
          <div className="report-title">
            <Badge tone={data.is_demo ? 'amber' : 'green'}>
              {data.is_demo ? 'SYNTHETIC DEMONSTRATION' : 'AUTOMATED ANALYSIS'}
            </Badge>
            <h2>{datasetName(data.name)}</h2>
            <p>
              Prepared{' '}
              {new Date(data.created_at).toLocaleDateString('en-US', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              <span>·</span> {number(data.row_count)} observations
            </p>
          </div>
          <section className="report-summary">
            <span className="eyebrow">IN A FEW WORDS</span>
            <p>{data.summary}</p>
          </section>
          <div className="report-section-heading">
            <span>01</span>
            <h3>The important observations</h3>
          </div>
          <div className="report-insights">
            {data.insights.map((insight) => (
              <InsightItem key={insight.id} insight={insight} detailed />
            ))}
          </div>
          <div className="report-section-heading">
            <span>02</span>
            <h3>Where to go from here</h3>
          </div>
          <div className="next-steps">
            <div>
              <span>1</span>
              <p>
                <strong>Ground the data in context.</strong> Confirm the unit of observation, provenance, date
                coverage, and what each column really means.
              </p>
            </div>
            <div>
              <span>2</span>
              <p>
                <strong>Review before you clean.</strong> Investigate missingness and duplicate rows. Repeated
                events and unusual values are not automatically mistakes.
              </p>
            </div>
            <div>
              <span>3</span>
              <p>
                <strong>Turn a pattern into a question.</strong> Use correlations to guide investigation, then
                validate with independent data and domain expertise.
              </p>
            </div>
            <div>
              <span>4</span>
              <p>
                <strong>Test before you trust.</strong> Choose features available at prediction time. Use
                time-aware or grouped validation when the problem calls for it.
              </p>
            </div>
          </div>
          <div className="report-section-heading">
            <span>03</span>
            <h3>The predictive baseline</h3>
          </div>
          {model ? (
            <div className="report-model">
              <Badge>
                <Check size={12} />
                EXPERIMENT INCLUDED
              </Badge>
              <p>
                <strong>{label(model.target)}</strong> · {model.task} · {model.model_name}
              </p>
              <p>
                {number(model.train_rows)} training rows and {number(model.test_rows)} holdout rows, with a{' '}
                {model.split === 'time' ? 'chronological' : 'random'} split.
              </p>
              <div className="report-model-metrics">
                {Object.entries(model.metrics).map(([key, value]) => (
                  <div key={key}>
                    <span>{label(key)}</span>
                    <strong>{number(value, 4)}</strong>
                    <small>Naive: {number(model.baseline_metrics[key], 4)}</small>
                  </div>
                ))}
              </div>
              <p className="muted">
                Full metrics, selected features, and experiment caveats are included in your downloads.
              </p>
              <button className="text-link" onClick={() => navigate('models')}>
                Review the experiment <ArrowUpRight size={14} />
              </button>
            </div>
          ) : (
            <div className="report-not-run">
              <Info size={19} />
              <div>
                <strong>
                  {modelError ? 'Experiment status unavailable' : 'A question for the next chapter.'}
                </strong>
                <p>
                  {modelError ||
                    'No predictive experiment has been run for this dataset. Explore the model lab when you have a target in mind.'}
                </p>
                <button className="text-link" onClick={() => navigate('models')}>
                  Open the model lab <ArrowUpRight size={14} />
                </button>
              </div>
            </div>
          )}
          <div className="report-section-heading">
            <span>04</span>
            <h3>Methods, not magic</h3>
          </div>
          <div className="method-list">
            {Object.entries(data.methodology).map(([key, value]) => (
              <details key={key}>
                <summary>
                  {label(key)}
                  <ChevronDown size={15} />
                </summary>
                <p>{value}</p>
              </details>
            ))}
          </div>
          <p className="report-disclaimer">
            Descriptive, automated analysis—not causal inference, a forecast, or a fairness audit. Dates are
            inferred; prefer ISO 8601 for unambiguous parsing. Missing metric values are excluded from
            aggregations. No currency is assumed.
          </p>
          {data.notes.length > 0 && (
            <div className="report-notes">
              <strong>A note about this dataset</strong>
              {data.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          )}
          <footer className="report-footer">
            <BrandMark small />
            <span>A little clarity goes a long way.</span>
            <span>fieldnote / local analysis</span>
          </footer>
        </article>
        <aside className="report-sidebar">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Ready to take with you</h2>
                <p>Your findings, without the noise.</p>
              </div>
            </div>
            <div className="report-downloads">
              <button onClick={() => exportFile('markdown')}>
                <span className="download-icon">
                  <FileText size={19} />
                </span>
                <span>
                  <strong>Analysis report</strong>
                  <small>Markdown · readable anywhere</small>
                </span>
                <ArrowDownToLine size={16} />
              </button>
              <button onClick={() => exportFile('json')}>
                <span className="download-icon">
                  <Code2 size={19} />
                </span>
                <span>
                  <strong>Structured findings</strong>
                  <small>JSON · ready for your workflow</small>
                </span>
                <ArrowDownToLine size={16} />
              </button>
            </div>
            <p className="panel-note">
              Includes profiles and derived findings, not raw rows. Category names, summaries, and evaluation
              values may still be sensitive.
            </p>
          </section>
          <section className="panel analysis-trail">
            <div className="panel-heading">
              <div>
                <h2>A transparent trail</h2>
                <p>What your data agent did</p>
              </div>
              <CheckCheck size={20} className="green-text" />
            </div>
            {data.steps.map((step, index) => (
              <div className="trail-step" key={step.name}>
                <span>
                  <Check size={12} />
                </span>
                <div>
                  <strong>{step.name}</strong>
                  <small>
                    Step {index + 1} · completed{step.duration_ms > 0 ? ` in ${step.duration_ms} ms` : ''}
                  </small>
                </div>
              </div>
            ))}
            <div className="trail-foot">
              <ShieldCheck size={15} />
              <span>No external AI calls. No made-up metrics.</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
