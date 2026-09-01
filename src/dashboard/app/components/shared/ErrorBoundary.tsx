import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Panel failed to load", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="wd-card p-8 flex flex-col items-center justify-center text-center">
          <h2 className="font-medium mb-1 text-primary">This panel failed to load</h2>
          <p className="text-sm max-w-sm text-muted">
            Something went wrong rendering this panel. You can try reloading it.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer active:translate-y-[1px] wd-chip-secondary"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
