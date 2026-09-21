export type Page = 'overview' | 'explorer' | 'models' | 'reports'
export type ColumnKind = 'numeric' | 'categorical' | 'date' | 'identifier' | 'text' | 'boolean' | 'empty'
export interface Column {
  name: string
  kind: ColumnKind
  missing: number
  missing_pct: number
  unique: number
  outliers?: number
  invalid_dates?: number
  stats?: {
    min: number | null
    max: number | null
    mean: number | null
    median: number | null
    std: number | null
  }
  top_values?: { label: string; count: number }[]
  date_range?: string[]
}
export interface ChartPoint {
  label: string
  value: number | null
  count?: number
  date?: string
}
export interface Charts {
  kind: 'time' | 'histogram' | 'category' | 'empty'
  metric: string | null
  aggregation: 'sum' | 'mean'
  date_column: string | null
  period: string | null
  trend: ChartPoint[]
  breakdown: ChartPoint[]
  category: string | null
  total: number | null
  change_pct: number | null
  valid_rows: number
}
export interface Insight {
  id: string
  kind: 'quality' | 'trend' | 'distribution' | 'relationship'
  title: string
  description: string
  columns: string[]
  importance: 'info' | 'warning'
}
export interface DatasetMeta {
  id: string
  name: string
  row_count: number
  created_at: string
  is_demo: boolean
}
export interface Analysis extends DatasetMeta {
  column_count: number
  missing_cells: number
  duplicate_rows: number
  completeness: number
  uniqueness: number
  quality_score: number
  numeric_count: number
  categorical_count: number
  columns: Column[]
  charts: Charts
  correlations: { first: string; second: string; value: number; n: number }[]
  insights: Insight[]
  summary: string
  notes: string[]
  suggested_target: string | null
  steps: { name: string; duration_ms: number }[]
  methodology: Record<string, string>
}
export interface RowsPage {
  total: number
  offset: number
  limit: number
  rows: Record<string, string | number | boolean | null>[]
}
export interface ModelResult {
  target: string
  task: 'regression' | 'classification'
  split: 'random' | 'time'
  model_name: string
  baseline_name: string
  train_rows: number
  test_rows: number
  features: string[]
  excluded: { name: string; reason: string }[]
  metrics: Record<string, number | null>
  baseline_metrics: Record<string, number | null>
  feature_importance: { feature: string; importance: number | null; std: number | null }[]
  notes: string[]
  seed: number
  importance_unit: string
  predictions?: { actual: number; predicted: number }[]
  confusion?: { labels: string[]; matrix: number[][] }
}
