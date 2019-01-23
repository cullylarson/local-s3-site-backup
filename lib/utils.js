const path = require('path')
const { spawn } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const R = require('ramda')
const { map, isObject, get } = require('@cullylarson/f')
const dateFns = require('date-fns')

const today = dateFns.startOfDay(new Date())

const readdir = promisify(fs.readdir)
const unlink = promisify(fs.unlink)
const copyFile = promisify(fs.copyFile)

const report = x => {
    console.log(x)
    return x
}

const reportM = R.curry((msg, x) => {
    console.log(msg, '---', x)
    return x
})

const mkdir = (folder, options) => {
    return new Promise((resolve, reject) => {
        fs.mkdir(folder, options, (err) => {
            if(err) reject(err)
            else resolve(folder)
        })
    })
}

const pipe = (procs, outputStream) => {
    return new Promise((resolve, reject) => {
        if(!procs.length) {
            reject(Error('Must have at least one item to pipe.'))
            return
        }

        let errors = []
        procs.forEach((x, i) => {
            x.on('error', err => {
                errors.push(err.toString())
            })
            x.stderr.on('data', data => {
                errors.push(data.toString())
            })
        })

        // pipe everything together
        // don't do this to the last item (length - 1)
        for(let i = 0; i < procs.length - 1; i++) {
            procs[i].stdout.pipe(procs[i + 1].stdin)
        }

        const lastProc = procs[procs.length - 1]

        if(outputStream) {
            lastProc.stdout.pipe(outputStream)
        }

        const streamForClose = outputStream || lastProc

        streamForClose.on('close', (code) => {
            if(errors.length) {
                reject(errors.join('\n'))
            }
            else if(code) {
                reject(new Error(`Process exited with code ${code}.`))
            }
            else {
                resolve()
            }
        })
    })
}

const backupSubFolderPathsFromDest = backupDest => {
    return {
        daily: path.join(backupDest, 'daily'),
        weekly: path.join(backupDest, 'weekly'),
        monthly: path.join(backupDest, 'monthly'),
    }
}

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

// parseInt's all values of an object. if any value is an object, will also pareeInt its children.
const parseIntObj = obj => {
    return map((x) => {
        return isObject(x)
            ? parseIntObj(x)
            : parseInt(x)
    }, obj)
}

const addExtension = (name, extension) => {
    return [name, extension].join('.')
}

const nameFormatToRegex = (nameFormat) => {
    return new RegExp('^' + nameFormat.replace('[DATE]', '([0-9]{4})([0-9]{2})([0-9]{2})') + '$')
}

const nameFormatToFileName = (nameFormat, date) => {
    return nameFormat.replace('[DATE]', dateFns.format(date, 'YYYYMMDD'))
}

const getLocalBackups = (nameFormat, folder) => {
    const nameFormatRegex = nameFormatToRegex(nameFormat)

    return readdir(folder)
        .then(R.filter(R.test(nameFormatRegex)))
}

const fileInfoFromName = R.curry((frequency, nameFormat, folder, fileName) => {
    const matches = nameFormatToRegex(nameFormat).exec(fileName)
    const folderNormalized = folder.replace(/\/$/, '')

    const dateStr = `${matches[1]}-${matches[2]}-${matches[3]}`
    const date = dateFns.parse(dateStr)

    return {
        name: fileName,
        fullName: [folderNormalized, fileName].join('/'),
        folder: folderNormalized,
        dateStr,
        date,
        year: parseInt(matches[1]),
        month: parseInt(matches[2]),
        day: parseInt(matches[3]),
        stamp: date.getTime(),
        frequency,
    }
})

const sortInfoNewestFirst = R.sort((a, b) => b.stamp - a.stamp)

// fileInfos are assumed to be sorted, with the youngest first
const shouldMakeLocalBackup = (fileInfos) => {
    // make a backup if no backups
    if(!fileInfos.length) return true

    const dailyInfos = fileInfos.filter(x => x.frequency === 'daily')

    // make a local backup if no daily backups, or last was made before today
    return !dailyInfos.length || dateFns.isBefore(dailyInfos[0].date, today)
}

