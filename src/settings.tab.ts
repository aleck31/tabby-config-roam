import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { SyncSettingsComponent } from './components/settings.component'

@Injectable()
export class SyncSettingsTabProvider extends SettingsTabProvider {
  id = 'tabby-config-roam'
  icon = 'cloud'
  title = 'Config Roam'
  weight = 20

  getComponentType(): any {
    return SyncSettingsComponent
  }
}
