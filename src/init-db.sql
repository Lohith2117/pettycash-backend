-- =============================================================
-- PettyCash Settlement Application — Full Schema + Seed Data
-- Compatible with Neon (PostgreSQL 16)
-- =============================================================

-- ─── EXTENSIONS ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── DROP TABLES (safe re-run order) ─────────────────────────
DROP TABLE IF EXISTS fund_transactions      CASCADE;
DROP TABLE IF EXISTS voucher_attachments    CASCADE;
DROP TABLE IF EXISTS voucher_lines          CASCADE;
DROP TABLE IF EXISTS vouchers               CASCADE;
DROP TABLE IF EXISTS expense_types          CASCADE;
DROP TABLE IF EXISTS employees              CASCADE;
DROP TABLE IF EXISTS users                  CASCADE;
DROP TABLE IF EXISTS projects               CASCADE;
DROP TABLE IF EXISTS departments            CASCADE;
DROP TABLE IF EXISTS divisions              CASCADE;

-- ─── DIVISIONS ────────────────────────────────────────────────
CREATE TABLE divisions (
  id         SERIAL        PRIMARY KEY,
  code       VARCHAR(20)   NOT NULL UNIQUE,
  name       VARCHAR(120)  NOT NULL,
  is_active  BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── DEPARTMENTS ──────────────────────────────────────────────
CREATE TABLE departments (
  id         SERIAL        PRIMARY KEY,
  code       VARCHAR(20)   NOT NULL UNIQUE,
  name       VARCHAR(120)  NOT NULL,
  is_active  BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── PROJECTS ─────────────────────────────────────────────────
CREATE TABLE projects (
  id                      SERIAL        PRIMARY KEY,
  code                    VARCHAR(40)   NOT NULL UNIQUE,
  name                    VARCHAR(120)  NOT NULL,
  default_division_code   VARCHAR(20)   REFERENCES divisions(code)   ON UPDATE CASCADE,
  default_department_code VARCHAR(20)   REFERENCES departments(code) ON UPDATE CASCADE,
  is_active               BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_division ON projects(default_division_code);

-- ─── USERS ────────────────────────────────────────────────────
CREATE TABLE users (
  id                   SERIAL        PRIMARY KEY,
  username             VARCHAR(50)   NOT NULL UNIQUE,
  full_name            VARCHAR(120)  NOT NULL,
  password_hash        VARCHAR(255)  NOT NULL,
  must_change_pw       BOOLEAN       NOT NULL DEFAULT TRUE,
  is_admin             BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
  system_functions     TEXT[]        NOT NULL DEFAULT '{}',
  employee_code        VARCHAR(20)   DEFAULT NULL,
  manager_id           INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  fund_limit           NUMERIC(12,3) NOT NULL DEFAULT 0,
  fund_active          BOOLEAN       NOT NULL DEFAULT FALSE,
  default_project_code VARCHAR(40)   REFERENCES projects(code) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── EMPLOYEES ────────────────────────────────────────────────
CREATE TABLE employees (
  id           SERIAL        PRIMARY KEY,
  code         VARCHAR(20)   NOT NULL UNIQUE,
  name         VARCHAR(120)  NOT NULL,
  division     VARCHAR(80)   DEFAULT NULL,
  division_code VARCHAR(20)  DEFAULT NULL,
  designation  VARCHAR(120)  DEFAULT NULL,
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by   INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── EXPENSE TYPES ────────────────────────────────────────────
CREATE TABLE expense_types (
  id                  SERIAL        PRIMARY KEY,
  name                VARCHAR(120)  NOT NULL UNIQUE,
  is_employee_linked  BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── VOUCHERS ─────────────────────────────────────────────────
CREATE TABLE vouchers (
  id                     SERIAL        PRIMARY KEY,
  ref_no                 VARCHAR(20)   NOT NULL UNIQUE,
  date                   DATE          NOT NULL,
  created_by_user        INTEGER       NOT NULL REFERENCES users(id),
  holder_name            VARCHAR(120)  NOT NULL,
  holder_emp_code        VARCHAR(20)   DEFAULT NULL,
  division               VARCHAR(80)   DEFAULT NULL,
  project_code           VARCHAR(80)   DEFAULT NULL,
  project_name           VARCHAR(120)  DEFAULT NULL,
  status                 VARCHAR(20)   NOT NULL DEFAULT 'Draft'
                           CHECK (status IN ('Draft','Submitted','Manager Approved','Approved','Paid','Rejected')),
  total                  NUMERIC(12,3) NOT NULL DEFAULT 0,
  submitted_date         DATE          DEFAULT NULL,
  manager_approved_by    INTEGER       REFERENCES users(id),
  manager_approved_date  DATE          DEFAULT NULL,
  approved_by            INTEGER       REFERENCES users(id),
  approved_date          DATE          DEFAULT NULL,
  rejected_by            INTEGER       REFERENCES users(id),
  rejected_date          DATE          DEFAULT NULL,
  reject_reason          TEXT          DEFAULT NULL,
  paid_by                INTEGER       REFERENCES users(id),
  paid_date              DATE          DEFAULT NULL,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vouchers_status     ON vouchers(status);
CREATE INDEX idx_vouchers_created_by ON vouchers(created_by_user);

-- ─── VOUCHER LINES ────────────────────────────────────────────
CREATE TABLE voucher_lines (
  id           SERIAL        PRIMARY KEY,
  voucher_id   INTEGER       NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  line_order   SMALLINT      NOT NULL DEFAULT 0,
  expense_type VARCHAR(80)   NOT NULL,
  emp_code     VARCHAR(20)   DEFAULT NULL,
  emp_name     VARCHAR(120)  DEFAULT NULL,
  amount       NUMERIC(12,3) NOT NULL,
  line_date    DATE          NOT NULL,
  invoice_no   VARCHAR(40)   DEFAULT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voucher_lines_voucher  ON voucher_lines(voucher_id);
CREATE INDEX idx_voucher_lines_emp_type ON voucher_lines(emp_code, expense_type);

-- ─── VOUCHER ATTACHMENTS ──────────────────────────────────────
CREATE TABLE voucher_attachments (
  id            SERIAL        PRIMARY KEY,
  voucher_id    INTEGER       NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  original_name VARCHAR(255)  NOT NULL,
  stored_name   VARCHAR(255)  NOT NULL,
  mime_type     VARCHAR(100)  NOT NULL,
  file_size     INTEGER       NOT NULL,
  uploaded_by   INTEGER       NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voucher_attachments_voucher ON voucher_attachments(voucher_id);

-- ─── FUND TRANSACTIONS ────────────────────────────────────────
CREATE TABLE fund_transactions (
  id             SERIAL        PRIMARY KEY,
  fund_holder_id INTEGER       NOT NULL REFERENCES users(id),
  type           VARCHAR(10)   NOT NULL CHECK (type IN ('funding','closing')),
  amount         NUMERIC(12,3) NOT NULL,
  performed_by   INTEGER       NOT NULL REFERENCES users(id),
  notes          TEXT          DEFAULT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fund_transactions_holder ON fund_transactions(fund_holder_id);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_divisions_updated_at   BEFORE UPDATE ON divisions   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_projects_updated_at    BEFORE UPDATE ON projects    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated_at       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_employees_updated_at   BEFORE UPDATE ON employees   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_expense_types_updated  BEFORE UPDATE ON expense_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_vouchers_updated_at    BEFORE UPDATE ON vouchers    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- SEED DATA
-- =============================================================

-- ─── DIVISIONS (10) ───────────────────────────────────────────
INSERT INTO divisions (code, name) VALUES
  ('RTW', 'AL-Dhow RTW'),
  ('RET', 'AL-Dhow Retail'),
  ('WHL', 'AL-Dhow Wholesale'),
  ('ADM', 'Administration'),
  ('FIN', 'Finance'),
  ('HRA', 'HR & Admin'),
  ('IT',  'Information Technology'),
  ('OPS', 'Operations'),
  ('PRC', 'Procurement'),
  ('WHS', 'Warehouse');

-- ─── DEPARTMENTS (10) ─────────────────────────────────────────
INSERT INTO departments (code, name) VALUES
  ('GEN', 'General'),
  ('ACC', 'Accounts'),
  ('HR',  'Human Resources'),
  ('IT',  'IT Department'),
  ('LOG', 'Logistics'),
  ('PUR', 'Purchasing'),
  ('SAL', 'Sales'),
  ('WHS', 'Warehouse'),
  ('OPS', 'Operations'),
  ('ADM', 'Administration');

-- ─── PROJECTS (9) ─────────────────────────────────────────────
INSERT INTO projects (code, name, default_division_code, default_department_code) VALUES
  ('AL-DHOW-RET',   'AL-Dhow Retail Project',       'RET', 'SAL'),
  ('AL-DHOW-WHL',   'AL-Dhow Wholesale Project',     'WHL', 'SAL'),
  ('AL-DHOW-RTW',   'AL-Dhow RTW Project',           'RTW', 'SAL'),
  ('ADMIN-OPS',     'Admin Operations',              'ADM', 'ADM'),
  ('FINOPS',        'Finance Operations',            'FIN', 'ACC'),
  ('HR-OPS',        'HR Operations',                 'HRA', 'HR'),
  ('IT-OPS',        'IT Operations',                 'IT',  'IT'),
  ('LOGISTICS',     'Logistics Project',             'OPS', 'LOG'),
  ('PROCUREMENT',   'Procurement Project',           'PRC', 'PUR');

-- ─── ADMIN USER (password: admin123) ─────────────────────────
-- bcrypt hash for "admin123" with 10 rounds
INSERT INTO users (username, full_name, password_hash, must_change_pw, is_admin, is_active, system_functions)
VALUES (
  'admin',
  'System Administrator',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- admin123
  TRUE,
  TRUE,
  TRUE,
  ARRAY['admin']
);

-- ─── EMPLOYEES (18) ───────────────────────────────────────────
INSERT INTO employees (code, name, division, division_code, designation, created_by) VALUES
  ('EMP001', 'Ahmed Al-Rashidi',    'AL-Dhow Retail',        'RET', 'Sales Manager',          1),
  ('EMP002', 'Fatima Al-Harbi',     'Finance',               'FIN', 'Accountant',             1),
  ('EMP003', 'Khalid Al-Mutairi',   'HR & Admin',            'HRA', 'HR Officer',             1),
  ('EMP004', 'Sara Al-Azemi',       'Information Technology','IT',  'IT Specialist',          1),
  ('EMP005', 'Mohammed Al-Hajri',   'Operations',            'OPS', 'Operations Supervisor',  1),
  ('EMP006', 'Noura Al-Shammari',   'AL-Dhow Wholesale',     'WHL', 'Wholesale Executive',    1),
  ('EMP007', 'Bader Al-Enezi',      'Procurement',           'PRC', 'Procurement Officer',    1),
  ('EMP008', 'Hessa Al-Kandari',    'Warehouse',             'WHS', 'Warehouse Supervisor',   1),
  ('EMP009', 'Faisal Al-Rasheed',   'AL-Dhow RTW',           'RTW', 'RTW Coordinator',        1),
  ('EMP010', 'Maryam Al-Sabah',     'Administration',        'ADM', 'Administrative Officer', 1),
  ('EMP011', 'Yousef Al-Bloushi',   'Finance',               'FIN', 'Senior Accountant',      1),
  ('EMP012', 'Dalal Al-Fulaij',     'HR & Admin',            'HRA', 'HR Manager',             1),
  ('EMP013', 'Abdulaziz Al-Omar',   'Operations',            'OPS', 'Logistics Coordinator',  1),
  ('EMP014', 'Reem Al-Mansouri',    'Information Technology','IT',  'Systems Analyst',        1),
  ('EMP015', 'Jaber Al-Mutairi',    'AL-Dhow Retail',        'RET', 'Retail Supervisor',      1),
  ('EMP016', 'Latifa Al-Hajri',     'Procurement',           'PRC', 'Procurement Manager',    1),
  ('EMP017', 'Hamad Al-Shimmari',   'Warehouse',             'WHS', 'Warehouse Officer',      1),
  ('EMP018', 'Ghada Al-Rashidi',    'Administration',        'ADM', 'Office Manager',         1);

-- ─── EXPENSE TYPES (9) ────────────────────────────────────────
INSERT INTO expense_types (name, is_employee_linked) VALUES
  ('Work Permits',         TRUE),
  ('Medical Insurance',    TRUE),
  ('Residency Stamping',   TRUE),
  ('Civil IDs',            TRUE),
  ('PIFSS',                TRUE),
  ('Vehicles',             FALSE),
  ('PACI Certificate',     TRUE),
  ('MANDOUB Card',         TRUE),
  ('Translation',          FALSE);
