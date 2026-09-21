import { Component, type ReactNode } from 'react'
import { BrandMark } from './ui'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="workspace-loading" role="alert">
          <BrandMark />
          <h1>This view needs a fresh start.</h1>
          <p>Something unexpected happened while opening the workspace. Reload to reconnect to your data.</p>
          <button className="button primary" onClick={() => window.location.reload()}>
            Reload workspace
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
