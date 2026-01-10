import { initConfig, getConfig } from './core/config';
import { SystemTracker } from './core/tracker';
import { Announcement } from './plugins/announcements';
import { Feedback as FeedbackFactory } from './plugins/feedback';
import { AnnouncementConfig } from './plugins/announcements';
import { Nps, NpsConfig } from './plugins/nps';
import { fetchInitConfig } from './utils/init';

let tracker: SystemTracker | null = null;
let initializationPromise: Promise<void> | null = null;
let remoteResponse: any;

const ensureInitialized = () => {
  if (!tracker) {
    throw new Error('PulseTrack not initialized. Call PulseTrack.init() first.');
  }
};

export const PulseTrack = {
  async init(config: { businessId: string; remote?: boolean; [key: string]: any }) {
    if (initializationPromise) {
      console.warn('PulseTrack already initializing');
      return initializationPromise;
    }

    initializationPromise = (async () => {
      try {
        // Fetch remote config if enabled
        if (config.remote) {
          console.log('Fetching remote configuration...');
          const response = await fetchInitConfig<{ data: any }>(config.businessId);
          
          if (response.ok) {
            remoteResponse = response.data;
            console.log('Remote configuration loaded:', response.data);
            // Merge remote config with local config
            config = { ...config, ...response.data };
          } else {
            console.warn('Failed to fetch remote config:', response.error?.message);
          }
        }

        await initConfig(config);
        const finalConfig = getConfig();
        tracker = new SystemTracker(finalConfig);
        await tracker.start();
      } catch (error) {
        console.error('Failed to initialize PulseTrack:', error);
        throw error;
      }
    })();

    return initializationPromise;
  },

  async ensureReady() {
    if (initializationPromise) {
      await initializationPromise;
    } else {
      throw new Error('PulseTrack not initialized. Call PulseTrack.init() first.');
    }
  },

  tracker() {
    ensureInitialized();
    return tracker!;
  },

  async Feedback(options?: Omit<Parameters<typeof FeedbackFactory>[0], 'tracker'>) {
    await this.ensureReady();
    let data = remoteResponse.feedback;
    if(options) data = options

    console.log('data', data)
    return FeedbackFactory({ tracker: this.tracker(), ...data });
  },

  async Announcement(options?: Omit<AnnouncementConfig, 'tracker'>) {
    await this.ensureReady();
    console.log('remote options', remoteResponse.announcements)
    console.log('options', options);


    console.log('data more remote', { tracker: this.tracker(), ...remoteResponse.announcements });
    console.log('data more ', { tracker: this.tracker(), ...options });

    return new Announcement({ tracker: this.tracker(), ...remoteResponse.announcements });
  },

  async Nps(options?: Omit<NpsConfig, 'tracker'>) {
    await this.ensureReady();
    return new Nps({ tracker: this.tracker(), ...remoteResponse.nps });
  },
};
