import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RotateCcw, LayoutDashboard, Copy, Check } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info?.componentStack);
  }

  handleCopy = () => {
    const text = [
      `Error: ${this.state.error?.message || 'Unknown error'}`,
      `Page: ${window.location.pathname}`,
      `Time: ${new Date().toISOString()}`,
      this.state.error?.stack ? `\nStack:\n${this.state.error.stack}` : '',
    ].join('\n');

    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-5 text-center px-4 py-8">

          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-destructive" />
          </div>

          <div className="space-y-2 max-w-md">
            <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This page ran into an unexpected problem. You can try again, go back to the dashboard, or copy the error details to send to your administrator.
            </p>
          </div>

          {/* Error detail (collapsed, monospace) */}
          {this.state.error?.message && (
            <div className="w-full max-w-md bg-muted rounded-lg px-4 py-3 text-left">
              <p className="text-xs font-mono text-muted-foreground break-all leading-relaxed">
                {this.state.error.message}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-center">
            <Button
              variant="outline"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Try again
            </Button>
            <Button onClick={() => { window.location.href = '/'; }}>
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Go to Dashboard
            </Button>
            <Button
              variant="outline"
              onClick={this.handleCopy}
              className={this.state.copied ? 'text-green-600 border-green-300' : ''}
            >
              {this.state.copied
                ? <><Check className="w-4 h-4 mr-2" />Copied!</>
                : <><Copy className="w-4 h-4 mr-2" />Copy error details</>
              }
            </Button>
          </div>

          <p className="text-xs text-muted-foreground/60 max-w-sm">
            Use "Copy error details" to paste the technical information into a message to your administrator.
          </p>

        </div>
      );
    }
    return this.props.children;
  }
}
