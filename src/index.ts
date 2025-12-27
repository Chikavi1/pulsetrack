import { initConfig } from './core/config';
import { SystemTracker } from './core/tracker';
import { Feedback as FeedbackFactory } from './plugins/feedback';

let tracker: SystemTracker | null = null;

export const PulseTrack = {
  init(config: { businessId: string }) {
    initConfig(config);
    tracker = new SystemTracker(config);
    tracker.start();
  },

  tracker() {
    if (!tracker) throw new Error('PulseTrack not initialized');
    return tracker;
  },

  Feedback(options?: Omit<Parameters<typeof FeedbackFactory>[0], 'tracker'>) {
    if (!tracker) throw new Error('PulseTrack not initialized');

    // Llamamos a la factory pasando el tracker + cualquier opción extra
    return FeedbackFactory({ tracker, ...options });
  },
};
