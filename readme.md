# MAC S3 Backup

> A script to back up websites locally and to S3.

## Setup

1. Clone the repo.
2. `npm install`
3. The backup script requires a config file to run. Copy `config-dist.json` to a location outside the project folder. Create one file for each site you want to back up and set its values appropriately.
4. Add a cron job for each site you want to back up.

### Config

These are the config file parameters. All of them must be set. If you change any parameters related to the naming or location of backup files (e.g `backupDest`, `backupFileFormat`, `endpoint`, `bucket`, `dbPrefix`, `filesPrefix`), backups previously made will no longer be recognized.

- **name**. A name used in log files. For example: `Colleges of Distinction`
- **db**. The username, password, database name, and port used to connect to MySQL to fetch the site's data.
    - **backupDest**. The absolute path to the folder to store database backups. Folders named 'daily', 'weekly', and 'montly' will be created in this folder. For example: `/home/backups/abound/db`)
    - **backupFileFormat**. The format of database backup files. Can, and must, use `[DATE]` (case sensitive) in the format, and it will be replaced with the data in the format `YYYYMMDD`. Do not include a file extension, this will be addd automatically. This must be different from `files.backupFileFormat`. For example:`abound.college-db-[DATE]`)
- **files**. Information for file backups.
    - **source**. The absolute path to the site files. For example: `/home/abound/abound.college`)
    - **backupDest**. The absolute path to the folder to store file backups. Folders named 'daily', 'weekly', and 'montly' will be created in this folder. For example: `/home/backups/abound.college/files`)
    - **backupFileFormat**. The format of file backup files. Can, and must, use `[DATE]` (case sensitive) in the format, and it will be replaced with the data in the format `YYYYMMDD`. Do not include a file extension, this will be addd automatically. This must be different from `db.backupFileFormat`. For example:`abound.college-files-[DATE]`)
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
    - **endpoint**. The endpoint used to access S3. For example: `nyc3.digitaloceanspaces.com`
    - **bucket**. The name of the bucket to store backups in.
    - **dbPrefix**. All database backup objects stored in the S3 bucket will be prefixed with this value. If using slashes, you likely want to include a trailing slash. If you are storing backups for multiple sites in the same bucket, use this to differentiate them. Prefixes 'daily/', 'weekly/', and 'monthly/' will be added to this prefix. For example: `/backups/abound.college/db/`
    - **filesPrefix**. All files backup objects stored in the S3 bucket will be prefixed with this value. If using slashes, you likely want to include a trailing slash. If you are storing backups for multiple sites in the same bucket, use this to differentiate them. Prefixes 'daily/', 'weekly/', and 'monthly/' will be added to this prefix. For example: `/backups/abound.college/files/`

### cron

Your cron file would look something like this:

```
# Backup Abound / Every day @ 3 am
0 3 * * * node /path/to/do-backup.js /path/to/config-abound.json

# Backup CoD / Every day @ 3:10 am
10 3 * * * node /path/to/do-backup.js /path/to/config-cod.json
```

## Dev

```
npm run watch
npm run test
docker-compose up -d
```

