import { Component } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { SyncService } from '../sync.service'
import { SYNC_CATEGORIES } from '../categories'

declare const PLUGIN_VERSION: string

@Component({
  selector: 'sync-settings',
  template: `
    <div class="form-group">
      <h3>Config Roam</h3>
      <small class="text-muted">Sync your Tabby config across devices via S3-compatible storage.</small>
      <small *ngIf="autoSaved" class="text-success ml-2">✓ Saved</small>
    </div>

    <ul class="nav nav-tabs mb-3">
      <li class="nav-item">
        <a class="nav-link" [class.active]="activeTab === 'general'" (click)="activeTab = 'general'">GENERAL</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" [class.active]="activeTab === 'categories'" (click)="activeTab = 'categories'">CATEGORIES</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" [class.active]="activeTab === 'export'" (click)="activeTab = 'export'">MAINTENANCE</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" [class.active]="activeTab === 'logs'" (click)="activeTab = 'logs'">LOGS</a>
      </li>
    </ul>

    <!-- GENERAL TAB -->
    <div *ngIf="activeTab === 'general'">
      <h5>S3 Configuration</h5>

      <div class="form-group row">
        <div class="col-6">
          <label>Region</label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.region"
                 placeholder="ap-southeast-1" (ngModelChange)="autoSave()">
        </div>
        <div class="col-6">
          <label>Bucket</label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.bucket"
                 placeholder="my-tabby-sync" (ngModelChange)="autoSave()">
        </div>
      </div>

      <div class="form-group row">
        <div class="col-6">
          <label>Access Key ID</label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.accessKeyId"
                 (ngModelChange)="autoSave()">
        </div>
        <div class="col-6">
          <label>Prefix</label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.prefix"
                 placeholder="tabby-config-roam/" (ngModelChange)="autoSave()">
        </div>
      </div>

      <div class="form-group row">
        <div class="col-6">
          <label>Secret Access Key</label>
          <div class="input-group">
            <input [type]="showSecretKey ? 'text' : 'password'" class="form-control"
                   [(ngModel)]="config.store.configRoam.s3.secretAccessKey" (ngModelChange)="autoSave()">
            <button type="button" class="btn btn-secondary" (click)="showSecretKey = !showSecretKey"
                    [title]="showSecretKey ? 'Hide' : 'Show'">
              <i class="fas fa-fw" [class.fa-eye]="!showSecretKey" [class.fa-eye-slash]="showSecretKey"></i>
            </button>
          </div>
        </div>
        <div class="col-6">
          <label>Custom Endpoint <small class="text-muted">(optional)</small></label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.endpoint"
                 placeholder="https://s3.example.com" (ngModelChange)="autoSave()">
        </div>
      </div>

      <div class="form-group mt-3">
        <button class="btn btn-info" (click)="doTest()" [disabled]="testing">
          {{ testing ? 'Testing...' : 'Test Connection' }}
        </button>
        <span *ngIf="testResult" class="ml-2"
              [class.text-success]="testResult.success"
              [class.text-danger]="!testResult.success">
          {{ testResult.message }}
        </span>
      </div>

      <hr>

      <h5>Encryption</h5>

      <div class="form-group">
        <small *ngIf="hasPassphrase()" class="text-success">🔒 Passphrase is set.</small>
        <small *ngIf="!hasPassphrase()" class="text-warning">🔓 No passphrase set — data uploads in plaintext. Set one for defense-in-depth.</small>
      </div>

      <div class="form-group d-flex align-items-end" style="gap: 1rem;">
        <div *ngIf="hasPassphrase()" style="flex: 1 1 0; max-width: 280px;">
          <label>Current Passphrase</label>
          <div class="input-group">
            <input [type]="showOldPassphrase ? 'text' : 'password'" class="form-control"
                   [(ngModel)]="oldPassphrase" placeholder="Required to change">
            <button type="button" class="btn btn-secondary" (click)="showOldPassphrase = !showOldPassphrase"
                    [title]="showOldPassphrase ? 'Hide' : 'Show'">
              <i class="fas fa-fw" [class.fa-eye]="!showOldPassphrase" [class.fa-eye-slash]="showOldPassphrase"></i>
            </button>
          </div>
        </div>
        <div style="flex: 1 1 0; max-width: 280px;">
          <label>{{ hasPassphrase() ? 'New Passphrase' : 'Passphrase' }}</label>
          <div class="input-group">
            <input [type]="showNewPassphrase ? 'text' : 'password'" class="form-control"
                   [(ngModel)]="newPassphrase" placeholder="Strongly recommended">
            <button type="button" class="btn btn-secondary" (click)="showNewPassphrase = !showNewPassphrase"
                    [title]="showNewPassphrase ? 'Hide' : 'Show'">
              <i class="fas fa-fw" [class.fa-eye]="!showNewPassphrase" [class.fa-eye-slash]="showNewPassphrase"></i>
            </button>
          </div>
        </div>
        <button class="btn btn-warning" (click)="doApplyPassphrase()" [disabled]="changingPassphrase || !newPassphrase">
          {{ changingPassphrase ? 'Applying...' : (hasPassphrase() ? 'Change Passphrase' : 'Set Passphrase') }}
        </button>
      </div>
      <div class="form-group" *ngIf="passphraseResult">
        <span [class.text-success]="passphraseResult.success"
              [class.text-danger]="!passphraseResult.success">
          {{ passphraseResult.message }}
        </span>
      </div>

      <div *ngIf="isConfigured()">
        <hr>
        <h5>Sync</h5>

        <div class="form-group">
          <label>
            <input type="checkbox" [(ngModel)]="config.store.configRoam.enabled" (ngModelChange)="onToggle()">
            Enable Auto Sync
          </label>
        </div>

        <div class="form-group d-flex align-items-center" *ngIf="config.store.configRoam.enabled" style="gap: 0.5rem;">
          <label class="mb-0">Interval (seconds)</label>
          <input type="number" class="form-control" style="width: 100px;"
                 [(ngModel)]="config.store.configRoam.syncIntervalSeconds"
                 min="10" (ngModelChange)="autoSave()">
        </div>

        <div class="form-group d-flex align-items-center" style="gap: 0.5rem;">
          <button class="btn btn-success" (click)="doUpload()"
                  [disabled]="sync.status === 'uploading' || sync.status === 'downloading'">
            Upload Now
          </button>
          <button class="btn btn-warning" (click)="doDownload()"
                  [disabled]="sync.status === 'uploading' || sync.status === 'downloading'">
            Download Now
          </button>
          <small class="text-muted">First device? Upload. Second device? Download.</small>
        </div>
      </div>
    </div>

    <!-- CATEGORIES TAB -->
    <div *ngIf="activeTab === 'categories'">
      <p class="text-muted">Select which config categories to sync. All enabled by default.</p>
      <div class="form-group" *ngFor="let cat of categories">
        <label>
          <input type="checkbox" [(ngModel)]="config.store.configRoam.categories[cat.id]" (ngModelChange)="autoSave()">
          <strong>{{ cat.id | titlecase }}</strong> — {{ cat.label }}
        </label>
      </div>
    </div>

    <!-- SETTINGS TAB -->
    <div *ngIf="activeTab === 'export'">
      <h5>Plugin Info</h5>
      <div class="form-group">
        <small class="text-muted">Device ID: {{ config.store.configRoam.deviceId }}</small><br>
        <small class="text-muted">Version: v{{ version }}</small>
      </div>

      <div class="form-group">
        <button class="btn btn-info btn-sm" (click)="doCheckUpdate()" [disabled]="checkingUpdate">
          {{ checkingUpdate ? 'Checking...' : 'Check for Update' }}
        </button>
        <span *ngIf="updateResult" class="ml-2"
              [class.text-success]="!updateResult.hasUpdate"
              [class.text-info]="updateResult.hasUpdate">
          {{ updateResult.message }}
        </span>
      </div>

      <hr>

      <h5>Export</h5>
      <p><small>Saves S3 credentials, prefix, passphrase, and sync preferences to a JSON file.</small></p>
      <div class="form-group">
        <button class="btn btn-primary" (click)="doExport()">Export Config</button>
      </div>

      <hr>

      <h5>Import</h5>
      <p><small>Load plugin settings from a previously exported JSON file. This will overwrite current settings.</small></p>
      <div class="form-group">
        <button class="btn btn-warning" (click)="doImport()">Import Config</button>
        <span *ngIf="importResult" class="ml-2"
              [class.text-success]="importResult.success"
              [class.text-danger]="!importResult.success">
          {{ importResult.message }}
        </span>
      </div>

      <div class="form-group text-warning mt-3">
        ⚠️ The exported file may contain sensitive data (S3 credentials, encryption passphrase). Store it securely.
      </div>
    </div>

    <!-- LOGS TAB -->
    <div *ngIf="activeTab === 'logs'">
      <div class="form-group">
        <span class="badge mr-2"
              [class.badge-success]="sync.status === 'idle'"
              [class.badge-info]="sync.status === 'uploading' || sync.status === 'downloading'"
              [class.badge-danger]="sync.status === 'error'">
          {{ sync.status }}
        </span>
      </div>

      <div class="form-group text-danger" *ngIf="sync.lastError">
        <strong>Last Error:</strong> {{ sync.lastError }}
      </div>

      <h5>Sync Log</h5>
      <div *ngIf="sync.logs.length === 0" class="text-muted">No sync activity yet.</div>
      <div class="log-container" style="max-height: 400px; overflow-y: auto; font-family: monospace; font-size: 12px;">
        <div *ngFor="let log of sync.logs" [class.text-danger]="log.level === 'error'" [class.text-success]="log.level === 'success'">
          <small class="text-muted">{{ log.time }}</small> {{ log.message }}
        </div>
      </div>
    </div>
  `,
})
export class SyncSettingsComponent {
  activeTab = 'general'
  version = PLUGIN_VERSION
  categories = SYNC_CATEGORIES
  testResult: { success: boolean; message: string } | null = null
  testing = false
  autoSaved = false
  importResult: { success: boolean; message: string } | null = null
  checkingUpdate = false
  updateResult: { hasUpdate: boolean; message: string } | null = null
  oldPassphrase = ''
  newPassphrase = ''
  changingPassphrase = false
  passphraseResult: { success: boolean; message: string } | null = null
  showSecretKey = false
  showOldPassphrase = false
  showNewPassphrase = false

