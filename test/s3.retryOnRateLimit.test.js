const { retryOnRateLimit } = require('../lib/s3')

const getRateLimitError = () => {
    const err = Error('Does not matter.')
    err.code = 'SlowDown'
    return err
}

const getNow = () => (new Date()).getTime()

test('Only tries once on success.', () => {
    expect.assertions(1)

    let numTries = 0

    const doIt = () => {
        numTries++
        return Promise.resolve()
    }

    return retryOnRateLimit(doIt)
        .then(() => {
            expect(numTries).toBe(1)
        })
})

test("Only tries once if throwing an exception that isn't rate limiting.", () => {
    expect.assertions(2)

    let numTries = 0

    const doIt = () => {
        numTries++

        const err = Error('asdf')
        err.code = 'mine'

        return Promise.reject(err)
    }

    return retryOnRateLimit(doIt)
        .catch(err => {
            expect(numTries).toBe(1)
            expect(err.code).toBe('mine')
        })
})

test('Only tries once if numTries is set to 1.', () => {
    expect.assertions(1)

    let numTries = 0

    const doIt = () => {
        numTries++
        return Promise.reject(getRateLimitError())
    }

    return retryOnRateLimit(doIt, { numTries: 1 })
        .catch(() => {
            expect(numTries).toBe(1)
        })
})

test('Retries on rate limit.', () => {
    expect.assertions(1)

    let numTries = 0

    const doIt = () => {
        numTries++
        if(numTries === 3) return Promise.resolve()
        else return Promise.reject(getRateLimitError())
    }

    return retryOnRateLimit(doIt, { numTries: 4, backoffMs: 1, backoffMaxMs: 100 })
        .then(() => {
            expect(numTries).toBe(3)
        })
})

test('Stops retrying after max retries reached.', () => {
    expect.assertions(1)

    let numTries = 0

    const doIt = () => {
        numTries++
        return Promise.reject(getRateLimitError())
    }

    return retryOnRateLimit(doIt, { numTries: 4, backoffMs: 1, backoffMaxMs: 100 })
        .catch(() => {
            expect(numTries).toBe(4)
        })
})

test('Backs off.', () => {
    expect.assertions(3)

    const backoff = 50
    const expectedTotalTime = 0 // try 1
        + backoff // try 2
        + (backoff * 2) // try 3
        + (backoff * 4) // try 4

    let numTries = 0
    let totalTime = 0
    let lastRunStamp = getNow()

    const doIt = () => {
        const now = getNow()
        totalTime += now - lastRunStamp
        lastRunStamp = now
        numTries++
        return Promise.reject(getRateLimitError())
    }

    return retryOnRateLimit(doIt, { numTries: 4, backoffMs: backoff, backoffMaxMs: 5000 })
        .catch(() => {
            expect(numTries).toBe(4)
            // these times won't be exact, so give it some buffer
            expect(totalTime).toBeGreaterThan(expectedTotalTime - 20)
            expect(totalTime).toBeLessThan(expectedTotalTime + 20)
        })
})

test('Backs off, but not more than max.', () => {
    expect.assertions(3)

    const limitBackoff = (backoff, backoffMax) => backoff > backoffMax ? backoffMax : backoff

    const backoff = 50
    const backoffMax = 200
    const expectedTotalTime = 0 // try 1
        + limitBackoff(backoff, backoffMax) // try 2 (50)
        + limitBackoff(backoff * 2, backoffMax) // try 3 (100)
        + limitBackoff(backoff * 4, backoffMax) // try 4 (200)
        + limitBackoff(backoff * 8, backoffMax) // try 5 (400)
        + limitBackoff(backoff * 16, backoffMax) // try 6 (800)

    let numTries = 0
    let totalTime = 0
    let lastRunStamp = getNow()

    const doIt = () => {
        const now = getNow()
        totalTime += now - lastRunStamp
        lastRunStamp = now
        numTries++
        return Promise.reject(getRateLimitError())
    }

    return retryOnRateLimit(doIt, { numTries: 6, backoffMs: backoff, backoffMaxMs: backoffMax })
        .catch(() => {
            expect(numTries).toBe(6)
            // these times won't be exact, so give it some buffer
            expect(totalTime).toBeGreaterThan(expectedTotalTime - 20)
            expect(totalTime).toBeLessThan(expectedTotalTime + 20)
        })
})
