const path = require('path')
const { spawn } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const R = require('ramda')
const { map, isObject } = require('@cullylarson/f')
const dateFns = require('date-fns')

const readdir = promisify(fs.readdir)

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

const execSane = (command, args, options) => {
    return new Promise((resolve, reject) => {
        const cmdSpawned = spawn(command, args, options)

        let stdout = ''
        let stderr = ''

        cmdSpawned.stdout.on('data', (data) => {
            stdout += data
        })

        cmdSpawned.stderr.on('data', (data) => {
            stderr += data
        })

        cmdSpawned.on('close', (code) => {
            if(code) {
                const err = new Error(`Process exited with code: ${code}`)
                err.code = code
                err.stderr = stderr
                err.stdout = stdout

                reject(err)
            }
            else {
                resolve({ stdout, stderr })
            }
        })
    })
}

const pipe = xs => {
    if(!xs.length) throw Error('Must have at least one item to pipe.')

    // don't do this to the last item (length - 1)
    for(let i = 0; i < xs.length - 1; i++) {
        xs[i].stdout.pipe(xs[i + 1].stdin)
    }

    return xs[xs.length - 1] // return the last item
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
    const today = dateFns.startOfDay(new Date())

    // make a local back up if no backups, or last was made before today
    return !fileInfos.length || dateFns.isBefore(fileInfos[0].date, today)
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
    return new Promise((resolve, reject) => {
        const today = dateFns.startOfDay(new Date())
        const destFilename = path.join(dest, nameFormatToFileName(fileNameFormat, today))
        const destStream = fs.createWriteStream(destFilename, { flags: 'w' })

        const cmdStream = pipe([
            // spawn('mysqldump', ['-u', user, '--password=' + pass, '-P', port, name]),
            spawn('ls', ['-al']), // stub -- also, uncomment line above
            spawn('gzip', ['-']),
        ])

        cmdStream.stdout.pipe(destStream)

        cmdStream.on('close', (code) => {
            if(code) {
                reject(new Error(`Database backup process exited with code ${code}.`))
            }
            else {
                resolve(destFilename)
            }
        })
    })
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
}
