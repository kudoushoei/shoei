// IndexedDB のごく薄いラッパー。ビルド不要で動かすため外部ライブラリは使わない。
const DB = (() => {
  const DB_NAME = "bodyTrackerDB";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("bodyMetrics")) {
          db.createObjectStore("bodyMetrics", { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains("activity")) {
          db.createObjectStore("activity", { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains("meals")) {
          const meals = db.createObjectStore("meals", { keyPath: "id", autoIncrement: true });
          meals.createIndex("byDate", "date");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async get(storeName, key) {
      const store = await tx(storeName, "readonly");
      return reqToPromise(store.get(key));
    },
    async getAll(storeName) {
      const store = await tx(storeName, "readonly");
      return reqToPromise(store.getAll());
    },
    async getAllByIndex(storeName, indexName, range) {
      const store = await tx(storeName, "readonly");
      return reqToPromise(store.index(indexName).getAll(range));
    },
    async put(storeName, value) {
      const store = await tx(storeName, "readwrite");
      return reqToPromise(store.put(value));
    },
    async putMany(storeName, values) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(storeName, "readwrite");
        const store = t.objectStore(storeName);
        values.forEach((v) => store.put(v));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    },
    async delete(storeName, key) {
      const store = await tx(storeName, "readwrite");
      return reqToPromise(store.delete(key));
    },
    async clear(storeName) {
      const store = await tx(storeName, "readwrite");
      return reqToPromise(store.clear());
    },
  };
})();
