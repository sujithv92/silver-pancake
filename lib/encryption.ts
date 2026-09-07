import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || process.env.ADMIN_PASSWORD || 'default-dev-key-please-change-in-prod-32';
  // Hash to 32 bytes if needed
  return crypto.createHash('sha256').update(key).digest();
}

export function encrypt(text: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (e) {
    console.error('Encryption failed, storing as plain (dev mode):', e);
    return `plain:${Buffer.from(text).toString('base64')}`;
  }
}

export function decrypt(encryptedText: string): string {
  try {
    if (encryptedText.startsWith('plain:')) {
      return Buffer.from(encryptedText.slice(6), 'base64').toString('utf8');
    }

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      // Maybe it's not encrypted, return as is for backwards compat
      return encryptedText;
    }

    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (e) {
    console.error('Decryption failed:', e);
    // Try to return as is if decryption fails (might be plain key)
    if (encryptedText.startsWith('sk-') || encryptedText.length > 20) {
      return encryptedText;
    }
    throw e;
  }
}

export function maskKey(key: string): string {
  if (!key || key.length < 8) return '****';
  if (key.length <= 12) return key.slice(0, 3) + '****' + key.slice(-2);
  return key.slice(0, 7) + '...' + key.slice(-4);
}

export function isEncrypted(text: string): boolean {
  return text.includes(':') && text.split(':').length === 3 && /^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/i.test(text);
}
