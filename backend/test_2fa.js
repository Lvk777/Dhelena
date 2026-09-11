import jwt from 'jsonwebtoken';
import { pool } from './src/config/db.js';
import { encrypt, decrypt } from './src/lib/crypto.js';

(async () => {
  const adminPwd = process.env.ADMIN_PASSWORD;
  const { rows } = await pool.query("SELECT id, email, role, password_hash FROM profiles WHERE email = 'admin@dhelenas.com'");
  const user = rows[0];
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
  
  const { authenticator } = await import('otplib');
  const secret = authenticator.generateSecret();
  const encryptedSecret = encrypt(secret);
  await pool.query('UPDATE profiles SET totp_secret_encrypted = $1 WHERE id = $2', [encryptedSecret, user.id]);
  console.log('1. Setup 2FA: secret generated and encrypted');
  
  const code = authenticator.generate(secret);
  console.log('2. TOTP code generated:', code);
  
  const isValid = authenticator.verify({ token: code, secret });
  console.log('3. Verify code:', isValid);
  
  const recoveryCodes = Array.from({ length: 8 }, () => 
    Math.random().toString(36).substring(2, 10).toUpperCase()
  );
  const encryptedRecovery = encrypt(JSON.stringify(recoveryCodes));
  await pool.query('UPDATE profiles SET totp_enabled = TRUE, recovery_codes_encrypted = $1 WHERE id = $2', [encryptedRecovery, user.id]);
  console.log('4. Recovery codes:', recoveryCodes.length, 'codes generated');
  console.log('5. 2FA enabled in profile');
  
  const { rows: statusRows } = await pool.query('SELECT totp_enabled, require_2fa FROM profiles WHERE id = $1', [user.id]);
  console.log('6. Status: enabled=' + statusRows[0].totp_enabled + ' require_2fa=' + statusRows[0].require_2fa);
  
  await pool.query('UPDATE profiles SET totp_enabled = FALSE, totp_secret_encrypted = NULL, recovery_codes_encrypted = NULL WHERE id = $1', [user.id]);
  console.log('7. 2FA disabled (cleanup)');
  
  const { rows: disabledRows } = await pool.query('SELECT totp_enabled FROM profiles WHERE id = $1', [user.id]);
  console.log('8. After disable: enabled=' + disabledRows[0].totp_enabled);
  
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
