import { TrackedError } from './interfaces';

type ErrorHandler = (error: TrackedError) => void;

export class ErrorsTracker {
  private pageUrl = window.location.pathname;
  private seen = new Map<string, TrackedError>();

  constructor(private onError: ErrorHandler) {}
   public init(): void {
    window.addEventListener('error', this.handleError);
    window.addEventListener('unhandledrejection', this.handleRejection);
  }

  private handleError = (e: ErrorEvent) => {
    this.record({
      message: e.message,
      stack: e.error?.stack,
      source: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  };

  private handleRejection = (e: PromiseRejectionEvent) => {
    const reason =
      e.reason instanceof Error
        ? e.reason
        : new Error(String(e.reason));

    this.record({
      message: reason.message,
      stack: reason.stack,
    });
  };

  private record(
    partial: Pick<TrackedError, 'message'> & Partial<TrackedError>
  ): void {
    const error: TrackedError = {
      message: partial.message,
      source: partial.source,
      lineno: partial.lineno,
      colno: partial.colno,
      stack: partial.stack,
      timestamp: Date.now(),
      page: this.pageUrl,
      hash: '',
      count: 1,
      lastOccurred: Date.now(),
    };
    error.hash = this.generateErrorHash(error);
    const existing = this.seen.get(error.hash);
    if (existing) {
      existing.count!++;
      existing.lastOccurred = Date.now();
      return;
    }
    this.seen.set(error.hash, error);
    this.onError(error);
  }

  private generateErrorHash(err: TrackedError): string {
    const str = `${err.message}|${err.stack ?? ''}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }
}
