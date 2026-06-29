import fs from "fs";
import path from "path";
import { DATA_DIR } from "./state";

export const PHOTO_STORAGE_PATH = process.env.PHOTO_STORAGE_PATH ?? path.join(DATA_DIR, "photos");

/** Thrown when the photo storage volume is missing/unwritable (e.g. the external drive lost its mount). */
export class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Photo storage is unavailable");
    this.name = "StorageUnavailableError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Ensure the album + thumbnail directories exist and return their paths.
 *
 * Guards against the external photo drive losing its mount in two ways:
 *  - If the storage root is missing, the drive isn't mounted. We refuse rather than
 *    let `mkdir -p` silently recreate the tree on the local disk under the (empty)
 *    mountpoint — that would shadow the real photos when the drive comes back.
 *  - If the mount is stale (present in `df` but returning EIO), the mkdir throws and
 *    we surface it as StorageUnavailableError.
 *
 * Callers should treat StorageUnavailableError as a transient 503-style failure; the
 * server-side watchdog (scripts/check-photos-mount.sh) remounts the drive, after which
 * the next call succeeds with no restart.
 */
export function ensureAlbumDirs(channelId: string): { albumDir: string; thumbDir: string } {
  if (!fs.existsSync(PHOTO_STORAGE_PATH)) {
    throw new StorageUnavailableError(new Error(`Storage root missing: ${PHOTO_STORAGE_PATH}`));
  }
  const albumDir = path.join(PHOTO_STORAGE_PATH, channelId);
  const thumbDir = path.join(albumDir, "thumbs");
  try {
    fs.mkdirSync(thumbDir, { recursive: true });
  } catch (e) {
    throw new StorageUnavailableError(e);
  }
  return { albumDir, thumbDir };
}
