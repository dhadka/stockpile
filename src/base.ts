export interface CleanupOptions {
    verbose?: boolean
}

export interface UploadOptions {
    ttl?: string
}

export abstract class Configuration {

}

export abstract class Client {
    abstract async createContainerIfNotExists(): Promise<void>
    abstract async uploadFile(filePath: string, blobName: string, options?: UploadOptions): Promise<void>
    abstract async downloadFile(blobName: string, filePath: string): Promise<void>
    abstract async updateLastAccessedTime(blobName: string): Promise<void>
    abstract async cleanup(options?: CleanupOptions): Promise<void>
}