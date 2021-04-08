# NPK Frenzy Plugin
This is a plugin to the [frenzy](https://github.com/Stage2Sec/frenzy.git) slack bot which allows you to utilize an NPK instance from within slack

## Frenzy setup
Add the plugin as a dependency to your frenzy instance
```shell
npm install @stage2sec/frenzy-npk-plugin
```

From within the frenzy typescript

TODO:
```typescript

```

Make sure these environment variables are set when running the frenzy server
```
NPK_COGNITO_IDENTITY_POOL_ID=your_cognito_identity_pool_id
NPK_COGNITO_USER_POOL_ID=your_cognito_user_pool_id
NPK_COGNITO_CLIENT_ID=your_cognito_app_client_id
NPK_COGNITO_USERNAME=your_cognito_bot_username
NPK_COGNITO_PASSWORD=your_cognito_bot_password
NPK_USERDATA_BUCKET=your_userdata_bucket
NPK_APIGATEWAY_URL=your_apigateway_url
NPK_AWS_REGION=us-west-2
```

## Usage
TODO: Add how to use in slack