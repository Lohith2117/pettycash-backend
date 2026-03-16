import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

// ── Factory: create a simple CRUD router for a table ─────────────
function makeMasterRouter({ table, codeField = 'code' }) {
  const router = Router();
  router.use(requireAuth);

  // GET all active
  router.get('/', async (_req, res) => {
    try {
      const { rows } = await query(`SELECT * FROM ${table} WHERE is_active = TRUE ORDER BY ${codeField}`);
      return res.json(rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // POST create
  router.post('/', requireAdmin, async (req, res) => {
    const { code, name, ...extra } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name required' });

    if (table === 'projects') {
      const { default_division_code, default_department_code } = extra;
      try {
        const { rows } = await query(
          `INSERT INTO projects (code, name, default_division_code, default_department_code)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [code, name, default_division_code || null, default_department_code || null]
        );
        return res.status(201).json(rows[0]);
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }
    }

    try {
      const { rows } = await query(
        `INSERT INTO ${table} (code, name) VALUES ($1,$2) RETURNING *`,
        [code, name]
      );
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Code already exists' });
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT update
  router.put('/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, is_active, ...extra } = req.body;

    if (table === 'projects') {
      const { default_division_code, default_department_code } = extra;
      try {
        const { rows } = await query(
          `UPDATE projects SET
             name = COALESCE($1, name),
             is_active = COALESCE($2, is_active),
             default_division_code = $3,
             default_department_code = $4
           WHERE id = $5 RETURNING *`,
          [name, is_active, default_division_code || null, default_department_code || null, id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Not found' });
        return res.json(rows[0]);
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }
    }

    try {
      const { rows } = await query(
        `UPDATE ${table} SET name = COALESCE($1, name), is_active = COALESCE($2, is_active) WHERE id = $3 RETURNING *`,
        [name, is_active, id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      return res.json(rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // DELETE soft
  router.delete('/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      await query(`UPDATE ${table} SET is_active = FALSE WHERE id = $1`, [id]);
      return res.json({ message: 'Deactivated' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
}

export const divisionsRouter   = makeMasterRouter({ table: 'divisions' });
export const departmentsRouter = makeMasterRouter({ table: 'departments' });
export const projectsRouter    = makeMasterRouter({ table: 'projects' });
