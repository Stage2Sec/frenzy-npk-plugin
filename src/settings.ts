function getEnvVar(name: string) {
    return process.env[name] || ""
}

let region = getEnvVar("NPK_AWS_REGION")
let userPoolId = getEnvVar("NPK_COGNITO_USER_POOL_ID")

let logins: any = {}
logins[`cognito-idp.${region}.amazonaws.com/${userPoolId}`] = ""
export const settings = {
    "cognito": {
        "identity_options": {
            "IdentityPoolId": getEnvVar("NPK_COGNITO_IDENTITY_POOL_ID"),
            "Logins": logins
        },
        "user_pool_config": {
            "UserPoolId": userPoolId,
            "ClientId": getEnvVar("NPK_COGNITO_CLIENT_ID")
        },
        "bot_user_creds": {
            "username": getEnvVar("NPK_COGNITO_USERNAME"),
            "password": getEnvVar("NPK_COGNITO_PASSWORD")
        }
    },

    "AWS_REGION": region,
    "USERDATA_BUCKET": getEnvVar("NPK_USERDATA_BUCKET"),
    "DICTIONARY_BUCKETS": {
        "us-east-1": "npk-dictionary-east-1-20181029005812833000000004-2",
        "us-east-2": "npk-dictionary-east-2-20181029005812776500000003-2",
        "us-west-1": "npk-dictionary-west-1-20181029005812746900000001-2",
        "us-west-2": "npk-dictionary-west-2-20181029005812750900000002-2"
    },
    "APIGATEWAY_URL": getEnvVar("NPK_APIGATEWAY_URL")
}