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

These are the config file parameters. All of them must be set. If you change any parameters related to the naming or location of backup files (e.g `backupDest`, `backupFileFormat`, `endpoint`, `bucket`, `dbPrefix`, `filesPrefix`), backups previously made will no longer be recognized.

- **name**. A name used in log files. For example: `Example Site`
- **db**. The username, password, database name, host, and port used to connect to MySQL to fetch the site's data.
    - **backupDest**. The absolute path to the folder to store database backups. Folders named 'daily', 'weekly', and 'montly' will be created in this folder. For example: `/home/me/backups/example.com/db`)
    - **backupFileFormat**. The format of database backup files. Can, and must, use `[DATE]` (case sensitive) in the format, and it will be replaced with the data in the format `YYYYMMDD`. Do not include a file extension, this will be addd automatically. This must be different from `files.backupFileFormat`. For example:`example.com-db-[DATE]`)
- **files**. Information for file backups.
    - **source**. The absolute path to the site files. For example: `/home/me/example.com`)
    - **backupDest**. The absolute path to the folder to store file backups. Folders named 'daily', 'weekly', and 'montly' will be created in this folder. For example: `/home/me/backups/example.com/files`)
    - **backupFileFormat**. The format of file backup files. Can, and must, use `[DATE]` (case sensitive) in the format, and it will be replaced with the data in the format `YYYYMMDD`. Do not include a file extension, this will be addd automatically. This must be different from `db.backupFileFormat`. For example:`example.com-files-[DATE]`)
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

### cron

Your cron file would look something like this:

```
# Backup Abound / Every day @ 3 am
0 3 * * * node /path/to/do-backup.js /path/to/config-example.com.json >> /path/to/log-file.txt

# Backup CoD / Every day @ 3:10 am
10 3 * * * node /path/to/do-backup.js /path/to/config-cullylarson.com.json >> /path/to/log-file.txt
```

## Dev

```
npm run watch
npm run test
docker-compose up -d
```

