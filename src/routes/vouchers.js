import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ── Helper: generate next ref_no (X0001, X0002 …) ────────────────
async function nextRefNo() {
  const { rows } = await query(`
    SELECT ref_no FROM vouchers
    WHERE ref_no ~ '^X[0-9]+$'
    ORDER BY CAST(SUBSTRING(ref_no FROM 2) AS INTEGER) DESC
    LIMIT 1
  `);
  if (!rows.length) return 'X0001';
  const num = parseInt(rows[0].ref_no.slice(1), 10) + 1;
  return `X${String(num).padStart(4, '0')}`;
}

// ── GET /api/vouchers/validate-charge ────────────────────────────
// 9-month cycle check for employee-linked expense types
router.get('/validate-charge', async (req, res) => {
  const { emp_code, expense_type, line_date } = req.query;
  if (!emp_code || !expense_type || !line_date)
    return res.status(400).json({ error: 'emp_code, expense_type, line_date required' });

  try {
    const { rows } = await query(`
      SELECT vl.line_date
      FROM voucher_lines vl
      JOIN vouchers v ON v.id = vl.voucher_id
      WHERE vl.emp_code     = $1
        AND vl.expense_type = $2
        AND v.status NOT IN ('Rejected','Draft')
      ORDER BY vl.line_date DESC
      LIMIT 1
    `, [emp_code, expense_type]);

    if (!rows.length) return res.json({ allowed: true });

    const lastDate = new Date(rows[0].line_date);
    const nextAllowed = new Date(lastDate);
    nextAllowed.setMonth(nextAllowed.getMonth() + 9);

    const requested = new Date(line_date);
    if (requested >= nextAllowed) return res.json({ allowed: true });

    return res.json({
      allowed: false,
      last_date:    lastDate.toISOString().slice(0, 10),
      next_allowed: nextAllowed.toISOString().slice(0, 10),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/vouchers ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const u = req.user;
  try {
    let rows;

    if (u.is_admin) {
      ({ rows } = await query(`
        SELECT v.*, u.full_name AS created_by_name
        FROM vouchers v JOIN users u ON u.id = v.created_by_user
        ORDER BY v.created_at DESC
      `));
    } else if (u.system_functions?.includes('chief_accountant')) {
      ({ rows } = await query(`
        SELECT v.*, u.full_name AS created_by_name
        FROM vouchers v JOIN users u ON u.id = v.created_by_user
        ORDER BY v.created_at DESC
      `));
    } else if (u.is_manager) {
      ({ rows } = await query(`
        SELECT v.*, u.full_name AS created_by_name
        FROM vouchers v
        JOIN users u ON u.id = v.created_by_user
        WHERE u.manager_id = $1
        ORDER BY v.created_at DESC
      `, [u.id]));
    } else if (u.system_functions?.includes('cashier')) {
      ({ rows } = await query(`
        SELECT v.*, u.full_name AS created_by_name
        FROM vouchers v JOIN users u ON u.id = v.created_by_user
        WHERE v.status IN ('Approved','Paid')
        ORDER BY v.created_at DESC
      `));
    } else {
      // petty cash holder — own vouchers only
      ({ rows } = await query(`
        SELECT v.*, u.full_name AS created_by_name
        FROM vouchers v JOIN users u ON u.id = v.created_by_user
        WHERE v.created_by_user = $1
        ORDER BY v.created_at DESC
      `, [u.id]));
    }

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/vouchers/:id ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(`
      SELECT v.*,
             cb.full_name    AS created_by_name,
             ma.full_name    AS manager_approved_name,
             ap.full_name    AS approved_name,
             rb.full_name    AS rejected_name,
             pb.full_name    AS paid_name
      FROM vouchers v
      LEFT JOIN users cb ON cb.id = v.created_by_user
      LEFT JOIN users ma ON ma.id = v.manager_approved_by
      LEFT JOIN users ap ON ap.id = v.approved_by
      LEFT JOIN users rb ON rb.id = v.rejected_by
      LEFT JOIN users pb ON pb.id = v.paid_by
      WHERE v.id = $1
    `, [id]);

    if (!rows[0]) return res.status(404).json({ error: 'Voucher not found' });

    const { rows: lines } = await query(
      'SELECT * FROM voucher_lines WHERE voucher_id = $1 ORDER BY line_order, id',
      [id]
    );
    const { rows: attachments } = await query(
      'SELECT * FROM voucher_attachments WHERE voucher_id = $1 ORDER BY created_at',
      [id]
    );

    return res.json({ ...rows[0], lines, attachments });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/vouchers ────────────────────────────────────────────
router.post('/', requireRole('petty_cash_holder'), async (req, res) => {
  const u = req.user;
  const { date, division, project_code, project_name, lines = [] } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });

  const client = await (await import('../config/db.js')).default.connect();
  try {
    await client.query('BEGIN');
    const ref_no = await nextRefNo();

    const { rows } = await client.query(`
      INSERT INTO vouchers
        (ref_no, date, created_by_user, holder_name, holder_emp_code,
         division, project_code, project_name, status, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Draft',$9)
      RETURNING *
    `, [
      ref_no, date, u.id, u.full_name, u.employee_code,
      division, project_code, project_name,
      lines.reduce((s, l) => s + Number(l.amount || 0), 0),
    ]);

    const voucher = rows[0];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(`
        INSERT INTO voucher_lines
          (voucher_id, line_order, expense_type, emp_code, emp_name, amount, line_date, invoice_no)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [voucher.id, i, l.expense_type, l.emp_code || null, l.emp_name || null,
          l.amount, l.line_date, l.invoice_no || null]);
    }

    await client.query('COMMIT');
    return res.status(201).json(voucher);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── PUT /api/vouchers/:id ─────────────────────────────────────────
router.put('/:id', requireRole('petty_cash_holder'), async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  const { date, division, project_code, project_name, lines = [] } = req.body;

  const client = await (await import('../config/db.js')).default.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM vouchers WHERE id = $1 AND status = $2',
      [id, 'Draft']
    );
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'Draft voucher not found' });
    if (!u.is_admin && v.created_by_user !== u.id)
      return res.status(403).json({ error: 'Not your voucher' });

    const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const { rows: updated } = await client.query(`
      UPDATE vouchers SET
        date = $1, division = $2, project_code = $3, project_name = $4, total = $5
      WHERE id = $6 RETURNING *
    `, [date, division, project_code, project_name, total, id]);

    await client.query('DELETE FROM voucher_lines WHERE voucher_id = $1', [id]);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(`
        INSERT INTO voucher_lines
          (voucher_id, line_order, expense_type, emp_code, emp_name, amount, line_date, invoice_no)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [id, i, l.expense_type, l.emp_code || null, l.emp_name || null,
          l.amount, l.line_date, l.invoice_no || null]);
    }

    await client.query('COMMIT');
    return res.json(updated[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── POST /api/vouchers/:id/submit ─────────────────────────────────
router.post('/:id/submit', requireRole('petty_cash_holder'), async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT v.*, u.manager_id FROM vouchers v
       JOIN users u ON u.id = v.created_by_user
       WHERE v.id = $1 AND v.status = 'Draft'`, [id]
    );
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'Draft voucher not found' });
    if (!u.is_admin && v.created_by_user !== u.id)
      return res.status(403).json({ error: 'Not your voucher' });

    const { rows: linesCheck } = await query(
      'SELECT id FROM voucher_lines WHERE voucher_id = $1 LIMIT 1', [id]
    );
    if (!linesCheck.length) return res.status(400).json({ error: 'Add at least one expense line before submitting' });

    // If no manager, auto-skip to Manager Approved
    const newStatus = v.manager_id ? 'Submitted' : 'Manager Approved';
    const { rows: updated } = await query(
      `UPDATE vouchers SET status = $1, submitted_date = CURRENT_DATE WHERE id = $2 RETURNING *`,
      [newStatus, id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/vouchers/:id/manager-approve ────────────────────────
router.post('/:id/manager-approve', async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT v.*, holder.manager_id FROM vouchers v
       JOIN users holder ON holder.id = v.created_by_user
       WHERE v.id = $1 AND v.status = 'Submitted'`, [id]
    );
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'Submitted voucher not found' });

    if (!u.is_admin && v.manager_id !== u.id)
      return res.status(403).json({ error: 'You are not the assigned manager' });

    const { rows: updated } = await query(
      `UPDATE vouchers SET status = 'Manager Approved', manager_approved_by = $1, manager_approved_date = CURRENT_DATE
       WHERE id = $2 RETURNING *`,
      [u.id, id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/vouchers/:id/manager-reject ────────────────────────
router.post('/:id/manager-reject', async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  const { reason } = req.body;
  try {
    const { rows } = await query(
      `SELECT v.*, holder.manager_id FROM vouchers v
       JOIN users holder ON holder.id = v.created_by_user
       WHERE v.id = $1 AND v.status = 'Submitted'`, [id]
    );
    const v = rows[0];
    if (!v) return res.status(404).json({ error: 'Submitted voucher not found' });

    if (!u.is_admin && v.manager_id !== u.id)
      return res.status(403).json({ error: 'You are not the assigned manager' });

    const { rows: updated } = await query(
      `UPDATE vouchers SET status = 'Draft', rejected_by = $1, rejected_date = CURRENT_DATE, reject_reason = $2
       WHERE id = $3 RETURNING *`,
      [u.id, reason || null, id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/vouchers/:id/approve (CA) ──────────────────────────
router.post('/:id/approve', requireRole('chief_accountant'), async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT * FROM vouchers WHERE id = $1 AND status = 'Manager Approved'`, [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Voucher not in Manager Approved state' });

    const { rows: updated } = await query(
      `UPDATE vouchers SET status = 'Approved', approved_by = $1, approved_date = CURRENT_DATE
       WHERE id = $2 RETURNING *`,
      [u.id, id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/vouchers/:id/reject (CA) ───────────────────────────
router.post('/:id/reject', requireRole('chief_accountant'), async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  const { reason } = req.body;
  try {
    const { rows } = await query(
      `SELECT * FROM vouchers WHERE id = $1 AND status = 'Manager Approved'`, [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Voucher not in Manager Approved state' });

    const { rows: updated } = await query(
      `UPDATE vouchers SET status = 'Rejected', rejected_by = $1, rejected_date = CURRENT_DATE, reject_reason = $2
       WHERE id = $3 RETURNING *`,
      [u.id, reason || null, id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/vouchers/:id/pay ────────────────────────────────────
router.post('/:id/pay', requireRole('cashier'), async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT * FROM vouchers WHERE id = $1 AND status = 'Approved'`, [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Voucher not in Approved state' });

    const { rows: updated } = await query(
      `UPDATE vouchers SET status = 'Paid', paid_by = $1, paid_date = CURRENT_DATE
       WHERE id = $2 RETURNING *`,
      [u.id, id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
