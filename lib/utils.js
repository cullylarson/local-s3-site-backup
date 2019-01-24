const R = require('ramda')
const { get } = require('@cullylarson/f')
const dateFns = require('date-fns')
const {
    fileInfoFromName,
    addExtension,
} = require('./infos')

const report = x => {
    console.log(x)
    return x
}

const reportM = R.curry((msg, x) => {
    console.log(msg, '---', x)
    return x
})

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

// fileInfos are assumed to be sorted, with the youngest first
const shouldMakeBackup = (today, fileInfos) => {
    // make a backup if no backups
    if(!fileInfos.length) return true

    const dailyInfos = fileInfos.filter(x => x.frequency === 'daily')

    // make a local backup if no daily backups, or last was made before today
    return !dailyInfos.length || dateFns.isBefore(dailyInfos[0].date, today)
}

// works on fileInfos and objectInfos
const getPromotions = (today, num, infos) => {
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

module.exports = {
    report,
    reportM,
    pipe,
    addExtension,
    shouldMakeBackup,
    fileInfoFromName,
    getExpiredInfos,
    getPromotions,
}
