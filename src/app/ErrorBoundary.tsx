import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** A crash must not look like lost data. Saved words, notes and review schedules live in
 *  this browser's storage; nothing on this screen deletes them. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Only the failure is logged: searches, notes and document text are never written anywhere.
    console.error('Unhandled error in Hanyu Dictionary', error.message, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="stack" role="alert">
        <h1>Something went wrong on this screen</h1>
        <p className="muted">
          Your saved words, notebooks and review schedule are stored in this browser and have not
          been changed.
        </p>
        <pre className="text-sm">{error.message}</pre>
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload the app
          </button>
          <a className="btn" href="#/data">
            Export a backup
          </a>
        </div>
      </div>
    );
  }
}
