import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { SyncAdapter, Manifest } from './adapter.interface'

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
    return `${this.normalizePrefix()}${categoryId}.enc`
  }

  private getMasterKeyPath(): string {
    return `${this.normalizePrefix()}master.key`
  }

  private getManifestPath(): string {
    return `${this.normalizePrefix()}manifest.json`
  }

  private normalizePrefix(): string {
    return this.config.prefix.endsWith('/') ? this.config.prefix : this.config.prefix + '/'
  }

  private async getBytes(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }))
      const body = await response.Body!.transformToByteArray()
      return Buffer.from(body)
    } catch (e: any) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null
      throw e
    }
  }

  async writeTestFile(): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: `${this.normalizePrefix()}README.txt`,
      Body: `This directory is used by tabby-config-roam to sync Tabby terminal settings.\nDo not delete or modify files here manually.\nCreated at ${new Date().toISOString()}`,
      ContentType: 'text/plain',
    }))
  }

  async probeReadAccess(): Promise<void> {
    // HEAD on the manifest path: 404 is fine (first-time setup), only auth errors throw.
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getManifestPath(),
      }))
    } catch (e: any) {
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return
      throw e
    }
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
    return this.getBytes(this.getMasterKeyPath())
  }

  async deleteMasterKey(): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: this.getMasterKeyPath(),
    }))
  }

  async upload(categoryId: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.getKey(categoryId),
      Body: data,
      ContentType: 'application/octet-stream',
    }))
  }

  async download(categoryId: string): Promise<Buffer | null> {
    return this.getBytes(this.getKey(categoryId))
  }

  async uploadManifest(manifest: Manifest): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.getManifestPath(),
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-cache',
    }))
  }

  async downloadManifest(): Promise<Manifest | null> {
    const bytes = await this.getBytes(this.getManifestPath())
    return bytes ? JSON.parse(bytes.toString('utf-8')) : null
  }
}
