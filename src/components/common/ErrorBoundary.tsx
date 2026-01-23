/**
 * Error Boundary component
 * Catches React component errors and displays a fallback UI
 */

import React, { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  retry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.retry);
      }

      return (
        <div className="min-h-screen bg-rose-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-rose-100 rounded-full mb-4">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
            </div>
            <h1 className="text-2xl font-bold text-center text-red-900 mb-2">
              Oops! Something went wrong
            </h1>
            <p className="text-rose-700 text-center mb-4">
              We encountered an unexpected error. Please try again.
            </p>
            <details className="bg-rose-50 border border-rose-200 rounded p-3 mb-4 text-sm">
              <summary className="font-semibold text-red-900 cursor-pointer">
                Error details
              </summary>
              <pre className="mt-2 text-rose-700 overflow-auto max-h-40 text-xs">
                {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            </details>
            <button
              onClick={this.retry}
              className="w-full bg-rose-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
