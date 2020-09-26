const path = require('path')
const R = require('ramda')
const dateFns = require('date-fns')

const nameFormatToRegex = (nameFormat) => {
    return new RegExp('^' + nameFormat.replace('[DATE]', '([0-9]{4})([0-9]{2})([0-9]{2})') + '$')
}

const nameFormatToFileName = (nameFormat, date) => {
    return nameFormat.replace('[DATE]', dateFns.format(date, 'YYYYMMDD'))
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

const fileInfoFromName = R.curry((frequency, nameFormat, folder, fileName) => {
    const matches = nameFormatToRegex(nameFormat).exec(fileName)
    const folderNormalized = folder.replace(/\/$/, '')

    const dateStr = `${matches[1]}-${matches[2]}-${matches[3]}`
    const date = dateFns.parseISO(dateStr)

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

    const nameFormatPrefixed = objectKeyFromFileName(prefix, frequency, nameFormat)

    const matches = nameFormatToRegex(nameFormatPrefixed).exec(key)

    const dateStr = `${matches[1]}-${matches[2]}-${matches[3]}`
    const date = dateFns.parseISO(dateStr)

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

const addExtension = (name, extension) => {
    return [name, extension].join('.')
}

// just the name, not the path
const objectKeyFromFileName = (prefix, frequency, fileName) => {
    return joinPrefix([prefix, frequency, fileName])
}

const sortInfoNewestFirst = R.sort((a, b) => b.stamp - a.stamp)

module.exports = {
    nameFormatToRegex,
    nameFormatToFileName,
    backupSubFolderPathsFromDest,
    frequencyPrefixesFromPrefix,
    joinPrefix,
    fileInfoFromName,
    objectInfoFromKey,
    addExtension,
    objectKeyFromFileName,
    sortInfoNewestFirst,
}