  constructor(
    public config: ConfigService,
    public sync: SyncService,
  ) {}

  isConfigured(): boolean {
    const s3 = this.config.store.configRoam?.s3
    return !!(s3?.bucket && s3?.accessKeyId && s3?.secretAccessKey)
  }

  async doTest(): Promise<void> {
    this.testing = true
    this.testResult = null
    this.testResult = await this.sync.testConnection()
    this.testing = false
  }

  autoSave(): void {
    this.config.save()
    this.autoSaved = true
    setTimeout(() => this.autoSaved = false, 2000)
  }

  onToggle(): void {
    this.autoSave()
    if (this.config.store.configRoam.enabled) {
      this.sync.start()
    } else {
      this.sync.stop()
    }
  }

  hasPassphrase(): boolean {
    return !!this.config.store.configRoam?.encryptionPassphrase
  }

  async doApplyPassphrase(): Promise<void> {
    if (!this.newPassphrase) {
      this.passphraseResult = { success: false, message: 'New passphrase is required.' }
      return
    }
    if (this.hasPassphrase() && !this.oldPassphrase) {
      this.passphraseResult = { success: false, message: 'Current passphrase is required to change it.' }
      return
    }
    if (this.oldPassphrase && this.oldPassphrase === this.newPassphrase) {
      this.passphraseResult = { success: false, message: 'New passphrase must differ from the current one.' }
      return
    }

    this.changingPassphrase = true
    this.passphraseResult = null
    try {
      if (this.hasPassphrase()) {
        // Modify path: re-encrypt remote master.key with new passphrase
        await this.sync.reEncryptMasterKey(this.oldPassphrase, this.newPassphrase)
        this.config.store.configRoam.encryptionPassphrase = this.newPassphrase
        this.config.save()
        this.passphraseResult = {
          success: true,
          message: 'Passphrase changed. Remember to enter the new passphrase on your other devices.',
        }
      } else {
        // First-time path: refuse if a remote master.key already exists
        // (would mean another device set it first — local must match it).
        const existing = await this.sync.remoteMasterKeyExists()
        if (existing) {
          this.passphraseResult = {
            success: false,
            message: 'Remote already has a passphrase from another device. Enter that passphrase as Current Passphrase to use it here.',
          }
          return
        }
        this.config.store.configRoam.encryptionPassphrase = this.newPassphrase
        this.config.save()
        // Restart sync so the service rebuilds DEK/master.key with the new passphrase
        if (this.config.store.configRoam.enabled) {
          this.sync.stop()
          this.sync.start()
        }
        this.passphraseResult = { success: true, message: 'Passphrase set. Master key will be created on next upload.' }
      }
      this.oldPassphrase = ''
      this.newPassphrase = ''
    } catch (e: any) {
      this.passphraseResult = { success: false, message: e.message || 'Failed to apply passphrase.' }
    } finally {
      this.changingPassphrase = false
    }
  }

