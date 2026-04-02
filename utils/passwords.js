const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }

  const [salt, expectedHash] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expectedHash, 'hex'),
    Buffer.from(derivedKey, 'hex')
  );
}

function generateTemporaryPassword(length = 12) {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(length);

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function generateNumericCode(length = 6) {
  let code = '';

  while (code.length < length) {
    code += crypto.randomInt(0, 10).toString();
  }

  return code.slice(0, length);
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateTemporaryPassword,
  generateNumericCode,
};
