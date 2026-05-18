import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { SyncAdapter, SyncMetadata } from './adapter.interface'

export interface S3Config {
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
}

export class S3Adapter implements SyncAdapter {
  private client: S3Client

  constructor(private config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      requestHandler: new NodeHttpHandler(),
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    })
  }

  private getKey(categoryId: string): string {
    const prefix = this.normalizePrefix()
    return `${prefix}${categoryId}.enc`
  }

  private getMasterKeyPath(): string {
    return `${this.normalizePrefix()}master.key`
  }

  private normalizePrefix(): string {
    return this.config.prefix.endsWith('/') ? this.config.prefix : this.config.prefix + '/'
  }

  async writeTestFile(): Promise<void> {
    const key = `${this.normalizePrefix()}README.txt`
    const body = `This directory is used by tabby-config-roam to sync Tabby terminal settings.\nDo not delete or modify files here manually.\nCreated at ${new Date().toISOString()}`
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: 'text/plain',
    }))
  }

  async uploadMasterKey(data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.getMasterKeyPath(),
      Body: data,
      ContentType: 'application/octet-stream',
    }))
  }

  async downloadMasterKey(): Promise<Buffer | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getMasterKeyPath(),
      }))
      const body = await response.Body!.transformToByteArray()
      return Buffer.from(body)
    } catch (e: any) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null
      throw e
    }
  }

  async upload(categoryId: string, data: Buffer, metadata: SyncMetadata): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.getKey(categoryId),
      Body: data,
      Metadata: {
        timestamp: String(metadata.timestamp),
        deviceid: metadata.deviceId,
      },
    }))
  }

  async download(categoryId: string): Promise<{ data: Buffer; metadata: SyncMetadata } | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getKey(categoryId),
      }))
      const body = await response.Body!.transformToByteArray()
      return {
        data: Buffer.from(body),
        metadata: {
          timestamp: Number(response.Metadata?.timestamp ?? 0),
          deviceId: response.Metadata?.deviceid ?? 'unknown',
        },
      }
    } catch (e: any) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null
      throw e
    }
  }

  async getRemoteMetadata(categoryId: string): Promise<SyncMetadata | null> {
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getKey(categoryId),
      }))
      return {
        timestamp: Number(response.Metadata?.timestamp ?? 0),
        deviceId: response.Metadata?.deviceid ?? 'unknown',
      }
    } catch (e: any) {
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null
      throw e
    }
  }
}
