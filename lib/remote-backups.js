const fs = require('fs')
const R = require('ramda')
const { get } = require('@cullylarson/f')
const { retryOnRateLimit, listAllObjects } = require('./s3')
const { getLocalInfos } = require('./local-backups')
const { logImportances } = require('./utils')

const {
    nameFormatToRegex,
    backupSubFolderPathsFromDest,
    joinPrefix,
    frequencyPrefixesFromPrefix,
    sortInfoNewestFirst,
    objectInfoFromKey,
    objectKeyFromFileName,
} = require('./infos')

const {
    getPromotions,
    getExpiredInfos,
} = require('./utils')

// copies backups from daily to weekly, weekly to monthly, as needed
// objectInfos are assumed to be sorted, with youngest first
const promoteRemoteBackups = R.curry((logFn, today, s3, bucket, num, prefix, objectInfos) => {
    const promotions = getPromotions(today, num, objectInfos)

    return Promise.all([
        promotions.weekly ? promoteRemoteBackup(logFn, s3, bucket, promotions.weekly, 'weekly', prefix) : Promise.resolve(null),
        promotions.monthly ? promoteRemoteBackup(logFn, s3, bucket, promotions.monthly, 'monthly', prefix) : Promise.resolve(null),
    ])
        .then(R.filter(x => !!x))
        .then(R.reduce((acc, x) => R.append(x, acc), objectInfos))
        .then(sortInfoNewestFirst)
})

const promoteRemoteBackup = (logFn, s3, bucket, sourceInfo, destFrequency, prefix) => {
    const frequencyPrefixes = frequencyPrefixesFromPrefix(prefix)
    const newKey = joinPrefix([frequencyPrefixes[destFrequency], sourceInfo.name])
    const sourceKey = bucket + '/' + sourceInfo.key

    logFn(logImportances.VERBOSE, 'Promoting remote backup. ' + JSON.stringify({ Key: newKey, CopySource: sourceKey }))

    return retryOnRateLimit(() => s3.copyObject({
        Bucket: bucket,
        Key: newKey,
        CopySource: sourceKey,
    }).promise(), { logFn, numTries: 5, backoffMs: 30000 }) // Digitial Ocean only allows 2 COPY requests every 5 minutes, so going to try waiting that long. 30,000ms = 30s
        .then(() => {
            return Object.assign(
                {},
                sourceInfo,
                {
                    key: newKey,
                    prefix: frequencyPrefixes[destFrequency],
                    frequency: destFrequency,
                },
            )
        })
}

// objectInfos are assumed to be sorted, with youngest first
const removeExpiredRemoteBackups = R.curry((logFn, s3, bucket, num, objectInfos) => {
    const expiredInfos = getExpiredInfos(num, objectInfos)

    if(!expiredInfos.length) return Promise.resolve(objectInfos)

    const expiredKeys = expiredInfos.map(x => ({ Key: x.key }))

    logFn(logImportances.VERBOSE, 'Removing expired remote backups. ' + JSON.stringify({ Objects: expiredKeys }))

    return retryOnRateLimit(() => s3.deleteObjects({
        Bucket: bucket,
        Delete: {
            Objects: expiredKeys,
        },
    }).promise(), { logFn })
        .then(() => objectInfos.filter(x => {
            // only include objectInfos that aren't in expiredInfos
            return !expiredInfos.filter(y => x.key === y.key).length
        }))
})

const getRemoteInfosSingle = (logFn, s3, bucket, frequency, fileNameFormat, prefix) => {
    const frequencyPrefixes = frequencyPrefixesFromPrefix(prefix)
    const nameFormatPrefixed = joinPrefix([frequencyPrefixes[frequency], fileNameFormat])
    const nameFormatPrefixedRegex = nameFormatToRegex(nameFormatPrefixed)

    logFn(logImportances.VERBOSE, 'Getting remote infos single. ' + JSON.stringify({ Bucket: bucket, Prefix: frequencyPrefixes[frequency] }))

    return listAllObjects(s3, { Bucket: bucket, Prefix: frequencyPrefixes[frequency] }, { logFn })
        .then(R.map(get('Key', '')))
        .then(R.filter(x => nameFormatPrefixedRegex.test(x)))
        .then(R.map(objectInfoFromKey(frequency, fileNameFormat, prefix)))
}

const getRemoteInfos = (logFn, s3, bucket, fileNameFormat, prefix) => {
    return Promise.all([
        getRemoteInfosSingle(logFn, s3, bucket, 'daily', fileNameFormat, prefix),
        getRemoteInfosSingle(logFn, s3, bucket, 'weekly', fileNameFormat, prefix),
        getRemoteInfosSingle(logFn, s3, bucket, 'monthly', fileNameFormat, prefix),
    ])
        .then(R.flatten)
        .then(sortInfoNewestFirst)
}

const copyYoungestLocalBackupToRemote = (logFn, s3, bucket, localBackupDest, fileFormat, prefix) => {
    const localSubFolders = backupSubFolderPathsFromDest(localBackupDest)

    return getLocalInfos(
        fileFormat,
        localSubFolders.daily,
        localSubFolders.weekly,
        localSubFolders.monthly,
    )
        .then(get(0, null))
        .then(x => {
            if(!x) throw new Error('Cannot copy local backup to remote because there are no local backups.')
            return x
        })
        .then(localInfo => {
            const readStream = fs.createReadStream(localInfo.fullName)
            const key = objectKeyFromFileName(prefix, 'daily', localInfo.name)

            logFn(logImportances.VERBOSE, 'Uploading backup to remote. ' + JSON.stringify({ Key: key, fullName: localInfo.fullName }))

            return retryOnRateLimit(() => s3.upload({
                Bucket: bucket,
                Key: key,
                Body: readStream,
            }).promise(), { logFn, numTries: 2, backoffMs: 2000 })
                .then(_ => {
                    return {
                        key,
                        localFileNameFull: localInfo.fullName,
                    }
                })
        })
}

module.exports = {
    promoteRemoteBackups,
    removeExpiredRemoteBackups,
    getRemoteInfos,
    copyYoungestLocalBackupToRemote,
}
