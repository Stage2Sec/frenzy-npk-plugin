import { S3, config } from "aws-sdk"
import { basename } from "path"

export class NpkS3 {
    private s3: S3
    private s3w1: S3
    private s3w2: S3
    private s3e1: S3
    private s3e2: S3

    private replaceSelf(value: string) {
        return value.replace('self', (config.credentials as any)?.identityId);
    }

    public init() {
        this.s3 =  new S3()
        this.s3w1 = new S3({region: 'us-west-1'})
        this.s3w2 =  new S3({region: 'us-west-2'})
        this.s3e1 =  new S3({region: 'us-east-1'})
        this.s3e2 =  new S3({region: 'us-east-2'})
    }

    public s3ForRegion(region: string) {
        switch(region) {
            case 'us-west-1':
                return 's3w1'

            case 'us-west-2':
                return 's3w2'

            case 'us-east-1':
                return 's3e1'

            case 'us-east-2':
                return 's3e2'

            case undefined:
            case null:
            default:
                return 's3';
        }
    }

    public listBucketContents(bucket: string, path: string, region: string): Promise<S3.ListObjectsOutput> {
        path = this.replaceSelf(path)
        var params = {
            Bucket: bucket,
            Prefix: path,
            MaxKeys: 100
        };

        return new Promise((success, failure) => {
            this[this.s3ForRegion(region)].listObjects(params, (err, data) => {
                if (err) {
                    return failure(err);
                }

                return success(data);
            });
        });
    }

    public async listBucketFiles(bucket: string, path: string, region: string) {
        let files: Array<string> = []
        let result = await this.listBucketContents(bucket, path, region)
        if (result.Contents) {
            for (const content of result.Contents) {
                let key = content.Key || ""
                files.push(basename(key))
            }
        }
        
        return files
    }

    public putObject(bucket: string, key: string, data: any, region: string): Promise<S3.PutObjectOutput> {
        key = this.replaceSelf(key);
        var params = {
            Bucket: bucket,
            Key: key,
            Body: data,
            ContentType: "text/plain"
        }

        return new Promise((success, failure) => {
            this[this.s3ForRegion(region)].putObject(params, (err, result) => {
                if (err) {
                    console.log("Upload failed. " + err);
                    return failure(err)
                }
    
                console.log("Success");
                return success(result);
            })
        })
    }

    public getObject(bucket: string, key: string, region: string): Promise<S3.GetObjectOutput> {
        key = this.replaceSelf(key);
        var params = {
            Bucket: bucket,
            Key: key
        };

        return new Promise((success, failure) => {
            this[this.s3ForRegion(region)].getObject(params, (err, data) => {
                if (err) {
                    return failure(err);
                }

                return success(data);
            });
        });
    }

    public headObject(bucket: string, key: string, region: string): Promise<S3.HeadObjectOutput> {
        key = this.replaceSelf(key);
        var params = {
            Bucket: bucket,
            Key: key
        };

        return new Promise((success, failure) => {
            this[this.s3ForRegion(region)].headObject(params, (err, data) => {
                if (err) {
                    return failure(err);
                }

                return success(data);
            });
        });
    }

    public deleteObject(bucket: string, key: string, region: string): Promise<S3.DeleteObjectOutput> {
        key = this.replaceSelf(key);
        var params = {
            Bucket: bucket,
            Key: key
        };

        return new Promise((success, failure) => {
            this[this.s3ForRegion(region)].deleteObject(params, (err, data) => {
                if (err) {
                    return failure(err);
                }

                return success(data);
            });
        });
    }

    public getSignedUrl(action: string, params: any) {
        if (params.Key) {
            params.Key = this.replaceSelf(params.Key)
        }
        
        return this.s3.getSignedUrlPromise(action, params);
    }
}
export const npkS3 = new NpkS3()