const dateFns = require('date-fns')
const { getPromotions } = require('../lib/utils')

test('Does not return promotion if none to make', () => {
    const today = dateFns.parseISO('2019-02-01')

    const num = {
        daily: 7,
        weekly: 4,
        monthly: 6,
    }

    const infos = [
        {
            date: dateFns.parseISO('2019-02-01'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-31'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-30'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-29'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-28'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-27'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-26'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-26'),
            frequency: 'weekly',
        },
        {
            date: dateFns.parseISO('2019-01-26'),
            frequency: 'monthly',
        },
    ]

    const result = getPromotions(today, num, infos)

    expect(result).toEqual({
        weekly: null,
        monthly: null,
    })
})

test('Returns weekly promotion', () => {
    const today = dateFns.parseISO('2019-02-01')

    const num = {
        daily: 7,
        weekly: 4,
        monthly: 6,
    }

    const infos = [
        {
            date: dateFns.parseISO('2019-02-01'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-31'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-30'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-29'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-28'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-27'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-26'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-25'),
            frequency: 'weekly',
        },
        {
            date: dateFns.parseISO('2019-01-03'),
            frequency: 'monthly',
        },
    ]

    const result = getPromotions(today, num, infos)

    expect(result).toEqual({
        weekly: infos[0],
        monthly: null,
    })
})

test('Returns monthly promotion', () => {
    const today = dateFns.parseISO('2019-02-01')

    const num = {
        daily: 7,
        weekly: 4,
        monthly: 6,
    }

    const infos = [
        {
            date: dateFns.parseISO('2019-02-01'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-31'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-30'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-29'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-28'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-27'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-26'),
            frequency: 'daily',
        },
        {
            date: dateFns.parseISO('2019-01-27'),
            frequency: 'weekly',
        },
        {
            date: dateFns.parseISO('2019-01-02'),
            frequency: 'monthly',
        },
    ]

    const result = getPromotions(today, num, infos)

    expect(result).toEqual({
        weekly: null,
        monthly: infos[0],
    })
})
