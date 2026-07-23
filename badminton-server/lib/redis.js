// lib/redis.js
// ตัวเชื่อมต่อ Upstash Redis แทน PropertiesService (ค่าตั้งค่า), CacheService (แคชชั่วคราว),
// และ LockService (กันเขียนซ้อน) ของ Apps Script เดิม

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

// --- แทน PropertiesService: เก็บค่าตั้งค่าถาวร (ไม่มีวันหมดอายุ) ---
async function getSetting(key, defaultValue = null) {
  const val = await redis.get(`setting:${key}`);
  return val === null || val === undefined ? defaultValue : val;
}
async function setSetting(key, value) {
  await redis.set(`setting:${key}`, value);
}

// --- แทน CacheService: เก็บค่าแคชชั่วคราว (มีอายุ ttlSeconds) ---
async function getCache(key) {
  return await redis.get(`cache:${key}`);
}
async function setCache(key, value, ttlSeconds) {
  await redis.set(`cache:${key}`, value, { ex: ttlSeconds });
}
async function clearCache(key) {
  await redis.del(`cache:${key}`);
}

// --- แทน LockService: กันสองคำขอเขียนพร้อมกันชนกัน (ใช้ก่อนเขียนชีตที่ต้องกันเขียนซ้อน เช่น ลงทะเบียน/เช็คอิน) ---
// คืนค่า true ถ้าได้ล็อกสำเร็จ, false ถ้ามีคนอื่นถือล็อกอยู่ (ให้ผู้เรียกลองใหม่หรือแจ้ง error)
async function acquireLock(lockKey, ttlMs = 10000) {
  const key = `lock:${lockKey}`;
  // SET ... NX = ตั้งค่าเฉพาะตอนที่ยังไม่มีค่าอยู่ (atomic) เทียบเท่า LockService.tryLock()
  const result = await redis.set(key, '1', { nx: true, px: ttlMs });
  return result === 'OK';
}
async function releaseLock(lockKey) {
  await redis.del(`lock:${lockKey}`);
}

module.exports = { redis, getSetting, setSetting, getCache, setCache, clearCache, acquireLock, releaseLock };
