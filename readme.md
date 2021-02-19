# Local and S3 Site Backup

> A script to back up websites locally and to S3.

## Description

Makes local and remote backups of a database and a folder. Uses S3 for remote backups. Will only ever create a daily backup. Other backup frequencies (weekly, monthly) are made from copying a daily backup. So, if you have a bunch of local backups and you enable e.g. three weekly and 2 montly S3 backups, even if those backups are available locally, they won't all be copied. Only one daily backup will be copied at a time. Eventually the remote backups will build up to the weekly and monthly quotas listed in the config. So the config more defines what should be *kept* rather than what should be *created*.

## Setup

1. Clone the repo.
2. `npm install`
3. The backup script requires a config file to run. Copy `config-dist.json` to a location outside the project folder. Create one file for each site you want to back up and set its values appropriately.
4. Add a cron job for each site you want to back up.

### Config

These are the config file parameters. All of them must be set. Though if you don't provide he `db` or `files` property, the corresponding backup won't be made. If you change any parameters related to the naming or location of backup files (e.g `backupDest`, `backupFileFormat`, `endpoint`, `bucket`, `dbPrefix`, `filesPrefix`), backups previously made will no longer be recognized.

- **name**. A name used in log files. For example: `Example Site`
- **db**. information file database backups.
    - **user**. The database username.
    - **pass**. The database password.
    - **name**. The database name.
    - **host**. The database host.
    - **port**. The database port.
    - **backupDest**. The absolute path to the folder to store database backups. Folders named 'daily', 'weekly', and 'montly' will be created in this folder. For example: `/home/me/backups/example.com/db`)
    - **backupFileFormat**. The format of database backup files. Can, and must, use `[DATE]` (case sensitive) in the format, and it will be replaced with the data in the format `yyyyMMdd`. Do not include a file extension, this will be addd automatically. This must be different from `files.backupFileFormat`. For example:`example.com-db-[DATE]`)
    - **isMariaDb**. Set this to a non-falsey value of this is a MariaDB database. The backup for MariaDB works slightly differently than for MySQL.
    - **symmetricKey**. If you want to encrypt the backup file, provide a symmetric key here. It should be 256 bits, base64. It requires the `openssql` command (version 1.1.1).
    - **encryptionIterationCount** *(int, default: 2000000)*. If you are using symmetricKey, you may want to pass this value. It's what will be passed to the `openssql dec -iter` parameter. This app has a default value that is probably high enough. But if you want to change it, provide it here.
- **files**. Information for file backups.
    - **source**. The absolute path to the site files. For example: `/home/me/example.com`)
    - **backupDest**. The absolute path to the folder to store file backups. Folders named 'daily', 'weekly', and 'montly' will be created in this folder. For example: `/home/me/backups/example.com/files`)
    - **backupFileFormat**. The format of file backup files. Can, and must, use `[DATE]` (case sensitive) in the format, and it will be replaced with the data in the format `yyyyMMdd`. Do not include a file extension, this will be addd automatically. This must be different from `db.backupFileFormat`. For example:`example.com-files-[DATE]`)
    - **symmetricKey**. If you want to encrypt the backup file, provide a symmetric key here. It should be 256 bits, base64. It requires the `openssql` command (version 1.1.1).
    - **encryptionIterationCount** *(int, default: 2000000)*. If you are using symmetricKey, you may want to pass this value. It's what will be passed to the `openssql dec -iter` parameter. This app has a default value that is probably high enough. But if you want to change it, provide it here.
- **local**. Information about local backups.
    - **num**. The number of backups to keep.
        - **daily**. The number of daily backups to keep.
        - **weekly**. The number of weekly backups to keep.
        - **monthly**. The number of montly backups to keep.
- **s3**. Information about the S3 account used to store remote backups.
    - **num**. The number of backups to keep.
        - **daily**. The number of daily backups to keep.
        - **weekly**. The number of weekly backups to keep.
        - **monthly**. The number of montly backups to keep.
    - **accessKeyId** and **secretAccessKey**. Used to authenticate access to the S3 account.
    - **endpoint**. The endpoint used to access S3. For example: `sfo2.digitaloceanspaces.com`
    - **bucket**. The name of the bucket to store backups in.
    - **dbPrefix**. All database backup objects stored in the S3 bucket will be prefixed with this value. If you are storing backups for multiple sites in the same bucket, use this to differentiate them. Prefixes 'daily/', 'weekly/', and 'monthly/' will be added to this prefix. For example: `backups/example.com/db/`
    - **filesPrefix**. All files backup objects stored in the S3 bucket will be prefixed with this value. If you are storing backups for multiple sites in the same bucket, use this to differentiate them. Prefixes 'daily/', 'weekly/', and 'monthly/' will be added to this prefix. For example: `backups/example.com/files/`

### Encryption

Requires: openssl 1.1.1

It is possible to encrypt backup files using a symmetric key. You can generate a symmetic key using this command:

```bash
openssl rand -base64 32
```

### Decryption

In order to decrypt your files, run something like this (change the `-iter` value to whatever you passed as the `encryptionIterationCount` parameter):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 2000000 -in path/to/backup-file.tar.gz.enc -out path/to/backup-file.tar.gz -pass pass:<the-symmetric-key-you-provided-to-encrypt>
```

If you don't want your key to be saved to the command history, you can either put a space before the command (the command won't be saved to history) or put the key in a file and run:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 2000000 -in path/to/backup-file.tar.gz.enc -out path/to/backup-file.tar.gz -pass file:path/to/key-file.txt
```

### cron

Since many S3 service providers rate limit requests, it's a good idea to put all of your backup commands into a single bash script so that they run sequentially, and run that script as your cron job. If you want to run them concurrently or just use cron scheduler to manage when they run, your cron file would look something like this:

```
# Backup example.com / Every day @ 3 am
0 3 * * * node /path/to/do-backup.js /path/to/config-example.com.json >> /path/to/log-file.txt

# Backup cullylarson.com / Every day @ 3:10 am
10 3 * * * node /path/to/do-backup.js /path/to/config-cullylarson.com.json >> /path/to/log-file.txt
```

This will append all messages to `log-file.txt`. If you leave that out, the messages will be emailed to you by cron.

## Dev

```
npm install
npm run watch
npm run test
cp config-dist.json config.json
vim config.json
docker-compose up -d
```

You will need to run the backup script (`do-backup.js`) inside the Docker container unless you have `mysqldump` running locally. Or you can just put your config in `config.json` and run `npm run do-backup:test`
