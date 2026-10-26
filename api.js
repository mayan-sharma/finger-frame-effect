// Catalyst's fetch helper, behind the @api alias. Nothing uses it yet; the
// effects import from src/api.js, which is a different file.

const fetchFunction = (url, options) => {
    let baseURL = process.env.API_URL
    let finalUrl = baseURL + url

    // Request Interceptor -  modify request here

    return fetch(finalUrl, options).then((response) => {
        return response.json().then((parsedResponse) => {
            // Response Interceptor -  modify response here
            return parsedResponse
        })
    })
}

export default fetchFunction
