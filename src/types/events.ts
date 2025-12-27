export interface BaseEvent {
  type: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface PageViewEvent extends BaseEvent {
  type: 'page_view';
  url: string;
  referrer?: string;
}

export interface ClickEvent extends BaseEvent {
  type: 'click';
  target: string;
  x: number;
  y: number;
}

export type TrackerEvent = PageViewEvent | ClickEvent;