import React from "react"
import { Head, Body } from "catalyst-core"

const FAVICON =
    "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>" +
    "<text y=%22.9em%22 font-size=%2290%22>🖐️</text></svg>"

function Document(props) {
    return (
        <html lang="en">
            <Head {...props}>
                <title>Finger Frame Effect</title>
                <link rel="icon" href={FAVICON} />
            </Head>
            <Body {...props} />
        </html>
    )
}
export default Document
