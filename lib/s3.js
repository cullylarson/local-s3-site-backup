// wrap an S3 call with this function to retry a call if it
// fails because it was rate-limited. will do an exponential backoff
// on each fail.
const retryOnRateLimit = (
    f, // will this function on each retry. expected to return a promise
    numTries = 6, // setting this to 1 will mean the function is tried once; a total of one run (not tried once and then retried once for a total of two runs).
    backoffMs = 100, // wait this long after each fail. if multiple fails in a row, will double this amount in between
    backoffMaxMs = 5000, // if backing off, will never wait longer than this.
) => {
    let numTried = 0
    let backoff = 0

    const wait = ms => new Promise((resolve) => {
        setTimeout(resolve, ms)
    })

    const retry = (lastErr) => {
        if(numTried === numTries) {
            if(lastErr) throw lastErr
            else throw Error('Unknown error.')
        }

        return wait(backoff)
            .then(f)
            .catch(err => {
                if(err.code === 'SlowDown') {
                    numTried++

                    if(backoff === 0) backoff = backoffMs
                    else backoff *= 2

                    if(backoff > backoffMaxMs) backoff = backoffMaxMs

                    return retry(err)
                }
                else {
                    throw err
                }
            })
    }

    return retry()
}

const listAllObjects = (s3, params) => {
    return retryOnRateLimit(() => s3.listObjectsV2(params).promise())
        .then(({ Contents, IsTruncated, NextContinuationToken }) => {
            return IsTruncated && NextContinuationToken
                ? listAllObjects(s3, Object.assign({}, params, { ContinuationToken: NextContinuationToken }))
                    .then(x => Contents.concat(x))
                : Contents
        })
}

module.exports = {
    retryOnRateLimit,
    listAllObjects,
}
