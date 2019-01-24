const listAllObjects = (s3, params) => {
    return s3.listObjectsV2(params).promise()
        .then(({ Contents, IsTruncated, NextContinuationToken }) => {
            return IsTruncated && NextContinuationToken
                ? listAllObjects(s3, Object.assign({}, params, { ContinuationToken: NextContinuationToken }))
                    .then(x => Contents.concat(x))
                : Contents
        })
}

module.exports = {
    listAllObjects,
}
