const DATABASE_NAME = "tong-fit-private";
const STORE_NAME = "photos";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(mode, callback) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = callback(store);
    tx.oncomplete = () => { database.close(); resolve(result?.result); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  }));
}

export function listPhotos() {
  return transaction("readonly", (store) => store.getAll()).then((photos = []) => photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export function addPhoto(file, type) {
  const photo = {
    id: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    name: file.name,
    blob: file,
  };
  return transaction("readwrite", (store) => store.put(photo)).then(() => photo);
}

export function removePhoto(id) {
  return transaction("readwrite", (store) => store.delete(id));
}
