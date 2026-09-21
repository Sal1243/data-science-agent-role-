import { useEffect, useRef, type ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, Check, LoaderCircle, X } from 'lucide-react'
import type { Insight } from './types'

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}
export function Spinner({ text = 'Working…' }: { text?: string }) {
  return (
    <span className="spinner-line" role="status">
      <LoaderCircle size={17} className="spin" />
      {text}
    </span>
  )
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <div>
        {message}
        {retry && (
          <button className="text-link" onClick={retry}>
            Try again <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement
    dialog?.showModal()
    const onCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    dialog?.addEventListener('cancel', onCancel)
    return () => {
      dialog?.removeEventListener('cancel', onCancel)
      dialog?.close()
      previous?.focus()
    }
  }, [onClose])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
export function InsightItem({ insight, detailed = false }: { insight: Insight; detailed?: boolean }) {
  return (
    <div className={`insight-item ${detailed ? 'detailed' : ''}`}>
      <span className={`insight-symbol ${insight.importance === 'warning' ? 'warning' : insight.kind}`}>
        {insight.importance === 'warning' ? (
          <AlertCircle size={17} />
        ) : insight.kind === 'quality' ? (
          <Check size={17} />
        ) : (
          <ArrowUpRight size={17} />
        )}
      </span>
      <div>
        <span className="insight-kind">
          {insight.kind === 'relationship'
            ? 'Connection'
            : insight.kind === 'quality'
              ? 'Data quality'
              : insight.kind === 'trend'
                ? 'Momentum'
                : 'Pattern'}
        </span>
        <h4>{insight.title}</h4>
        <p>{insight.description}</p>
        {detailed && insight.columns.length > 0 && (
          <div className="field-tags">
            {insight.columns.map((column) => (
              <code key={column}>{column}</code>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
