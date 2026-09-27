FROM postgres:16-alpine

# rclone is used to upload dumps to any S3-compatible store (Cloudflare R2).
RUN apk add --no-cache rclone

COPY backup.sh /usr/local/bin/backup.sh
COPY restore.sh /usr/local/bin/restore.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh

CMD ["/usr/local/bin/backup.sh"]
