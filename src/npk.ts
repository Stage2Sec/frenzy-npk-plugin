import { basename } from "path"
import http from "http"

import { AppInfo, PluginInfo, asEventEmitter, Plugin } from "@frenzy/util"

import { npkCognito } from "./lib/npk-cognito"
import { npkPricing } from "./lib/npk-pricing"
import { npkS3 } from "./lib/npk-s3"
import { npkCampaign } from "./lib/npk-campaign"

let app: AppInfo

function processSlackEvent(event) {
    console.log(event)
    switch (event.type) {
        case "app_mention":
            if (event.text.includes("show instances")) {
                // app.slack.webClient.chat.postMessage({
                //     channel: event.channel,
                //     "blocks": [
                //         {
                //             "type": "section",
                //             "block_id": "instances",
                //             "text": {
                //                 "type": "mrkdwn",
                //                 "text": "Pick an instance from the dropdown list"
                //             },
                //             "accessory": {
                //                 "type": "external_select",
                //                 "placeholder": {
                //                     "type": "plain_text",
                //                     "text": "Select an instance",
                //                     "emoji": true
                //                 }
                //             }
                //         }
                //     ]
                // })
            }
            break;
        case "file_shared":
            break;
        case "message.groups":
            break;
        case "message.im":
            break;
        case "message.mpim":
            break;
        case "message.channels":
            break;
        default:
            break;
    }
}

async function initialize() {

    await npkCognito.init()

    npkCampaign.init()
    npkS3.init()
    npkPricing.init()

    let event = asEventEmitter(app.slack.events)
    event?.on("app_mention", processSlackEvent)
    event?.on("message.channels", processSlackEvent)
    event?.on("message.im", processSlackEvent)
    event?.on("message.mpim", processSlackEvent)
    event?.on("message.groups", processSlackEvent)
    event?.on("file_shared", processSlackEvent)
    event?.on("file_created", processSlackEvent)

    app.slack.interactions.action({
        blockId: "instances"
    }, (payload, respond) => {
        console.log(payload)
    })

    
    app.slack.interactions.options({
        within: "block_actions",
        blockId: "instances"
    }, async (payload) => {
        console.log(payload)
        let instancePrices = await npkPricing.getInstancePrices()
        return {
            options: [{
                    text: {
                        type: 'plain_text',
                        text: "G3",
                    },
                    value: instancePrices.idealG3Instance.instanceType,
                },
                {
                    text: {
                        type: 'plain_text',
                        text: "P2",
                    },
                    value: instancePrices.idealP2Instance.instanceType,
                },
                {
                    text: {
                        type: 'plain_text',
                        text: "P3",
                    },
                    value: instancePrices.idealP3Instance.instanceType,
                },
            ]
        }
    })
}

// const authRouter = express.Router()
// authRouter.use(async (req, res, next) => {
//     if (!cognito.isLoggedOn()) {
//         try {
//             await cognito.refreshSession()
//         } catch (error) {
//             console.log(error)
//         }
//         if (!cognito.isLoggedOn()) {
//             return res.unauthenticated()
//         }
//     }

//     next()
// })

// function respondJson(response, statusCode, body, success){
//     response.status(statusCode)
//     switch (typeof body) {
//         case "string":
//             body = { msg: body, success: success };
//         break;

//         case "object":
//             body.success = success;
//         break;
//     }
//     response.json(body)
// }
// function respondRaw(response, statusCode, body){
//     response.status(statusCode).send(body)
// }

// http.ServerResponse.prototype.success = function success(body, statusCode = 200){
//     respondJson(this, statusCode, body, true)
// }
// http.ServerResponse.prototype.file = function file(body){
//     respondRaw(this, 200, body)
// }
// http.ServerResponse.prototype.failure = function failure(body, statusCode = 400){
//     respondJson(this, statusCode, body, false)
// }
// http.ServerResponse.prototype.unauthenticated = function unauthenticated(){
//     this.failure("Not logged in", 403)
// }
// http.ServerResponse.prototype.schemaFailure = function schemaFailure(schema) {
//     this.failure({msg: "Missing required schema properties", schema: schema})
// }

