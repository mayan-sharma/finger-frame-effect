import React, { useEffect } from "react"

// The effects app is plain ES modules (src/main.js) that look these elements
// up by id when they load. This page only renders the markup on the server
// and starts the app in the browser. It never re-renders, so React leaves the
// DOM to the app after hydration.

// A broken effect (a typo, a bad defineEffect) shows up on the page, not only
// in the console.
function showError(e) {
    const el = document.getElementById("status")
    el.textContent = `⚠️ ${e.message} — details in the console`
    el.classList.remove("hidden")
}

function Stage() {
    useEffect(() => {
        addEventListener("error", showError)
        // React sets `muted` as a property, which server-rendered markup never
        // carries; iOS will not play inline video without it.
        document.getElementById("cam").muted = true
        // Browser only: the app touches `document` and `location` on import.
        import("../../../main.js").catch((err) => {
            console.error(err)
            showError(err)
        })
    }, [])

    return (
        <>
            <canvas id="stage" />
            <video id="cam" playsInline muted style={{ display: "none" }} />
            <div id="status">Loading hand tracker…</div>
            <div id="badge">demo mode</div>
            <div id="knobs" className="hidden" />
            <div id="hint" />
            <button id="sound" type="button" title="Sound (m)" aria-label="Mute sound">
                🔊
            </button>
        </>
    )
}

export default Stage
