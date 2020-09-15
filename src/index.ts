import { basename } from "path"
import http from "http"
import { config } from "aws-sdk"
import { createCommand } from "commander"
import stringArgv from 'string-argv';
import { Option, ActionsBlock, View, KnownBlock, Button, SectionBlock, PlainTextElement } from "@slack/web-api";

import { Slack, PluginInfo, Plugin, blockFactory, isFalsy } from "@frenzy/index"

import { npkCognito } from "./lib/npk-cognito"
import { npkPricing } from "./lib/npk-pricing"
import { npkS3 } from "./lib/npk-s3"
import { npkCampaign } from "./lib/npk-campaign"
import { request } from "./lib/http-utils"
import { settings } from "@npk/settings"
import e from "express";

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
async function updateInstances(view: View, metadata: any) {
    metadata.instances = await npkPricing.calcHashPricing(metadata.hashType, metadata.forceRegion)

    // Update selected instance in modal
    view.blocks.forEach(b => {
        if (!b.block_id) {
            return
        }

        if (b.block_id.startsWith("actionsInstance_")) {
        } else if (b.block_id.startsWith("instance_")) {
            let section = b as SectionBlock
            if (!section.accessory || !section.fields) {
                return
            }
            let button = section.accessory as Button
            let type = button.value || ""

            if (type == metadata.selectedInstance) {
                toggleButtonOn(button)
            } else {
                toggleButtonOff(button)
            }
            
            let priceElement = section.fields[1] as PlainTextElement
            let newPrice = (metadata.instances[type].hashes == "-") ? "-" : (metadata.instances[type].hashPrice) 
            priceElement.text = `${toHs(newPrice)}/\$`
        }
    })
}
function toHs(number: any) {

    if (number == "-" || number == "?") {
        return "???";
    }

    number = parseInt(number);
    
    if (number.toString().length < 4) {
        return number + " h/s";
    }

    if (number.toString().length < 7) {
        return (Math.round(number / 10) / 100) + " Kh/s";
    }

    if (number.toString().length < 10) {
        return (Math.round(number / 10000) / 100) + " Mh/s";
    }

    if (number.toString().length < 13) {
        return (Math.round(number / 10000000) / 100) + " Gh/s";
    }
    return ""
}
function toggleButton(button: Button) {
    if (button.style) {
        delete button.style
        return false
    }
    button.style = "primary"
    return true
}
function toggleButtonOff(button: Button) {
    if (button.style) {
        delete button.style
    }
}
function toggleButtonOn(button: Button) {
    button.style = "primary"
}
function instanceBlock(options: {
    instanceType: "g3" | "p2" | "p3",
    price: string,
}): SectionBlock {
    let text = ""
    switch (options.instanceType) {
        case "g3":
            text = "(Tesla M60)"
            break;
        case "p2":
            text = "(Tesla K80)"
            break;
        case "p3":
            text = "(Tesla V100)"
            break;
    }
    return blockFactory.section({
        text: text,
        blockId: `instance_${options.instanceType}`,
        fields: [
            blockFactory.markdown("*Price*:"),
            blockFactory.plainText(options.price)
        ],
        accessory: blockFactory.button({
            text: "Select",
            actionId: "selectInstance",
            value: options.instanceType
        })
    })
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
                            }),
                            blockFactory.button({
                                actionId: "cancelCampaignModal",
                                text: "Cancel Campaign",
                                style: "danger"
                            }),
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
        console.log(payload)
        slack.openModal({
            trigger_id: payload.trigger_id,
            modal: {
                callback_id: "campaign",
                submit: blockFactory.plainText("Create"),
                close: blockFactory.plainText("Close"),
                title: blockFactory.plainText("Create NPK Campaign"),
                blocks: [
                    blockFactory.section({
                        blockId: "hashTypes",
                        text: "Hash Type",
                        accessory: blockFactory.externalSelect({
                            minLength: 1
                        })
                    }),
                    blockFactory.divider(),
                    blockFactory.section({
                        text: "Force Region",
                        blockId: "forceRegion",
                        accessory: blockFactory.staticSelect({
                            options: [
                                blockFactory.option("Any", null),
                                blockFactory.option("West-1", "us-west-1"),
                                blockFactory.option("West-2", "us-west-2"),
                                blockFactory.option("East-1", "us-east-1"),
                            ],
                            initialOption: blockFactory.option("Any", null)
                        })
                    }),
                    blockFactory.divider(),
                    instanceBlock({
                        instanceType: "g3",
                        price: "???/$"
                    }),
                    instanceBlock({
                        instanceType: "p2",
                        price: "???/$"
                    }),
                    instanceBlock({
                        instanceType: "p3",
                        price: "???/$"
                    }),
                    // {
                    //     type: "context",
                    //     block_id: "p2InstanceInfo",
                    //     elements: [
                    //         {
                    //             type: "plain_text",
                    //             text: toHs("-") // Speed
                    //         },
                    //         {
                    //             type: "plain_text",
                    //             // text: `${prices.idealP2Instance.gpus} GPUs` // GPUs
                    //             text: "??? GPUs" // GPUs
                    //         },
                    //         {
                    //             type: "plain_text",
                    //             // text: `\$${prices.idealP2Instance.price} /Hr` // Instance Price
                    //             text: "??? /Hr" // Instance Price
                    //         },
                    //         {
                    //             type: "plain_text",
                    //             // text: prices.idealP2Instance.az // Availability Zone
                    //             text: "???" // Availability Zone
                    //         },
                    //     ]
                    // },
                    blockFactory.divider(),
                    blockFactory.header({
                        text: "Target List"
                    }),
                    blockFactory.input({
                        blockId: "hashFile",
                        label: "Hashes File",
                        element: blockFactory.externalSelect({
                            minLength: 1
                        })
                    }),
                    blockFactory.divider(),
                    blockFactory.header({
                        text: "Attack Type"
                    }),
                    blockFactory.section({
                        text: "Wordlist Attack",
                        blockId: "wordlistAttackToggle",
                        accessory: blockFactory.button({
                            text: "Enable",
                            value: "true"
                        })
                    }),
                    blockFactory.divider(),
                    blockFactory.section({
                        text: "Mask Configuration",
                        blockId: "maskConfigToggle",
                        accessory: blockFactory.button({
                            text: "Enable",
                            value: "true"
                        })
                    }),
                    // blockFactory.input({
                    //     blockId: "wordlist",
                    //     label: "Select a wordlist",
                    //     element: blockFactory.externalSelect({
                    //         minLength: 1
                    //     }),
                    //     optional: true
                    // }),
                    // blockFactory.input({
                    //     blockId: "rules",
                    //     label: "Select rules",
                    //     element: blockFactory.externalSelect({
                    //         multi: true,
                    //         minLength: 1
                    //     }),
                    //     optional: true
                    // }),
                    blockFactory.divider()
                ],
            }
        })
    })

    // Force Region
    slack.interactions.action({
        blockId: "forceRegion"
    }, async (payload, respond) => {
        console.log(payload)
        await slack.updateModal(payload.view, async (view, metadata) => {
            metadata.forceRegion = payload.actions.first().selected_option?.value
            if (isFalsy(metadata.forceRegion)) {
                delete metadata.forceRegion
            }

            let prices = await npkPricing.getInstancePrices(metadata.forceRegion)
            metadata.idealG3Instance = prices.idealG3Instance
            metadata.idealP2Instance = prices.idealP2Instance
            metadata.idealP3Instance = prices.idealP3Instance

            // Clear selected instance since a new region has been selected
            if (metadata.selectedInstance) {
                delete metadata.selectedInstance
            }
            
            await updateInstances(view, metadata)
        })
    })

    // Select Instance
    slack.interactions.action({
        actionId: "selectInstance"
    }, async (payload, respond) => {
        console.log(payload)
        await slack.updateModal(payload.view, async (view, metadata) => {
            let instanceType = payload.actions.first().value
            if (isFalsy(metadata.selectedInstance) || metadata.selectedInstance != instanceType) {
                metadata.selectedInstance = instanceType
            }
            await updateInstances(view, metadata)
        })
    })

    // slack.interactions.action({
    //     actionId: "instanceInfo"
    // }, (payload, respond) => {
    //     console.log(payload)
    //     let instanceType = payload.actions.first().value
    // })

    // Hash Types Action
    slack.interactions.action({
        blockId: "hashTypes",
        actionId: "selection"
    }, async (payload, respond) => {
        console.log(payload)
        await slack.updateModal(payload.view, async (view, metadata) => {
            metadata.hashType = payload.actions.first().selected_option?.value
            if (isFalsy(metadata.hashType)) {
                delete metadata.hashType
            }
            await updateInstances(view, metadata)
        })
    })

    slack.interactions.action({
        blockId: "wordlistAttackToggle"
    }, (payload, respond) => {
        slack.updateModal(payload.view, async (view, metadata) => {
            let enable = payload.actions.first().value == "true"
            let section = view.blocks.filter(b => b.block_id == "wordlistAttackToggle").firstAs<SectionBlock>()
            let button = section.accessory as Button

            let sectionIndex = view.blocks.indexOf(section)
            if (enable) {
                toggleButtonOn(button)
                button.text = blockFactory.plainText("Enabled")
                button.value = "false"

                let wordlists = await listFiles("wordlist")
                let rules = await listFiles("rule")
                let wordlistAttackBlocks = [
                    blockFactory.input({
                        blockId: "wordlist",
                        label: "Select a wordlist",
                        element: blockFactory.staticSelect({
                            options: wordlists.map((file) => blockFactory.option(file, file))
                        })
                    }),
                    blockFactory.input({
                        blockId: "rules",
                        label: "Select rules",
                        element: blockFactory.staticSelect({
                            options: rules.map((file) => blockFactory.option(file, file)),
                            multi: true
                        }),
                        optional: true
                    })
                ]
                
                view.blocks.splice(sectionIndex + 1, 0, ...wordlistAttackBlocks)
            } else {
                toggleButtonOff(button)
                button.text = blockFactory.plainText("Enable")
                button.value = "true"

                view.blocks.splice(sectionIndex + 1, 2) // Remove the wordlist and rules input
            }
        })
    })

    slack.interactions.action({
        blockId: "maskConfigToggle"
    }, (payload, respond) => {
        slack.updateModal(payload.view, (view, metadata) => {
            let enable = payload.actions.first().value == "true"
            let section = view.blocks.filter(b => b.block_id == "maskConfigToggle").firstAs<SectionBlock>()
            let button = section.accessory as Button
            if (enable) {
                toggleButtonOn(button)
                button.text = blockFactory.plainText("Enabled")
                button.value = "false"
            } else {
                toggleButtonOff(button)
                button.text = blockFactory.plainText("Enable")
                button.value = "true"
            }
        })
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
        let forceRegion: string | undefined
        let metadata = slack.getMetadata(payload.view)
        if (metadata.forceRegion) {
            forceRegion = metadata.forceRegion
        }
        let instances = await npkPricing.getInstancePrices(forceRegion)
        return {
            options: [
                blockFactory.option("Tesla M60", JSON.stringify(instances.idealG3Instance)),
                blockFactory.option("Tesla K80", JSON.stringify(instances.idealP2Instance)),
                blockFactory.option("Tesla V100", JSON.stringify(instances.idealP3Instance))
            ]
        }
    })

    // Campaign Modal Submission
    slack.interactions.viewSubmission({callbackId: "campaign"}, (payload) => {
        console.log("View Submission:")
        console.log(payload.view)
    })
}

async function initialize() {
    await npkCognito.init()

    npkCampaign.init()
    npkS3.init()
    await npkPricing.init()

    setupSlack()
}

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