 
  
import { RRWebOrchestrator } from './sessions/sessionorchestrator';
import { sendToBackend } from './sessions/sessionbsender';
import { RRWebTracker } from './sessions/sessiontracker';
import { ErrorsTracker } from './errors';
import { TrackedError } from './interfaces';

export interface TrackerOptions {
  token?: string;
}

export class SystemTracker {
  private rrwebTracker: RRWebTracker;
  private rrwebOrchestrator: RRWebOrchestrator;
  private errorsTracker: ErrorsTracker;
  private isPaused = false;
  private errors: TrackedError[] = [];

  constructor(private options: TrackerOptions = {}) {
    this.rrwebTracker = new RRWebTracker();
    this.rrwebTracker.start(); // Start the RRWeb recording

    this.rrwebOrchestrator = new RRWebOrchestrator(
      this.rrwebTracker,
      (chunk) =>
        sendToBackend({
          ...chunk,
          token: this.options.token,
        })
    );

    this.errorsTracker = new ErrorsTracker((error) => {
      this.errors.push(error);
      this.addErrorTag('error', {
        message: error.message,
        stack: error.stack,
        hash: error.hash,
      });
    });

    this.init();
  }

  public init() {
    this.errorsTracker.init();
  }

  public start() {
    this.rrwebOrchestrator.start();
  }

  public pause() {
    if (this.isPaused) return;
    this.isPaused = true;
    this.rrwebTracker.addTag('session_pause');
  }

  public resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.rrwebTracker.addTag('session_resume');
  }

  public stop() {
    this.rrwebOrchestrator.stop();
  }

  private handleError = (error: TrackedError) => {
    this.rrwebTracker.addErrorTag(error);
  };

  addTag(type: string, payload?: any) {
    this.rrwebTracker.addTag(type, payload);
  }

  private  addErrorTag(type: string, payload: any) {
    this.rrwebTracker.addErrorTag({ type, ...payload });
  }

  getData() {
    return {
      errors: [...this.errors],
      rrweb: this.rrwebTracker.peek(),
    };
  }

  reset() {
    this.errors = [];
    this.rrwebTracker.commit();
  }
}
