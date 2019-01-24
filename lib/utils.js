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

const frequencyPrefixesFromPrefix = prefix => {
    return {
        daily: joinPrefix([prefix, 'daily']),
        weekly: joinPrefix([prefix, 'weekly']),
        monthly: joinPrefix([prefix, 'monthly']),
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

const objectInfoFromKey = R.curry((frequency, nameFormat, prefix, key) => {
    const frequencyPrefixes = frequencyPrefixesFromPrefix(prefix)
    const frequencyPrefix = frequencyPrefixes[frequency]

    const matches = nameFormatToRegex(nameFormat).exec(key)

    const dateStr = `${matches[1]}-${matches[2]}-${matches[3]}`
    const date = dateFns.parse(dateStr)

    return {
        name: key.replace(frequencyPrefix + '/', ''),
        key,
        prefix: frequencyPrefix,
        dateStr,
        date,
        year: parseInt(matches[1]),
        month: parseInt(matches[2]),
        day: parseInt(matches[3]),
        stamp: date.getTime(),
        frequency,
    }
})

// just the name, not the path
const objectKeyFromFileName = (prefix, frequency, fileName) => {
    return joinPrefix(prefix, frequency, fileName)
}

const sortInfoNewestFirst = R.sort((a, b) => b.stamp - a.stamp)

// fileInfos are assumed to be sorted, with the youngest first
const shouldMakeBackup = (fileInfos) => {
    // make a backup if no backups
    if(!fileInfos.length) return true

    const dailyInfos = fileInfos.filter(x => x.frequency === 'daily')

    // make a local backup if no daily backups, or last was made before today
    return !dailyInfos.length || dateFns.isBefore(dailyInfos[0].date, today)
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

const listAllObjects = (s3, params) => {
    return s3.listObjectsV2(params).promise()
        .then(({ Contents, IsTruncated, NextContinuationToken }) => {
            return IsTruncated
                ? listAllObjects(s3, Object.assign({}, params, { ContinuationToken: NextContinuationToken }))
                    .then(x => Contents.concat(x))
                : Contents
        })
}

const joinPrefix = (xs) => {
    return xs
        .map((x, i) => {
            if(xs.length === 1) return x

            return R.compose(
                // remote end slash for all but last item
                x => i !== xs.length - 1 ? x.replace(/\/$/, '') : x,
                // remote beginning slash for all but first item
                x => i !== 0 ? x.replace(/^\//, '') : x,
            )(x)
        })
        .join('/')
}

const getRemoteInfosSingle = (s3, bucket, frequency, prefix, fileNameFormat) => {
    const frequencyPrefixes = frequencyPrefixesFromPrefix(prefix)
    const nameFormatPrefixed = joinPrefix([frequencyPrefixes[frequency], fileNameFormat])
    const nameFormatPrefixedRegex = nameFormatToRegex(nameFormatPrefixed)

    return listAllObjects(s3, { Bucket: bucket, Prefix: prefix })
        .then(get('Key', ''))
        .then(R.filter(x => nameFormatPrefixedRegex.test(x)))
        .then(R.map(objectInfoFromKey(frequency, fileNameFormat, prefix)))
}

const getRemoteInfos = (s3, bucket, fileNameFormat, prefix) => {
    const frequencyPrefixes = frequencyPrefixesFromPrefix(prefix)

    return Promise.all([
        getRemoteInfosSingle('daily', fileNameFormat, frequencyPrefixes.daily),
        getRemoteInfosSingle('weekly', fileNameFormat, frequencyPrefixes.weekly),
        getRemoteInfosSingle('monthly', fileNameFormat, frequencyPrefixes.monthly),
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

// works on fileInfos and objectInfos
const getPromotions = (num, infos) => {
    const dailyInfos = infos.filter(x => x.frequency === 'daily')

    // no need to promote, or nothing to promote
    if(num.weekly === 0 || num.monthly === 0 || !dailyInfos.length) return { weekly: null, monthly: null }

    const sevenDaysAgo = dateFns.subDays(today, 7)
    const thirtyDaysAgo = dateFns.subDays(today, 30)

    const weeklyInfos = infos.filter(x => x.frequency === 'weekly')
    const monthlyInfos = infos.filter(x => x.frequency === 'monthly')

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
const promoteLocalBackups = R.curry((num, weeklyDest, monthlyDest, fileInfos) => {
    const promotions = getPromotions(num, fileInfos)

    return Promise.all([
        promotions.weekly ? promoteLocalBackup(promotions.weekly, 'weekly', weeklyDest) : Promise.resolve(null),
        promotions.monthly ? promoteLocalBackup(promotions.monthly, 'monthly', monthlyDest) : Promise.resolve(null),
    ])
        .then(R.filter(x => !!x))
        .then(R.reduce((acc, x) => R.append(x, acc), fileInfos))
        .then(sortInfoNewestFirst)
})

// works on fileInfos and objectInfos
// infos are assumed to be sorted, with youngest first
const getExpiredInfos = R.curry((num, infos) => {
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
    )(infos)
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

const ensureRemoteBucket = (s3, bucket) => {
    return s3.createBucket({
        Bucket: bucket,
        ACL: 'private',
    }).promise()
        .then(x => x.Location)
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

// copies backups from daily to weekly, weekly to monthly, as needed
// objectInfos are assumed to be sorted, with youngest first
const promoteRemoteBackups = R.curry((s3, bucket, num, prefix, objectInfos) => {
    const promotions = getPromotions(num, objectInfos)

    return Promise.all([
        promotions.weekly ? promoteRemoteBackup(s3, promotions.weekly, 'weekly', prefix) : Promise.resolve(null),
        promotions.monthly ? promoteRemoteBackup(s3, promotions.monthly, 'monthly', prefix) : Promise.resolve(null),
    ])
        .then(R.filter(x => !!x))
        .then(R.reduce((acc, x) => R.append(x, acc), objectInfos))
        .then(sortInfoNewestFirst)
})

const promoteRemoteBackup = (s3, bucket, sourceInfo, destFrequency, prefix) => {
    const frequencyPrefixes = frequencyPrefixesFromPrefix(prefix)
    const newKey = joinPrefix(frequencyPrefixes[destFrequency], sourceInfo.name)

    return s3.copyObject({
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

    return s3.deleteObjects({
        Bucket: bucket,
        Objects: expiredInfos.map(x => ({ Key: x.key })),
    }).promise()
        .then(() => objectInfos.filter(x => {
            // only include objectInfos that aren't in expiredInfos
            return !expiredInfos.filter(y => x.key === y.key).length
        }))
})

module.exports = {
    report,
    reportM,
    addExtension,
    shouldMakeBackup,
    ensureBackupDestSubFolders,
    getLocalInfos,
    makeDatabaseBackup,
    fileInfoFromName,
    removeExpiredLocalBackups,
    promoteLocalBackups,
    makeFilesBackup,
    getRemoteInfos,
    ensureRemoteBucket,
    copyYoungestLocalBackupToRemote,
    objectInfoFromKey,
    promoteRemoteBackups,
    removeExpiredRemoteBackups,
}
