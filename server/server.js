import express from "express"
import path from "path"
import expressStaticGzip from "express-static-gzip"

// Server middlewares are added here.

// `npm run serve` registers Catalyst's offline service worker for the whole of
// localhost:3005. It outlives the server and keeps answering for `npm start`,
// where it failed the page load: it asks for its manifest, got the dev page's
// HTML instead, and threw. In development the manifest is an empty one, so the
// old worker passes the page through, and its update check on /catalyst-sw.js
// gets this worker, which clears the offline caches, removes itself and
// reloads the page.
const RETIRE_SERVICE_WORKER = `
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name.startsWith("catalyst-offline")) await caches.delete(name)
        }
        await self.registration.unregister()
        for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url)
    })())
})
`

export function addMiddlewares(app) {
    if (process.env.NODE_ENV !== "production") {
        app.get("/catalyst-sw.js", (req, res) => {
            res.type("text/javascript").set("cache-control", "no-store").send(RETIRE_SERVICE_WORKER)
        })
        app.get("/catalyst-offline-manifest.json", (req, res) => {
            res.set("cache-control", "no-store").json({ buildId: "development", routes: [] })
        })
    }
    if (process.env.NODE_ENV === "production") {
        app.use(
            `${process.env.PUBLIC_STATIC_ASSET_PATH}/client`,
            expressStaticGzip(path.join(__dirname, `../${process.env.BUILD_OUTPUT_PATH}/client`), {
                enableBrotli: true,
                orderPreference: ["br", "gz"],
                serveStatic: { maxAge: "1y", etag: true },
            })
        )
    }
    app.use("/favicon.ico", express.static(path.join(__dirname, "../public/favicon.ico")))
    // Your own sound files and their manifest (see sounds/README.md). Read
    // from disk on every request, so a new recording needs no rebuild.
    app.use("/sounds", express.static(path.join(__dirname, "../sounds"), { maxAge: 0, etag: false }))
}
