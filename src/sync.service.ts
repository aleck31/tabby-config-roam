import { Injectable } from '@angular/core'
import { ConfigService, PlatformService } from 'tabby-core'
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
  private intervalHandle: any = null

  constructor(
    private config: ConfigService,
    private platform: PlatformService,
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

    // Try to download existing master.key
    const masterKeyData = await this.adapter!.downloadMasterKey()
    if (masterKeyData) {
      this.dek = decryptDEK(masterKeyData, passphrase)
      this.log('Master key loaded from remote', 'info')
    } else {
      // First time: generate new DEK and upload
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
        if (Object.keys(partial).length === 0) continue
        const raw = Buffer.from(yaml.dump(partial), 'utf-8')
        const data = passphrase ? encrypt(raw, await this.ensureDEK()) : raw
        await this.adapter.upload(category.id, data, metadata)
      }

      this.config.store.configRoam.lastSyncTimestamp = metadata.timestamp
      this.config.save()
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
      const fullConfig = yaml.load(this.config.readRaw()) as Record<string, any>
      const passphrase = this.roamConfig.encryptionPassphrase
      const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
      let latestTimestamp = 0

      for (const category of enabledCategories) {
        const result = await this.adapter.download(category.id)
        if (!result) continue
        const raw = passphrase ? decrypt(result.data, await this.ensureDEK()).toString('utf-8') : result.data.toString('utf-8')
        const partial = yaml.load(raw) as Record<string, any>
        for (const field of category.fields) {
          if (partial[field] !== undefined) {
            fullConfig[field] = partial[field]
          }
        }
        latestTimestamp = Math.max(latestTimestamp, result.metadata.timestamp)
      }

      // Preserve local-only fields
      for (const field of EXCLUDED_FIELDS) {
        if (this.config.store[field] !== undefined) {
          fullConfig[field] = this.config.store[field]
        }
      }

      await this.config.writeRaw(yaml.dump(fullConfig))
      this.config.store.configRoam.lastSyncTimestamp = latestTimestamp
      this.config.save()
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

  async checkAndPull(): Promise<void> {
    if (!this.adapter || this.syncInProgress) return
    try {
      const enabledCategories = SYNC_CATEGORIES.filter(c => this.roamConfig.categories[c.id])
      if (enabledCategories.length === 0) return
      const remote = await this.adapter.getRemoteMetadata(enabledCategories[0].id)
      if (!remote) return
      if (remote.timestamp > this.roamConfig.lastSyncTimestamp && remote.deviceId !== this.roamConfig.deviceId) {
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
      return { success: true, message: 'Connection successful! Test file written to S3.' }
    } catch (e: any) {
      return { success: false, message: e.message || 'Connection failed' }
    }
  }

  /** Re-encrypt master.key with new passphrase (call after passphrase change) */
  async reEncryptMasterKey(oldPassphrase: string, newPassphrase: string): Promise<void> {
    if (!this.adapter) this.adapter = this.createAdapter()
    if (!this.adapter) throw new Error('S3 not configured')

    const masterKeyData = await this.adapter.downloadMasterKey()
    if (!masterKeyData) throw new Error('No master key found on remote')

    const dek = decryptDEK(masterKeyData, oldPassphrase)
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
