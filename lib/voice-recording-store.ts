'use client';

const DATABASE_NAME = 'sophie-voice-recordings';
const STORE_NAME = 'recordings';
const DATABASE_VERSION = 1;

export type StoredVoiceRecording = {
  id: string;
  chatId: string;
  blob: Blob;
  durationMs: number;
  createdAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('chatId', 'chatId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveVoiceRecording(recording: StoredVoiceRecording) {
  await withStore('readwrite', (store) => store.put(recording));
}

export async function deleteVoiceRecording(id: string) {
  await withStore('readwrite', (store) => store.delete(id));
}

export async function latestVoiceRecordingForChat(chatId: string) {
  const recordings = await withStore<StoredVoiceRecording[]>(
    'readonly',
    (store) => store.index('chatId').getAll(chatId),
  );
  return recordings.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}
