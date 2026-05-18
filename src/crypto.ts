import * as crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const SALT_LENGTH = 16
const PBKDF2_ITERATIONS = 100000

/** Derive a KEK from user passphrase */
function deriveKEK(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

/** Encrypt arbitrary data with a given key */
function encryptWithKey(data: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Format: iv(12) + authTag(16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted])
}

/** Decrypt data with a given key */
function decryptWithKey(payload: Buffer, key: Buffer): Buffer {
  const iv = payload.subarray(0, IV_LENGTH)
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16)
  const encrypted = payload.subarray(IV_LENGTH + 16)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

/** Generate a random Data Encryption Key */
export function generateDEK(): Buffer {
  return crypto.randomBytes(KEY_LENGTH)
}

/** Encrypt DEK with user passphrase → stored as master.key */
export function encryptDEK(dek: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const kek = deriveKEK(passphrase, salt)
  const encrypted = encryptWithKey(dek, kek)
  // Format: salt(16) + encrypted DEK
  return Buffer.concat([salt, encrypted])
}

/** Decrypt DEK from master.key using user passphrase */
export function decryptDEK(payload: Buffer, passphrase: string): Buffer {
  const salt = payload.subarray(0, SALT_LENGTH)
  const kek = deriveKEK(passphrase, salt)
  return decryptWithKey(payload.subarray(SALT_LENGTH), kek)
}

/** Encrypt data using DEK (for category files) */
export function encrypt(data: Buffer, dek: Buffer): Buffer {
  return encryptWithKey(data, dek)
}

/** Decrypt data using DEK (for category files) */
export function decrypt(payload: Buffer, dek: Buffer): Buffer {
  return decryptWithKey(payload, dek)
}
