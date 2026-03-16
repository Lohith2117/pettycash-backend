import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { upload, UPLOADS_DIR } from '../middleware/upload.js';

const router = Router();
router.use(requireAuth);

// ── POST /api/attachments/:voucherId ──────────────────────────────
router.post('/:voucherId', upload.array('files', 10), async (req, res) => {
  const u = req.user;
  const { voucherId } = req.params;

  try {
    const { rows } = await query('SELECT * FROM vouchers WHERE id = $1', [voucherId]);
    const voucher = rows[0];
    if (!voucher) return res.status(404).json({ error: 'Voucher not found' });

    // Only owner of Draft or admin can upload
    if (!u.is_admin && (voucher.created_by_user !== u.id || voucher.status !== 'Draft'))
      return res.status(403).json({ error: 'Cannot upload to this voucher' });

    if (!req.files?.length) return res.status(400).json({ error: 'No files received' });

    const inserted = [];
    for (const file of req.files) {
      const { rows: att } = await query(
        `INSERT INTO voucher_attachments
           (voucher_id, original_name, stored_name, mime_type, file_size, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [voucherId, file.originalname, file.filename, file.mimetype, file.size, u.id]
      );
      inserted.push(att[0]);
    }

    return res.status(201).json(inserted);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attachments/:voucherId ──────────────────────────────
router.get('/:voucherId', async (req, res) => {
  const { voucherId } = req.params;
  try {
    const { rows } = await query(
      'SELECT * FROM voucher_attachments WHERE voucher_id = $1 ORDER BY created_at',
      [voucherId]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attachments/download/:attachmentId ───────────────────
router.get('/download/:attachmentId', async (req, res) => {
  const { attachmentId } = req.params;
  try {
    const { rows } = await query(
      'SELECT * FROM voucher_attachments WHERE id = $1',
      [attachmentId]
    );
    const att = rows[0];
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    const filePath = path.join(UPLOADS_DIR, att.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    res.setHeader('Content-Disposition', `attachment; filename="${att.original_name}"`);
    res.setHeader('Content-Type', att.mime_type);
    return res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/attachments/:attachmentId ─────────────────────────
router.delete('/:attachmentId', async (req, res) => {
  const u = req.user;
  const { attachmentId } = req.params;
  try {
    const { rows } = await query(
      `SELECT a.*, v.status, v.created_by_user
       FROM voucher_attachments a
       JOIN vouchers v ON v.id = a.voucher_id
       WHERE a.id = $1`,
      [attachmentId]
    );
    const att = rows[0];
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    if (!u.is_admin && (att.created_by_user !== u.id || att.status !== 'Draft'))
      return res.status(403).json({ error: 'Cannot delete this attachment' });

    // Remove from DB
    await query('DELETE FROM voucher_attachments WHERE id = $1', [attachmentId]);

    // Remove from disk (best effort)
    const filePath = path.join(UPLOADS_DIR, att.stored_name);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }

    return res.json({ message: 'Attachment deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
