// // sw-tracking.js
// const DB_NAME = 'trackingDB';
// const STORE_NAME = 'events';

// // Abrir IndexedDB
// function openDB() {
//   return new Promise((resolve, reject) => {
//     const request = indexedDB.open(DB_NAME, 1);
//     request.onupgradeneeded = () => {
//       request.result.createObjectStore(STORE_NAME, { autoIncrement: true });
//     };
//     request.onsuccess = () => resolve(request.result);
//     request.onerror = () => reject(request.error);
//   });
// }

// // Guardar evento en IndexedDB
// async function saveEvent(eventData) {
//   const db = await openDB();
//   const tx = db.transaction(STORE_NAME, 'readwrite');
//   tx.objectStore(STORE_NAME).add(eventData);
//   return tx.complete;
// }

// // Obtener todos los eventos
// async function getAllEvents() {
//   const db = await openDB();
//   return new Promise((resolve, reject) => {
//     const tx = db.transaction(STORE_NAME, 'readonly');
//     const request = tx.objectStore(STORE_NAME).getAll();
//     request.onsuccess = () => resolve(request.result);
//     request.onerror = () => reject(request.error);
//   });
// }

// // Limpiar todos los eventos
// async function clearEvents() {
//   const db = await openDB();
//   const tx = db.transaction(STORE_NAME, 'readwrite');
//   tx.objectStore(STORE_NAME).clear();
//   return tx.complete;
// }

// // Enviar todos los eventos al servidor
// async function sendEvents() {
//   const events = await getAllEvents();
//   if (events.length === 0) return;

//   try {
//     await fetch('https://tu-servidor.com/tracking', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(events),
//     });
//     await clearEvents();
//     console.log('Eventos enviados desde SW:', events.length);
//   } catch (err) {
//     console.log('Error enviando eventos, se reintentará', err);
//   }
// }

// // Recibir mensajes desde la página
// self.addEventListener('message', (e) => {
//   const data = e.data;
//   if (data?.type === 'TRACK_EVENT') {
//     saveEvent(data.event).then(() => {
//       sendEvents();
//     });
//   }
// });

// // Background Sync (si está disponible)

// self.addEventListener('sync', (e) => {
//   if (e.tag === 'send-tracking') {
//     e.waitUntil(sendEvents());
//   }
// });

