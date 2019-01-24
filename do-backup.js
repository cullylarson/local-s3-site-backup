const path = require('path')
const R = require('ramda')
const dateFns = require('date-fns')
const { S3 } = require('aws-sdk')
const { get } = require('@cullylarson/f')
const { objectInfoFromKey } = require('./lib/infos')
const {
    addExtension,
    shouldMakeBackup,
    fileInfoFromName,
} = require('./lib/utils')

const {
    getRemoteInfos,
    promoteRemoteBackups,
    removeExpiredRemoteBackups,
    copyYoungestLocalBackupToRemote,
} = require('./lib/remote-backups')

const {
    getLocalInfos,
    removeExpiredLocalBackups,
    promoteLocalBackups,
    makeDatabaseBackup,
    makeFilesBackup,
    ensureBackupDestSubFolders,
} = require('./lib/local-backups')

const exitError = (name, msg, err = undefined) => {
    const finalMessage = [
        '[' + dateFns.format(new Date(), 'YYYY-MM-DD HH:mm:SS') + ']',
        `[${name}]`,
        'ERROR:',
        msg,
        err
            ? `Got error: ${err}, ${err.stack}`
            : null,
    ]
        .filter(x => !!x)
        .join(' ')

    console.error(finalMessage)
    process.exit(1)
}

const notice = (name, msg) => {
    const finalMessage = [
        '[' + dateFns.format(new Date(), 'YYYY-MM-DD HH:mm:SS') + ']',
        `[${name}]`,
        msg,
    ]
        .join(' ')

    console.log(finalMessage)
}

const getConfig = (configFile) => {
    try {
        return require(configFile)
    }
    catch(e) {
        exitError('???', `Could not read config file: ${configFile}`, e)
    }
}

const verifyConfig = R.curry((configFile, config) => {
    const verifyRequired = (prefix, requiredParameters, config) => {
        if(prefix.length) {
            const value = get(prefix, null, config)

            if(value === null || value === undefined || value === '') {
                exitError(config.name, `The config file must have a value for ${prefix.join('.')} (${configFile})`)
            }
        }

        const subRequiredParameters = prefix.length
            ? get(prefix, {}, requiredParameters)
            : requiredParameters

        Object.keys(subRequiredParameters)
            .forEach(x => verifyRequired(R.append(x, prefix), requiredParameters, config))
    }

    const requiredParameters = {
        'name': {},
        'db': {
            'user': {},
            'pass': {},
            'name': {},
            'port': {},
            'backupDest': {},
            'backupFileFormat': {},
        },
        'files': {
            'source': {},
            'backupDest': {},
            'backupFileFormat': {},
        },
        'local': {
            'num': {
                'daily': {},
                'weekly': {},
                'monthly': {},
            },
        },
        's3': {
            'num': {
                'daily': {},
                'weekly': {},
                'monthly': {},
            },
            'accessKeyId': {},
            'secretAccessKey': {},
            'endpoint': {},
            'bucket': {},
            'dbPrefix': {},
            'filesPrefix': {},
        },
    }

    verifyRequired([], requiredParameters, config)

    if(config.db.backupFileFormat === config.files.backupFileFormat) {
        exitError(config.name, 'Config parameters db.backupFileFormat and files.backupFileFormat cannot have the same value.')
    }

    if(config.db.backupFileFormat.indexOf('[DATE]') === -1) {
        exitError(config.name, 'Config parameter db.backupFileFormat must contain [DATE] in its value.')
    }

    if(config.files.backupFileFormat.indexOf('[DATE]') === -1) {
        exitError(config.name, 'Config parameter files.backupFileFormat must contain [DATE] in its value.')
    }

    if(parseInt(config.local.num.daily) < 1) {
        exitError(config.name, 'Config parameter local.num.daily must be at least 1 (i.e. there must be at least one daily local backup).')
    }

    if(parseInt(config.s3.num.daily) < 1) {
        exitError(config.name, 'Config parameter s3.num.daily must be at least 1 (i.e. there must be at least one daily remote backup).')
    }

    return config
})

