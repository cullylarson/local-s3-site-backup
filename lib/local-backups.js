const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const R = require('ramda')

const { readdir, unlink, copyFile, mkdir } = require('./file-utils')
const {
    pipe,
    getPromotions,
    getExpiredInfos,
} = require('./utils')

const {
    fileInfoFromName,
    sortInfoNewestFirst,
    nameFormatToFileName,
    nameFormatToRegex,
    backupSubFolderPathsFromDest,
} = require('./infos')

const getLocalBackups = (nameFormat, folder) => {
    const nameFormatRegex = nameFormatToRegex(nameFormat)

    return readdir(folder)
        .then(R.filter(R.test(nameFormatRegex)))
}

const getLocalInfosSingle = (frequency, fileNameFormat, backupDest) => {
    return getLocalBackups(fileNameFormat, backupDest)
        .then(R.map(fileInfoFromName(frequency, fileNameFormat, backupDest)))
}

const getLocalInfos = (fileNameFormat, dailyDest, weeklyDest, monthlyDest) => {
    return Promise.all([
        getLocalInfosSingle('daily', fileNameFormat, dailyDest),
        getLocalInfosSingle('weekly', fileNameFormat, weeklyDest),
        getLocalInfosSingle('monthly', fileNameFormat, monthlyDest),
    ])
        .then(R.flatten)
        .then(sortInfoNewestFirst)
}

const promoteLocalBackup = (sourceInfo, destFrequency, destFolder) => {
    const newFilePath = path.join(destFolder, sourceInfo.name)

    return copyFile(sourceInfo.fullName, newFilePath)
        .then(() => {
            return Object.assign(
                {},
                sourceInfo,
                {
                    fullName: newFilePath,
                    folder: path.dirname(newFilePath),
                    frequency: destFrequency,
                }
            )
        })
}

// copies backups from daily to weekly, weekly to monthly, as needed
// fileInfos are assumed to be sorted, with youngest first
const promoteLocalBackups = R.curry((today, num, weeklyDest, monthlyDest, fileInfos) => {
    const promotions = getPromotions(today, num, fileInfos)

    return Promise.all([
        promotions.weekly ? promoteLocalBackup(promotions.weekly, 'weekly', weeklyDest) : Promise.resolve(null),
        promotions.monthly ? promoteLocalBackup(promotions.monthly, 'monthly', monthlyDest) : Promise.resolve(null),
    ])
        .then(R.filter(x => !!x))
        .then(R.reduce((acc, x) => R.append(x, acc), fileInfos))
        .then(sortInfoNewestFirst)
})

// fileInfos are assumed to be sorted, with youngest first
const removeExpiredLocalBackups = R.curry((num, fileInfos) => {
    const expiredInfos = getExpiredInfos(num, fileInfos)

    if(!expiredInfos.length) return Promise.resolve(fileInfos)

    return Promise.all(expiredInfos.map(x => {
        return unlink(x.fullName)
            .then(() => x)
    }))
        .then(() => fileInfos.filter(x => {
            // only include fileInfos that aren't in expiredInfos
            return !expiredInfos.filter(y => x.fullName === y.fullName).length
        }))
})

const ensureBackupDestSubFolders = (backupDest) => {
    const subFolders = backupSubFolderPathsFromDest(backupDest)

    const makeIfNotExists = folder => {
        return mkdir(folder, { mode: 0o770 })
            .catch(err => {
                if(err.code === 'EEXIST') return folder
                else throw err
            })
    }

    return Promise.all([
        makeIfNotExists(subFolders.daily),
        makeIfNotExists(subFolders.weekly),
        makeIfNotExists(subFolders.monthly),
    ])
}

const makeDatabaseBackup = (today, user, pass, name, port, fileNameFormat, dest) => {
    const destFilename = path.join(dest, nameFormatToFileName(fileNameFormat, today))
    const destStream = fs.createWriteStream(destFilename, { flags: 'w' })

    return pipe([
        spawn('mysqldump', ['-u', user, '-P', port, name], { env: { MYSQL_PWD: pass } }),
        spawn('gzip', ['-']),
    ], destStream)
        .catch(err => {
            // try twice to remove the dest file, since it likely doesn't have anything useful in it
            return unlink(destFilename)
                .catch(() => {
                    return unlink(destFilename)
                        .catch(() => {
                            throw err
                        })
                })
                .then(() => {
                    throw err
                })
        })
        .then(() => destFilename)
}

const makeFilesBackup = (today, sourceFolder, fileNameFormat, destFolder) => {
    const destFilename = path.join(destFolder, nameFormatToFileName(fileNameFormat, today))
    const destStream = fs.createWriteStream(destFilename, { flags: 'w' })
    const sourceParentFolder = path.join(sourceFolder, '..')
    const sourceFolderRelative = path.basename(sourceFolder)

    return pipe([
        spawn('tar', ['cf', '-', sourceFolderRelative], { cwd: sourceParentFolder }), // sourceFolderRelative and cwd so that the tar doesn't contain the full path to the source folder
        spawn('gzip', ['-']),
    ], destStream)
        .catch(err => {
            // try twice to remove the dest file, since it likely doesn't have anything useful in it
            return unlink(destFilename)
                .catch(() => {
                    return unlink(destFilename)
                        .catch(() => {
                            throw err
                        })
                })
                .then(() => {
                    throw err
                })
        })
        .then(() => destFilename)
}

module.exports = {
    getLocalInfos,
    removeExpiredLocalBackups,
    promoteLocalBackups,
    makeDatabaseBackup,
    makeFilesBackup,
    ensureBackupDestSubFolders,
}