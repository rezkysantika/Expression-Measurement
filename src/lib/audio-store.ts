let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("audio-store", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files"); // passes the key: jobId, value: Blob for the audio
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function putAudio(jobId: string, blob: Blob): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(blob, jobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAudioBlob(jobId: string): Promise<Blob | null> {
  const db = await openDB();
  return await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const req = tx.objectStore("files").get(jobId);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => reject(req.error);
  });
}

const urlCache = new Map<string, string>(); // jobId -> objectURL

export async function getAudioUrl(jobId: string): Promise<string | null> {
  if (urlCache.has(jobId)) return urlCache.get(jobId)!;
  const blob = await getAudioBlob(jobId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(jobId, url);
  return url;
}
