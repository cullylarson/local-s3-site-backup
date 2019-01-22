const { set } = require('@cullylarson/f')
const dateFns = require('date-fns')
const { augFrequency, fileInfoFromName } = require('../lib/utils')

const dateFormat = 'YYYYMMDD'

const testInfo = dateStr => fileInfoFromName('test-[DATE]', 'test', `test-${dateStr}`)

const testInfoWithFrequency = (dateStr, frequency) => {
    return set(
        'frequency',
        frequency,
        fileInfoFromName('test-[DATE]', 'test', `test-${dateStr}`),
    )
}

const buildInfoAndExpectedFromSummary = summary => {
    const summaryStrs = summary
        .map(x => set(0, dateFns.format(x[0], dateFormat), x))

    return {
        infos: summaryStrs.map(x => testInfo(x[0])),
        expected: summaryStrs.map(x => testInfoWithFrequency(x[0], x[1])),
    }
}

test('Identifies daily frequency', () => {
    const today = dateFns.startOfToday()

    const summary = [
        [dateFns.addDays(today, 1), 'daily'],
        [dateFns.addDays(today, 2), 'daily'],
        [dateFns.addDays(today, 3), 'daily'],
        [dateFns.addDays(today, 4), 'daily'],
        [dateFns.addDays(today, 5), 'daily'],
        [dateFns.addDays(today, 6), 'daily'],
        [dateFns.addDays(today, 7), 'daily'],
        [dateFns.addDays(today, 8), 'daily'],
        [dateFns.addDays(today, 9), 'daily'],
        [dateFns.addDays(today, 10), 'daily'],
        [dateFns.addDays(today, 11), 'daily'],
        [dateFns.addDays(today, 12), 'daily'],
        [dateFns.addDays(today, 13), 'daily'],
    ]

    const { infos, expected } = buildInfoAndExpectedFromSummary(summary)

    expect(augFrequency(infos)).toEqual(expected)
})
