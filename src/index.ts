import * as url from 'url'
import { Client } from './base'
import { TimeSpan } from './timespan'
import { AzureStorageConfiguration, AzureStorageClient, SASToken, ConnectionString } from './azure'

export { Client, TimeSpan }

export class Stockpile {
    private constructor() {

    }

    static createClient(path: string): Client {
        if (path.startsWith("http://") || path.startsWith("https://")) {
            const pathUrl = url.parse(path)

            if (!pathUrl.host || !pathUrl.path) {
                throw Error(`Path is malformed: ${path}`)
            }

            if (pathUrl.host.indexOf(".blob.core.windows.net") >= 0) {
                const accountName = pathUrl.host.substring(0, pathUrl.host.indexOf('.'))
                const containerName = pathUrl.path.substring(1, pathUrl.path.indexOf('/', 1))
                let credential: SASToken | ConnectionString | undefined = undefined

                if (process.env["SAS_TOKEN"]) {
                    credential = new SASToken(process.env["SAS_TOKEN"])
                }

                if (process.env["CONNECTION_STRING"]) {
                    credential = new ConnectionString(process.env["CONNECTION_STRING"])
                }

                if (!accountName) {
                    throw Error(`Unable to parse account name from '${path}'`)
                }

                if (!containerName) {
                    throw Error(`Unable to parse container name from '${path}'`)
                }

                if (!credential) {
                    throw Error(`SAS_TOKEN environment variable not set`)
                }

                const configuration = new AzureStorageConfiguration(
                    accountName,
                    containerName,
                    credential)

                return new AzureStorageClient(configuration)
            }
        }

        throw Error(`Unsupported path '${path}'`)
    }
}
