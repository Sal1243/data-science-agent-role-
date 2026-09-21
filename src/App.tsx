import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Plus,
  ShieldCheck,
  Table2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { Analysis, DatasetMeta, Page } from './types'
import { api, datasetName, errorMessage, number } from './api'
import { BrandMark, ErrorBox, Modal, Spinner } from './ui'
import { Dashboard } from './Dashboard'
const Explorer = lazy(() => import('./Explorer').then((module) => ({ default: module.Explorer })))
const ModelLab = lazy(() => import('./ModelLab').then((module) => ({ default: module.ModelLab })))
const Reports = lazy(() => import('./Reports').then((module) => ({ default: module.Reports })))

const pages = [
  { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
  { id: 'explorer' as const, label: 'Data explorer', icon: Table2 },
  { id: 'models' as const, label: 'Model lab', icon: FlaskConical },
  { id: 'reports' as const, label: 'Reports', icon: FileText },
]
const currentPage = (): Page => pages.find((page) => `#${page.id}` === window.location.hash)?.id || 'overview'

function UploadDialog({
  onClose,
  onUploaded,
}: {
  onClose: () => void
  onUploaded: (data: Analysis) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const choose = (next?: File) => {
    if (!next || loading) return
    setError('')
    if (!next.name.toLowerCase().endsWith('.csv')) {
      setError('Please choose a CSV file. Export spreadsheets as UTF-8 CSV first.')
      return
    }
    if (next.size > 15 * 1024 * 1024) {
      setError('This file is too large. Choose a CSV smaller than 15 MB.')
      return
    }
    setFile(next)
  }
  const upload = async () => {
    if (!file) return
    setError('')
    setLoading(true)
    controller.current = new AbortController()
    const body = new FormData()
    body.append('file', file)
    try {
      const result = await api<Analysis>('/datasets', {
        method: 'POST',
        body,
        signal: controller.current.signal,
      })
      onUploaded(result)
    } catch (error) {
      if (!controller.current.signal.aborted) setError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title="Give your data a fresh perspective." onClose={onClose}>
      <p className="modal-description">
        Start with a CSV. We’ll handle the first look—profiles, quality checks, relationships, and a clear
        report.
      </p>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!loading) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          choose(event.dataTransfer.files[0])
        }}
      >
        <span className="upload-symbol">{file ? <FileSpreadsheet size={30} /> : <Upload size={28} />}</span>
        {file ? (
          <>
            <h3>{file.name}</h3>
            <p>{number(file.size / 1024, 1)} KB · Ready for a closer look</p>
            <button
              className="button secondary small-button"
              disabled={loading}
              onClick={() => input.current?.click()}
            >
              Choose a different file
            </button>
          </>
        ) : (
          <>
            <h3>Drop your dataset here</h3>
            <p>or choose a file from your computer</p>
            <button className="button secondary" onClick={() => input.current?.click()}>
              Browse files <ArrowUpRight size={15} />
            </button>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          aria-label="Choose CSV file"
          hidden
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      <div className="upload-limits">
        <span>UTF-8 CSV</span>
        <span>Up to 15 MB</span>
        <span>50,000 rows · 60 columns</span>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="upload-privacy">
        <LockKeyhole size={17} />
        <p>
          Processed here, not sent to an AI provider. Datasets expire after 2 hours without access, with
          cleanup within a minute. Keep a local copy.
        </p>
      </div>
      <button className="button primary upload-submit" disabled={!file || loading} onClick={upload}>
        {loading ? (
          <Spinner text="Profiling columns and finding patterns…" />
        ) : (
          <>
            <span>Let’s find the story</span>
            <ArrowRight size={17} />
          </>
        )}
      </button>
      <p className="upload-retention">
        This single-user workspace holds up to 4 uploads. Adding another replaces the least recently used
        dataset.
      </p>
    </Modal>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>(currentPage)
  const [data, setData] = useState<Analysis | null>(null)
  const [datasets, setDatasets] = useState<DatasetMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [toast, setToast] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const closeUpload = useCallback(() => setUploadOpen(false), [])
  const closeHelp = useCallback(() => setHelpOpen(false), [])
  const notify = useCallback((message: string) => setToast(message), [])
  const navigate = useCallback((next: Page) => {
    window.location.hash = next
    setPage(next)
    setMobileOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  useEffect(() => {
    const onHash = () => {
      setPage(currentPage())
      setMobileOpen(false)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => {
      setIsMobile(query.matches)
      if (!query.matches) setMobileOpen(false)
    }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!mobileOpen || !isMobile) return
    const previous = document.activeElement as HTMLElement
    const sidebar = document.getElementById('workspace-sidebar')
    sidebar?.querySelector<HTMLElement>('.main-nav a.active')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || [])
      const first = items[0],
        last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [mobileOpen, isMobile])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 7000)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setError('')
      setLoading(true)
      try {
        const demo = await api<Analysis>('/demo', { signal: controller.signal })
        const list = await api<DatasetMeta[]>('/datasets', { signal: controller.signal })
        let last = 'demo'
        try {
          last = localStorage.getItem('fieldnote:last-dataset') || 'demo'
        } catch {
          /* Storage can be disabled. */
        }
        const selected =
          list.some((item) => item.id === last) && last !== 'demo'
            ? await api<Analysis>(`/datasets/${last}`, { signal: controller.signal }).catch(() => demo)
            : demo
        if (!controller.signal.aborted) {
          setData(selected)
          setDatasets(list)
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [retry])
  useEffect(() => () => requestRef.current?.abort(), [])
  const remember = (id: string) => {
    try {
      localStorage.setItem('fieldnote:last-dataset', id)
    } catch {
      /* No raw data is stored in the browser. */
    }
  }
  const selectDataset = async (id: string) => {
    if (id === data?.id) {
      setMobileOpen(false)
      return
    }
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setSwitching(true)
    setMobileOpen(false)
    try {
      const selected = await api<Analysis>(`/datasets/${id}`, { signal: controller.signal })
      if (!controller.signal.aborted) {
        setData(selected)
        remember(id)
        navigate('overview')
      }
    } catch (error) {
      if (!controller.signal.aborted) notify(errorMessage(error))
    } finally {
      if (!controller.signal.aborted) setSwitching(false)
    }
  }
  const onUploaded = (uploaded: Analysis) => {
    requestRef.current?.abort()
    setSwitching(false)
    setData(uploaded)
    remember(uploaded.id)
    closeUpload()
    navigate('overview')
    setDatasets((items) => [...items.filter((item) => item.id !== uploaded.id), uploaded])
    api<DatasetMeta[]>('/datasets')
      .then(setDatasets)
      .catch((error) => notify(errorMessage(error)))
    notify(`${uploaded.name} is ready. ${uploaded.insights.length} observations found.`)
  }
  const deleteDataset = async (dataset: DatasetMeta) => {
    if (
      !window.confirm(
        `Remove “${dataset.name}” from this workspace? This clears the in-memory dataset, findings, and model result. Your original file is not affected.`
      )
    )
      return
    try {
      await api<void>(`/datasets/${dataset.id}`, { method: 'DELETE' })
      setDatasets((items) => items.filter((item) => item.id !== dataset.id))
      if (data?.id === dataset.id) await selectDataset('demo')
      notify('Dataset removed from this workspace.')
    } catch (error) {
      notify(errorMessage(error))
    }
  }
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        inert={isMobile && !mobileOpen}
        aria-label="Workspace sidebar"
        className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}
      >
        <a href="#overview" className="brand" onClick={() => navigate('overview')}>
          <BrandMark />
          <span>
            fieldnote<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Personal workspace</strong>
            <small>A space for your next insight</small>
          </div>
        </div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {pages.map((item) => (
            <a
              href={`#${item.id}`}
              className={page === item.id ? 'active' : ''}
              aria-current={page === item.id ? 'page' : undefined}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === 'models' && <span className="nav-beta">LAB</span>}
              {page === item.id && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="nav-section-label dataset-nav-label">
          <span>YOUR DATASETS</span>
          <button className="icon-button" aria-label="Add a dataset" onClick={() => setUploadOpen(true)}>
            <Plus size={15} />
          </button>
        </div>
        <div className="dataset-nav">
          {[...datasets].reverse().map((item) => (
            <div key={item.id} className={`dataset-nav-row ${data?.id === item.id ? 'selected' : ''}`}>
              <button
                className="dataset-nav-item"
                onClick={() => void selectDataset(item.id)}
                disabled={switching}
              >
                <FileSpreadsheet size={17} />
                <span>
                  <strong title={item.name}>{datasetName(item.name)}</strong>
                  <small>{item.is_demo ? 'Sample dataset' : `${number(item.row_count)} rows · CSV`}</small>
                </span>
              </button>
              {!item.is_demo && (
                <button
                  className="delete-dataset"
                  onClick={() => void deleteDataset(item)}
                  aria-label={`Delete ${item.name}`}
                  title="Remove dataset"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="add-data-button" onClick={() => setUploadOpen(true)}>
          <Plus size={15} />
          Bring your own data
        </button>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <span className="privacy-icon">
              <ShieldCheck size={19} />
            </span>
            <h3>Your data. Your workspace.</h3>
            <p>Local analysis. Transparent methods. A little peace of mind.</p>
            <button onClick={() => setHelpOpen(true)}>
              How Fieldnote works <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="help-button" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={17} />A field guide<span>v1.0</span>
          </button>
          <div className="sidebar-signature">
            <span>LESS NOISE. MORE KNOWING.</span>
            <i />
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={isMobile && mobileOpen}>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            aria-controls="workspace-sidebar"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{pages.find((item) => item.id === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-status">
              <span className="status-dot" />
              Local analysis
            </span>
            <span className="topbar-divider" />
            <button className="button primary" onClick={() => setUploadOpen(true)}>
              <Plus size={16} />
              New analysis
            </button>
            <span className="user-avatar" aria-label="Personal workspace">
              P
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="content" aria-busy={loading || switching}>
          {loading ? (
            <div className="workspace-loading">
              <BrandMark />
              <h1>A little clarity is on its way.</h1>
              <Spinner text="Preparing your data workspace…" />
            </div>
          ) : error ? (
            <div className="workspace-loading">
              <h1>Let’s get reconnected.</h1>
              <ErrorBox message={error} retry={() => setRetry((value) => value + 1)} />
              <p className="muted">
                The analysis service may still be starting. Your files have not been changed.
              </p>
            </div>
          ) : (
            data && (
              <div className={switching ? 'switching-content' : ''} key={data.id}>
                <Suspense
                  fallback={
                    <div className="padded">
                      <Spinner text="Opening your workspace…" />
                    </div>
                  }
                >
                  {page === 'overview' && <Dashboard data={data} navigate={navigate} notify={notify} />}
                  {page === 'explorer' && <Explorer data={data} />}
                  {page === 'models' && <ModelLab data={data} />}
                  {page === 'reports' && <Reports data={data} navigate={navigate} notify={notify} />}
                </Suspense>
              </div>
            )
          )}
          {switching && (
            <div className="switching-indicator">
              <Spinner text="Opening dataset…" />
            </div>
          )}
        </main>
      </div>
      {uploadOpen && <UploadDialog onClose={closeUpload} onUploaded={onUploaded} />}
      {helpOpen && (
        <Modal title="A more thoughtful first look." onClose={closeHelp}>
          <div className="guide-intro">
            <BrandMark />
            <p>
              Fieldnote is a local-first data-science agent. It turns a dataset into a profile,
              evidence-backed observations, and a reproducible starting point for modeling.
            </p>
          </div>
          <div className="guide-list">
            <div>
              <Check size={17} />
              <p>
                <strong>Calculations, not guesses.</strong> A deterministic pandas and scikit-learn workflow.
                No language model, API key, or external AI provider is involved.
              </p>
            </div>
            <div>
              <ShieldCheck size={18} />
              <p>
                <strong>A temporary, single-user workspace.</strong> Up to 4 uploads, held in server memory
                and expired after 2 hours without access (cleanup within a minute) or cleared on restart.
                Delete any uploaded dataset from the sidebar. Upload parsing may use temporary files.
              </p>
            </div>
            <div>
              <FlaskConical size={18} />
              <p>
                <strong>A baseline, not a promise.</strong> Models use training-only preprocessing and a
                held-out comparison. These are exploratory results; review leakage, time splits, and domain
                context before trusting them.
              </p>
            </div>
            <div>
              <LockKeyhole size={18} />
              <p>
                <strong>Use a trusted environment.</strong> This app has no login or multi-user isolation.
                Anyone with access to this server can access its workspace. Add authentication before a public
                deployment.
              </p>
            </div>
          </div>
          <div className="guide-footer">
            <a href="/api/docs" target="_blank" rel="noreferrer" className="text-link">
              Explore the API <ArrowUpRight size={14} />
            </a>
            <button className="button primary" onClick={closeHelp}>
              Back to the data <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button onClick={() => setToast('')} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
