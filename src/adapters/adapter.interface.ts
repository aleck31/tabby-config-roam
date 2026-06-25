export interface CategoryEntry {
  /** sha256 hex of plaintext yaml content */
  hash: string
  /** Date.now() at upload time */
  timestamp: number
  /** deviceId that produced this version */
  deviceId: string
}

/**
 * Authoritative state of the remote sync prefix. Written last during upload
 * to give a near-atomic view of which category versions belong together.
 */
export interface Manifest {
  /** schema version of the manifest itself */
  version: number
  /** monotonically increasing counter, bumped each successful upload */
  revision: number
  /** true when category files are encrypted with master.key */
  encrypted: boolean
  /** last device that wrote the manifest */
  deviceId: string
  /** Date.now() of the manifest write */
  updatedAt: number
  categories: Record<string, CategoryEntry>
}

export interface SyncAdapter {
  upload(categoryId: string, data: Buffer): Promise<void>
  download(categoryId: string): Promise<Buffer | null>
  uploadMasterKey(data: Buffer): Promise<void>
  downloadMasterKey(): Promise<Buffer | null>
  deleteMasterKey(): Promise<void>
  uploadManifest(manifest: Manifest): Promise<void>
  downloadManifest(): Promise<Manifest | null>
  /** Probe read access without throwing on 404. Used by Test Connection. */
  probeReadAccess(): Promise<void>
  writeTestFile(): Promise<void>
}
