export interface SyncMetadata {
  timestamp: number
  deviceId: string
}

export interface SyncAdapter {
  upload(categoryId: string, data: Buffer, metadata: SyncMetadata): Promise<void>
  download(categoryId: string): Promise<{ data: Buffer; metadata: SyncMetadata } | null>
  getRemoteMetadata(categoryId: string): Promise<SyncMetadata | null>
  uploadMasterKey(data: Buffer): Promise<void>
  downloadMasterKey(): Promise<Buffer | null>
  writeTestFile(): Promise<void>
}
