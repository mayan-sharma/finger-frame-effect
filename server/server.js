import express from "express"
import path from "path"
import expressStaticGzip from "express-static-gzip"

// Server middlewares are added here.

export function addMiddlewares(app) {
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
