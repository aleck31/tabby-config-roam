import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ConfigProvider } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { SyncConfigProvider } from './config'
import { SyncSettingsTabProvider } from './settings.tab'
import { SyncSettingsComponent } from './components/settings.component'
import { SyncService } from './sync.service'

@NgModule({
  imports: [CommonModule, FormsModule],
  declarations: [SyncSettingsComponent],
  providers: [
    { provide: ConfigProvider, useClass: SyncConfigProvider, multi: true },
    { provide: SettingsTabProvider, useClass: SyncSettingsTabProvider, multi: true },
    SyncService,
  ],
})
export default class TabbySyncModule {
  constructor(private sync: SyncService) {
    // SyncService auto-starts via config.ready$ subscription
  }
}
