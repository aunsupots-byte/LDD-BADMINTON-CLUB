// lib/redis.js
// ตัวเชื่อมต่อ Upstash Redis (แทน PropertiesService/CacheService/LockService ของ Apps Script เดิม)
// ใช้ REST client ของ Upstash เพราะทำงานได้ดีบน Render/serverless ไม่ต้องเปิด TCP connection ค้างไว้

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const SETTINGS_PREFIX = 'setting:';
const CACHE_PREFIX = 'cache:';
const LOCK_PREFIX = 'lock:';

// --- แคชข้อมูลชั่วคราว (แทน CacheService) ---

// อ่านค่าจากแคช คืนเป็น string เดิมที่เก็บไว้ (หรือ null ถ้าไม่มี/หมดอายุแล้ว)
async function getCache(key) {
  const val = await redis.get(CACHE_PREFIX + key);
  if (val === null || val === undefined) return null;
  // @upstash/redis บางเวอร์ชัน parse JSON ให้อัตโนมัติถ้าเก็บเป็น JSON string ไว้ ต้องแปลงกลับเป็น string เผื่อกรณีนี้
  return typeof val === 'string' ? val : JSON.stringify(val);
}

// เก็บค่าลงแคช พร้อมกำหนดอายุเป็นวินาที (ttlSeconds)
async function setCache(key, value, ttlSeconds) {
  await redis.set(CACHE_PREFIX + key, value, { ex: ttlSeconds || 60 });
}

// ล้างแคชทันที (ใช้หลังมีการแก้ไขข้อมูล เพื่อให้รอบถัดไปอ่านข้อมูลใหม่จริงแทนของเก่าที่แคชไว้)
async function clearCache(key) {
  await redis.del(CACHE_PREFIX + key);
}

// --- ค่าตั้งค่าถาวร ไม่มีวันหมดอายุเอง (แทน PropertiesService) ---

// อ่านค่าที่ตั้งไว้ ถ้ายังไม่เคยตั้งจะคืนค่า defaultValue แทน
async function getSetting(key, defaultValue) {
  const val = await redis.get(SETTINGS_PREFIX + key);
  return (val === null || val === undefined) ? defaultValue : val;
}

// บันทึกค่าตั้งค่าถาวร (เช่น จำนวนรับสมัครสูงสุด, ข้อความแจ้งเตือน ฯลฯ)
async function setSetting(key, value) {
  await redis.set(SETTINGS_PREFIX + key, value);
}

// --- ล็อกกันการทำงานชนกัน (แทน LockService.getScriptLock() ของ Apps Script) ---

// พยายามจองล็อก คืน true ถ้าจองสำเร็จ (ไม่มีใครถืออยู่), false ถ้ามีคนอื่นถือล็อกนี้อยู่ก่อนแล้ว
// ใช้ SET แบบ NX (ตั้งได้เฉพาะตอนยังไม่มีคีย์นี้) + กำหนดอายุ (ttlMs) กันล็อกค้างถ้าเซิร์ฟเวอร์ล่มก่อนปลดล็อก
async function acquireLock(lockKey, ttlMs) {
  const result = await redis.set(LOCK_PREFIX + lockKey, '1', { nx: true, px: ttlMs || 10000 });
  return result === 'OK' || result === true;
}

// ปลดล็อก ให้คนอื่นใช้งานต่อได้ทันที (เรียกใน finally เสมอ ไม่ว่าจะสำเร็จหรือ error)
async function releaseLock(lockKey) {
  await redis.del(LOCK_PREFIX + lockKey);
}

module.exports = {
  getCache: getCache,
  setCache: setCache,
  clearCache: clearCache,
  getSetting: getSetting,
  setSetting: setSetting,
  acquireLock: acquireLock,
  releaseLock: releaseLock
};
