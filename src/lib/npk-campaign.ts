import { DynamoDB, config } from "aws-sdk"
import { AttributeValue as ddbTypes } from 'dynamodb-data-types'

import { settings } from "@npk/settings"
import { npkCognito } from "./npk-cognito"
import { npkS3 } from "./npk-s3"
import { request } from "./http-utils"

const campaignUrl = `https://${settings.APIGATEWAY_URL}/v1/userproxy/campaign`

export class NpkCampaign {
    private db: DynamoDB

    public init() {
        this.db = new DynamoDB()
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

    public async get(campaignId: string) {
        let queryInput: DynamoDB.Types.QueryInput = {
			ExpressionAttributeValues: {
				':id': {S: (config.credentials as any).identityId},
				':keyid': {S: "campaigns:" + campaignId}
			},
			KeyConditionExpression: 'userid = :id and keyid = :keyid',
			TableName: "Campaigns"
		}
        let result = await this.db.query(queryInput).promise()
        result.Items = result.Items?.map(item =>  ddbTypes.unwrap(item))
        return result        
    }

    public async getAll() {
        let queryInput: DynamoDB.Types.QueryInput = {
			ExpressionAttributeValues: {
				':id': {S: (config.credentials as any).identityId},
				':keyid': {S: "campaigns:"}
			},
			KeyConditionExpression: 'userid = :id and begins_with(keyid, :keyid)',
			TableName: "Campaigns"
		}
        let result = await this.db.query(queryInput).promise()
        result.Items = result.Items?.map(item =>  ddbTypes.unwrap(item))
        return result
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

    public async cancel(campaignId) {
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

    public async status(campaignId: string) {
        let campaign = (await this.get(campaignId)).Items?.shift()
        if (!campaign) {
            return null
        }

        return {
            active: campaign.active as boolean,
            status: campaign.status as string,
            startTime: campaign.startTime as number,
            estimatedEndTime: campaign.estimatedEndTime as number,
            hashRate: campaign.hashRate,
            progress: campaign.progress,
            recoveredHashes: campaign.recoveredHashes,
            rejectedPercentage: campaign.rejectedPercentage,
            performance: campaign.performance
        }
    }
}
export const npkCampaign = new NpkCampaign()