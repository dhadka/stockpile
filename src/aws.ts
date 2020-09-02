import * as AWS from 'aws-sdk'
import * as url from 'url'
import * as fs from 'fs'
import { TimeSpan } from './timespan'
import { Configuration, Client, CleanupOptions, UploadOptions } from './base'

export class S3Configuration extends Configuration {
    bucket: string
    region: string
    apiVersion: string

    constructor(bucket: string, region: string, apiVersion: string = "2006-03-01") {
        super()
        this.bucket = bucket
        this.region = region
        this.apiVersion = apiVersion
    }
}

export class S3Client extends Client {
    configuration: S3Configuration
    client: AWS.S3

    constructor(configuration: S3Configuration) {
        super()
        this.configuration = configuration

        AWS.config.update({ region: configuration.region });
        this.client = new AWS.S3({ apiVersion: configuration.apiVersion });
    }

    getBlobName(path: string): string {
        if (path.startsWith("s3://") || path.startsWith("s3://")) {
            const pathUrl = url.parse(path)

            if (!pathUrl.host || !pathUrl.path) {
                throw Error(`Path is malformed: ${path}`)
            }

            return pathUrl.path.substring(1)
        }

        throw Error(`Not a valid S3 path: ${path}`)
    }

    async createContainerIfNotExists(): Promise<void> {
        // no-op
    }

    async uploadFile(filePath: string, blobName: string, options?: UploadOptions): Promise<void> {
        const stream = fs.createReadStream(filePath)
        stream.on('error', (e) => console.error(e))

        let metadata: { [key: string]: string } = {}
        metadata["last_accessed"] = new Date().toUTCString()
        
        if (options && options.ttl) {
            metadata["ttl"] = options.ttl
        }

        const uploadParams = {
            Bucket: this.configuration.bucket,
            Key: blobName,
            Body: stream,
            Metadata: metadata
        };

        this.client.upload(uploadParams)
    }

    async downloadFile(blobName: string, filePath: string): Promise<void> {
        const downloadParams = {
            Bucket: this.configuration.bucket,
            Key: blobName
        }

        const stream = fs.createWriteStream(filePath)
        this.client.getObject(downloadParams).createReadStream().pipe(stream)
    }

    async updateLastAccessedTime(blobName: string): Promise<void> {
        // TODO
    }

    async cleanup(options?: CleanupOptions) {
        const listParams = {
            Bucket : this.configuration.bucket,
        };

        const response = this.client.listObjects(listParams, (err, data) => {
            if (err) {
                console.error(err)
            } else {
                if (data.Contents) {
                    for (let object of data.Contents) {
                        console.log(object.Key)
                    }
                }
            }
        })

        // TODO: finish work on this
    }
}
