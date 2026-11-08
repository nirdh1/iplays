# iplays: running actions 1-3 on the Mac (v5)

Everything below is read-only against production. The scripts stop on their own if anything is off.
Never paste the database password into a file, a URL or the chat.

## 0. Unpack the scripts (once)
    mkdir -p ~/iplays-backup-scripts && cd ~/iplays-backup-scripts
    tar -xzf ~/Downloads/iplays-backup-scripts-v5.tar.gz
    shasum -a 256 -c SCRIPTS.SHA256          # every line must say OK

## Action 2: tools
    brew install libpq age
    export PATH="$(brew --prefix libpq)/bin:$PATH"
    psql --version; pg_dump --version; pg_restore --version; age --version; python3 --version
pg_dump must be the same major version as the Supabase server or newer; preflight.sh checks this itself.

## Connection (same terminal for actions 1 and 3)
Supabase dashboard > Connect > Session pooler. Copy the URI and DELETE the password part, so it looks like
postgresql://postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432/postgres

    export PROD_REF=<ref>                    # the 20-letter project ref from the dashboard URL
    export DB_URL='postgresql://postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432/postgres'
    read -s PGPASSWORD && export PGPASSWORD  # type the DB password, nothing is shown

The scripts refuse a URL that contains a password, that is not the Session pooler on port 5432,
or whose user is not postgres.$PROD_REF, and they check that the database really looks like iplays production.

## Action 1: preflight (read-only, limits: 30s per query, 1s lock wait)
    ./preflight.sh
Must end with PREFLIGHT PASSED. Send me the terminal output (no personal data in it) and the files
preflight_sizes.txt, gaps.txt, managed_tables.txt from ~/iplays-backup-scripts.

## Action 3: backup (only after PREFLIGHT PASSED)
    mkdir -p ~/iplays-backup && chmod 700 ~/iplays-backup   # NOT inside iCloud Desktop/Documents
    ./backup.sh ~/iplays-backup/$(date +%Y%m%d-%H%M)
    unset PGPASSWORD
Must end with BACKUP PASSED. Send me ONLY report.txt from that folder: sizes, checksums, counts, no personal data.
Do not send, upload or encrypt anything else yet: actions 4-11 need a separate approval.
