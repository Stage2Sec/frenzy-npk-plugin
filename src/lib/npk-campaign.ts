import { DynamoDB, config, EC2 } from "aws-sdk"
import { AttributeValue as ddbTypes } from 'dynamodb-data-types'

import { settings } from "@npk/settings"
import { npkCognito } from "./npk-cognito"
import { npkS3 } from "./npk-s3"
import { request } from "./http-utils"

const campaignUrl = `https://${settings.APIGATEWAY_URL}/v1/userproxy/campaign`

class NpkDb {
    private db: DynamoDB
    
    public init() {
        this.db = new DynamoDB()
    }

    public create(table: string, record: any) {
        return this.db.putItem({
            TableName: table,
            Item: record
        }).promise()
    }

    public query(params: any) {
        return this.db.query(params).promise()
    }

    private parseCompoundKey(compound_key: string): {
        owner: string,
        keys: string
    } {
        let owner: string = ""
        let split = compound_key.split(":");
        switch (split[0]) {
            case 'admin':
                owner = 'admin';
                break;

            case 'self':
                owner = (config.credentials as any)?.identityId;
                break;

            default:
                console.log('Allowed key prefixes are "self" and "admin"');
                break;
        }

        split.shift();
        return {
            owner,
            keys: split.join(':')
        }
    }
    public select(compound_key: string, table: string) {
        let { owner, keys } = this.parseCompoundKey(compound_key)

        var params = {
            ExpressionAttributeValues: {
                ':id': {S: owner},
                ':keyid': {S: keys}
            },
            KeyConditionExpression: 'userid = :id and begins_with(keyid, :keyid)',
            TableName: table
        };

        return this.query(params)
        .then((data) => {
            var result: Array<any> = [];

            data.Items?.forEach(function(s) {
              var newData = DynamoDB.Converter.unmarshall(s);
              delete newData.userid;

              result.push(newData)
            });

            return result;
        });
    }

    public edit(compound_key: string, table: string, values: any) {
        values = ddbTypes.wrap(values);
        Object.keys(values).forEach(function(e) {
            values[e] = {
                Action: "PUT",
                Value: values[e]
            };
        });

        let { owner, keys } = this.parseCompoundKey(compound_key)
        return this.db.updateItem({
            Key: {
                userid: {S: owner},
                keyid: {S: keys}
            },
            TableName: table,
            AttributeUpdates: values
        }).promise()
    }
}

export class NpkCampaign {
    private db: NpkDb = new NpkDb()

    public init() {
        this.db.init()
    }

    public async create(order: any) {
        order.hashFileUrl = await npkS3.getSignedUrl('getObject', {
            Bucket: settings.USERDATA_BUCKET,
            Key: `self/${order.hashFile}`,
            Expires: 3600
        })
    
        let params = {
            method: 'POST',
            url: campaignUrl,
            headers: {},
            body: JSON.stringify(order),
        }
        let result = await request(npkCognito.signAPIRequest(params))
        return result
    }

    public get(campaignId: string) {
        return this.db.select(`self:campaigns:${campaignId}`, "Campaigns")
        .then(data => data.first())
    }

    public getNodes(campaignId: string) {
        return this.db.select(`self:${campaignId}:nodes:`, "Campaigns")
    }
    public getEvents(campaignId: string) {
        return this.db.select(`self:${campaignId}:events:`, "Campaigns")
    }

    public getAll() {
        return this.db.select("self:campaigns:", "Campaigns")
    }

    public async start(campaignId: string) {
        let params = {
            method: 'PUT',
            url: `${campaignUrl}/${campaignId}`,
            headers: {},
            body: ""
        }
        let result = await request(npkCognito.signAPIRequest(params))
        return result        
    }

    public async cancel(campaignId: string) {
        let params = {
            method: 'DELETE',
            url: `${campaignUrl}/${campaignId}`,
            headers: {},
            body: ""
        };
        
        let data = await request(npkCognito.signAPIRequest(params))
        if (typeof data != "object") {
            try {
                data = JSON.parse(data);
            } catch (e) {
                data = {msg: "Error parsing response JSON.", success: false};
            }
        }
        return data        
    }
    public edit(campaignId: string, values: any) {
        return this.db.edit(`self:campaigns:${campaignId}`, "Campaigns", values)
    }

    public async status(campaignId: string) {
        let data = await Promise.all([
            this.get(campaignId),
            this.getNodes(campaignId),
            this.getEvents(campaignId)
        ])
        
        let result: any = {
            ...data[0],
            nodes: data[1],
            events: data[2]
        }

        return result
        // let campaign = result[0][Object.keys(result[0]).first()]
        // if (!campaign) {
        //     return null
        // }

        // return {
        //     active: campaign.active as boolean,
        //     status: campaign.status as string,
        //     startTime: campaign.startTime as number,
        //     estimatedEndTime: campaign.estimatedEndTime as number,
        //     hashRate: campaign.hashRate,
        //     progress: campaign.progress,
        //     recoveredHashes: campaign.recoveredHashes,
        //     rejectedPercentage: campaign.rejectedPercentage,
        //     performance: campaign.performance
        // }
    }
}
export const npkCampaign = new NpkCampaign()