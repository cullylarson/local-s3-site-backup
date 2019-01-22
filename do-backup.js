const R = require('ramda')
const { get } = require('@cullylarson/f')
const { getLocalBackups, addExtension, fileInfoFromName, reportM, augFrequency, sortInfoNewestFirst } = require('./lib/utils')

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

    return config
}

const configFile = get(2, null, process.argv)
const compressedExtension = 'tar.gz'

if(!configFile) {
    exitError('You must provide the path to a config file.')
}

const config = R.compose(
    verifyConfig,
    getConfig,
)(configFile)

// database backups
getLocalBackups(addExtension(config.db.backupFileFormat, compressedExtension), config.db.backupDest)
    .catch(err => exitError('Failed while reading local database backups folder.', err))
    .then(R.map(fileInfoFromName(addExtension(config.db.backupFileFormat, compressedExtension), config.db.backupDest)))
    .catch(err => exitError('Failed while parsing local database backup filenames.', err))
    .then(sortInfoNewestFirst)
    .then(augFrequency)
    .then(reportM('file infos'))
    .catch(err => exitError('Unknown.', err))
