import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM expense_types WHERE is_active = TRUE ORDER BY name');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const { name, is_employee_linked = false } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { rows } = await query(
      `INSERT INTO expense_types (name, is_employee_linked) VALUES ($1,$2) RETURNING *`,
      [name, is_employee_linked]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Expense type already exists' });
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, is_employee_linked, is_active } = req.body;
  try {
    const { rows } = await query(
      `UPDATE expense_types SET
         name = COALESCE($1, name),
         is_employee_linked = COALESCE($2, is_employee_linked),
         is_active = COALESCE($3, is_active)
       WHERE id = $4 RETURNING *`,
      [name, is_employee_linked, is_active, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await query('UPDATE expense_types SET is_active = FALSE WHERE id = $1', [id]);
    return res.json({ message: 'Expense type deactivated' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
