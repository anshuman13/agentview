import { Component, type ReactNode } from 'react';

// A crash shows a way back instead of a blank page, and stays inside the part that crashed. With retry, the part renders again
// in place instead of reloading the whole page.
export class Guard extends Component<{ children: ReactNode; retry?: boolean }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(err: unknown) {
    return { error: String(err) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cd-empty">
        <p>{this.props.retry ? 'This page hit an error' : 'AgentView hit an error'}: {this.state.error}</p>
        {this.props.retry ? <button onClick={() => this.setState({ error: null })}>Retry</button> : <button onClick={() => location.reload()}>Reload</button>}
      </div>
    );
  }
}
