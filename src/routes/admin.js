import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../config/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// ── GET /api/admin/users ──────────────────────────────────────────
router.get('/users', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT u.*,
             m.full_name AS manager_name
      FROM users u
      LEFT JOIN users m ON m.id = u.manager_id
      ORDER BY u.id
    `);
    const safe = rows.map(({ password_hash, ...u }) => u);
    return res.json(safe);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/admin/users ─────────────────────────────────────────
router.post('/users', async (req, res) => {
  const {
    username, full_name, password,
    is_admin = false, is_active = true,
    system_functions = [],
    employee_code, manager_id,
    fund_limit = 0,
    default_project_code,
  } = req.body;

  if (!username || !full_name || !password)
    return res.status(400).json({ error: 'username, full_name, password required' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users
         (username, full_name, password_hash, must_change_pw, is_admin, is_active,
          system_functions, employee_code, manager_id, fund_limit, default_project_code)
       VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        username, full_name, hash,
        is_admin, is_active,
        system_functions,
        employee_code || null,
        manager_id    || null,
        fund_limit,
        default_project_code || null,
      ]
    );
    const { password_hash, ...safe } = rows[0];
    return res.status(201).json(safe);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/admin/users/:id ──────────────────────────────────────
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const {
    full_name, is_admin, is_active,
    system_functions, employee_code,
    manager_id, fund_limit,
    default_project_code,
  } = req.body;

  try {
    const { rows } = await query(
      `UPDATE users SET
         full_name            = COALESCE($1, full_name),
         is_admin             = COALESCE($2, is_admin),
         is_active            = COALESCE($3, is_active),
         system_functions     = COALESCE($4, system_functions),
         employee_code        = $5,
         manager_id           = $6,
         fund_limit           = COALESCE($7, fund_limit),
         default_project_code = $8
       WHERE id = $9
       RETURNING *`,
      [
        full_name, is_admin, is_active,
        system_functions,
        employee_code        || null,
        manager_id           || null,
        fund_limit,
        default_project_code || null,
        id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    const { password_hash, ...safe } = rows[0];
    return res.json(safe);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/admin/users/:id/reset-password ─────────────────────
router.post('/users/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const hash = await bcrypt.hash(new_password, 10);
    const { rowCount } = await query(
      `UPDATE users SET password_hash = $1, must_change_pw = TRUE WHERE id = $2`,
      [hash, id]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    return res.json({ message: 'Password reset — user must change on next login' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
