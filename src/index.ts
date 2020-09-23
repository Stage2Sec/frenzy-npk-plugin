import { basename } from "path"
import http from "http"
import { config } from "aws-sdk"
import { createCommand } from "commander"
import stringArgv from 'string-argv';
import { View, Button, SectionBlock, PlainTextElement, HeaderBlock, KnownBlock, ExternalSelect, StaticSelect } from "@slack/web-api";
import AdmZip from "adm-zip"

import { Slack, PluginInfo, Plugin, blockFactory, isFalsy, ActionBlockElement } from "@frenzy/index"

import { npkCognito } from "./lib/npk-cognito"
import { npkPricing } from "./lib/npk-pricing"
import { npkS3 } from "./lib/npk-s3"
import { npkCampaign } from "./lib/npk-campaign"
import { request } from "./lib/http-utils"
import { settings } from "@npk/settings"
import { setTimeout } from "timers";
import { EventEmitter } from "events";

let slack: Slack

const heartbeatInterval = 30000 // 30 seconds
const helpText: string = 
`- *Create and start a campaign.* Click the \`Create Campaign\` button and fill out the necessary fields
- *Upload a hash file to crack.* Send the \`.npk\` message with the file attached`

async function listFiles(type: "hash" | "wordlist" | "rule", forceRegion?: string): Promise<Array<string>> {
    try {
        let { bucket, keyPrefix, region } = npkS3.getS3Info(type, forceRegion)
        return await npkS3.listBucketFiles(bucket, keyPrefix, region)
    } catch (error) {
        console.error(`Error getting ${type} files: `, error)
        return []
    }
}

async function uploadHashFile(name: string, data: any) {
    let { bucket, keyPrefix, region } = npkS3.getS3Info("hash")
    let result = await npkS3.putObject(bucket, `${keyPrefix}/${name}`, data, region)
    return result
}
async function updateInstances(view: View, metadata: any) {
    metadata.instances = await npkPricing.getHashPricing(metadata.hashType, metadata.forceRegion)

    view.blocks
    .filter(b => b.block_id?.startsWith("instance_"))
    .asType<SectionBlock>()
    .forEach(section => {
        if (!section.accessory || !section.fields) {
            return
        }
        let button = section.accessory as Button
        let type = button.value || ""

        // Update selected instance
        if (type == metadata.selectedInstance) {
            toggleOn(button)
        } else {
            toggleOff(button)
        }
        
        // Update price info
        let priceElement = section.fields[1] as PlainTextElement
        priceElement.text = `${toDollarString(metadata.instances[type].price)}/Hr`

        let hashPriceElement = section.fields[3] as PlainTextElement
        let newPrice = (metadata.instances[type].hashes == "-") ? "-" : (metadata.instances[type].hashPrice) 
        hashPriceElement.text = `${toHashesPerSecond(newPrice)}/\$`
    })
    updateTotalPrice(view, metadata)
}
function updateTotalPrice(view: View, metadata: any) {
    let totalPrice: number | undefined
    if (metadata.selectedInstance){
        totalPrice = metadata.instances[metadata.selectedInstance].price * metadata.instanceCount * metadata.instanceDuration
    }

    let priceHeader = view.blocks.findAs<HeaderBlock>(b => b.block_id == "totalPrice")
    priceHeader.text = blockFactory.plainText(`Total: ${toDollarString(totalPrice)}`)
}
function toDollarString(number?: number) {
    if (!number) {
        return "$?.??"
    }
    let parts = number.toFixed(2).toString().split(".")
    return `\$${parts[0]}.${parts[1]}`
}
function toHashesPerSecond(number: any) {

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
function toggleOff(button: Button) {
    delete button.style
}
function toggleOn(button: Button) {
    button.style = "primary"
}
function instanceBlocks(): SectionBlock[] {
    return ["g3", "p2", "p3"].map(type => {
        let text = ""
        switch (type) {
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
            blockId: `instance_${type}`,
            fields: [
                blockFactory.markdown("*Price*:"),
                blockFactory.plainText("$?.??/Hr"),
                blockFactory.markdown("*Hash Price*:"),
                blockFactory.plainText("???/$"),
            ],
            accessory: blockFactory.button({
                text: "Select",
                actionId: "selectInstance",
                value: type
            })
        })
    })
}

