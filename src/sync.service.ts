import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { debounceTime, filter } from 'rxjs/operators'
import { Subscription } from 'rxjs'
import * as crypto from 'crypto'
import * as yaml from 'js-yaml'
import { SyncAdapter, Manifest, CategoryEntry } from './adapters/adapter.interface'
import { S3Adapter } from './adapters/s3.adapter'
import { SYNC_CATEGORIES, EXCLUDED_FIELDS } from './categories'
import { generateDEK, encryptDEK, decryptDEK, encrypt, decrypt } from './crypto'

export type SyncStatus = 'idle' | 'uploading' | 'downloading' | 'error'

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf-8').digest('hex')
}

export interface LogEntry {
  time: string
  message: string
  level: 'info' | 'success' | 'error'
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  status: SyncStatus = 'idle'
  lastError: string | null = null
  logs: LogEntry[] = []

  private adapter: SyncAdapter | null = null
  private dek: Buffer | null = null
  private autoSyncSub: Subscription | null = null
  private syncInProgress = false
  private consecutiveFailures = 0
  private static readonly MAX_FAILURES = 3
  /** Revision of the manifest this device last successfully synced with. */
  private lastSyncRevision = 0
  private intervalHandle: any = null

  private static readonly MANIFEST_VERSION = 1

  constructor(
    private config: ConfigService,
  ) {
    this.config.ready$.subscribe(() => {
      this.initDeviceId()
      if (this.roamConfig.enabled) {
        this.start()
      }
    })
  }

  private get roamConfig(): any {
    return this.config.store.configRoam
  }

  private initDeviceId(): void {
    if (!this.roamConfig.deviceId) {
      this.config.store.configRoam.deviceId = crypto.randomBytes(8).toString('hex')
      this.config.save()
    }
  }

  start(): void {
    this.stop()
    this.consecutiveFailures = 0
    this.adapter = this.createAdapter()
    if (!this.adapter) return

    if (this.roamConfig.autoSync) {
      this.autoSyncSub = this.config.changed$.pipe(
        debounceTime(3000),
        filter(() => !this.syncInProgress),
      ).subscribe(() => this.upload())

      this.intervalHandle = setInterval(
        () => this.checkAndPull(),
        this.roamConfig.syncIntervalSeconds * 1000,
      )
    }
  }

  stop(): void {
    this.autoSyncSub?.unsubscribe()
    this.autoSyncSub = null
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    this.adapter = null
    this.dek = null
  }

  /** Ensure DEK is available: load from remote or generate new */
  private async ensureDEK(): Promise<Buffer> {
    if (this.dek) return this.dek

    const passphrase = this.roamConfig.encryptionPassphrase
    if (!passphrase) throw new Error('Passphrase is required for encryption')

    const masterKeyData = await this.adapter!.downloadMasterKey()
    if (masterKeyData) {
      try {
        this.dek = decryptDEK(masterKeyData, passphrase)
      } catch {
        throw new Error('Passphrase does not match remote master key. Check your passphrase or use Change Passphrase to re-encrypt.')
      }
      this.log('Master key loaded from remote', 'info')
    } else {
      // Guard: if remote already has encrypted data, refuse to generate new key
      const manifest = await this.adapter!.downloadManifest()
      if (manifest?.encrypted) {
        throw new Error('Remote has encrypted data but master.key is missing. Cannot generate new key — existing data would become unrecoverable. Re-upload from a device that has the correct passphrase, or delete remote data to start fresh.')
      }
      this.dek = generateDEK()
      const encrypted = encryptDEK(this.dek, passphrase)
      await this.adapter!.uploadMasterKey(encrypted)
      this.log('New master key generated and uploaded', 'info')
    }
    return this.dek
  }

