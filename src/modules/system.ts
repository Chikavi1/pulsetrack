import { SystemTracker } from '../core/tracker';

const tracker = new SystemTracker();

interface SystemTrackerAPI {
  /** Initialize the tracker */
  init(): void;
  /** Start or resume tracking */
  start(): void;
  /** Pause tracking */
  pause(): void;
  /** Stop tracking and flush events */
  stop(): void;
  /** Reset tracker to initial state */
  reset(): void;
  /** Get current tracking data */
  getData(): void
  /** Track a custom event */
  track(type: string, payload?: any): void;
}

export const systemTracker: SystemTrackerAPI = {
  init: () => tracker.init(),
  start: () => tracker.start(),
  pause: () => tracker.pause(),
  stop: () => tracker.stop(),
  reset: () => tracker.reset(),
  getData: () => tracker.getData(),
  track: (type: string, payload?: any) => tracker.track(type, payload),
};
