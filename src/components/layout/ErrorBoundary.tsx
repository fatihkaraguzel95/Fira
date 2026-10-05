import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
// A class component cannot hold the `useT()` hook, so the module-level `t` is
// called here at render time. The recovery card is re-rendered on every catch,
// so it always picks up the language in force at that moment.
import { t } from '../../i18n'

/**
 * Last line of defence: a render error anywhere below here used to blank the
 * whole app (React unmounts the tree on an uncaught throw). Instead we show a
 * recovery card. `resetKey` (the route path) clears the error on navigation, so
 * a broken ticket window does not trap the user on a dead screen.
 */
interface Props {
  children: ReactNode
  resetKey?: string
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No error service on QA; the console is where a developer will look.
    console.error('[fira] yakalanan render hatası:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface border border-line rounded-xl shadow-sm p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-danger/10 text-danger flex items-center justify-center mx-auto mb-4">
            <Icon name="warning" size={24} />
          </div>
          <h1 className="text-base font-semibold text-fg mb-1">{t('common.somethingWentWrong')}</h1>
          <p className="text-sm text-fg-muted mb-5">{t('board.error.detail')}</p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
            >
              {t('board.error.reload')}
            </button>
            <button
              onClick={() => { window.location.href = '/' }}
              className="px-4 py-2 text-sm font-medium text-fg-2 rounded-lg hover:bg-raised transition-colors"
            >
              {t('board.error.backToBoard')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
