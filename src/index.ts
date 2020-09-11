import { basename } from "path"
import http from "http"
import { config } from "aws-sdk"
import { createCommand } from "commander"
import stringArgv from 'string-argv';
import { Option } from "@slack/web-api";

import { Slack, PluginInfo, Plugin, blockFactory } from "@frenzy/index"

import { npkCognito } from "./lib/npk-cognito"
import { npkPricing } from "./lib/npk-pricing"
import { npkS3 } from "./lib/npk-s3"
import { npkCampaign } from "./lib/npk-campaign"
import { request } from "./lib/http-utils"
import { settings } from "@npk/settings"

let slack: Slack

function getS3Info(type: "hash" | "wordlist" | "rule") {
    let region = config.region || ""
    switch(type){
        case "hash":
            return {
                bucket: settings.USERDATA_BUCKET,
                keyPrefix: "self/uploads",
                region: region
            }
        case "wordlist":
            return {
                bucket: settings.DICTIONARY_BUCKETS[region],
                keyPrefix: "wordlist",
                region: region
            }
        case "rule":
            return {
                bucket: settings.DICTIONARY_BUCKETS[region],
                keyPrefix: "rules",
                region: region
            }
    }
}

async function uploadHashFile(name: string, data: any) {
    let { bucket, keyPrefix, region } = getS3Info("hash")
    let result = await npkS3.putObject(bucket, `${keyPrefix}/${name}`, data, region)
    return result
}


