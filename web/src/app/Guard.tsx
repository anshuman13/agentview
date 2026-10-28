import { Component, type ReactNode } from 'react';

// A crash shows a way back instead of a blank page, and stays inside the part that crashed.
export class Guard extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(err: unknown) {
    return { error: String(err) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cd-empty">
        <p>AgentView hit an error: {this.state.error}</p>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