  async upload(force = false): Promise<void> {
    if (this.syncInProgress) return
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) {
      this.status = 'error'
      this.lastError = 'S3 not configured'
      return
    }
    this.syncInProgress = true
    this.status = 'uploading'
    try {
      // Pull-before-push: refuse to clobber a remote revision we haven't seen.
      // Exception: if remote was last written by *this* device, our cursor is just stale
      // (e.g. process restart) — adopt the remote revision and proceed.
      const remoteManifest = await this.adapter.downloadManifest()
      if (!force && remoteManifest && remoteManifest.revision > this.lastSyncRevision) {
        if (remoteManifest.deviceId === this.roamConfig.deviceId) {
          this.lastSyncRevision = remoteManifest.revision
        } else {
          this.log(`Remote has newer changes (rev ${remoteManifest.revision}). Use Push to Cloud to overwrite, or Pull from Cloud to accept remote.`, 'error')
          this.status = 'error'
          this.lastError = 'Remote has newer changes — Pull from Cloud to accept, or Push again to overwrite.'
          return
        }
      }

      const fullConfig = yaml.load(this.config.readRaw()) as Record<string, any>
      const now = Date.now()
      const deviceId: string = this.roamConfig.deviceId
      const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
      const passphrase = this.roamConfig.encryptionPassphrase
      const newCategories: Record<string, CategoryEntry> = { ...(remoteManifest?.categories ?? {}) }
      const uploaded: string[] = []
      const skipped: string[] = []

      for (const category of enabledCategories) {
        const partial: Record<string, any> = {}
        for (const field of category.fields) {
          if (fullConfig[field] !== undefined) {
            partial[field] = fullConfig[field]
          }
        }
        const yamlBody = yaml.dump(partial)
        const hash = sha256(yamlBody)
        const prev = remoteManifest?.categories[category.id]

        // Skip if remote already has this exact content
        if (prev && prev.hash === hash) {
          skipped.push(category.id)
          newCategories[category.id] = prev
          continue
        }
        // Don't create empty files for categories the user has never set
        if (Object.keys(partial).length === 0 && !prev) {
          continue
        }

        const raw = Buffer.from(yamlBody, 'utf-8')
        const data = passphrase ? encrypt(raw, await this.ensureDEK()) : raw
        await this.adapter.upload(category.id, data)
        newCategories[category.id] = { hash, timestamp: now, deviceId }
        uploaded.push(category.id)
      }

      const nextManifest: Manifest = {
        version: SyncService.MANIFEST_VERSION,
        revision: (remoteManifest?.revision ?? 0) + 1,
        encrypted: !!passphrase,
        deviceId,
        updatedAt: now,
        categories: newCategories,
      }
      await this.adapter.uploadManifest(nextManifest)
      this.lastSyncRevision = nextManifest.revision

      this.status = 'idle'
      this.lastError = null
      this.consecutiveFailures = 0
      const parts: string[] = []
      if (uploaded.length) parts.push(`uploaded: ${uploaded.join(', ')}`)
      if (skipped.length) parts.push(`unchanged: ${skipped.join(', ')}`)
      this.log(`Upload complete (rev ${nextManifest.revision}; ${parts.join('; ') || 'no changes'})`, 'success')
    } catch (e: any) {
      this.status = 'error'
      this.lastError = e.message
      this.log(`Upload failed: ${e.message}`, 'error')
    } finally {
      this.syncInProgress = false
    }
  }

  async download(): Promise<void> {
    if (this.syncInProgress) return
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) {
      this.status = 'error'
      this.lastError = 'S3 not configured'
      return
    }
    this.syncInProgress = true
    this.status = 'downloading'
    try {
      const manifest = await this.adapter.downloadManifest()
      if (!manifest) {
        this.status = 'idle'
        this.log('Download skipped: no manifest on remote (nothing has been uploaded yet).', 'info')
        return
      }

      const localRaw = yaml.load(this.config.readRaw()) as Record<string, any>
      const fullConfig: Record<string, any> = { ...localRaw }
      const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
      const fetched: string[] = []

      for (const category of enabledCategories) {
        if (!manifest.categories[category.id]) continue
        const bytes = await this.adapter.download(category.id)
        if (!bytes) continue
        const raw = manifest.encrypted
          ? decrypt(bytes, await this.ensureDEK()).toString('utf-8')
          : bytes.toString('utf-8')

        const partial = yaml.load(raw) as Record<string, any>
        if (partial && typeof partial === 'object') {
          for (const field of category.fields) {
            if (partial[field] !== undefined) {
              fullConfig[field] = partial[field]
            }
          }
        }
        fetched.push(category.id)
      }

      // Preserve local-only fields from raw config (not proxy)
      for (const field of EXCLUDED_FIELDS) {
        if (localRaw[field] !== undefined) {
          fullConfig[field] = localRaw[field]
        }
      }

      await this.config.writeRaw(yaml.dump(fullConfig))
      this.lastSyncRevision = manifest.revision
      this.status = 'idle'
      this.lastError = null
      this.consecutiveFailures = 0
      this.log(`Download complete (rev ${manifest.revision}; ${fetched.join(', ') || 'no categories'})`, 'success')
    } catch (e: any) {
      this.status = 'error'
      this.lastError = e.message
      this.consecutiveFailures++
      this.log(`Download failed: ${e.message}`, 'error')
      if (this.consecutiveFailures >= SyncService.MAX_FAILURES) {
        this.log('Auto sync paused after repeated failures. Fix the issue and re-enable.', 'error')
        this.stop()
      }
    } finally {
      this.syncInProgress = false
    }
  }

  /** Returns true if remote manifest has a newer revision than this device has seen. */
  async hasRemoteChanges(): Promise<boolean> {
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) return false
    const manifest = await this.adapter.downloadManifest()
    return !!manifest && manifest.revision > this.lastSyncRevision
  }

  async checkAndPull(): Promise<void> {
    if (!this.adapter || this.syncInProgress) return
    if (this.consecutiveFailures >= SyncService.MAX_FAILURES) return
    if (this.status === 'error') return // Don't auto-pull during conflict
    try {
      const manifest = await this.adapter.downloadManifest()
      if (!manifest) return
      if (manifest.revision > this.lastSyncRevision && manifest.deviceId !== this.roamConfig.deviceId) {
        await this.download()
      }
    } catch {
      // Silent fail for periodic check
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const adapter = this.createAdapter()
      if (!adapter) {
        return { success: false, message: 'S3 not configured (check bucket, access key, secret key)' }
      }
      await adapter.writeTestFile()
      await adapter.probeReadAccess()
      return { success: true, message: 'Connection successful! Read/write verified.' }
    } catch (e: any) {
      return { success: false, message: e.message || 'Connection failed' }
    }
  }

  /** True if a master.key exists on the remote (i.e. encryption was set up before). */
  async remoteMasterKeyExists(): Promise<boolean> {
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) return false
    return !!(await this.adapter.downloadMasterKey())
  }

  /** Delete all remote sync files. Local config is untouched. */
  async clearRemote(): Promise<void> {
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) throw new Error('S3 not configured')

    const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
    for (const category of enabledCategories) {
      await this.adapter.deleteObject(category.id + '.enc')
    }
    await this.adapter.deleteMasterKey()
    await this.adapter.deleteManifest()
    this.dek = null
    this.lastSyncRevision = 0
    this.log('Cloud data cleared', 'success')
  }

  /** Remove encryption: decrypt all remote files and re-upload as plaintext */
  async removeEncryption(currentPassphrase: string): Promise<void> {
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) throw new Error('S3 not configured')

    const masterKeyData = await this.adapter.downloadMasterKey()
    if (!masterKeyData) {
      // No master.key on remote — just clear local passphrase
      this.dek = null
      this.config.store.configRoam.encryptionPassphrase = ''
      this.config.save()
      this.log('Passphrase cleared (no remote encryption to remove).', 'success')
      return
    }

    // Load DEK with provided passphrase
    let dek: Buffer
    try {
      dek = decryptDEK(masterKeyData, currentPassphrase)
    } catch {
      throw new Error('Passphrase is incorrect')
    }

    // Re-upload each category as plaintext
    const manifest = await this.adapter.downloadManifest()
    if (!manifest) throw new Error('No manifest found on remote')
    const enabledCategories = SYNC_CATEGORIES.filter(c => manifest.categories[c.id])

    for (const category of enabledCategories) {
      const bytes = await this.adapter.download(category.id)
      if (!bytes) continue
      const plaintext = decrypt(bytes, dek)
      await this.adapter.upload(category.id, plaintext)
    }

    // Delete master.key
    await this.adapter.deleteMasterKey()

    // Update manifest
    manifest.encrypted = false
    manifest.revision++
    manifest.updatedAt = Date.now()
    manifest.deviceId = this.roamConfig.deviceId
    await this.adapter.uploadManifest(manifest)
    this.lastSyncRevision = manifest.revision

    // Clear local state
    this.dek = null
    this.config.store.configRoam.encryptionPassphrase = ''
    this.config.save()
    this.log('Encryption removed. All remote data is now plaintext.', 'success')
  }

  /** Re-encrypt master.key with new passphrase */
  async reEncryptMasterKey(oldPassphrase: string, newPassphrase: string): Promise<void> {
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) throw new Error('S3 not configured')

    const masterKeyData = await this.adapter.downloadMasterKey()
    if (!masterKeyData) throw new Error('No master key found on remote')

    let dek: Buffer
    try {
      dek = decryptDEK(masterKeyData, oldPassphrase)
    } catch {
      throw new Error('Old passphrase is incorrect')
    }
    const reEncrypted = encryptDEK(dek, newPassphrase)
    await this.adapter.uploadMasterKey(reEncrypted)
    this.dek = dek
    this.log('Master key re-encrypted with new passphrase', 'success')
  }

  private log(message: string, level: 'info' | 'success' | 'error' = 'info'): void {
    const time = new Date().toLocaleTimeString()
    this.logs.unshift({ time, message, level })
    if (this.logs.length > 100) this.logs.pop()
  }

  private createAdapter(): SyncAdapter | null {
    const s3 = this.roamConfig.s3
    if (!s3.bucket || !s3.accessKeyId || !s3.secretAccessKey) return null
    return new S3Adapter({
      region: s3.region,
      bucket: s3.bucket,
      prefix: s3.prefix,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      endpoint: s3.endpoint || undefined,
    })
  }
}
