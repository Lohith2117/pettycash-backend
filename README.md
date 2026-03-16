# PettyCash Backend — AL-Dhow Group

Express + PostgreSQL API for the PettyCash Settlement Application.

---

## Tech Stack

| Package | Purpose |
|---------|---------|
| Express 4 | HTTP server |
| pg 8 | PostgreSQL client (Neon-compatible) |
| bcrypt 5 | Password hashing (10 rounds) |
| jsonwebtoken 9 | JWT auth (8-hour expiry) |
| multer 2 | File uploads |
| dotenv 16 | Environment variables |

---

## Local Development

### 1. Clone and install

```bash
git clone <your-backend-repo-url>
cd pettycash-backend
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Edit .env with your Neon connection string and JWT secret
```

### 3. Initialize the database (run once)

```bash
npm run db:init
```

This runs `src/init-db.sql` against your Neon database. It creates all tables,
indexes, triggers, and seed data (10 divisions, 10 departments, 9 projects, 18 employees,
9 expense types, 1 admin user).

**Default credentials after init:**
- Username: `admin`
- Password: `admin123`
- ⚠️ You will be forced to change the password on first login.

### 4. Start the dev server

```bash
npm run dev
# API available at http://localhost:3001
```

---

## Project Structure

```
pettycash-backend/
├── src/
│   ├── config/
│   │   └── db.js              # Neon PostgreSQL pool
│   ├── middleware/
│   │   ├── auth.js            # JWT sign/verify/role guards
│   │   └── upload.js          # Multer config (10MB, allowed types)
│   ├── routes/
│   │   ├── auth.js            # Login, change-password, /me
│   │   ├── admin.js           # User CRUD (admin only)
│   │   ├── vouchers.js        # Full approval workflow
│   │   ├── attachments.js     # File upload/download/delete
│   │   ├── funding.js         # Fund holder management
│   │   ├── employees.js       # Employee CRUD
│   │   ├── expenseTypes.js    # Expense type CRUD
│   │   └── masters.js         # Divisions, departments, projects
│   ├── scripts/
│   │   └── initDb.js          # One-time DB initializer
│   ├── init-db.sql            # Full schema + seed data
│   └── index.js               # Express app entry point
├── .env.example
├── .gitignore
└── package.json
```

---

## Deploying to Render

### Step 1 — Create a Neon database

1. Go to [neon.tech](https://neon.tech) → New Project
2. Name it `pettycash`
3. Copy the **Connection string** (looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`)
4. Run the init script locally against Neon:
   ```bash
   # Set DATABASE_URL in your .env first, then:
   npm run db:init
   ```

### Step 2 — Push backend to GitHub

```bash
git init
git add .
git commit -m "Initial backend"
git branch -M main
git remote add origin https://github.com/<you>/pettycash-backend.git
git push -u origin main
```

### Step 3 — Create a Web Service on Render

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Configure:

| Field | Value |
|-------|-------|
| **Name** | `pettycash-backend` |
| **Environment** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (or Starter) |

4. Under **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your Neon connection string |
| `JWT_SECRET` | A long random string (e.g., `openssl rand -hex 32`) |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | Your Render frontend URL (add after deploying frontend) |
| `PORT` | `3001` |

5. Click **Deploy**. Your API will be at:
   `https://pettycash-backend.onrender.com`

> **Note on file uploads:** Render's free tier uses an ephemeral filesystem — uploaded files
> are lost on redeploy. For production, integrate Cloudinary or AWS S3 for persistent storage.
> The attachment routes are already structured to make this swap easy.

---

## API Reference

All endpoints are prefixed `/api`. All except `/api/auth/login` and `/api/health`
require a `Authorization: Bearer <token>` header.

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | No | Login, returns JWT |
| POST | `/api/auth/change-password` | Yes | Change password |
| GET | `/api/auth/me` | Yes | Current user profile |

### Vouchers
| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/vouchers` | Any | List (role-filtered) |
| GET | `/api/vouchers/:id` | Any | Single voucher + lines + attachments |
| POST | `/api/vouchers` | petty_cash_holder | Create draft |
| PUT | `/api/vouchers/:id` | petty_cash_holder | Update draft |
| POST | `/api/vouchers/:id/submit` | petty_cash_holder | Submit |
| POST | `/api/vouchers/:id/manager-approve` | Manager/Admin | Manager approval |
| POST | `/api/vouchers/:id/manager-reject` | Manager/Admin | Manager rejection → Draft |
| POST | `/api/vouchers/:id/approve` | chief_accountant | CA approval |
| POST | `/api/vouchers/:id/reject` | chief_accountant | CA rejection → Rejected |
| POST | `/api/vouchers/:id/pay` | cashier | Mark as paid |
| GET | `/api/vouchers/validate-charge` | Any | 9-month cycle check |

### Funding
| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/funding/fund-holders` | cashier | List with live balances |
| POST | `/api/funding/fund` | cashier | Allocate funds |
| POST | `/api/funding/close` | cashier | Close fund |
| GET | `/api/funding/transactions/:userId` | cashier | Transaction history |

### Attachments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/attachments/:voucherId` | Upload files (multipart) |
| GET | `/api/attachments/:voucherId` | List |
| GET | `/api/attachments/download/:id` | Download |
| DELETE | `/api/attachments/:id` | Delete |

### Admin (admin only)
| Method | Endpoint |
|--------|----------|
| GET/POST | `/api/admin/users` |
| PUT | `/api/admin/users/:id` |
| POST | `/api/admin/users/:id/reset-password` |

### Maintenance (admin — GET open to all)
- `/api/divisions`
- `/api/departments`
- `/api/projects`
- `/api/expense-types`
- `/api/employees`

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | **Required.** Neon PostgreSQL connection string |
| `JWT_SECRET` | `pcs-jwt-secret-change-in-production` | JWT signing secret — **change this!** |
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | `production` enables SSL for DB |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin |
| `UPLOADS_DIR` | `uploads` | Directory for file uploads |
