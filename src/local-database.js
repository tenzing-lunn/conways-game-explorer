// Site data can be blocked (privacy settings, some in-app browsers). Reading
// localStorage, sessionStorage or indexedDB then throws, so every default goes
// through these getters; storage falls back to a store that lives in memory.
export function safeStorage(name = 'localStorage') {
  try {
    const storage = globalThis[name];
    if (storage) return storage;
  } catch { /* blocked */ }
  return createMemoryStorage();
}

export function safeIndexedDB() {
  try { return globalThis.indexedDB; } catch { return undefined; }
}

export function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

// The code on errors raised when the database itself cannot be opened, as
// opposed to a read or write that failed inside a transaction.
export const LOCAL_DATABASE_UNAVAILABLE = 'local_database_unavailable';

function unavailable(cause) {
  return Object.assign(new Error('IndexedDB is unavailable.', { cause }), { code: LOCAL_DATABASE_UNAVAILABLE });
}

// Every read/modify/write runs while holding one IndexedDB readwrite
// transaction. Callbacks must be synchronous: no network or unrelated awaits.
export function localTransaction(name, key, update, { indexedDB = safeIndexedDB() } = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) { reject(unavailable()); return; }
    let request;
    try { request = indexedDB.open(name, 1); } catch (error) { reject(unavailable(error)); return; }
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onerror = () => reject(unavailable(request.error));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('records', 'readwrite');
      const records = tx.objectStore('records');
      let result;
      let failure;
      const read = records.get(key);
      read.onsuccess = () => {
        try {
          const change = update(read.result);
          if (change.result instanceof Promise) {
            // Repository commands only perform synchronous in-memory work;
            // observe a rejected command before the transaction can commit.
            change.result.catch((error) => { failure = error; try { tx.abort(); } catch {} });
          }
          result = change.result;
          if (change.delete) records.delete(key);
          else if ('value' in change) records.put(change.value, key);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(failure || tx.error || new Error('Local transaction aborted.')); };
      tx.onerror = () => {};
    };
  });
}

const recoveryDatabase = 'life-lab-recovery';
export const readRecovery = (key) => localTransaction(recoveryDatabase, key, (value) => ({ result: value }));
export const writeRecovery = (key, value) => localTransaction(recoveryDatabase, key, () => ({ value, result: value }));
export const deleteRecovery = (key) => localTransaction(recoveryDatabase, key, () => ({ delete: true }));
