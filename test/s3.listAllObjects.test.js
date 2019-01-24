const { listAllObjects } = require('../lib/s3')

test('Returns all results on multiple continuations', () => {
    expect.assertions(1)

    let numCalls = 0

    const s3 = {
        listObjectsV2: params => {
            numCalls++

            return {
                promise: () => {
                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            if(numCalls === 3) {
                                resolve({
                                    Contents: [numCalls],
                                    IsTruncated: false,
                                })
                            }
                            else {
                                resolve({
                                    Contents: [numCalls],
                                    IsTruncated: true,
                                    NextContinuationToken: 'blah',
                                })
                            }
                        }, 200)
                    })
                },
            }
        },
    }

    return listAllObjects(s3, {})
        .then(xs => {
            expect(xs).toEqual([1, 2, 3])
        })
})
