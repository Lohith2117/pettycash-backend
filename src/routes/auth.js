import { Router } from 'express';
import { query } from '../config/db.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

// ── POST /api/auth/login ──────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  // LOG: See exactly what the frontend is sending
  console.log(`DEBUG: Login attempt - User: [${username}] Pass: [${password}]`);

  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  try {
    const { rows } = await query(
      `SELECT u.*,
              (SELECT COUNT(*) > 0 FROM users m WHERE m.manager_id = u.id AND m.is_active = TRUE) AS is_manager
       FROM users u
       WHERE TRIM(u.username) = TRIM($1) AND u.is_active = TRUE`,
      [username]
    );

    const user = rows[0];

    if (!user) {
      console.log(`DEBUG: User [${username}] not found in DB or is inactive.`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // LOG: See exactly what the database retrieved
    console.log(`DEBUG: DB User Found - Username: [${user.username}] DB_Pass: [${user.password_hash}]`);

    // Clean comparison: remove any accidental whitespace from both sides
    const match = (password.trim() === user.password_hash.trim());

    if (!match) {
      console.log(`DEBUG: Password mismatch. Received: [${password.trim()}], Expected: [${user.password_hash.trim()}]`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const payload = {
      id:                   user.id,
      username:             user.username,
      full_name:            user.full_name,
      is_admin:             user.is_admin,
      system_functions:     user.system_functions,
      employee_code:        user.employee_code,
      manager_id:           user.manager_id,
      fund_limit:           user.fund_limit,
      fund_active:          user.fund_active,
      default_project_code: user.default_project_code,
      is_manager:           user.is_manager,
      must_change_pw:       user.must_change_pw,
    };

    const token = signToken(payload);
    console.log(`DEBUG: Login SUCCESS for ${username}`);
    return res.json({ token, user: payload });

  } catch (err) {
    console.error("DEBUG: CRITICAL DATABASE ERROR:", err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });

  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!req.user.must_change_pw) {
      if (!current_password) return res.status(400).json({ error: 'Current password required' });
      
      const match = (current_password.trim() === user.password_hash.trim());
      if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    }

    await query(
      'UPDATE users SET password_hash = $1, must_change_pw = FALSE WHERE id = $2',
      [new_password.trim(), req.user.id]
    );

    return res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.*,
              (SELECT COUNT(*) > 0 FROM users m WHERE m.manager_id = u.id AND m.is_active = TRUE) AS is_manager
       FROM users u WHERE u.id = $1 AND u.is_active = TRUE`,
      [req.user.id]
    );

    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password_hash, ...safe } = user;
    return res.json(safe);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
