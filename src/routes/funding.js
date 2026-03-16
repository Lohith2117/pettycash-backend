import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('cashier'));

// ── GET /api/funding/fund-holders ────────────────────────────────
router.get('/fund-holders', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        u.id, u.full_name, u.employee_code, u.fund_limit, u.fund_active,
        u.default_project_code, u.is_active,
        COALESCE(SUM(CASE WHEN ft.type = 'funding' THEN ft.amount ELSE -ft.amount END), 0)
          - COALESCE((SELECT SUM(v.total) FROM vouchers v WHERE v.created_by_user = u.id AND v.status = 'Paid'), 0)
          AS balance
      FROM users u
      LEFT JOIN fund_transactions ft ON ft.fund_holder_id = u.id
      WHERE 'petty_cash_holder' = ANY(u.system_functions) AND u.is_active = TRUE
      GROUP BY u.id
      ORDER BY u.full_name
    `);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/funding/fund ────────────────────────────────────────
router.post('/fund', async (req, res) => {
  const u = req.user;
  const { fund_holder_id, amount, notes } = req.body;
  if (!fund_holder_id || !amount || Number(amount) <= 0)
    return res.status(400).json({ error: 'fund_holder_id and positive amount required' });

  const client = await (await import('../config/db.js')).default.connect();
  try {
    await client.query('BEGIN');

    const { rows: holderRows } = await client.query(
      `SELECT u.*, COALESCE(SUM(CASE WHEN ft.type='funding' THEN ft.amount ELSE -ft.amount END),0) AS net_funded
       FROM users u
       LEFT JOIN fund_transactions ft ON ft.fund_holder_id = u.id
       WHERE u.id = $1 AND 'petty_cash_holder' = ANY(u.system_functions)
       GROUP BY u.id`,
      [fund_holder_id]
    );
    const holder = holderRows[0];
    if (!holder) return res.status(404).json({ error: 'Fund holder not found' });

    const newNet = Number(holder.net_funded) + Number(amount);
    if (holder.fund_limit > 0 && newNet > Number(holder.fund_limit)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Exceeds fund limit. Limit: ${holder.fund_limit}, Current net: ${holder.net_funded}, Adding: ${amount}`,
      });
    }

    await client.query(
      `INSERT INTO fund_transactions (fund_holder_id, type, amount, performed_by, notes)
       VALUES ($1,'funding',$2,$3,$4)`,
      [fund_holder_id, amount, u.id, notes || null]
    );

    // Auto-activate on first funding
    if (!holder.fund_active) {
      await client.query('UPDATE users SET fund_active = TRUE WHERE id = $1', [fund_holder_id]);
    }

    await client.query('COMMIT');
    return res.status(201).json({ message: 'Fund allocated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── POST /api/funding/close ───────────────────────────────────────
router.post('/close', async (req, res) => {
  const u = req.user;
  const { fund_holder_id, notes } = req.body;
  if (!fund_holder_id) return res.status(400).json({ error: 'fund_holder_id required' });

  const client = await (await import('../config/db.js')).default.connect();
  try {
    await client.query('BEGIN');

    // Check for pending vouchers
    const { rows: pending } = await client.query(
      `SELECT id FROM vouchers
       WHERE created_by_user = $1 AND status NOT IN ('Draft','Paid','Rejected')
       LIMIT 1`,
      [fund_holder_id]
    );
    if (pending.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot close fund: holder has pending vouchers in pipeline' });
    }

    // Compute balance
    const { rows: balRows } = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='funding' THEN amount ELSE -amount END), 0)
           - COALESCE((SELECT SUM(total) FROM vouchers WHERE created_by_user = $1 AND status='Paid'),0)
         AS balance
       FROM fund_transactions WHERE fund_holder_id = $1`,
      [fund_holder_id]
    );
    const balance = Number(balRows[0].balance);

    if (balance > 0) {
      await client.query(
        `INSERT INTO fund_transactions (fund_holder_id, type, amount, performed_by, notes)
         VALUES ($1,'closing',$2,$3,$4)`,
        [fund_holder_id, balance, u.id, notes || 'Fund closed']
      );
    }

    await client.query('UPDATE users SET fund_active = FALSE WHERE id = $1', [fund_holder_id]);

    await client.query('COMMIT');
    return res.json({ message: 'Fund closed successfully', amount_recovered: balance > 0 ? balance : 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/funding/transactions/:userId ─────────────────────────
router.get('/transactions/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const { rows } = await query(
      `SELECT ft.*, u.full_name AS performed_by_name
       FROM fund_transactions ft
       JOIN users u ON u.id = ft.performed_by
       WHERE ft.fund_holder_id = $1
       ORDER BY ft.created_at DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
