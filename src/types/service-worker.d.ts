// Extend the ServiceWorkerGlobalScope
declare const self: ServiceWorkerGlobalScope;

// Extend IDBTransaction to include the 'complete' property
declare global {
  interface IDBTransaction {
    complete: Promise<void>;
  }
}

export {};