interface SubCommandInfo {
    mainMenuItems?: Array<ActionBlockElement>,
    subCommandMenuItems?: Array<KnownBlock>
}

function setupSlack(){
    let subCommands = [
        createCampaignInteractions(),
        //manageCampaignsInteractions(),
        testInteractions()
    ]

    // Setup dot commands
    slack.dotCommand("npk", async (event) => {
        let threadTs = event.thread_ts || event.ts

        try {
            // Upload hash file
            if (event.files) {
                event.files.forEach(async (file: any) => {
                    let contents = await slack.getFile(file.url_private)
                    await uploadHashFile(file.name, contents)
                    await slack.postMessage({
                        channel: event.channel,
                        text: `<@${event.user}> \`${file.name}\` uploaded`,
                        icon_emoji: ":thumbsup:",
                        thread_ts: threadTs
                    })
                });
                return
            }

            // Send NPK Menu
            await slack.postMessage({
                channel: event.channel,
                thread_ts: threadTs,
                text: "Menu",
                blocks: [
                    blockFactory.header({
                        text: "Help"
                    }),
                    blockFactory.section({
                        text: helpText,
                        markdown: true
                    }),
                    blockFactory.divider(),
                    blockFactory.actions({
                        blockId: "npkMenu",
                        elements: subCommands.mapAndFlatten(c => c.mainMenuItems as Array<ActionBlockElement>)
                    })
                ]
            })
        } catch (error) {
            console.error(error)
            slack.postError({
                channel: event.channel,
                error: "An unexpected error ocurred",
                threadTs: threadTs
            })
        }
    })

    function createCampaignInteractions(): SubCommandInfo {
        const campaignTimeouts: Record<string, NodeJS.Timeout> = {}

        // Setup Static Options
        slack.storeOptions("hashTypes", Object.keys(npkPricing.hashTypes).map(name => blockFactory.option(name, npkPricing.hashTypes[name])))
        slack.storeOptions("forceRegion", [
            blockFactory.option("Any", null),
            blockFactory.option("West-1", "us-west-1"),
            blockFactory.option("West-2", "us-west-2"),
            blockFactory.option("East-1", "us-east-1"),
        ])
        slack.storeOptions("instanceCount", [].range(6, 1).map(n => blockFactory.option(`${n}`, n)))
        slack.storeOptions("instanceDuration", [].range(24, 1).map(n => blockFactory.option(`${n} hour(s)`, n)))

        // Open Campaign Modal
        slack.interactions.action({
            actionId: "openCampaignModal"
        }, (payload, respond) => {
            slack.modals.open({
                trigger_id: payload.trigger_id,
                modal: {    
                    callback_id: "campaign",                
                    close: "Close",
                    title: "Create Campaign",
                    blocks: [
                        blockFactory.section({
                            blockId: "loading",
                            text: "Loading..."
                        })
                    ]
                }
            })
            .then(result => {
                // Since it seems payload.trigger_id will timeout if a modal is opened
                // asynchronously, we will just update the modal with the rest of the blocks
                // here
                if (!result?.ok) {
                    return
                }
                slack.modals.update((result as any).view, async (view, metadata) => {
                    metadata.message = {
                        channel: payload.channel.id,
                        user: payload.user.id,
                        threadTs: payload.message.thread_ts
                    }

                    let prices = await npkPricing.getInstancePrices(metadata.forceRegion)
                    metadata.idealG3Instance = prices.idealG3Instance
                    metadata.idealP2Instance = prices.idealP2Instance
                    metadata.idealP3Instance = prices.idealP3Instance

                    metadata.instanceCount = 2
                    metadata.instanceDuration = 4

                    let hashFiles = await listFiles("hash")

                    view.submit = blockFactory.plainText("Create")
                    view.blocks = [
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
                                options: slack.getOptions("forceRegion"),
                                initialOption: blockFactory.option("Any", null)
                            })
                        }),
                        blockFactory.divider(),
                        ...instanceBlocks(),
                        blockFactory.divider(),
                        blockFactory.header({
                            text: "Target List"
                        }),
                        blockFactory.input({
                            blockId: "hashFile",
                            label: "Hashes File",
                            element: blockFactory.staticSelect({
                                options: hashFiles.length > 0 ? 
                                hashFiles.map(file => blockFactory.option(file, file)) :
                                [blockFactory.option("No files found", null)]
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
                        blockFactory.divider(),
                        blockFactory.header({
                            text: "Resource Allocation"
                        }),
                        blockFactory.section({
                            blockId: "instanceCount",
                            text: "Instance Count",
                            accessory: blockFactory.staticSelect({
                                options: slack.getOptions("instanceCount"),
                                initialOption: slack.getOptions("instanceCount").find(o => o.value == `${metadata.instanceCount}`)
                            })
                        }),
                        blockFactory.section({
                            blockId: "instanceDuration",
                            text: "Duration",
                            accessory: blockFactory.staticSelect({
                                options: slack.getOptions("instanceDuration"),
                                initialOption: slack.getOptions("instanceDuration").find(o => o.value == `${metadata.instanceDuration}`)
                            })
                        }),
                        blockFactory.divider(),
                        blockFactory.header({
                            text: "Total: $?.??",
                            blockId: "totalPrice"
                        })
                    ]
                })
            })
        })

        // Force Region
        slack.interactions.action({
            blockId: "forceRegion"
        }, (payload, respond) => {
            slack.modals.update(payload.view, async (view, metadata) => {
                metadata.forceRegion = payload.actions.first().selected_option?.value
                if (isFalsy(metadata.forceRegion)) {
                    delete metadata.forceRegion
                }

                let prices = await npkPricing.getInstancePrices(metadata.forceRegion)
                metadata.idealG3Instance = prices.idealG3Instance
                metadata.idealP2Instance = prices.idealP2Instance
                metadata.idealP3Instance = prices.idealP3Instance

                // Clear selected instance since a new region has been selected
                delete metadata.selectedInstance
                
                await updateInstances(view, metadata)
            })
        })

        // Select Instance
        slack.interactions.action({
            actionId: "selectInstance"
        }, (payload, respond) => {
            slack.modals.update(payload.view, async (view, metadata) => {
                let instanceType = payload.actions.first().value
                if (isFalsy(metadata.selectedInstance) || metadata.selectedInstance != instanceType) {
                    metadata.selectedInstance = instanceType
                }
                await updateInstances(view, metadata)
            })
        })

        // Hash Type Selected
        slack.interactions.action({
            blockId: "hashTypes",
            actionId: "selection"
        }, (payload, respond) => {
            slack.modals.update(payload.view, async (view, metadata) => {
                metadata.hashType = payload.actions.first().selected_option?.value
                if (isFalsy(metadata.hashType)) {
                    delete metadata.hashType
                }
                await updateInstances(view, metadata)
            })
        })

        // Wordlist Attack Toggle
        slack.interactions.action({
            blockId: "wordlistAttackToggle"
        }, (payload, respond) => {
            slack.modals.update(payload.view, async (view, metadata) => {
                metadata.wordlistEnabled = payload.actions.first().value == "true"
                let section = view.blocks.findAs<SectionBlock>(b => b.block_id == "wordlistAttackToggle")
                let button = section.accessory as Button

                let sectionIndex = view.blocks.indexOf(section)
                if (metadata.wordlistEnabled) {
                    toggleOn(button)
                    button.text = blockFactory.plainText("Enabled")
                    button.value = "false"

                    let wordlists = await listFiles("wordlist", metadata.forceRegion)
                    let rules = await listFiles("rule", metadata.forceRegion)
                    
                    view.blocks.splice(sectionIndex + 1, 0, 
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
                    )
                } else {
                    toggleOff(button)
                    button.text = blockFactory.plainText("Enable")
                    button.value = "true"

                    view.blocks.splice(sectionIndex + 1, 2) // Remove the wordlist and rules input
                }
            })
        })

        // Mask Configuration Toggle
        slack.interactions.action({
            blockId: "maskConfigToggle"
        }, (payload, respond) => {
            slack.modals.update(payload.view, (view, metadata) => {
                metadata.maskEnabled = payload.actions.first().value == "true"
                let section = view.blocks.findAs<SectionBlock>(b => b.block_id == "maskConfigToggle")
                let button = section.accessory as Button

                let sectionIndex = view.blocks.indexOf(section)
                if (metadata.maskEnabled) {
                    toggleOn(button)
                    button.text = blockFactory.plainText("Enabled")
                    button.value = "false"

                    view.blocks.splice(sectionIndex + 1, 0, blockFactory.input({
                        label: "Mask",
                        blockId: "maskBlock",
                        element: blockFactory.plainTextInput({
                            actionId: "mask"
                        })
                    }))
                } else {
                    toggleOff(button)
                    button.text = blockFactory.plainText("Enable")
                    button.value = "true"

                    view.blocks.splice(sectionIndex + 1, 1) // Remove the mask input
                }
            })
        })

        // Instance Count Selected
        slack.interactions.action({
            blockId: "instanceCount",
            actionId: "selection"
        }, (payload, respond) => {
            slack.modals.update(payload.view, (view, metadata) => {
                metadata.instanceCount = parseInt(payload.actions.first().selected_option?.value)
                updateTotalPrice(view, metadata)
            })
        })

        // Instance Duration Selected
        slack.interactions.action({
            blockId: "instanceDuration",
            actionId: "selection"
        }, (payload, respond) => {
            slack.modals.update(payload.view, (view, metadata) => {
                metadata.instanceDuration = parseInt(payload.actions.first().selected_option?.value)
                updateTotalPrice(view, metadata)
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

        // Campaign Modal Submission
        slack.interactions.viewSubmission({
            callbackId: "campaign"
        }, (payload) => {
            let metadata = slack.modals.getMetadata(payload.view)
            let results = validate(payload.view, metadata)
            if (results.errors) {
                // Since state isn't save for action blocks and we have some fields
                // that are action blocks and not input blocks, we must manually save their state
                // before showing the error modal
                slack.modals.update(payload.view, (view) => {
                    ["hashTypes", "forceRegion", "instanceCount", "instanceDuration"]
                    .forEach(blockId => {
                        let select = view.blocks.findAs<SectionBlock>(b => b.block_id == blockId).accessory as StaticSelect

                        let value = metadata[blockId]
                        if (blockId == "hashTypes") {
                            value = metadata.hashType
                        }

                        if (value) {
                            select.initial_option = slack.getOptions(blockId).find(o => o.value == value.toString())
                        }
                    })
                })
                return slack.modals.push({
                    pushMethod: "responseAction",
                    modal: {
                        callback_id: "campaignErrors",
                        title: "Errors",
                        close: "OK",
                        blocks: results.errors.map(e => blockFactory.section({
                            text: e
                        }))
                    }
                })
            };
            
            (async function(){
                let { channel, user, threadTs } = metadata.message
                try {
                    let { campaignId } = await npkCampaign.create(results.data)

                    // Can fire and forget this since we don't really need to care
                    // whether this succeeds or fails
                    slack.postMessage({
                        channel: channel,
                        text: `<@${user}>, campaign created`,
                        icon_emoji: ":thumbsup:",
                        thread_ts: threadTs
                    })
                    .catch(error => console.error("Error posting campaign created message\n", error))

                    await npkCampaign.start(campaignId)

                    startHeartbeat({
                        campaignId,
                        channel: channel,
                        threadTs: threadTs,
                        interval: heartbeatInterval
                    })
                } catch (error) {
                    console.error("Error creating or starting campaign\n", error)
                    slack.postError({
                        channel: channel,
                        error: "Error creating or starting campaign\n",
                        threadTs: threadTs
                    })
                }
            })()
            return undefined // Return undefined so it doesn't wait for the async function to complete
        })

        // Campaign Status
        slack.interactions.action({
            actionId: new RegExp("^campaignStatusRefresh_.*")
        }, (payload, respond) => {
            let options = JSON.parse(payload.actions.first().value)
            startHeartbeat({
                campaignId: options.campaignId,
                interval: options.interval,
                channel: payload.channel.id,
                threadTs: payload.message.thread_ts,
                ts: payload.message.ts
            })
        })

        // Cancel Campaign
        slack.interactions.action({
            actionId: new RegExp("^cancelCampaign_.*")
        }, (payload, respond) => {
            let options = JSON.parse(payload.actions.first().value)
            if (!options.cancelling) {
                npkCampaign.cancel(options.campaignId)
                .then(data => {
                    startHeartbeat({
                        campaignId: options.campaignId,
                        interval: options.interval,
                        channel: payload.channel.id,
                        threadTs: payload.message.thread_ts,
                        ts: payload.message.ts,
                        cancelling: true
                    })
                })
            }
            
            return undefined
        })

        return {
            mainMenuItems: [
                blockFactory.button({
                    actionId: "openCampaignModal",
                    text: "Create Campaign",
                    style: "primary"
                })
            ]
        }

        function validate(view: View, metadata: any): {
            errors?: Array<any>,
            data?: any
        } {
            let errors: Array<any> = []
            let hashType = metadata.hashType
            if (!hashType) {
                errors.push("Hash type not selected")
            }
        
            let selectedInstance = metadata.selectedInstance
            if (!selectedInstance) {
                errors.push("Instance not selected")
            }
        
            if (!metadata.maskEnabled && !metadata.wordlistEnabled) {
                errors.push("Attack type not specified")
            }

            let hashFile = slack.getSelectedOption({
                blockId: "hashFile",
                view: view
            })
            if (isFalsy(hashFile)) {
                errors.push("Hash file not selected")
            }
        
            if (errors.length > 0){
                return {
                    errors
                }
            }
        
            let idealInstance = metadata[`ideal${selectedInstance.toUpperCase()}Instance`]
            let data: any = {
                hashType,
                hashFile: `uploads/${hashFile}`,
                region: idealInstance.az.slice(0, idealInstance.az.length - 1),
                availabilityZone: idealInstance.az,
                priceTarget: idealInstance.price,
                instanceType: idealInstance.type,
                instanceCount: metadata.instanceCount,
                instanceDuration: metadata.instanceDuration,
            }
        
            if (metadata.maskEnabled) {
                data.mask = slack.getPlainTextValue({
                    view: view,
                    blockId: "maskBlock",
                    actionId: "mask"
                })
            }
        
            if (metadata.wordlistEnabled) {
                data.dictionaryFile = `wordlist/${slack.getSelectedOption({
                    view: view,
                    blockId: "wordlist"
                })}`

                data.rulesFiles = slack.getSelectedOptions({
                    view: view,
                    blockId: "rules"
                }).map(r => `rules/${r}`)
            }
            
            return {
                data
            }
        }

        function startHeartbeat(options: {
            campaignId: string,
            channel: string,
            threadTs: string,
            ts?: string,
            interval: number,
            cancelling?: boolean
        }) {
            kill()
            heartbeat()
        
            async function heartbeat() {
                try {
                    let result = await npkCampaign.status(options.campaignId)
                    if (!result) {
                        kill(`Campaign \`${options.campaignId}\` not found`)
                        return
                    }
                    if (result.status.iEquals("available")) {
                        kill(`Campaign \`${options.campaignId}\` hasn't started`)
                        return
                    }

                    // NPK doesn't stop the campaign if all nodes are in a done state
                    // so we must manually stop it
                    let nodesAreDone = result.nodes.length > 0 && result.nodes.every(node => node.status.iEquals("error") || node.status.iEquals("completed"))
                    if (!options.cancelling && nodesAreDone) {
                        await npkCampaign.cancel(options.campaignId)
                        options.cancelling = true
                    }

                    let message = {
                        channel: options.channel,
                        text: "Status",
                        blocks: [
                            blockFactory.header({
                                text: "Campaign Status"
                            }),
                            blockFactory.actions({
                                blockId: `campaignStatusBlock_${options.campaignId}`,
                                elements: [
                                    blockFactory.button({
                                        text: "Refresh",
                                        actionId: `campaignStatusRefresh_${options.campaignId}`,
                                        style: "primary",
                                        value: JSON.stringify(options)
                                    }),
                                    blockFactory.button({
                                        text: "Cancel",
                                        actionId: `cancelCampaign_${options.campaignId}`,
                                        style: "danger",
                                        value: JSON.stringify(options)
                                    })
                                ]
                            }),
                            blockFactory.section({
                                text: `\`\`\`${JSON.stringify(result, null, 3)}\`\`\``,
                                markdown: true,
                                blockId: `campaignStatus_${options.campaignId}`
                            })
                        ]
                    }

                    let campaignIsDone = result.status.iEquals("completed") || result.status.iEquals("error")
                    if (campaignIsDone){
                        // Remove the refresh and cancel buttons since the campaign is done
                        message.blocks.splice(1, 1)
                    }

                    if (options.ts) {
                        await slack.updateMessage({
                            ...message,
                            ts: options.ts,
                        })
                    } else {
                        await slack.postMessage({
                            ...message,
                            thread_ts: options.threadTs
                        })
                        .then((result: any) => options.ts = result.ts)
                    }
                    
                    if (campaignIsDone) {
                        onFinished()
                    } else {
                        campaignTimeouts[options.campaignId] = setTimeout(async () => await heartbeat(), options.interval)
                    }
                } catch(error) {
                    console.error("Error heartbeating\n", error)
                    kill("An unexpected error occurred while retrieving the campaign's status")
                }
            }
            function kill(error?: string){
                if (campaignTimeouts[options.campaignId]) {
                    clearTimeout(campaignTimeouts[options.campaignId])
                    delete campaignTimeouts[options.campaignId]
                }
                if (error) {
                    slack.postError({
                        channel: options.channel,
                        threadTs: options.threadTs,
                        error: error
                    })
                }
            }
            async function onFinished(){
                try {
                    let files = await npkCampaign.potFiles(options.campaignId)
                    if (files.length == 0) {
                        return
                    }

                    let zip: AdmZip = new AdmZip()
                    files.forEach(file => {
                        zip.addFile(file.name, file.data)
                    })

                    let file = zip.toBuffer()
                    await slack.client.files.upload({
                        channels: options.channel,
                        thread_ts: options.threadTs,
                        filename: `${options.campaignId}-potfiles.zip`,
                        file: file,
                        filetype: "application/zip"
                    })
                } catch (error) {
                    console.error("Error executing while executing campaign completion code\n", error)
                }

                kill()
            }
        }
    }
    
    function manageCampaignsInteractions(): SubCommandInfo {
        slack.interactions.action({
            actionId: "manageCampaignsModal"
        }, (payload, respond) => {
            // TODO: Implement managing campaigns
        })
        return {
            mainMenuItems: [
                blockFactory.button({
                    actionId: "manageCampaignsModal",
                    text: "Manage Campaigns"
                })
            ]
        }
    }

    function testInteractions(): SubCommandInfo {
        slack.interactions.action({
            actionId: "testButton"
        }, (payload, respond) => {
            console.log("Test button pushed")
            return undefined
        })
        return {
            mainMenuItems: [
                blockFactory.button({
                    text: "Test",
                    actionId: "testButton"
                })
            ]
        }
    }
}

async function initialize() {
    await npkCognito.init()

    npkCampaign.init()
    npkS3.init()
    await npkPricing.init()

    setupSlack()
}

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