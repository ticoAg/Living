import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkError, reloadOnce } from '../lib/chunks';

interface Props {
  /** The current route: a new one clears the error, so the header's links lead out of it. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
  error: unknown;
  /** A missing chunk is being fetched by a full page load; until componentDidCatch decides, assume it is. */
  reloading: boolean;
  resetKey: string;
}

/** Catches what the pages throw while loading or rendering, so the header stays and the page shows a way out. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null, reloading: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error, reloading: isChunkError(error) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { failed: false, error: null, reloading: false, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // a chunk from before a deploy: load the page again (once) to get the new build
    if (isChunkError(error) && reloadOnce()) return;
    if (this.state.reloading) this.setState({ reloading: false });
    console.error(error, info.componentStack);
  }

  render() {
    const { failed, error, reloading } = this.state;
    if (!failed) return this.props.children;
    if (reloading) return <p className="loading">加载中</p>;
    return (
      <main className="page-narrow" style={{ paddingTop: 96 }} role="alert">
        <h1 className="display display-l">{isChunkError(error) ? '页面没能加载' : '出错了'}</h1>
        <p className="muted">{isChunkError(error) ? '网络不通，或网站刚更新。' : '这个页面出了问题。'}</p>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
          刷新
        </button>
      </main>
    );
  }
}
