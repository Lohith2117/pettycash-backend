import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Routes ────────────────────────────────────────────────────────
import authRouter        from './routes/auth.js';
import adminRouter       from './routes/admin.js';
import vouchersRouter    from './routes/vouchers.js';
import attachmentsRouter from './routes/attachments.js';
import fundingRouter     from './routes/funding.js';
import employeesRouter   from './routes/employees.js';
import expenseTypesRouter from './routes/expenseTypes.js';
import {
  divisionsRouter,
  departmentsRouter,
  projectsRouter,
} from './routes/masters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ── CORS ──────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (Postman, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsers ──────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── API routes ────────────────────────────────────────────────────
app.use('/api/auth',         authRouter);
app.use('/api/admin',        adminRouter);
app.use('/api/vouchers',     vouchersRouter);
app.use('/api/attachments',  attachmentsRouter);
app.use('/api/funding',      fundingRouter);
app.use('/api/employees',    employeesRouter);
app.use('/api/expense-types', expenseTypesRouter);
app.use('/api/divisions',    divisionsRouter);
app.use('/api/departments',  departmentsRouter);
app.use('/api/projects',     projectsRouter);

// ── Serve uploaded files (dev / Render ephemeral disk) ───────────
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve('uploads');
app.use('/uploads', express.static(uploadsDir));

// ── 404 catch-all ─────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler ─────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅  PettyCash API running on port ${PORT}`);
  console.log(`    ENV: ${process.env.NODE_ENV || 'development'}`);
});
