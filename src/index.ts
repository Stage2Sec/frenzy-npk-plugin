import { basename } from "path"
import http from "http"
import { config } from "aws-sdk"
import { createCommand } from "commander"
import stringArgv from 'string-argv';
import { Option, ActionsBlock } from "@slack/web-api";

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
async function listFiles(type: "hash" | "wordlist" | "rule"): Promise<Array<string>> {
    try {
        let { bucket, keyPrefix, region } = getS3Info(type)
        return await npkS3.listBucketFiles(bucket, keyPrefix, region)
    } catch (error) {
        console.error(`Error getting ${type} files: `, error)
        return []
    }
}

async function uploadHashFile(name: string, data: any) {
    let { bucket, keyPrefix, region } = getS3Info("hash")
    let result = await npkS3.putObject(bucket, `${keyPrefix}/${name}`, data, region)
    return result
}


function setupSlack(){
    // Setup Static Options
    slack.storeOptions("hashTypes", Object.keys(npkPricing.hashTypes).map(name => blockFactory.option(name, npkPricing.hashTypes[name])))

    // Setup dot commands
    slack.dotCommand("npk", async (event) => {
        try {
            // Upload hash file
            if ((event.subtype && event.subtype == "file_share") || event.files) {
                event.files.forEach(async (file: any) => {
                    let contents = await slack.getFile(file.url_private)
                    await uploadHashFile(file.name, contents)
                    await slack.postMessage({
                        channel: event.channel,
                        text: `<@${event.user}> \`${file.name}\` uploaded`,
                        icon_emoji: ":thumbsup:"
                    })
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
                            blockFactory.button({
                                actionId: "openCampaignModal",
                                text: "Create Campaign",
                                style: "primary"
                            })
                        ]
                    }
                ]
            })
        } catch (error) {
            console.error(error)
        }
    })
    
    /*
    {
        "region": 0,
        "availabilityZone": 0,
        "hashFile": 0,
        "hashType": 0,
        "instanceType": 0,
        "instanceCount": 0,
        "instanceDuration": 0,
        "priceTarget": 0
    }
    */
    // Open Campaign Modal
    slack.interactions.action({actionId: "openCampaignModal"}, (payload, respond) => {
        slack.openModal({
            trigger_id: payload.trigger_id,
            modal: {
                callback_id: "campaign",
                submit: {
                    text: "Create",
                    type: "plain_text",
                    emoji: true
                },
                close: {
                    text: "Close",
                    type: "plain_text",
                    emoji: true
                },
                title: {
                    text: "Create NPK Campaign",
                    type: "plain_text",
                    emoji: true
                },
                blocks: [
                    blockFactory.externalSelect({
                        blockId: "hashTypes",
                        label: "Choose a hash type",
                        placeholder: "Hash Type"
                    }),
                    blockFactory.divider(),
                    blockFactory.section({
                        text: "Force Region"
                    }),
                    {
                        type: "actions",
                        block_id: "forceRegion",
                        elements: [
                            blockFactory.button({
                                text: "west-1",
                                value: "us-west-1"
                            }),
                            blockFactory.button({
                                text: "west-2",
                                value: "us-west-2"
                            }),
                            blockFactory.button({
                                text: "east-1",
                                value: "us-east-1"
                            }),
                            blockFactory.button({
                                text: "east-2",
                                value: "us-east-2"
                            })
                        ]
                    },
                    blockFactory.divider(),
                    blockFactory.externalSelect({
                        blockId: "hashFile",
                        label: "Choose a hash file",
                        placeholder: "Hash File"
                    }),
                    blockFactory.externalSelect({
                        blockId: "wordlist",
                        label: "Choose a wordlist",
                        placeholder: "Wordlist"
                    }),
                    blockFactory.externalSelect({
                        blockId: "rules",
                        label: "Choose rules",
                        placeholder: "Rules",
                        multi: true
                    }),
                    blockFactory.divider(),

                    blockFactory.externalSelect({
                        blockId: "instanceTypes",
                        label: "Choose instance type",
                        placeholder: "Instance Type"
                    })
                ],
            }
        })
    })
    slack.interactions.action({
        blockId: "forceRegion"
    }, async (payload, respond) => {
        console.log(payload)
        let region = payload.actions.firstOrDefault().value
        let forceRegionBlock: ActionsBlock = payload.view.blocks.filter(b => b.block_id == "forceRegion")[0]
        forceRegionBlock.elements.forEach((e: any) => {
            if (e.value == region && !e.style) {
                e.style = "primary"
            } else if (e.style) {
                delete e.style
            }
        })
        await slack.updateModal(payload.view)
    })

    // Hash Types Options
    slack.interactions.options({
        within: "block_actions",
        blockId: "hashTypes",
        actionId: "selection"
    }, (payload) => {
        let options = slack.getOptions("hashTypes")
        let startsWith = options.filter(o => o.text.text.iStartsWith(payload.value)) // all hash files that start with the search string
        let includes = options.filter(o => {
            return o.text.text.iIncludes(payload.value) &&
            !startsWith.includes(o)
        }) // all hash files that include the search string and are not in the startsWith array

        // The number of slack options can't exceed 100
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

    // Hash Files Options
    slack.interactions.options({
        within: "block_actions",
        blockId: "hashFile",
        actionId: "selection"
    }, async (payload) => {
        let files = await listFiles("hash")
        return {
            options: files.map((file) => blockFactory.option(file, file))
        }
    })

    // Wordlists Options
    slack.interactions.options({
        within: "block_actions",
        blockId: "wordlist",
        actionId: "selection"
    }, async (payload) => {
        let files = await listFiles("wordlist")

        return {
            options: files.map((file) => blockFactory.option(file, file))
        }
    })

    // Rules Options
    slack.interactions.options({
        within: "block_actions",
        blockId: "rules",
        actionId: "selection"
    }, async (payload) => {
        let files = await listFiles("rule")

        return {
            options: files.map((file) => blockFactory.option(file, file))
        }
    })
    
    // Instance Types
    slack.interactions.options({
        within: "block_actions",
        blockId: "instanceTypes",
        actionId: "selection"
    }, async (payload) => {
        let instances = await npkPricing.getInstancePrices()
        return {
            options: [
                blockFactory.option("G3", JSON.stringify(instances.idealG3Instance)),
                blockFactory.option("P2", JSON.stringify(instances.idealP2Instance)),
                blockFactory.option("P3", JSON.stringify(instances.idealP3Instance))
            ]
        }
    })

    // Campaign Modal Submission
    slack.interactions.viewSubmission({callbackId: "campaign"}, (payload) => {
        console.log("Values")
        console.log(payload.view.state.values)
    })
}

async function initialize() {
    await npkCognito.init()
    let isLoggedIn = npkCognito.isLoggedOn()

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

// apiRequirements.campaigns.create
// await npkCampaign.create(req.body)
// await npkCampaign.start(req.params.campaignId)

// await npkCampaign.get(req.params.campaignId)
// await npkCampaign.cancel(req.params.campaignId)

// await npkCampaign.status(req.params.campaignId)

// await npkS3.getObject(req.s3.bucket, `${req.s3.keyPrefix}/${req.params.file}`)
// result.Body.toString()
// await npkS3.deleteObject(req.s3.bucket, `${req.s3.keyPrefix}/${req.params.file}`)

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