import { BlobServiceClient, ContainerClient, BlobClient, BlockBlobClient, RestError } from '@azure/storage-blob'
import * as url from 'url'
import { TimeSpan } from './timespan'
import { Configuration, Client, CleanupOptions, UploadOptions } from './base'

export class SASToken {
    sasToken: string

    constructor(sasToken: string) {
        this.sasToken = sasToken
    }
}

export class ConnectionString {
    connectionString: string

    constructor(connectionString: string) {
        this.connectionString = connectionString
    }
}

export class AzureStorageConfiguration extends Configuration {
    account: string
    container: string
    credential: SASToken | ConnectionString

    constructor(account: string, container: string, credential: SASToken | ConnectionString) {
        super()
        this.account = account
        this.container = container
        this.credential = credential
    }
}

export class AzureStorageClient extends Client {
    configuration: AzureStorageConfiguration
    client: BlobServiceClient

    constructor(configuration: AzureStorageConfiguration) {
        super()
        this.configuration = configuration

        if (configuration.credential instanceof SASToken) {
            this.client = new BlobServiceClient(
                `https://${configuration.account}.blob.core.windows.net${configuration.credential.sasToken}`)
        } else {
            this.client = BlobServiceClient.fromConnectionString(configuration.credential.connectionString)
        }
    }

    private getContainerClient(): ContainerClient {
        return this.client.getContainerClient(this.configuration.container)
    }

    private getBlobClient(name: string): BlockBlobClient {
        return this.getContainerClient().getBlobClient(name).getBlockBlobClient()
    }

    getBlobName(path: string): string {
        if (path.startsWith("http://") || path.startsWith("https://")) {
            const pathUrl = url.parse(path)

            if (!pathUrl.host || !pathUrl.path) {
                throw Error(`Path is malformed: ${path}`)
            }

            if (pathUrl.host.indexOf(".blob.core.windows.net")) {
                const containerName = pathUrl.path.substring(1, pathUrl.path.indexOf('/', 1))
                const blobName = pathUrl.path.substring(2 + (containerName?.length ?? 0))
                
                if (blobName) {
                    return blobName
                }
            }
        }

        throw Error(`Not a valid Azure storage path: ${path}`)
    }

    async createContainerIfNotExists(): Promise<void> {
        const containerClient = this.getContainerClient();

        if (!await containerClient.exists()) {
            await containerClient.create()
        }
    }

    async uploadFile(filePath: string, blobName: string, options?: UploadOptions): Promise<void> {
        const blobClient = this.getBlobClient(blobName)

        // TODO: Instead of timing out, get this to work with leasing.  The lease should keep renewing until the
        // upload finishes, and we can check if there is an active lease to determine if another process is uploading.

        // Check if the file already exists. If a 0-byte file exists, another process is uploading the file.
        if (await blobClient.exists()) {
            const blobProperties = await blobClient.getProperties()
            const timeout = new TimeSpan(5 * 60 * 1000)

            if (blobProperties.contentLength == 0) {
                if (blobProperties.lastModified && TimeSpan.fromDates(new Date(), blobProperties.lastModified).isGreaterThan(timeout)) {
                    console.log(`${blobName} was being upload by another prcess but it timed out, trying again`)
                } else {
                    console.log(`${blobName} is being upload by another process, skipping upload`)
                    return
                }
            } else {
                console.log(`${blobName} already exists`)
                return
            }
        }

        // First create an empty file so we can acquire a lease.
        await blobClient.upload("", 0)

        // Acquire the lease.
        const blobLeaseClient = blobClient.getBlobLeaseClient()

        try {
            let downloadFinished = false
            let lease = await blobLeaseClient.acquireLease(60)

            let renewLeaseCallback = () => {
                if (!downloadFinished) {
                    blobLeaseClient.renewLease().then((l) => {
                        console.log("Upload in progress, renewing lease")
                    })

                    setTimeout(renewLeaseCallback, 30000)
                }
            }

            setTimeout(renewLeaseCallback, 30000)

            // Upload the file.
            try {
                let metadata: { [propertyName: string]: string } = {}
                metadata["last_accessed"] = new Date().toUTCString()
                
                if (options && options.ttl) {
                    metadata["ttl"] = options.ttl
                }

                await blobClient.uploadFile(filePath, {
                    metadata: metadata,
                    conditions: {
                        leaseId: lease.leaseId
                    }
                })

                downloadFinished = true
            } finally {
                await blobLeaseClient.releaseLease()
            }
        } catch (error) {
            if (error instanceof RestError) {
                if (error.statusCode == 409) {
                    console.log(`${blobName} - Another process has the lease`)
                    return
                }
            }

            throw error
        }

        console.log(`${blobName} finished uploading`)
    }

    async downloadFile(blobName: string, filePath: string): Promise<void> {
        const blobClient = this.getBlobClient(blobName)
        await blobClient.downloadToFile(filePath);
    }

    async updateLastAccessedTime(blobName: string): Promise<void> {
        const blobClient = this.getBlobClient(blobName)
        const properties = await blobClient.getProperties()
        const metadata = properties.metadata ?? {}
        metadata["last_accessed"] = new Date().toUTCString()
        blobClient.setMetadata(metadata)
    }

    async cleanup(options?: CleanupOptions) {
        const containerClient = this.getContainerClient()

        for await (const blob of containerClient.listBlobsFlat({ includeMetadata: true })) {
            if (options?.verbose) {
                console.log(`${blob.name}`)
            }

            if (blob.metadata) {
                const ttl = blob.metadata["ttl"]
                const lastAccessed = blob.metadata["last_accessed"]

                if (ttl && lastAccessed) {
                    const age = new TimeSpan(Date.now() - Date.parse(lastAccessed))
                    const maxAge = TimeSpan.fromString(ttl)

                    if (options?.verbose) {
                        console.log(`  * Age: ${age}`)
                        console.log(`  * TTL: ${maxAge}`)
                    }

                    if (age.isGreaterThan(maxAge)) {
                        if (options?.verbose) {
                            console.log(`  * Action: Deleting blob, exceeds TTL`)
                        }

                       await this.getBlobClient(blob.name).delete()
                    } else {
                        if (options?.verbose) {
                            console.log(`  * Action: None, still alive`)
                        }
                    }
                }
            } else {
                if (options?.verbose) {
                    console.log(`  * Action: None, missing metadata`)
                }
            }
        }
    }
}
