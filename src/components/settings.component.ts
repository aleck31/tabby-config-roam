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
    </div>

    <ul class="nav nav-tabs mb-3">
      <li class="nav-item">
        <a class="nav-link" [class.active]="activeTab === 'general'" (click)="activeTab = 'general'">GENERAL</a>
      </li>
      <li class="nav-item">
        <a class="nav-link" [class.active]="activeTab === 'categories'" (click)="activeTab = 'categories'">CATEGORIES</a>
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
                 placeholder="ap-southeast-1">
        </div>
        <div class="col-6">
          <label>Bucket</label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.bucket"
                 placeholder="my-tabby-sync">
        </div>
      </div>

      <div class="form-group row">
        <div class="col-6">
          <label>Access Key ID</label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.accessKeyId">
        </div>
        <div class="col-6">
          <label>Prefix</label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.prefix"
                 placeholder="tabby-config-roam/">
        </div>
      </div>

      <div class="form-group row">
        <div class="col-6">
          <label>Secret Access Key</label>
          <input type="password" class="form-control" [(ngModel)]="config.store.configRoam.s3.secretAccessKey">
        </div>
        <div class="col-6">
          <label>Custom Endpoint <small class="text-muted">(optional)</small></label>
          <input type="text" class="form-control" [(ngModel)]="config.store.configRoam.s3.endpoint"
                 placeholder="https://s3.example.com">
        </div>
      </div>

      <h5>Encryption</h5>

      <div class="form-group row">
        <div class="col-6">
          <label>Passphrase</label>
          <input type="password" class="form-control" [(ngModel)]="config.store.configRoam.encryptionPassphrase"
                 placeholder="Strongly recommended">
        </div>
      </div>
      <div class="form-group text-warning" *ngIf="!config.store.configRoam.encryptionPassphrase">
        ⚠️ Passphrase not set. Data will be uploaded without encryption. Recommend setting one for defense-in-depth.
      </div>

      <div class="form-group" *ngIf="config.store.configRoam.encryptionPassphrase">
        <a (click)="showChangePassphrase = !showChangePassphrase" class="text-info" style="cursor: pointer;">
          {{ showChangePassphrase ? '▼' : '▶' }} Change Passphrase
        </a>
      </div>

      <div *ngIf="showChangePassphrase" class="ml-3 mb-3">
        <div class="form-group row">
          <div class="col-6">
            <label>Old Passphrase</label>
            <input type="password" class="form-control" [(ngModel)]="oldPassphrase">
          </div>
          <div class="col-6">
            <label>New Passphrase</label>
            <input type="password" class="form-control" [(ngModel)]="newPassphrase">
          </div>
        </div>
        <div class="form-group">
          <button class="btn btn-warning" (click)="doChangePassphrase()" [disabled]="changingPassphrase">
            {{ changingPassphrase ? 'Updating...' : 'Confirm Change' }}
          </button>
          <span *ngIf="passphraseResult" class="ml-2"
                [class.text-success]="passphraseResult.success"
                [class.text-danger]="!passphraseResult.success">
            {{ passphraseResult.message }}
          </span>
        </div>
      </div>

      <hr>

      <div class="form-group">
        <button class="btn btn-info mr-2" (click)="doTest()" [disabled]="testing">
          {{ testing ? 'Testing...' : 'Test Connection' }}
        </button>
        <button class="btn btn-primary" (click)="doSave()">Save Settings</button>
        <span *ngIf="testResult" class="ml-2"
              [class.text-success]="testResult.success"
              [class.text-danger]="!testResult.success">
          {{ testResult.message }}
        </span>
        <span *ngIf="saved" class="ml-2 text-success">Settings saved!</span>
        <span *ngIf="saveError" class="ml-2 text-danger">{{ saveError }}</span>
      </div>

      <div *ngIf="isConfigured()">
        <hr>
        <h5>Sync</h5>

        <div class="form-group row">
          <div class="col-6">
            <label>
              <input type="checkbox" [(ngModel)]="config.store.configRoam.enabled" (ngModelChange)="onToggle()">
              Enable Auto Sync
            </label>
          </div>
          <div class="col-6" *ngIf="config.store.configRoam.enabled">
            <label>Interval (seconds)</label>
            <input type="number" class="form-control" [(ngModel)]="config.store.configRoam.syncIntervalSeconds"
                   min="10" (ngModelChange)="doSave()">
          </div>
        </div>

        <div class="form-group">
          <button class="btn btn-success mr-2" (click)="doUpload()"
                  [disabled]="sync.status === 'uploading' || sync.status === 'downloading'">
            Upload Now
          </button>
          <button class="btn btn-warning" (click)="doDownload()"
                  [disabled]="sync.status === 'uploading' || sync.status === 'downloading'">
            Download Now
          </button>
          <small class="text-muted ml-2">First device? Upload. Second device? Download.</small>
        </div>
      </div>
    </div>

    <!-- CATEGORIES TAB -->
    <div *ngIf="activeTab === 'categories'">
      <p class="text-muted">Select which config categories to sync. All enabled by default.</p>
      <div class="form-group" *ngFor="let cat of categories">
        <label>
          <input type="checkbox" [(ngModel)]="config.store.configRoam.categories[cat.id]" (ngModelChange)="doSave()">
          <strong>{{ cat.id | titlecase }}</strong> — {{ cat.label }}
        </label>
      </div>
      <span *ngIf="saved" class="text-success">Saved!</span>
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
        <small class="text-muted">Device ID: {{ config.store.configRoam.deviceId }} | Plugin v{{ version }}</small>
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
  saved = false
  saveError: string | null = null
  showChangePassphrase = false
  oldPassphrase = ''
  newPassphrase = ''
  changingPassphrase = false
  passphraseResult: { success: boolean; message: string } | null = null

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
    this.saved = false
    this.saveError = null
    this.testResult = await this.sync.testConnection()
    this.testing = false
  }

  doSave(): void {
    this.saveError = null
    this.config.save()
    this.sync.status = 'idle'
    this.sync.lastError = null
    this.saved = true
    this.testResult = null
    setTimeout(() => this.saved = false, 3000)
  }

  onToggle(): void {
    this.doSave()
    if (this.config.store.configRoam.enabled) {
      this.sync.start()
    } else {
      this.sync.stop()
    }
  }

  async doChangePassphrase(): Promise<void> {
    if (!this.oldPassphrase || !this.newPassphrase) {
      this.passphraseResult = { success: false, message: 'Both fields are required.' }
      return
    }
    this.changingPassphrase = true
    this.passphraseResult = null
    try {
      await this.sync.reEncryptMasterKey(this.oldPassphrase, this.newPassphrase)
      this.config.store.configRoam.encryptionPassphrase = this.newPassphrase
      this.config.save()
      this.oldPassphrase = ''
      this.newPassphrase = ''
      this.showChangePassphrase = false
      this.passphraseResult = { success: true, message: 'Passphrase changed successfully.' }
    } catch (e: any) {
      this.passphraseResult = { success: false, message: e.message || 'Failed to change passphrase.' }
    } finally {
      this.changingPassphrase = false
    }
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
