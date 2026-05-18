export interface SyncCategory {
  id: string
  label: string
  fields: string[]
}

export const SYNC_CATEGORIES: SyncCategory[] = [
  {
    id: 'profiles',
    label: 'Profiles (SSH, Serial, Local Shell connections)',
    fields: ['profiles', 'groups', 'profileDefaults', 'profileBlacklist', 'defaultQuickConnectProvider'],
  },
  {
    id: 'vault',
    label: 'Vault (Private keys, passwords)',
    fields: ['vault', 'encrypted'],
  },
  {
    id: 'appearance',
    label: 'Appearance (Theme, font, hotkeys, language)',
    fields: ['appearance', 'terminal', 'hotkeys', 'accessibility', 'globalHotkey', 'language'],
  },
  {
    id: 'ssh',
    label: 'SSH Settings (Known hosts, agent config)',
    fields: ['ssh'],
  },
  {
    id: 'app',
    label: 'App Settings (Updates, plugins, hacks)',
    fields: ['recoverTabs', 'enableAnalytics', 'enableWelcomeTab', 'electronFlags', 'enableAutomaticUpdates', 'hideTray', 'enableExperimentalFeatures', 'hacks', 'pluginBlacklist', 'commandBlacklist', 'providerBlacklist'],
  },
]

// Fields that should never be synced
export const EXCLUDED_FIELDS = ['version', 'configSync', 'configRoam']
