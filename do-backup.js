const path = require('path')
const R = require('ramda')
const dateFns = require('date-fns')
const { S3 } = require('aws-sdk')
const { curry, get } = require('@cullylarson/f')
const { objectInfoFromKey } = require('./lib/infos')
const {
    addExtension,
    shouldMakeBackup,
    fileInfoFromName,
    logImportances,
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

const dateFormatStr = 'yyyy-MM-dd HH:mm:ss.SSSS'

const exitError = (name, msg, err = undefined) => {
    const finalMessage = [
        '[' + dateFns.format(new Date(), dateFormatStr) + ']',
        `[${name}]`,
        'ERROR:',
        msg,
        err
            ? `Got error: ${err}`
            : null,
        err && err.stack
            ? `\n${err.stack}`
            : null,
    ]
        .filter(x => !!x)
        .join(' ')

    console.error(finalMessage)
    process.exit(1)
}

const notice = curry((name, importance, msg) => {
    // only log errors
    if(options.onlyErrors) return
    // don't log VERBOSE
    if(!options.verbose && importance <= logImportances.GENERAL) return

    const finalMessage = [
        '[' + dateFns.format(new Date(), dateFormatStr) + ']',
        `[${name}]`,
        msg,
    ]
        .join(' ')

    console.log(finalMessage)
})

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

    // only required if 'db' is present in the config
    const dbRequiredParameters = {
        db: {
            user: {},
            pass: {},
            name: {},
            port: {},
            backupDest: {},
            backupFileFormat: {},
        },
        s3: {
            dbPrefix: {},
        },
    }

    // only required if 'files' is present in the config
    const filesRequireParameters = {
        files: {
            source: {},
            backupDest: {},
            backupFileFormat: {},
        },
        s3: {
            filesPrefix: {},
        },
    }

    const requiredParameters = {
        name: {},
        local: {
            num: {
                daily: {},
                weekly: {},
                monthly: {},
            },
        },
        s3: {
            num: {
                daily: {},
                weekly: {},
                monthly: {},
            },
            accessKeyId: {},
            secretAccessKey: {},
            endpoint: {},
            bucket: {},
        },
    }

    verifyRequired([], requiredParameters, config)

    if(!config.db && !config.files) {
        exitError(config.name, "You must at least provide settings for 'db' or 'files'. Neither was found.")
    }

    if(config.db) {
        verifyRequired([], dbRequiredParameters, config)
    }

    if(config.files) {
        verifyRequired([], filesRequireParameters, config)
    }

    if(config.db && config.files && config.db.backupFileFormat === config.files.backupFileFormat) {
        exitError(config.name, 'Config parameters db.backupFileFormat and files.backupFileFormat cannot have the same value.')
    }

    if(config.db && config.db.backupFileFormat.indexOf('[DATE]') === -1) {
        exitError(config.name, 'Config parameter db.backupFileFormat must contain [DATE] in its value.')
    }

    if(config.files && config.files.backupFileFormat.indexOf('[DATE]') === -1) {
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
                        notice(configName, logImportances.GENERAL, `Made ${filesOrDatabaseForErrorMessage} backup: ${backupFileName}`)
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
    return getRemoteInfos(notice(configName), s3, bucket, fileFormat, prefix)
        .catch(err => exitError(configName, `Failed while reading remote ${filesOrDatabaseForErrorMessage} backup objects.`, err))
        .then(infos => {
            if(shouldMakeBackup(today, infos)) {
                return copyYoungestLocalBackupToRemote(notice(configName), s3, bucket, localBackupDest, fileFormat, prefix)
                    .catch(err => exitError(configName, `Failed while copying ${filesOrDatabaseForErrorMessage} backup to remote.`, err))
                    .then(({ localFileNameFull, key }) => {
                        notice(configName, logImportances.GENERAL, `Uploaded ${filesOrDatabaseForErrorMessage} backup ${localFileNameFull} to remote: ${key}`)
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
        .then(promoteRemoteBackups(notice(configName), today, s3, bucket, num, prefix))
        .then(removeExpiredRemoteBackups(notice(configName), s3, bucket, num))
        .catch(err => exitError(configName, `Unknown error while processing remote ${filesOrDatabaseForErrorMessage} backups.`, err))
}

async function main() {
    const today = dateFns.startOfDay(new Date())

    // don't perform backups async because we don't want one task's failure to kill the process while the other task is running.

    // local database backups
    if(config.db) {
        await makeLocalBackup('database', today, config.name, config.db.backupDest, fileFormatWithExtension.db, config.local.num, (dailyDest) => {
            return makeDatabaseBackup(options.mariaDb, today, config.db.user, config.db.pass, config.db.name, config.db.host, config.db.port, fileFormatWithExtension.db, dailyDest)
        })
    }

    // local files backups
    if(config.files) {
        await makeLocalBackup('file', today, config.name, config.files.backupDest, fileFormatWithExtension.files, config.local.num, (dailyDest) => {
            return makeFilesBackup(today, config.files.source, fileFormatWithExtension.files, dailyDest)
        })
    }

    const s3 = await new S3({
        apiVersion: '2006-03-01',
        endpoint: config.s3.endpoint,
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
        httpOptions: {
            timeout: 600 * 1000, // 600s = 10m
        },
    })

    // remote database backup
    if(config.db) {
        await makeRemoteBackup('database', today, s3, config.name, config.db.backupDest, config.s3.bucket, fileFormatWithExtension.db, config.s3.num, config.s3.dbPrefix)
    }

    // remote files backup
    if(config.files) {
        await makeRemoteBackup('files', today, s3, config.name, config.files.backupDest, config.s3.bucket, fileFormatWithExtension.files, config.s3.num, config.s3.filesPrefix)
    }
}

const options = require('yargs')
    .usage('Usage: $0 [options] <config-file>')
    .help('h')
    .options({
        mariaDb: {
            describe: "Pass this flag if you're using maria db's mysqldump command.",
            default: false,
            type: 'boolean',
        },
        onlyErrors: {
            describe: "Only log error messages. Don't log progress messages.",
            default: false,
            type: 'boolean',
        },
        verbose: {
            describe: 'Show more logs.',
            default: false,
            type: 'boolean',
        },
    })
    .demandCommand(1) // makes the config file required
    .argv

const configFile = options._[0]

if(!configFile) {
    exitError('???', 'You must provide the path to a config file.')
}

const config = R.compose(
    verifyConfig(configFile),
    getConfig,
    x => /^\//.test(x) ? x : path.join(process.cwd(), x), // relative to cwd, or absolute
)(configFile)

const compressedExtensions = {
    files: 'tar.gz',
    db: 'sql.gz',
}

const fileFormatWithExtension = {
    db: config.db ? addExtension(config.db.backupFileFormat, compressedExtensions.db) : null,
    files: config.files ? addExtension(config.files.backupFileFormat, compressedExtensions.files) : null,
}

main()
