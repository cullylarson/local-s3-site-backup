const fs = require('fs')
const R = require('ramda')
const { map, isObject, set } = require('@cullylarson/f')
const dateFns = require('date-fns')

const report = x => {
    console.log(x)
    return x
}

const reportM = R.curry((msg, x) => {
    console.log(msg, '---', x)
    return x
})

const readDir = (folder) => {
    return new Promise((resolve, reject) => {
        fs.readdir(folder, (err, files) => {
            if(err) reject(err)
            else resolve(files)
        })
    })
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

const getLocalBackups = (nameFormat, folder) => {
    const nameFormatRegex = nameFormatToRegex(nameFormat)

    return readDir(folder)
        .then(R.filter(R.test(nameFormatRegex)))
}

const fileInfoFromName = R.curry((nameFormat, folder, fileName) => {
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
    }
})

const sortInfoNewestFirst = R.sort((a, b) => b.stamp - a.stamp)

// adds the 'frequency' key to info object. frequency is infereed. frequency is how frequently this backup was made (e.g. is this a daily backup, a weekly backup, or a montly backup)
// fileInfos must be sorted, with the newest first
const augFrequency = (fileInfos) => {
    const today = dateFns.startOfToday()
    const sevenDaysAgo = dateFns.subDays(today, 7)

    const getFrequency = (lastFrequency, lastDate, info) => {
        // if younger than 7 days, always considered daily
        if(dateFns.isAfter(info.date, sevenDaysAgo)) {
            return 'daily'
        }

        // frequency is possibly 'daily' only if last frequency was daily, otherwise it has to be weekly or monthly
        if(lastFrequency === 'daily') {
            // const twoDayAfterInfo = dateFns.subDays(2)
            // is daily if within 2 days of last date
        }

        // otherwise, consider it monthly
        return 'monthly'
    }

    const result = R.reduce((acc, x) => {
        const frequency = getFrequency(x.lastFrequency, x.lastDate, x)

        const info = set('frequency', frequency, x)

        return {
            fileInfos: R.append(info, acc.fileInfos),
            lastDate: info.date,
            lastFrequency: frequency,
        }
    }, {
        fileInfos: [],
        lastDate: today,
        lastFrequency: 'daily',
    }, fileInfos)

    return result.fileInfos
}

const shouldMakeLocalBackup = (backupFrequency, fileInfos) => {
}

module.exports = {
    report,
    reportM,
    addExtension,
    getLocalBackups,
    fileInfoFromName,
    augFrequency,
    shouldMakeLocalBackup,
    parseIntObj,
    sortInfoNewestFirst,
}
