const fs = require('fs')
const { promisify } = require('util')

module.exports.readdir = promisify(fs.readdir)
module.exports.unlink = promisify(fs.unlink)
module.exports.copyFile = promisify(fs.copyFile)

module.exports.mkdir = (folder, options) => {
    return new Promise((resolve, reject) => {
        fs.mkdir(folder, options, (err) => {
            if(err) reject(err)
            else resolve(folder)
        })
    })
}