  async doCheckUpdate(): Promise<void> {
    this.checkingUpdate = true
    this.updateResult = null
    try {
      const res = await fetch('https://registry.npmjs.org/tabby-config-roam/latest')
      const data = await res.json()
      const latest = data.version
      if (latest !== this.version) {
        this.updateResult = { hasUpdate: true, message: `New version available: v${latest}` }
      } else {
        this.updateResult = { hasUpdate: false, message: 'You are on the latest version.' }
      }
    } catch {
      this.updateResult = { hasUpdate: false, message: 'Failed to check for updates.' }
    } finally {
      this.checkingUpdate = false
    }
  }

  doExport(): void {
    const data = JSON.stringify(this.config.store.configRoam, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tabby-config-roam.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  doImport(): void {
    const confirmed = window.confirm(
      'Import will overwrite your current Config Roam settings (S3 credentials, passphrase, sync preferences). Your local Tabby config and your device ID are preserved. Continue?',
    )
    if (!confirmed) return

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result as string)
          if (!imported || typeof imported !== 'object') throw new Error('Invalid format')

          const target = this.config.store.configRoam
          // Warn if both sides have a passphrase and they differ — switching would
          // make the local passphrase no longer match the remote master.key.
          if (target.encryptionPassphrase
              && imported.encryptionPassphrase
              && target.encryptionPassphrase !== imported.encryptionPassphrase) {
            const ok = window.confirm(
              'The imported passphrase differs from your current one. After import, this device will use the imported passphrase. Sync will fail unless the remote master.key was created with that passphrase. Continue?',
            )
            if (!ok) {
              this.importResult = { success: false, message: 'Import cancelled.' }
              return
            }
          }
          // Allowlist of top-level scalar fields — unknown keys are ignored on purpose.
          const SCALAR_FIELDS = ['enabled', 'adapter', 'autoSync', 'syncIntervalSeconds', 'encryptionPassphrase']
          for (const k of SCALAR_FIELDS) {
            if (imported[k] !== undefined) target[k] = imported[k]
          }
          // Nested objects — merge per-key so a partial export doesn't drop existing fields.
          if (imported.s3 && typeof imported.s3 === 'object') {
            Object.assign(target.s3, imported.s3)
          }
          if (imported.categories && typeof imported.categories === 'object') {
            Object.assign(target.categories, imported.categories)
          }
          // deviceId is intentionally not imported — each device must keep its own,
          // otherwise pull-before-push and checkAndPull can't tell devices apart.

          this.config.save()
          this.sync.stop()
          if (target.enabled) this.sync.start()

          this.importResult = { success: true, message: 'Config imported. Sync service restarted.' }
          setTimeout(() => this.importResult = null, 5000)
        } catch (e: any) {
          this.importResult = { success: false, message: e.message || 'Failed to import' }
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  doUpload(): void {
    this.sync.upload()
  }

  async doDownload(): Promise<void> {
    const confirmed = window.confirm(
      'Download will overwrite your local Tabby config with remote data. Any local changes since the last sync will be lost. Continue?',
    )
    if (!confirmed) return
    this.sync.download()
  }
}
