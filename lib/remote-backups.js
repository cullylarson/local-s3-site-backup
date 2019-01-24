const fs = require('fs')
const R = require('ramda')
const { get } = require('@cullylarson/f')
const { listAllObjects } = require('./s3')
const { getLocalInfos } = require('./local-backups')

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
const promoteRemoteBackups = R.curry((today, s3, bucket, num, prefix, objectInfos) => {
    const promotions = getPromotions(today, num, objectInfos)

    return Promise.all([
        promotions.weekly ? promoteRemoteBackup(s3, bucket, promotions.weekly, 'weekly', prefix) : Promise.resolve(null),
        promotions.monthly ? promoteRemoteBackup(s3, bucket, promotions.monthly, 'monthly', prefix) : Promise.resolve(null),
    ])
        .then(R.filter(x => !!x))
        .then(R.reduce((acc, x) => R.append(x, acc), objectInfos))
        .then(sortInfoNewestFirst)
})

const promoteRemoteBackup = (s3, bucket, sourceInfo, destFrequency, prefix) => {
    const frequencyPrefixes = frequencyPrefixesFromPrefix(prefix)
    const newKey = joinPrefix([frequencyPrefixes[destFrequency], sourceInfo.name])

    return s3.copyObject({
        Bucket: bucket,
        Key: newKey,
        CopySource: bucket + '/' + sourceInfo.key,
    }).promise()
        .then(() => {
            return Object.assign(
                {},
                sourceInfo,
                {
                    key: newKey,
                    prefix: frequencyPrefixes[destFrequency],
                    frequency: destFrequency,
                }
            )
        })
}

// objectInfos are assumed to be sorted, with youngest first
const removeExpiredRemoteBackups = R.curry((s3, bucket, num, objectInfos) => {
    const expiredInfos = getExpiredInfos(num, objectInfos)

    if(!expiredInfos.length) return Promise.resolve(objectInfos)

    return s3.deleteObjects({
        Bucket: bucket,
        Delete: {
            Objects: expiredInfos.map(x => ({ Key: x.key })),
        },
    }).promise()
        .then(() => objectInfos.filter(x => {
            // only include objectInfos that aren't in expiredInfos
            return !expiredInfos.filter(y => x.key === y.key).length
        }))
})

const getRemoteInfosSingle = (s3, bucket, frequency, fileNameFormat, prefix) => {
    const frequencyPrefixes = frequencyPrefixesFromPrefix(prefix)
    const nameFormatPrefixed = joinPrefix([frequencyPrefixes[frequency], fileNameFormat])
    const nameFormatPrefixedRegex = nameFormatToRegex(nameFormatPrefixed)

    return listAllObjects(s3, { Bucket: bucket, Prefix: frequencyPrefixes[frequency] })
        .then(R.map(get('Key', '')))
        .then(R.filter(x => nameFormatPrefixedRegex.test(x)))
        .then(R.map(objectInfoFromKey(frequency, fileNameFormat, prefix)))
}

const getRemoteInfos = (s3, bucket, fileNameFormat, prefix) => {
    return Promise.all([
        getRemoteInfosSingle(s3, bucket, 'daily', fileNameFormat, prefix),
        getRemoteInfosSingle(s3, bucket, 'weekly', fileNameFormat, prefix),
        getRemoteInfosSingle(s3, bucket, 'monthly', fileNameFormat, prefix),
    ])
        .then(R.flatten)
        .then(sortInfoNewestFirst)
}

const copyYoungestLocalBackupToRemote = (s3, bucket, localBackupDest, fileFormat, prefix) => {
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

            return s3.upload({
                Bucket: bucket,
                Key: key,
                Body: readStream,
            }).promise()
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
