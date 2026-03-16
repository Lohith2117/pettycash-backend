import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'pcs-jwt-secret-change-in-production';
const EXPIRY  = '8h';

// ── Token helpers ────────────────────────────────────────────────
export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

// ── Express middleware: require valid JWT ────────────────────────
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Role guards ──────────────────────────────────────────────────
export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const userFunctions = req.user?.system_functions || [];
    const hasRole = req.user?.is_admin || roles.some(r => userFunctions.includes(r));
    if (!hasRole) {
      return res.status(403).json({ error: `Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}
