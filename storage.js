/*
  storage.js — the app's stockroom, on this device.

  The app was written to talk to Claude's database using a few simple commands:
    db.doc("config/exercises").set(...)        save a document
    db.doc("config/exercises").onSnapshot(...)  tell me whenever it changes
    db.collection("history").onSnapshot(...)    same, for a whole collection

  This file provides those same commands, but keeps everything in IndexedDB,
  the database built into every web browser. Because the commands are the
  same, the rest of the app barely needs to change. Programmers call this
  an "adapter": same plug, different socket.

  Nothing in here sends data anywhere. It all stays on this device.
*/
(function () {
  const DB_NAME = "gym-log";   // the name of our database inside the browser
  const STORE = "docs";        // one "table" holding every document, keyed by its path

  // Open (or create, the first time) the IndexedDB database.
  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Wrap a stored value in the shape the app expects (id, exists, data()).
  function snapshot(path, data) {
    return {
      id: path.split("/").pop(),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : structuredClone(data)),
    };
  }

  window.openLocalDB = async function () {
    if (!("indexedDB" in window)) return null;
    let idb;
    try { idb = await openIDB(); } catch (e) { console.error(e); return null; }

    // Ask the browser to keep our data even when the device is short of space.
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

    // Load everything into memory once at start-up: the data is small, and it makes the app fast.
    const cache = new Map();
    await new Promise((resolve, reject) => {
      const req = idb.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { cache.set(cursor.key, cursor.value); cursor.continue(); } else resolve();
      };
      req.onerror = () => reject(req.error);
    });

    // Everyone who asked to be told about changes.
    const listeners = new Set();
    const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

    // Write one document to IndexedDB, then tell the listeners.
    function put(path, data) {
      return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(data, path);
        tx.oncomplete = () => { cache.set(path, data); notify(); resolve(); };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Save was cancelled"));
      });
    }

    function doc(path) {
      return {
        get: async () => snapshot(path, cache.get(path)),
        set: data => put(path, structuredClone(data)),
        onSnapshot(next) {
          const fn = () => next(snapshot(path, cache.get(path)));
          listeners.add(fn);
          setTimeout(fn, 0);              // send the current value straight away
          return () => listeners.delete(fn);
        },
      };
    }

    function collection(name) {
      return {
        doc: id => doc(name + "/" + id),
        onSnapshot(next) {
          const fn = () => {
            const docs = [...cache.keys()]
              .filter(k => k.startsWith(name + "/") && k.split("/").length === 2)
              .sort()
              .map(k => snapshot(k, cache.get(k)));
            next({ docs, size: docs.length, empty: docs.length === 0 });
          };
          listeners.add(fn);
          setTimeout(fn, 0);
          return () => listeners.delete(fn);
        },
      };
    }

    return { doc, collection };
  };

  /*
    Saving the backup file.
    On a phone this opens the Share sheet, where you choose "Save to Files"
    (then iCloud Drive). On a computer it downloads the file instead.
  */
  window.localDownloads = {
    async save({ filename, data }) {
      const file = new File([data], filename, { type: "application/json" });
      const isPhone = window.matchMedia && matchMedia("(pointer: coarse)").matches;
      if (isPhone && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return { status: "saved" };
        } catch (e) {
          if (e && e.name === "AbortError") throw { code: "declined", message: "Cancelled" };
          throw { code: "unavailable", message: String(e) };
        }
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { status: "saved" };
    },
  };
})();