const makeLocalBackup = async (filesOrDatabaseForErrorMessage, today, configName, backupDest, fileFormat, num, makeBackup) => {
    const [dailyDest, weeklyDest, monthlyDest] = await ensureBackupDestSubFolders(backupDest)
        .catch(err => exitError(configName, `Failed while creating daily, weekly, monthly folders for ${filesOrDatabaseForErrorMessage} backups.`, err))

    return getLocalInfos(
        fileFormat,
        dailyDest,
        weeklyDest,
        monthlyDest,
    )
        .catch(err => exitError(configName, `Failed while reading local ${filesOrDatabaseForErrorMessage} backups folders.`, err))
        .then(infos => {
            if(shouldMakeBackup(today, infos)) {
                return makeBackup(dailyDest)
                    .catch(err => exitError(configName, `Failed while making ${filesOrDatabaseForErrorMessage} backup.`, err))
                    .then(backupFileName => {
                        notice(configName, `Made ${filesOrDatabaseForErrorMessage} backup: ${backupFileName}`)
                        return R.prepend(
                            fileInfoFromName('daily', fileFormat, path.dirname(backupFileName), path.basename(backupFileName)),
                            infos,
                        )
                    })
            }
            else {
                return infos
            }
        })
        .then(promoteLocalBackups(today, num, weeklyDest, monthlyDest))
        .then(removeExpiredLocalBackups(num))
        .catch(err => exitError(configName, `Unknown error while processing local ${filesOrDatabaseForErrorMessage} backups.`, err))
}

const makeRemoteBackup = async (filesOrDatabaseForErrorMessage, today, s3, configName, localBackupDest, bucket, fileFormat, num, prefix) => {
    // remote database backups
    return getRemoteInfos(s3, bucket, fileFormat, prefix)
        .catch(err => exitError(configName, `Failed while reading remote ${filesOrDatabaseForErrorMessage} backup objects.`, err))
        .then(infos => {
            if(shouldMakeBackup(today, infos)) {
                return copyYoungestLocalBackupToRemote(s3, bucket, localBackupDest, fileFormat, prefix)
                    .catch(err => exitError(configName, `Failed while copy ${filesOrDatabaseForErrorMessage} backup to remote.`, err))
                    .then(({ localFileNameFull, key }) => {
                        notice(configName, `Uploaded ${filesOrDatabaseForErrorMessage} backup ${localFileNameFull} to remote: ${key}`)
                        return R.prepend(
                            objectInfoFromKey('daily', fileFormat, prefix, key),
                            infos,
                        )
                    })
            }
            else {
                return infos
            }
        })
        .then(promoteRemoteBackups(today, s3, bucket, num, prefix))
        .then(removeExpiredRemoteBackups(s3, bucket, num))
        .catch(err => exitError(configName, `Unknown error while processing remote ${filesOrDatabaseForErrorMessage} backups.`, err))
}

async function main() {
    const today = dateFns.startOfDay(new Date())

    // don't perform backups async because we don't want one task's failure to kill the process while the other task is running.

    // local database backups
    await makeLocalBackup('database', today, config.name, config.db.backupDest, fileFormatWithExtension.db, config.local.num, (dailyDest) => {
        return makeDatabaseBackup(today, config.db.user, config.db.pass, config.db.name, config.db.port, fileFormatWithExtension.db, dailyDest)
    })

    // local files backups
    await makeLocalBackup('file', today, config.name, config.files.backupDest, fileFormatWithExtension.files, config.local.num, (dailyDest) => {
        return makeFilesBackup(today, config.files.source, fileFormatWithExtension.files, dailyDest)
    })

    const s3 = await new S3({
        apiVersion: '2006-03-01',
        endpoint: config.s3.endpoint,
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
    })

    // remote database backup
    await makeRemoteBackup('database', today, s3, config.name, config.db.backupDest, config.s3.bucket, fileFormatWithExtension.db, config.s3.num, config.s3.dbPrefix)

    // remote files backup
    await makeRemoteBackup('files', today, s3, config.name, config.files.backupDest, config.s3.bucket, fileFormatWithExtension.files, config.s3.num, config.s3.filesPrefix)
}

const configFile = get(2, null, process.argv)

if(!configFile) {
    exitError('???', 'You must provide the path to a config file.')
}

const config = R.compose(
    verifyConfig(configFile),
    getConfig,
)(configFile)

const compressedExtensions = {
    files: 'tar.gz',
    db: 'sql.gz',
}

const fileFormatWithExtension = {
    db: addExtension(config.db.backupFileFormat, compressedExtensions.db),
    files: addExtension(config.files.backupFileFormat, compressedExtensions.files),
}

main()