function setupSlack(){
    // Setup Static Options
    slack.addOptions("hashTypes", Object.keys(npkPricing.hashTypes).map(name => slack.createOption(name, npkPricing.hashTypes[name])))

    // Setup dot commands
    slack.dotCommand("npk", async (event) => {
        try {
            // Upload hash file
            if ((event.subtype && event.subtype == "file_share") || event.files) {
                event.files.forEach(async (file: any) => {
                    let params = {
                        method: 'GET',
                        url: file.url_private,
                        headers: {
                            "Authorization": `Bearer ${slack.client.token}`
                        }
                    }
                    let contents = await request(params)
                    let result = await uploadHashFile(file.name, contents)
                    console.log("Hash upload result")
                    console.log(result)
                });
                return
            }

            // Send NPK Menu
            await slack.postMessage({
                channel: event.channel,
                text: "Menu",
                blocks: [
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                action_id: "openCampaignModal",
                                style: "primary",
                                text: {
                                    type: "plain_text",
                                    text: "Create Campaign",
                                    emoji: true
                                }
                            }
                        ]
                    }
                ]
            })
        } catch (error) {
            console.error(error)
        }
    })
    
    // Open Campaign Modal
    slack.interactions.action({actionId: "openCampaignModal"}, (payload, respond) => {
        slack.openModal({
            modal: {
                callback_id: "campaign",
                submit: {
                    text: "Create",
                    type: "plain_text",
                    emoji: true
                },
                title: {
                    text: "Create NPK Campaign",
                    type: "plain_text",
                    emoji: true
                },
                blocks: [
                    {
                        block_id: "hashTypes",
                        type: "input",
                        label: {
                            type: "plain_text",
                            text: "Choose hash type",
                            emoji: true
                        },
                        element: {
                            type: "external_select",
                            action_id: "selection",
                            min_query_length: 1,
                            placeholder: {
                                text: "Type",
                                type: "plain_text",
                                emoji: true
                            }
                        }
                    },
                    {
                        block_id: "hashFile",
                        type: "input",
                        label: {
                            type: "plain_text",
                            text: "Choose hash file",
                            emoji: true
                        },
                        element: {
                            type: "external_select",
                            action_id: "selection",
                            min_query_length: 1,
                            placeholder: {
                                text: "File",
                                type: "plain_text",
                                emoji: true
                            }
                        }
                    },
                    {
                        block_id: "wordlist",
                        type: "input",
                        label: {
                            type: "plain_text",
                            text: "Choose wordlist",
                            emoji: true
                        },
                        element: {
                            type: "external_select",
                            action_id: "selection",
                            min_query_length: 1,
                            placeholder: {
                                text: "Wordlist",
                                type: "plain_text",
                                emoji: true
                            }
                        }
                    },
                    {
                        block_id: "rules",
                        type: "input",
                        label: {
                            type: "plain_text",
                            text: "Choose rules",
                            emoji: true
                        },
                        element: {
                            type: "multi_external_select",
                            action_id: "selection",
                            min_query_length: 1,
                            placeholder: {
                                text: "Rules",
                                type: "plain_text",
                                emoji: true
                            }
                        }
                    }
                ],
            },
            trigger_id: payload.trigger_id
        })
    })

    slack.interactions.options({
        within: "block_actions",
        blockId: "hashTypes",
        actionId: "selection"
    }, (payload) => {
        let search: string = payload.value.toLowerCase()
        let options = slack.getOptions("hashTypes")
        let startsWith = options.filter(o => o.text.text.toLowerCase().startsWith(search))
        let includes = options.filter(o => {
            return o.text.text.toLowerCase().includes(search) &&
            !startsWith.includes(o)
        })

        if (startsWith.length + includes.length > 100) {
            options = startsWith
        } else {
            options = [
                ...startsWith,
                ...includes
            ]
        }
        return {
            options: options
        }
    })
    slack.interactions.options({
        within: "block_actions",
        blockId: "hashFile",
        actionId: "selection"
    }, async (payload) => {
        let options: Array<Option>
        try {
            let s3 = getS3Info("hash")
            let hashes = await npkS3.listBucketFiles(s3.bucket, s3.keyPrefix, s3.region)
            options = hashes.map((file) => slack.createOption(file, file))
        } catch (error) {
            console.error(error)
            options = []
        }
        options.splice(0, 0, slack.createOption(" ", " "))
        return {
            options: [
                ...options
            ]
        }
    })
    slack.interactions.options({
        within: "block_actions",
        blockId: "wordlist",
        actionId: "selection"
    }, async (payload) => {
        let options: Array<Option>
        try {
            let s3 = getS3Info("wordlist")
            let wordlists = await npkS3.listBucketFiles(s3.bucket, s3.keyPrefix, s3.region)
            options = wordlists.map((file) => slack.createOption(file, file))
        } catch (error) {
            console.error(error)
            options = []
        }

        return {
            options: [
                ...options
            ]
        }
    })
    slack.interactions.options({
        within: "block_actions",
        blockId: "rules",
        actionId: "selection"
    }, async (payload) => {
        let options: Array<Option>
        try {
            let s3 = getS3Info("rule")
            let rules = await npkS3.listBucketFiles(s3.bucket, s3.keyPrefix, s3.region)
            options = rules.map((file) => slack.createOption(file, file))
        } catch (error) {
            console.error(error)
            options = []
        }

        return {
            options: [
                ...options
            ]
        }
    })
    slack.interactions.viewSubmission({callbackId: "campaign"}, (payload) => {
        console.log("Values")
        console.log(payload.view.state.values)
    })

    // slack.interactions.options({
    //     within: "block_actions",
    //     blockId: "instances"
    // }, async (payload) => {
    //     console.log(payload)
    //     let instancePrices = await npkPricing.getInstancePrices()
    //     return {
    //         options: [{
    //                 text: {
    //                     type: 'plain_text',
    //                     text: "G3",
    //                 },
    //                 value: instancePrices.idealG3Instance.instanceType,
    //             },
    //             {
    //                 text: {
    //                     type: 'plain_text',
    //                     text: "P2",
    //                 },
    //                 value: instancePrices.idealP2Instance.instanceType,
    //             },
    //             {
    //                 text: {
    //                     type: 'plain_text',
    //                     text: "P3",
    //                 },
    //                 value: instancePrices.idealP3Instance.instanceType,
    //             },
    //         ]
    //     }
    // })
    // let campaignsParser = createCommand()
    // campaignsParser.option('-c, --cheese <type>');
    // slack.dotCommand({ command: "campaigns", parser: campaignsParser }, async (event) => {
    //     console.log("dotCommand: ", event)
    //     try {
    //         switch (event.dotCommandPayload) {
    //             case "get":
    //                 break;
    //             case "getAll":
    //                 let campaigns = await npkCampaign.getAll()
    //                 slack.client.chat.postMessage({
    //                     channel: event.channel,
    //                     text: markdown.codeBlock(campaigns),
    //                     mrkdwn: true
    //                 })
    //                 break;
    //             case "create":
    //                 break;
    //             case "start":
    //                 break;
    //             case "cancel":
    //                 break;
    //             case "status":
    //                 break;
    //         }
    //     } catch (error) {
    //         slack.postError(event.channel, error)
    //     }
    // })
    // slack.dotCommand("hashes", async (event) => {
    //     try {
    //         let s3 = getS3Info("hash")
    //         switch (event.dotCommandPayload) {
    //             case "get":
    //                 break;
    //             case "getAll":
    //                 let hashes = await npkS3.listBucketFiles(s3.bucket, s3.keyPrefix, s3.region)
    //                 slack.client.chat.postMessage({
    //                     channel: event.channel,
    //                     text: markdown.codeBlock(hashes),
    //                     mrkdwn: true
    //                 })
    //                 break;
    //             case "create":
    //                 break;
    //             case "start":
    //                 break;
    //             case "cancel":
    //                 break;
    //             case "status":
    //                 break;
    //         }
    //     } catch (error) {
    //         slack.postError(event.channel, error)
    //     }
    // })
    // slack.dotCommand("wordlists", async (event) => {
    //     try {
    //         let s3 = getS3Info("wordlist")
    //         let wordlists = await npkS3.listBucketFiles(s3.bucket, s3.keyPrefix, s3.region)
    //         slack.postMessage({
    //             channel: event.channel,
    //             text: markdown.codeBlock(wordlists),
    //             mrkdwn: true
    //         })
    //     } catch (error) {
    //         slack.postError(event.channel, error)
    //     }
    // })
    // slack.dotCommand("rules", async (event) => {
    //     try {
    //         let s3 = getS3Info("rule")
    //         let rules = await npkS3.listBucketFiles(s3.bucket, s3.keyPrefix, s3.region)
    //         slack.postMessage({
    //             channel: event.channel,
    //             text: markdown.codeBlock(rules),
    //             mrkdwn: true
    //         })
    //     } catch (error) {
    //         slack.postError(event.channel, error)
    //     }
    // })
}

async function initialize() {
    await npkCognito.init()

    npkCampaign.init()
    npkS3.init()
    await npkPricing.init()

    setupSlack()
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

const plugin: Plugin = async (s) => {
    slack = s
    await initialize()

    let pluginInfo: PluginInfo = {
        name: "npk",
        description: "",
        version: "1.0.0"
    }
    return pluginInfo
}
export default plugin