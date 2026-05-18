import { ConfigProvider } from 'tabby-core'

export class SyncConfigProvider extends ConfigProvider {
  defaults = {
    configRoam: {
      enabled: false,
      adapter: 's3',
      autoSync: true,
      syncIntervalSeconds: 60,
      encryptionPassphrase: '',
      deviceId: '',
      lastSyncTimestamp: 0,
      categories: {
        profiles: true,
        vault: true,
        appearance: true,
        ssh: true,
        app: true,
      },
      s3: {
        region: '',
        bucket: '',
        prefix: 'tabby-config-roam/',
        accessKeyId: '',
        secretAccessKey: '',
        endpoint: '',
      },
    },
  }
  platformDefaults = {}
}
