#!/bin/bash
# Watchdog: detect a dead/stale /mnt/photos mount and auto-remount it.
#
# The photos drive is an external NTFS USB disk. It can re-enumerate across a
# disconnect/reconnect (e.g. /dev/sdb1 -> /dev/sdc1), which leaves a stale
# ntfs-3g mount: `df` still shows it mounted but every access returns EIO,
# breaking all photo uploads. fstab mounts it by stable UUID, so a plain
# `mount /mnt/photos` re-attaches the current device.
#
# Installed as a root cron job: /etc/cron.d/photos-mount-watchdog
# The snek bot self-heals on the next request once the mount is restored
# (see src/photoStorage.ts), so no service restart is needed here.
set -u

MOUNT=/mnt/photos
MARKER="$MOUNT/snek-photos"        # a dir that lives ON the drive
TESTFILE="$MOUNT/.mount-watchdog"

healthy() {
  # Must actually be a mountpoint first: /mnt/photos has a leftover empty
  # snek-photos/ dir on the root filesystem itself (predates this guard), so
  # after a clean unmount the marker dir "exists" and is writable even though
  # the real drive is gone — that false-positive let the drive sit unmounted
  # for a day undetected (2026-08-03). mountpoint -q is what actually
  # distinguishes "the drive is attached here" from "this path is writable".
  # A stale ntfs-3g mount still passes mountpoint but fails the touch (EIO).
  mountpoint -q "$MOUNT" && [ -d "$MARKER" ] && touch "$TESTFILE" 2>/dev/null
}

if healthy; then
  rm -f "$TESTFILE" 2>/dev/null
  exit 0
fi

logger -t photos-watchdog "photos mount unhealthy — attempting remount"
umount -l "$MOUNT" 2>/dev/null
mount "$MOUNT" 2>/dev/null

if healthy; then
  rm -f "$TESTFILE" 2>/dev/null
  logger -t photos-watchdog "remount succeeded"
  exit 0
fi

logger -t photos-watchdog "remount FAILED — manual intervention needed"
exit 1
