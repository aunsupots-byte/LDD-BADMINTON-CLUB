// lib/auth.js
// ระบบยืนยันตัวตนแอดมิน — เดิมของ Apps Script ส่งรหัสผ่าน "adminbadminton" แบบข้อความธรรมดา
// แนบไปกับแทบทุกคำสั่ง (เห็นได้จาก view-source ของทุกคนที่เปิดเว็บ) ตอนย้ายมาที่นี่เปลี่ยนเป็น
// ล็อกอินครั้งเดียว ได้ "ตั๋ว" (JWT เก็บใน cookie) แล้วใช้ตั๋วนั้นยืนยันตัวตนแทนการส่งรหัสผ่านซ้ำทุกครั้ง

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE_NAME = 'admin_token';

function login(password) {
  if (!JWT_SECRET) throw new Error('ยังไม่ได้ตั้งค่า JWT_SECRET ใน environment variables');
  if (!ADMIN_PASSWORD) throw new Error('ยังไม่ได้ตั้งค่า ADMIN_PASSWORD ใน environment variables');
  if (password !== ADMIN_PASSWORD) return null;
  // ตั๋วมีอายุ 12 ชั่วโมง (ยาวพอสำหรับกะทำงานหนึ่งวัน แต่ไม่ถาวรตลอดไปเผื่อเครื่องหาย)
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
}

// Express middleware: ตรวจตั๋วจาก cookie ก่อนอนุญาตให้เรียก endpoint ฝั่งแอดมิน
function requireAdmin(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ success: false, msg: 'กรุณาเข้าสู่ระบบแอดมินก่อน' });
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ success: false, msg: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่' });
  }
}

// เช็คว่าตั๋วปัจจุบันยังใช้ได้อยู่ไหม (ใช้ตอนหน้า admin.html โหลดครั้งแรก เพื่อรู้ว่าจะโชว์หน้าล็อกอินหรือหน้าแผงควบคุมเลย)
function isAdminLoggedIn(req) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return false;
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { login, requireAdmin, isAdminLoggedIn, COOKIE_NAME };
