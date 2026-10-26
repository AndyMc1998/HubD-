// HubD service worker. It does three jobs:
//  1. Serves your game zip (saved on this device by the launcher) when
//     Boxedwine asks for it, so the game files never touch a server.
//  2. Joins the Wine filesystem parts back into one zip, and keeps them so
//     later launches don't download them again.
//  3. Adds the cross-origin isolation headers the multi-threaded build needs
//     (GitHub Pages can't set them).

const GAME_CACHE = "hubd-games";
const WINE_CACHE_PREFIX = "hubd-wine-";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function isolated(response) {
    // Opaque and redirected responses can't be rebuilt; pass them through.
    if (response.type === "opaque" || response.type === "opaqueredirect" || response.status === 0) {
        return response;
    }
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
    });
}

function siteUrl(path) {
    return new URL(path, self.registration.scope).href;
}

async function serveGame(request) {
    const cache = await caches.open(GAME_CACHE);
    const url = new URL(request.url);
    const hit = await cache.match(url.origin + url.pathname);
    if (!hit) {
        return new Response("Game zip not found on this device. Go back and pick it again.", { status: 404 });
    }
    return hit;
}

async function wineCache() {
    let version = "dev";
    try {
        version = (await (await fetch(siteUrl("version.txt"), { cache: "no-store" })).text()).trim();
    } catch (e) {
        // offline: fall back to whatever is cached
    }
    const name = WINE_CACHE_PREFIX + version;
    for (const key of await caches.keys()) {
        if (key.startsWith(WINE_CACHE_PREFIX) && key !== name && version !== "dev") {
            await caches.delete(key);
        }
    }
    return caches.open(name);
}

async function servePart(cache, url) {
    let response = await cache.match(url);
    if (!response) {
        response = await fetch(url);
        if (!response.ok) {
            throw new Error("Could not download " + url + " (" + response.status + ")");
        }
        await cache.put(url, response.clone());
    }
    return response;
}

async function serveWine() {
    const manifest = await (await fetch(siteUrl("wine/parts.json"), { cache: "no-cache" })).json();
    const cache = await wineCache();
    const urls = manifest.parts.map((part) => siteUrl("wine/" + part));
    const stream = new ReadableStream({
        async start(controller) {
            try {
                for (const url of urls) {
                    const reader = (await servePart(cache, url)).body.getReader();
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        controller.enqueue(value);
                    }
                }
                controller.close();
            } catch (e) {
                controller.error(e);
            }
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "application/zip",
            "Content-Length": String(manifest.size),
        },
    });
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) {
        return;
    }
    const path = url.pathname;
    if (path.startsWith(new URL(siteUrl("games/")).pathname)) {
        event.respondWith(serveGame(request).then(isolated));
    } else if (path === new URL(siteUrl("wine/boxedwine.zip")).pathname) {
        event.respondWith(serveWine().then(isolated));
    } else {
        event.respondWith(fetch(request).then(isolated));
    }
});
