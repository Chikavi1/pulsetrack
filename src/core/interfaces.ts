// import { EventType as RRWebEvent } from 'rrweb';


export interface PageNavigation {
  page: string;
  timestamp: number;
  previousPage?: string;
  duration?: number;
}

export interface Session {
  id: string;
  createdAt: string;
  errors: TrackedError[];
  userInfo: UserInfo;
  pages: PageSession[];
  pageHistory: PageNavigation[];
  userId?: string | undefined;
  entryPage?: string;
  exitPage?: string;
  systemEvents: SystemEvent[];
  totalClicks?: number;
  totalInputs?: number;
  totalPagesVisited?: number;
  rrwebEvents: any[]; 
  // rrwebEvents: RRWebEvent[]; // arreglar
}

export interface PageSession {
  page: string;             
  duration: number;          
  totalClicks: number;
  totalInputs: number;
  percentageScroll: number;
  events: Event[];           
}

export interface Event {
  type: string;
  data: EventData;
  timestamp: number;
  relativeTime: number;
  page: string;
}





export interface TrackerConfig {
  endpoint?: string;
  environment?: string;
  release?: string;
  userId?: string;
  enableRRWeb?: boolean;
  excludePaths?: (string | RegExp)[];
}

export interface EventData {
  [key: string]: any;
}

export interface SystemEvent {
  type: string;
  data: EventData;
  page: string;
  timestamp: number;
  relativeTime: number;
}

export interface PageEvent {
  type: string;
  data: EventData;
  timestamp: number;
  relativeTime: number;
  page: string;
}

export interface Page {
  page: string;
  duration: number;
  totalClicks: number;
  totalInputs: number;
  percentageScroll: number;
  events: PageEvent[];
}



export interface UserInfo {
  browser: string;
  platform: string;
  language: string;
  fingerprint: string | null;
  isBot: boolean | null;
  deviceType: 'mobile' | 'desktop';
  screen: { width: number; height: number };
  timezone: string | undefined;
}


export interface RecordedEvent {
  type: string;
  data: EventData;
  timestamp: number;
  relativeTime: number;
  page: string;
}

export interface SystemTrackerOptions {
  businessId: string;
  userId?: string;
}

export interface TrackedError {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  timestamp: number;
  page: string;
   count?: number;
   hash: string;
   lastOccurred: number;
   
}