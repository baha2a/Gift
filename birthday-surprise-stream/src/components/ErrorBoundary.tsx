import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex flex-col items-center justify-center px-6 text-center">
          <h1 className="font-display text-3xl font-bold mb-3">حدث خطأ غير متوقع</h1>
          <p className="text-sm text-[#A69D8E] mb-6 max-w-md">
            يرجى إعادة تحميل الصفحة للمحاولة من جديد.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-full bg-[#E5B869] text-[#09080A] text-sm font-semibold hover:bg-[#EFC77E] transition-colors cursor-pointer"
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
