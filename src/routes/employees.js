import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ── GET /api/employees ────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM employees WHERE is_active = TRUE ORDER BY code'
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/employees ───────────────────────────────────────────
router.post('/', requireRole('employee_definition'), async (req, res) => {
  const u = req.user;
  const { code, name, division, division_code, designation } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });

  try {
    const { rows } = await query(
      `INSERT INTO employees (code, name, division, division_code, designation, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code, name, division || null, division_code || null, designation || null, u.id]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Employee code already exists' });
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/employees/:code ──────────────────────────────────────
router.put('/:code', requireRole('employee_definition'), async (req, res) => {
  const { code } = req.params;
  const { name, division, division_code, designation } = req.body;
  try {
    const { rows } = await query(
      `UPDATE employees SET
         name = COALESCE($1, name),
         division = $2, division_code = $3, designation = $4
       WHERE code = $5 AND is_active = TRUE RETURNING *`,
      [name, division || null, division_code || null, designation || null, code]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/employees/:code (soft) ───────────────────────────
router.delete('/:code', requireRole('employee_definition'), async (req, res) => {
  const { code } = req.params;
  try {
    const { rowCount } = await query(
      'UPDATE employees SET is_active = FALSE WHERE code = $1', [code]
    );
    if (!rowCount) return res.status(404).json({ error: 'Employee not found' });
    return res.json({ message: 'Employee deactivated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
