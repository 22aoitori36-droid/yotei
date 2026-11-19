// IndexedDB の薄いラッパー
// items: 予定（単発 type:'single' / 毎週ルール type:'weekly'）keyPath = uid
// kv:    設定など

const DB_NAME = 'yotei';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'uid' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  all: () => tx('items', 'readonly', (s) => reqP(s.getAll())),
  put: (item) => tx('items', 'readwrite', (s) => { s.put(item); }),
  putMany: (items) => tx('items', 'readwrite', (s) => { items.forEach((i) => s.put(i)); }),
  del: (uid) => tx('items', 'readwrite', (s) => { s.delete(uid); }),
  getKv: (k) => tx('kv', 'readonly', (s) => reqP(s.get(k))),
  setKv: (k, v) => tx('kv', 'readwrite', (s) => { s.put(v, k); }),
};
