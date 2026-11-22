'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
class SecureTokenStore {
  constructor({ storage, file }) { this.storage = storage; this.file = file; }
  async availability() {
    // Do not persist plaintext in any circumstance.
    if (typeof this.storage.isAsyncEncryptionAvailable === 'function') {
      return !!(await this.storage.isAsyncEncryptionAvailable());
    }
    return !!this.storage.isEncryptionAvailable();
  }
  async encrypt(text) {
    if (!(await this.availability())) throw new Error('운영체제 보안 저장소를 사용할 수 없습니다.');
    if (typeof this.storage.encryptStringAsync === 'function') return this.storage.encryptStringAsync(text);
    return this.storage.encryptString(text);
  }
  async decrypt(buffer) {
    if (!(await this.availability())) throw new Error('운영체제 보안 저장소를 사용할 수 없습니다.');
    if (typeof this.storage.decryptStringAsync === 'function') {
      const data = await this.storage.decryptStringAsync(buffer);
      return data.result;
    }
    return this.storage.decryptString(buffer);
  }
  async get() {
    let bytes;
    try { bytes = await fs.readFile(this.file); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    return this.decrypt(bytes);
  }
  async set(token) {
    if (typeof token !== 'string' || !token) throw new Error('저장할 Refresh Token이 없습니다.');
    const encrypted = await this.encrypt(token);
    const tmp = this.file + '.tmp';
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      await fs.writeFile(tmp, encrypted, { mode: 0o600 });
      // Windows rename may not replace a pre-existing file.
      try { await fs.rename(tmp, this.file); }
      catch (err) {
        if (process.platform !== 'win32' || !['EEXIST', 'EPERM', 'EACCES'].includes(err.code)) throw err;
        await fs.rm(this.file, { force: true });
        await fs.rename(tmp, this.file);
      }
    } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  }
  async clear() { await Promise.all([fs.rm(this.file, { force: true }), fs.rm(this.file + '.tmp', { force: true })]); }
}
module.exports = { SecureTokenStore };
