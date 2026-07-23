// lib/auth.js
// ระบบล็อกอินแอดมินด้วย JWT เก็บไว้ใน cookie (แทนการส่งรหัสผ่าน "adminbadminton" แนบไปทุกคำสั่งแบบเดิมใน Apps Script)
// ล็อกอินครั้งเดียว ได้ตั๋วอายุ 12 ชม. แล้วใช้ตั๋วนั้นยืนยันตัวตนคำสั่งแอดมินอื่นๆ ต่อไปโดยไม่ต้องกรอกรหัสผ่านซ้ำ

const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'admin_token';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-env';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminbadminton';

// ตรวจรหัสผ่านที่ส่งมา ถ้าถูกต้องออกตั๋ว JWT อายุ 12 ชม. ให้ (คืน token string) ถ้าผิดคืน null
function login(password) {
  if (!password || String(password) !== String(ADMIN_PASSWORD)) return null;
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
}

// Middleware สำหรับ endpoint ที่ต้องเป็นแอดมินเท่านั้นถึงจะเรียกได้
// เช็คตั๋วจากคุกกี้ ถ้าไม่มี/ปลอม/หมดอายุ จะตอบ 401 ทันทีโดยไม่ปล่อยให้ endpoint ทำงานต่อ
function requireAdmin(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ success: false, msg: 'กรุณาเข้าสู่ระบบแอดมินก่อน', needLogin: true });
    }
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
      return res.status(401).json({ success: false, msg: 'สิทธิ์ไม่ถูกต้อง', needLogin: true });
    }
    req.admin = payload;
    next();
  } catch (e) {
    // ตั๋วหมดอายุหรือปลอม (jwt.verify throw) ถือว่ายังไม่ได้ล็อกอินเช่นกัน
    return res.status(401).json({ success: false, msg: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่', needLogin: true });
  }
}

module.exports = { login: login, requireAdmin: requireAdmin, COOKIE_NAME: COOKIE_NAME };