// // Campaigns
// authRouter.route("/campaigns")
//     .get(async (req, res) => {
//         try {
//             let result = await npkCampaign.getAll()
//             res.success(result)
//         } catch (error) {
//             res.failure(error)
//         }
//     })
//     .post(required(apiRequirements.campaigns.create), async (req, res) => {
//         try {
//             let result = await npkCampaign.create(req.body)
//             res.success(result)
//         } catch (error) {
//             res.failure(error)
//         }
//     })
// authRouter.route("/campaigns/:campaignId")
//     .get(async (req, res) => {
//         try {
//             let result = await npkCampaign.get(req.params.campaignId)
//             res.success(result)
//         } catch (error) {
//             res.failure(error)
//         }
//     })
//     .delete(async (req, res) => {
//         try {
//             let result = await npkCampaign.cancel(req.params.campaignId)
//             res.success(result)
//         } catch (error) {
//             res.failure(error)
//         }
//     })

// // Start campaign
// authRouter.post("/campaigns/:campaignId/start", async (req, res) => {
//     try {
//         let result = await npkCampaign.start(req.params.campaignId)
//         res.success(result)
//     } catch (error) {
//         res.failure(error)
//     }
// })

// // Get campaign status
// authRouter.get("/campaigns/:campaignId/status", async (req, res) => {
//     try {
//         let result = await npkCampaign.status(req.params.campaignId)
//         res.success(result)
//     } catch (error) {
//         res.failure(error)
//     }
// })

// // Rules
// authRouter.get("/rules", s3Info("rule"), async (req, res) => {
//     try {
//         let rules = await npkS3.listBucketFiles(req.s3.bucket, req.s3.keyPrefix, req.s3.region)
//         res.success({rules: rules})
//     } catch (error) {
//         res.failure(error)
//     }
// })

// // Wordlists
// authRouter.get("/wordlists", s3Info("wordlist"), async (req, res) => {
//     try {
//         let wordlists = await npkS3.listBucketFiles(req.s3.bucket, req.s3.keyPrefix, req.s3.region)
//         res.success({wordlists: wordlists})
//     } catch (error) {
//         res.failure(error)
//     }
// })

// // Hashes
// authRouter.use("/hashes", s3Info("hash"))
// authRouter.route("/hashes")
//     .get(async (req, res) => {
//         try {
//             let hashes = await npkS3.listBucketFiles(req.s3.bucket, req.s3.keyPrefix)
//             res.success({hashes: hashes})
//         } catch (error) {
//             res.failure(error)
//         }
//     })
//     .post(upload.single("file"), modify("file.originalname", basename), async (req, res) => {
//         try {
//             let result = await npkS3.putObject(req.s3.bucket, `${req.s3.keyPrefix}/${req.file.originalname}`, info.file.buffer.toString())
//             res.success(result)
//         } catch (error) {
//             res.failure(error)    
//         }
//     })
// authRouter.use("/hashes/:file", modify("params.file", basename))
// authRouter.route("/hashes/:file")
//     .get(async (req, res) => {
//         try {
//             let result = await npkS3.getObject(req.s3.bucket, `${req.s3.keyPrefix}/${req.params.file}`)
//             res.file(result.Body.toString())
//         } catch (error) {
//             res.failure(res, error)
//         }
//     })
//     .delete(async (req, res) => {
//         try {
//             let result = await npkS3.deleteObject(req.s3.bucket, `${req.s3.keyPrefix}/${req.params.file}`)
//             res.success(result)
//         } catch (error) {
//             res.failure(error)
//         }
//     })

// app.use('/slack/actions', slackInteractions.requestListener());
// app.use('/slack/events', slackEvents.requestListener());
// app.use(authRouter)

// app.listen(port, async () => {
//     try {
//         await cognito.init()

//         npkCampaign.init()
//         npkS3.init()
//         npkPricing.init()

//         npkPricing.getInstancePrices().then(data => console.log(data))
//     } catch (error) {
//         console.log(error)
//         process.exit(1)
//     }

//     console.log(`App listening at http://localhost:${port}`)
// })

const plugin: Plugin = async (appInfo) => {
    app = appInfo

    await initialize()

    let pluginInfo: PluginInfo = {
        name: "npk",
        description: "",
        version: "1.0.0"
    }
    return pluginInfo
}
export default plugin