import https from "https"
import urlParser from "url"
import { IncomingMessage, ClientRequest } from "http"

export function prepare(options: any): any {
    if (options.url){
        let url = urlParser.parse(options.url)
        if (!options.hostname){
            options.hostname = url.hostname
        }
        if (!options.path){
            options.path = url.path
        }
    }

    options.headers = options.headers || {}
    if (options.body && options.body !== "" && !options.headers["Content-Type"]) {
        try {
            JSON.parse(options.body)
            options.headers["Content-Type"] = "application/json"
        } catch (error) {
            options.headers["Content-Type"] = "application/x-www-form-urlencoded"
        }
    }
}
export function request(options: any): Promise<{
    request: ClientRequest,
    response: IncomingMessage,
    data: any
}> {
    return new Promise((success, failure) => {
        prepare(options)

        let request = https.request(options, (response) => {
            response.on("data", data => {
                data = data.toString()
                try {
                    data = JSON.parse(data)
                } catch {
                    // Do nothing on purpose
                }
                
                let result = {
                    request,
                    response,
                    data
                }
                console.log(result)
                success(result)
            })
            response.on("error", error => {
                console.log(error)
                failure({
                    response,
                    error
                })
            })
        })

        if (options.body) {
            request.write(options.body)
        }
        request.on("error", error => {
            console.log(error)
            failure(error)
        })
        request.end()
    });
}