# Stockpile - Universal Storage for GitHub Actions

Stockpile aims to be a universal storage solution for GitHub Actions.  To achieve this, it provides basic storage
capabilities to transfer files between cloud storage providers and the local runner as well as tools to manage
those files.

## NodeJS Module

This repository contains the Stockpile NodeJS module that is [published to NPM](http://npmjs.com/package/gh-stockpile).
All of the corresponding GitHub Actions below are implemented using this NodeJS module.

## Actions

### Configuring

Stockpile is a "bring your own storage" solution.  Therefore, you are responsible for creating and maintaining the
cloud storage account as well as all costs associated with operating the storage account.  To security configure
Stockpile to use your storage account, first create secrets with the required connection information.  Then,
pass the secret to Stockpile as an environment variable.  For example, we could set the `SAS_TOKEN` environment
variable as follows:

```
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      SAS_TOKEN: ${{ secrets.SAS_TOKEN }}
    steps:
    - uses: dhadka/stockpile-copy@v1
      with:
        src: file.tgz
        dest: https://account_name.blob.core.windows.net/container_name/blob.tgz
```

See the appropriate section below for details on which environment variables to configure for different cloud
storage providers.

#### Azure Blob Storage

Generate a Shared Access Signature (SAS) token or a connection string using the Azure Portal.  At a minimum, you
must ensure the siganture grants read, write, list, and delete permission to containers and objects on blob storage.
Also be mindful of the expiration date.  Save the SAS token or connection string as a secret and assign it to the
`SAS_TOKEN` or `CONNECTION_STRING` environment variables.

### Stockpile-Copy

[Stockpile-Copy](http://github.com/dhadka/stockpile-copy) transfers files between cloud storage and the local
runner.  The `src` and `dest` paths are required.  One must point to a local file path and one must point to
a cloud storage path.  An optional `ttl` field can be given to control the duration a blob is retained.

```
    - uses: dhadka/stockpile-copy@v1
      with:
        src: file.tgz
        dest: https://<account_name>.blob.core.windows.net/<container_name>/file.tgz
        ttl: 90d
```

### Stockpile-Cleanup

When using the time-to-live (`ttl`) field, the cleanup job must be scheduled in order to actually move expired
content.  [Stockpile-Cleanup](http://github.com/dhadka/stockpile-cleanup) is the Action that performs the actual
cleanup.  The following is a complete workflow that runs cleanup once a day:

```
name: Cleanup

on:
  schedule:
    - cron: '0 0 * * *'

jobs:
  build:
    runs-on: ubuntu-latest
    
    env:
      SAS_TOKEN: ${{ secrets.SAS_TOKEN }}

    steps:
    - uses: dhadka/stockpile-cleanup@master
      with:
        path: https://<account_name>.blob.core.windows.net/<container_name>/
```