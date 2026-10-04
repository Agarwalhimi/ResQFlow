// ======================================================
// ResQFlow Service Worker
// Emergency Route Planner
// ======================================================

// Name of our cache
const CACHE_NAME = "resqflow-shell-v1";

// Files that should be available offline
const FILES_TO_CACHE = [
    "/",
    "/static/css/style.css",
    "/static/js/app.js",
    "/static/manifest.webmanifest"
];


// ======================================================
// INSTALL
// ======================================================

self.addEventListener("install", function (event) {

    console.log("ResQFlow Service Worker: Installing...");

    event.waitUntil(

        caches.open(CACHE_NAME)
            .then(function (cache) {

                console.log("ResQFlow: Saving files to cache");

                return cache.addAll(FILES_TO_CACHE);
            })
    );

    // Activate the new service worker immediately
    self.skipWaiting();
});


// ======================================================
// ACTIVATE
// ======================================================

self.addEventListener("activate", function (event) {

    console.log("ResQFlow Service Worker: Activated");

    event.waitUntil(

        caches.keys()
            .then(function (cacheNames) {

                return Promise.all(

                    cacheNames.map(function (cacheName) {

                        // Remove old ResQFlow caches
                        if (cacheName !== CACHE_NAME) {

                            console.log(
                                "ResQFlow: Deleting old cache:",
                                cacheName
                            );

                            return caches.delete(cacheName);
                        }

                        return null;
                    })
                );
            })
    );

    // Allow the service worker to control the page
    self.clients.claim();
});


// ======================================================
// FETCH
// ======================================================

self.addEventListener("fetch", function (event) {

    // Only handle GET requests
    if (event.request.method !== "GET") {
        return;
    }

    event.respondWith(

        fetch(event.request)

            // --------------------------------------------------
            // Internet available
            // --------------------------------------------------

            .then(function (response) {

                // Make a copy of the response
                const responseCopy = response.clone();

                // Save the latest response in cache
                caches.open(CACHE_NAME)
                    .then(function (cache) {

                        cache.put(
                            event.request,
                            responseCopy
                        );
                    });

                // Return the online response
                return response;
            })

            // --------------------------------------------------
            // Internet unavailable
            // --------------------------------------------------

            .catch(function () {

                console.log(
                    "ResQFlow: Internet unavailable. Loading cache."
                );

                return caches.match(event.request)
                    .then(function (cachedResponse) {

                        // If the file exists in cache
                        if (cachedResponse) {
                            return cachedResponse;
                        }

                        // If nothing is available
                        return new Response(
                            `
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <title>ResQFlow Offline</title>
                                <meta name="viewport"
                                      content="width=device-width,
                                      initial-scale=1">
                                <style>
                                    body {
                                        margin: 0;
                                        min-height: 100vh;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        font-family: Arial, sans-serif;
                                        background: #f5f7fa;
                                        color: #1d2939;
                                    }

                                    .offline-box {
                                        width: 90%;
                                        max-width: 400px;
                                        text-align: center;
                                        background: white;
                                        padding: 30px;
                                        border-radius: 16px;
                                        box-shadow:
                                            0 15px 40px
                                            rgba(0, 0, 0, 0.12);
                                    }

                                    h1 {
                                        color: #176fe5;
                                        margin-bottom: 10px;
                                    }

                                    p {
                                        color: #66758a;
                                        line-height: 1.6;
                                    }

                                    button {
                                        margin-top: 15px;
                                        padding: 10px 18px;
                                        border: none;
                                        border-radius: 8px;
                                        background: #176fe5;
                                        color: white;
                                        cursor: pointer;
                                    }
                                </style>
                            </head>

                            <body>

                                <div class="offline-box">

                                    <h1>ResQFlow</h1>

                                    <p>
                                        You are currently offline.
                                        Please connect to the internet
                                        and try again.
                                    </p>

                                    <button
                                        onclick="location.reload()">
                                        Try Again
                                    </button>

                                </div>

                            </body>
                            </html>
                            `,
                            {
                                status: 503,
                                headers: {
                                    "Content-Type": "text/html"
                                }
                            }
                        );
                    });
            })
    );
});