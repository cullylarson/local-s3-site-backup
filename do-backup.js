const path = require('path')
const R = require('ramda')
const { get } = require('@cullylarson/f')
const {
    reportM,
    addExtension,
    ensureBackupDestSubFolders,
    getLocalInfos,
    shouldMakeLocalBackup,
    makeDatabaseBackup,
    fileInfoFromName,
} = require('./lib/utils')

const exitError = (msg, err = undefined) => {
    const finalMessage = [
        'ERROR:',
        msg,
        err
            ? `Got error: ${err}`
            : null,
    ]
        .filter(x => !!x)
        .join(' ')

    console.error(finalMessage)
    process.exit(1)
}

const getConfig = (configFile) => {
    try {
        return require(configFile)
    }
    catch(e) {
        exitError('Could not read config file.', e)
    }
}

const verifyConfig = (config) => {
    const verifyRequired = (prefix, requiredParameters, config) => {
        if(prefix.length) {
            const value = get(prefix, null, config)

            if(value === null || value === undefined || value === '') {
                exitError(`The config file must have a value for: ${prefix.join('.')}`)
            }
        }

        const subRequiredParameters = prefix.length
            ? get(prefix, {}, requiredParameters)
            : requiredParameters

        Object.keys(subRequiredParameters)
            .forEach(x => verifyRequired(R.append(x, prefix), requiredParameters, config))
    }

    const requiredParameters = {
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
        exitError('Config parameters db.backupFileFormat and files.backupFileFormat cannot have the same value.')
    }

    if(config.db.backupFileFormat.indexOf('[DATE]') === -1) {
        exitError('Config parameter db.backupFileFormat must contain [DATE] in its value.')
    }

    if(config.files.backupFileFormat.indexOf('[DATE]') === -1) {
        exitError('Config parameter files.backupFileFormat must contain [DATE] in its value.')
    }

    if(parseInt(config.local.num.daily) < 1) {
        exitError('Config parameter local.num.daily must be at least 1 (i.e. there must be at least one daily local backup).')
    }

    if(parseInt(config.s3.num.daily) < 1) {
        exitError('Config parameter s3.num.daily must be at least 1 (i.e. there must be at least one daily remote backup).')
    }

    return config
}

const configFile = get(2, null, process.argv)
const compressedExtensions = {
    files: 'tar.gz',
    db: 'sql.gz',
}

if(!configFile) {
    exitError('You must provide the path to a config file.')
}

const config = R.compose(
    verifyConfig,
    getConfig,
)(configFile)

const dbFileFormatWithExtension = addExtension(config.db.backupFileFormat, compressedExtensions.db)

// database backups
ensureBackupDestSubFolders(config.db.backupDest)
    .catch(err => exitError('Failed while creating daily, weekly, monthly folders for database backups.', err))
    .then(([dailyDest, weeklyDest, monthlyDest]) => {
        return getLocalInfos(
            dbFileFormatWithExtension,
            dailyDest,
            weeklyDest,
            monthlyDest,
        )
            .catch(err => exitError('Failed while reading local database backups folders.', err))
            .then(infos => {
                return shouldMakeLocalBackup(infos)
                    ? makeDatabaseBackup(config.db.user, config.db.pass, config.db.name, config.db.port, dbFileFormatWithExtension, dailyDest)
                        .catch(err => exitError('Failed while making database backup.', err))
                        .then(backupFileName => {
                            return R.prepend(
                                fileInfoFromName('daily', dbFileFormatWithExtension, path.dirname(backupFileName), path.basename(backupFileName)),
                                infos,
                            )
                        })
                    : infos
            })
            .then(reportM('local infos'))
    })
    .catch(err => exitError('Unknown error while processing local database backups.', err))
