import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { debounceTime, filter } from 'rxjs/operators'
import { Subscription } from 'rxjs'
import * as crypto from 'crypto'
import * as yaml from 'js-yaml'
import { SyncAdapter, SyncMetadata } from './adapters/adapter.interface'
import { S3Adapter } from './adapters/s3.adapter'
import { SYNC_CATEGORIES, EXCLUDED_FIELDS } from './categories'
import { generateDEK, encryptDEK, decryptDEK, encrypt, decrypt } from './crypto'

export type SyncStatus = 'idle' | 'uploading' | 'downloading' | 'error'

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
  private lastSyncTimestamp = 0
  private intervalHandle: any = null

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
      this.dek = generateDEK()
      const encrypted = encryptDEK(this.dek, passphrase)
      await this.adapter!.uploadMasterKey(encrypted)
      this.log('New master key generated and uploaded', 'info')
    }
    return this.dek
  }

  async upload(): Promise<void> {
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
      const fullConfig = yaml.load(this.config.readRaw()) as Record<string, any>
      const metadata: SyncMetadata = {
        timestamp: Date.now(),
        deviceId: this.roamConfig.deviceId,
      }
      const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
      const passphrase = this.roamConfig.encryptionPassphrase

      for (const category of enabledCategories) {
        const partial: Record<string, any> = {}
        for (const field of category.fields) {
          if (fullConfig[field] !== undefined) {
            partial[field] = fullConfig[field]
          }
        }
        // Skip upload if local has nothing AND remote has nothing (avoid creating empty files)
        if (Object.keys(partial).length === 0) {
          const remoteMeta = await this.adapter.getRemoteMetadata(category.id)
          if (!remoteMeta) continue // remote doesn't exist either, skip
        }
        const raw = Buffer.from(yaml.dump(partial), 'utf-8')
        const data = passphrase ? encrypt(raw, await this.ensureDEK()) : raw
        await this.adapter.upload(category.id, data, metadata)
      }

      this.lastSyncTimestamp = metadata.timestamp
      this.status = 'idle'
      this.lastError = null
      this.log(`Upload complete (${enabledCategories.map(c => c.id).join(', ')})`, 'success')
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
      const localRaw = yaml.load(this.config.readRaw()) as Record<string, any>
      const fullConfig: Record<string, any> = { ...localRaw }
      const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
      let latestTimestamp = 0
      const remoteEncrypted = !!(await this.adapter.downloadMasterKey())

      for (const category of enabledCategories) {
        const result = await this.adapter.download(category.id)
        if (!result) continue
        const raw = remoteEncrypted
          ? decrypt(result.data, await this.ensureDEK()).toString('utf-8')
          : result.data.toString('utf-8')

        const partial = yaml.load(raw) as Record<string, any>
        if (partial && typeof partial === 'object') {
          for (const field of category.fields) {
            if (partial[field] !== undefined) {
              fullConfig[field] = partial[field]
            }
          }
        }
        latestTimestamp = Math.max(latestTimestamp, result.metadata.timestamp)
      }

      // Preserve local-only fields from raw config (not proxy)
      for (const field of EXCLUDED_FIELDS) {
        if (localRaw[field] !== undefined) {
          fullConfig[field] = localRaw[field]
        }
      }

      await this.config.writeRaw(yaml.dump(fullConfig))
      this.lastSyncTimestamp = latestTimestamp
      this.status = 'idle'
      this.lastError = null
      this.log(`Download complete (${enabledCategories.map(c => c.id).join(', ')})`, 'success')
    } catch (e: any) {
      this.status = 'error'
      this.lastError = e.message
      this.log(`Download failed: ${e.message}`, 'error')
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * Inspect remote vs local without writing anything. Returns true if remote
   * has changes the caller hasn't seen yet (timestamp newer than lastSyncTimestamp).
   */
  async hasRemoteChanges(): Promise<boolean> {
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) return false
    const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
    for (const category of enabledCategories) {
      const remote = await this.adapter.getRemoteMetadata(category.id)
      if (remote && remote.timestamp > this.lastSyncTimestamp) return true
    }
    return false
  }

  async checkAndPull(): Promise<void> {
    if (!this.adapter || this.syncInProgress) return
    try {
      const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
      if (enabledCategories.length === 0) return
      let maxTimestamp = 0
      let remoteDeviceId = ''
      for (const category of enabledCategories) {
        const remote = await this.adapter.getRemoteMetadata(category.id)
        if (remote && remote.timestamp > maxTimestamp) {
          maxTimestamp = remote.timestamp
          remoteDeviceId = remote.deviceId
        }
      }
      if (maxTimestamp > this.lastSyncTimestamp && remoteDeviceId !== this.roamConfig.deviceId) {
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
      // Verify read access too (404 returns null without throwing — only auth errors throw)
      await adapter.getRemoteMetadata('profiles')
      return { success: true, message: 'Connection successful! Read/write verified.' }
    } catch (e: any) {
      return { success: false, message: e.message || 'Connection failed' }
    }
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
