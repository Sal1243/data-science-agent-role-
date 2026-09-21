export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail =
      typeof body?.detail === 'string'
        ? body.detail
        : Array.isArray(body?.detail)
          ? body.detail.map((item: { msg: string }) => item.msg).join('. ')
          : null
    throw new Error(detail || `Request failed (${response.status}). Please try again.`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export async function downloadReport(id: string, format: 'markdown' | 'json') {
  const response = await fetch(`/api/datasets/${id}/report?format=${format}`)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail || 'Could not download this report. Please try again.')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download =
    response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ||
    `fieldnote-report.${format === 'json' ? 'json' : 'md'}`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const number = (value: number | null | undefined, decimals = 0) => {
  if (value == null) return '—'
  const magnitude = Math.abs(value)
  if ((magnitude > 0 && magnitude < 0.001) || magnitude >= 1e12) {
    return new Intl.NumberFormat('en-US', { notation: 'scientific', maximumFractionDigits: 3 }).format(value)
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: magnitude > 0 && magnitude < 1 ? Math.max(3, decimals) : decimals,
  }).format(value)
}
export const compact = (value: number) =>
  value !== 0 && Math.abs(value) < 1
    ? number(value, 3)
    : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
export const label = (value: string | null | undefined) =>
  value ? value.replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase()) : 'Count'
export const datasetName = (name: string) => name.replace(/\.csv$/i, '').replace(/_/g, ' ')
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'
