import { BlobServiceClient, ContainerClient, BlobClient, BlockBlobClient, RestError } from '@azure/storage-blob'
import { TimeSpan } from './dateUtils'

export interface CleanupOptions {
    verbose?: boolean
}

export abstract class Configuration {

}

export class AzureStorageConfiguration extends Configuration {
    account: string
    container: string
    sasToken: string

    constructor(account: string, container: string, sasToken: string) {
        super()
        this.account = account
        this.container = container
        this.sasToken = sasToken
    }
}

export abstract class Client {
    abstract async createContainerIfNotExists(): Promise<void>
    abstract async uploadFile(filePath: string, blobName: string): Promise<void>
    abstract async downloadFile(blobName: string, filePath: string): Promise<void>
    abstract async updateLastAccessedTime(blobName: string): Promise<void>
    abstract async cleanup(options?: CleanupOptions): Promise<void>
}

export class AzureStorageClient extends Client {
    configuration: AzureStorageConfiguration
    client: any

    constructor(configuration: AzureStorageConfiguration) {
        super()
        this.configuration = configuration
        
        this.client = new BlobServiceClient(
            `https://${configuration.account}.blob.core.windows.net${configuration.sasToken}`)
    }

    private getContainerClient(): ContainerClient {
        return this.client.getContainerClient(this.configuration.container)
    }

    private getBlobClient(name: string): BlockBlobClient {
        return this.getContainerClient().getBlobClient(name).getBlockBlobClient()
    }

    async createContainerIfNotExists(): Promise<void> {
        const containerClient = this.getContainerClient();

        if (!await containerClient.exists()) {
            await containerClient.create()
        }
    }

    async uploadFile(filePath: string, blobName: string): Promise<void> {
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
                        console.log("Renewed lease for another 60 seconds")
                    })

                    setTimeout(renewLeaseCallback, 15000)
                }
            }

            setTimeout(renewLeaseCallback, 30000)

            // Upload the file.
            try {
                await blobClient.uploadFile(filePath, {
                    metadata: {
                        "ttl": "7d",
                        "last_accessed": new Date().toUTCString()
                    },
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
