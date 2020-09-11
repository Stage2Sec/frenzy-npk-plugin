import { Credentials, CognitoIdentityCredentials, config } from "aws-sdk"
import { CognitoUser, ICognitoUserPoolData, CognitoUserPool, AuthenticationDetails } from 'amazon-cognito-identity-js'
import aws4 from 'aws4'

import { settings } from "@npk/settings"
import { prepare } from "./http-utils"
import { setTimeout } from "timers"

interface AwsSignerOptions {
   region: string,
   service: string
}
interface AwsCredentials {
   accessKeyId: string,
   secretAccessKey: string,
   sessionToken: string
}
class AwsSigner {
   constructor(opt: any) {
      this.options = {
         region: opt.region,
         service: opt.service
      }
      this.credentials = {
         accessKeyId: opt.accessKeyId,
         secretAccessKey: opt.secretAccessKey,
         sessionToken: opt.sessionToken
      }
   }
   private options: AwsSignerOptions
   private credentials: AwsCredentials

   sign(params: any) {
      let options = {
         ...this.options,
         ...params
      }

      let signed = aws4.sign(options, this.credentials)
      return signed.headers
   }
}

export class NpkCognito {
   private cognitoConfig: ICognitoUserPoolData = settings.cognito.user_pool_config
   private cognitoIdentityOptions: any = settings.cognito.identity_options
   private userPool: CognitoUserPool = new CognitoUserPool(settings.cognito.user_pool_config)
   private cognitoUser: CognitoUser | null = null
   private cognitoSigner: AwsSigner
   private cognitoUserSession: any

   public async init() {
      await this.authenticateBotUser()
      await this.restoreSession()
      await this.retrieveCredentials()

      setTimeout(this.refreshSession.bind(this), this.sessionExpiresIn() - 300000)
   }

   private sessionExpiresIn() {
      let exp = new Date(this.cognitoUserSession.accessToken.payload.exp * 1000)
      let now = new Date()
      return exp.getTime() - now.getTime()
   }

   public signAPIRequest(params: any): any {
      prepare(params)
      params.headers = this.cognitoSigner.sign(params)
      return params
   }
   public isLoggedOn(): boolean {
      if (typeof this.cognitoUserSession.isValid == "function") {
         return this.cognitoUserSession.isValid();
      } else {
         return false;
      }
   }

   public async refreshSession() {
      try {
         await (new Promise((success, failure) => {
            if (!this.cognitoUser || !this.cognitoUserSession) {
               return failure("Not initialized!")
            }
            this.cognitoUser.refreshSession(this.cognitoUserSession.refreshToken, (error, session) => {
               if (error) {
                  return failure(error)
               }
               this.cognitoUserSession = session
               return success(true)
            })
         }))
         await this.retrieveCredentials()
         setTimeout(this.refreshSession.bind(this), this.sessionExpiresIn() - 300000)
      } catch (error) {
         console.error("Failed to refresh AWS session\n", error)
      }
   }

   public restoreSession(): Promise<boolean> {
      return new Promise((success, failure) => {
         this.cognitoUser = this.userPool.getCurrentUser();

         if (this.cognitoUser != null) {
            this.cognitoUser.getSession((err: any, session: any) => {
               if (err) {
                  return failure(err);
               }
               
               this.cognitoUserSession = session;

               return success(true);
            });
         } else {
            return failure('Unable to restore session.');
         }
      })
   }

   public authenticateBotUser(): Promise<any> {
      return new Promise((success, failure) => {
         let { username, password } = settings.cognito.bot_user_creds
         this.cognitoUser = new CognitoUser({
            "Username": username,
            "Pool": this.userPool
         });

         this.cognitoUser.authenticateUser(new AuthenticationDetails({
            "Username": username,
            "Password": password
         }), {
            onSuccess: function (result) {
               return success('Successfully Logged In');
            },

            onFailure: function (err) {
               return failure({
                  code: "AuthenticationFailure",
                  message: "Authentication Failed."
               });
            },

            newPasswordRequired: function (userAttributes, requiredAttributes) {
               return failure({
                  code: "ResetRequiredException",
                  message: "You must reset your password before logging on the first time."
               });
            }
         });
      });
   }

   public retrieveCredentials(): Promise<boolean> {
      return new Promise((success, failure) => {

         if (typeof this.cognitoUserSession.getIdToken != "function") {
            return failure('Not initialized');
         }

         this.cognitoIdentityOptions.Logins[Object.keys(this.cognitoIdentityOptions.Logins)[0]] = this.cognitoUserSession.getIdToken().getJwtToken();

         config.update({
            region: settings.AWS_REGION,
            credentials: new CognitoIdentityCredentials(this.cognitoIdentityOptions)
         });

         (config.credentials as Credentials)?.getPromise()
         .then((data) => {
            if (config.credentials && config.credentials.accessKeyId) {
               this.cognitoSigner = new AwsSigner({
                  accessKeyId: config.credentials.accessKeyId, // REQUIRED
                  secretAccessKey: config.credentials.secretAccessKey, // REQUIRED
                  sessionToken: config.credentials.sessionToken, //OPTIONAL: If you are using temporary credentials you must include the session token
                  region: config.region, // REQUIRED: The region where the API is deployed.
                  service: 'execute-api'
               });
            }

            return success(true);
         })
         .catch(error => {
            failure(error)
         });
      })
   }
}

export const npkCognito = new NpkCognito()