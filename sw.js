/*
  sw.js — the "service worker": a small helper the browser runs in the background.

  Its job here is to keep a copy of the app's files on the phone, so the app
  opens even with no signal (a gym basement, airplane mode).

  Strategy: "network first, fall back to the saved copy".
    - Online:  fetch the latest file from the internet, and save a fresh copy.
               (So when you publish an update, you get it automatically.)
    - Offline: use the copy saved last time.

  Your workout data is NOT handled here. That lives in IndexedDB (storage.js).
  This file only deals with the app's code, icons and fonts.
*/
const CACHE = "gym-log-v3";   // change the number to force every phone to start fresh
const APP_FILES = [
  "./",
  "index.html",
  "storage.js",
  "starter.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
];

// 1. Install: save the app's files straight away.
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

// 2. Activate: delete copies saved by older versions of this file.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
  );
  self.clients.claim();
});

// 3. Fetch: every time the app asks for a file, try the network, else use the saved copy.
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