// localInfos and remoteInfos are assumed to be sorted, with the youngest first
const shouldSendRemoteBackup = (localInfos, remoteInfos) => {
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

const makeDatabaseBackup = (user, pass, name, port, fileNameFormat, dest) => {
    const destFilename = path.join(dest, nameFormatToFileName(fileNameFormat, today))
    const destStream = fs.createWriteStream(destFilename, { flags: 'w' })

    return pipe([
        // spawn('mysqldump', ['-u', user, '-P', port, name], {env: { MYSQL_PWD: pass }}),
        spawn('ls', ['-al']), // stub -- also, uncomment line above
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

const getLocalPromotions = (num, fileInfos) => {
    const dailyInfos = fileInfos.filter(x => x.frequency === 'daily')

    // no need to promote, or nothing to promote
    if(num.weekly === 0 || num.monthly === 0 || !dailyInfos.length) return { weekly: null, monthly: null }

    const sevenDaysAgo = dateFns.subDays(today, 7)
    const thirtyDaysAgo = dateFns.subDays(today, 30)

    const weeklyInfos = fileInfos.filter(x => x.frequency === 'weekly')
    const monthlyInfos = fileInfos.filter(x => x.frequency === 'monthly')

    const numWeekly = weeklyInfos.length
    const numMonthly = monthlyInfos.length

    const youngestDaily = dailyInfos[0]
    const youngestWeekly = numWeekly ? weeklyInfos[0] : null
    const youngestMonthly = numMonthly ? monthlyInfos[0] : null

    // need if: have a quota, don't yet have a weekly, or last weekly backup is at least 7 days old
    const needWeekly = num.weekly !== 0 && (!youngestWeekly || dateFns.isBefore(youngestWeekly, sevenDaysAgo) || dateFns.isEqual(youngestWeekly, sevenDaysAgo))
    // need if: have a quota, don't yet have a monthly, or last monthly backup is at least 30 days old
    const needMonthly = num.monthly !== 0 && (!youngestMonthly || dateFns.isBefore(youngestMonthly, thirtyDaysAgo) || dateFns.isEqual(youngestMonthly, thirtyDaysAgo))

    return {
        weekly: needWeekly ? youngestDaily : null,
        monthly: needMonthly ? youngestDaily : null,
    }
}

const promoteBackup = (sourceInfo, destFrequency, destFolder) => {
    const newFilePath = path.join(destFolder, sourceInfo.name)

    return copyFile(sourceInfo.fullName, newFilePath)
        .then(() => {
            return Object.assign(
                {},
                sourceInfo,
                {
                    name: path.basename(newFilePath),
                    fullName: newFilePath,
                    folder: path.dirname(newFilePath),
                    frequency: destFrequency,
                }
            )
        })
}

// copies backups from daily to weekly, weekly to monthly, as needed
// fileInfos are assumed to be sorted, with youngest first
const promoteLocalBackups = R.curry((num, weeklyDest, monthlyDest, fileInfos) => {
    const promotions = getLocalPromotions(num, fileInfos)

    return Promise.all([
        promotions.weekly ? promoteBackup(promotions.weekly, 'weekly', weeklyDest) : Promise.resolve(null),
        promotions.monthly ? promoteBackup(promotions.monthly, 'monthly', monthlyDest) : Promise.resolve(null),
    ])
        .then(R.filter(x => !!x))
        .then(R.reduce((acc, x) => R.append(x, acc), fileInfos))
        .then(sortInfoNewestFirst)
})

// fileInfos are assumed to be sorted, with youngest first
const getExpiredInfos = R.curry((num, fileInfos) => {
    return R.compose(
        get('expiredInfos', []),
        R.reduce((acc, x) => {
            const foundNum = acc.numFound[x.frequency] + 1

            return {
                numFound: Object.assign(
                    {},
                    acc.numFound,
                    {
                        [x.frequency]: foundNum,
                    },
                ),
                expiredInfos: foundNum > num[x.frequency]
                    ? R.append(x, acc.expiredInfos)
                    : acc.expiredInfos,
            }
        }, {
            numFound: {
                daily: 0,
                weekly: 0,
                monthly: 0,
            },
            expiredInfos: [],
        })
    )(fileInfos)
})

// fileInfos are assumed to be sorted, with youngest first
const removeExpiredLocalBackups = R.curry((num, fileInfos) => {
    const expiredInfos = getExpiredInfos(num, fileInfos)

    return Promise.all(expiredInfos.map(x => {
        return unlink(x.fullName)
            .then(() => x)
    }))
        .then(() => fileInfos.filter(x => {
            // only include fileInfos that aren't in expiredInfos
            return !expiredInfos.filter(y => x.fullName === y.fullName).length
        }))
})

const makeFilesBackup = (sourceFolder, fileNameFormat, destFolder) => {
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
    report,
    reportM,
    addExtension,
    shouldMakeLocalBackup,
    shouldSendRemoteBackup,
    ensureBackupDestSubFolders,
    getLocalInfos,
    makeDatabaseBackup,
    fileInfoFromName,
    removeExpiredLocalBackups,
    promoteLocalBackups,
    makeFilesBackup,
}
