import { generateDEK, encryptDEK, decryptDEK, encrypt, decrypt } from '../src/crypto'

describe('crypto', () => {
  describe('DEK encrypt/decrypt', () => {
    it('round-trips DEK with correct passphrase', () => {
      const dek = generateDEK()
      const passphrase = 'test-passphrase-123'
      const encrypted = encryptDEK(dek, passphrase)
      const decrypted = decryptDEK(encrypted, passphrase)
      expect(decrypted).toEqual(dek)
    })

    it('fails with wrong passphrase', () => {
      const dek = generateDEK()
      const encrypted = encryptDEK(dek, 'correct')
      expect(() => decryptDEK(encrypted, 'wrong')).toThrow()
    })

    it('generates different ciphertext each time (random salt/iv)', () => {
      const dek = generateDEK()
      const a = encryptDEK(dek, 'pass')
      const b = encryptDEK(dek, 'pass')
      expect(a).not.toEqual(b)
    })
  })

  describe('data encrypt/decrypt', () => {
    it('round-trips data with DEK', () => {
      const dek = generateDEK()
      const plaintext = Buffer.from('hello world 你好世界')
      const encrypted = encrypt(plaintext, dek)
      const decrypted = decrypt(encrypted, dek)
      expect(decrypted).toEqual(plaintext)
    })

    it('fails with wrong DEK', () => {
      const dek1 = generateDEK()
      const dek2 = generateDEK()
      const encrypted = encrypt(Buffer.from('secret'), dek1)
      expect(() => decrypt(encrypted, dek2)).toThrow()
    })

    it('handles empty buffer', () => {
      const dek = generateDEK()
      const plaintext = Buffer.alloc(0)
      const encrypted = encrypt(plaintext, dek)
      const decrypted = decrypt(encrypted, dek)
      expect(decrypted).toEqual(plaintext)
    })

    it('handles large data', () => {
      const dek = generateDEK()
      const plaintext = Buffer.alloc(1024 * 100, 'x')
      const encrypted = encrypt(plaintext, dek)
      const decrypted = decrypt(encrypted, dek)
      expect(decrypted).toEqual(plaintext)
    })
  })

  describe('generateDEK', () => {
    it('returns 32 bytes', () => {
      const dek = generateDEK()
      expect(dek.length).toBe(32)
    })

    it('generates unique keys', () => {
      const a = generateDEK()
      const b = generateDEK()
      expect(a).not.toEqual(b)
    })
  })
})
