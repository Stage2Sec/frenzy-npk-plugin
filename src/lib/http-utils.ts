import https from "https"
import urlParser from "url"

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
export function request(options: any): Promise<any> {
    return new Promise((success, failure) => {
        prepare(options)

        let request = https.request(options, (response) => {
            response.on("data", data => {
                data = data.toString()
                try {
                    success(JSON.parse(data))
                } catch {
                    success(data)
                }
            })
            response.on("error", error => {
                console.log(error)
                failure(error)
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