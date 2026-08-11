import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

// Keeps the shell (sidebar) alive when a page throws — e.g. a Supabase query for a
// function that has not been deployed yet — instead of blanking the whole app.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-[60vh] place-items-center p-6">
          <div className="max-w-md rounded-2xl border border-danger/20 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-bold text-on-surface">This page hit an error</h1>
            <p className="mt-2 text-sm leading-6 text-secondary">
              {this.state.error.message || "Something went wrong loading this page."}
            </p>
            <p className="mt-3 text-[11px] leading-5 text-secondary">
              If this started after an update, verify the Supabase Edge Function deployment and browser configuration.
            </p>
            <button onClick={this.reset} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white">
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
