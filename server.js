// server.js
// เซิร์ฟเวอร์หลักของระบบ (แทนที่ Code.gs เดิมที่รันบน Google Apps Script)
//
// 🆕 สถานะการย้าย (อ่านก่อนใช้งาน):
//   ✅ ดูรายชื่อผู้ลงทะเบียนวันนี้ (GET /api/data-summary) — ตอนนี้รวม masterProducts (คลังสินค้า) ด้วยแล้ว
//   ✅ ลงทะเบียนเข้าใช้สนาม (POST /api/register)
//   ✅ แอดมินล็อกอิน (POST /api/admin/login)
//   ✅ แอดมินเช็คอิน + คิดค่าสนามอัตโนมัติ (POST /api/admin/checkin)
//   ✅ Walk-in ลงทะเบียนหน้างาน (POST /api/walkin)
//   ✅ ขายของ + ตัดสต๊อกอัตโนมัติ (POST /api/admin/shop-sale)
//   ✅ ซื้อลูกแบดหารจ่าย (POST /api/admin/shuttlecock)
// ฟีเจอร์อื่นที่เหลือ (จัดคิวสนามเรียลไทม์, ปิดสนามประจำวัน, รายงาน PDF ส่ง Drive,
// ตั้งค่าเสาร์-อาทิตย์, ระบบถอนรายชื่อ ฯลฯ) ยังไม่ได้ย้ายมาในรอบนี้ — บอกได้เลยเมื่อพร้อมย้ายรอบถัดไป

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const sheetsDb = require('./lib/sheets');
const redisDb = require('./lib/redis');
const auth = require('./lib/auth');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const REG_SHEET = 'Registrations';
const SALES_SHEET = 'ProductSales';
const PRODUCTS_SHEET = 'Products';

// คอลัมน์ของชีต Registrations (1-index ตรงกับของเดิมทุกประการ เพื่อให้ใช้สเปรดชีตเดิมต่อได้เลยไม่ต้องย้ายข้อมูล)
// A=ID, B=Timestamp, C=Name, D=Nickname, E=Phone, F=MemberType, G=TimeSlot, H=Status, I=Attendance, J=CustomFee, K=IsWalkIn
const COL = { ID: 1, TIMESTAMP: 2, NAME: 3, NICKNAME: 4, PHONE: 5, MEMBER_TYPE: 6, TIME_SLOT: 7, STATUS: 8, ATTENDANCE: 9, CUSTOM_FEE: 10, IS_WALKIN: 11 };

const DEFAULT_COURT_FEES = { 'บุคคลทั่วไป': 70, 'สมาชิกสามัญ': 20, 'สมาชิกสมทบ': 50, 'สมาชิกกิตติมศักดิ์': 0 };

function cleanPhone(p) { return String(p || '').replace(/[\s-]/g, ''); }
function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }); // 'sv-SE' locale ให้ผลลัพธ์เป็น yyyy-MM-dd พอดี (วิธีลัดที่ใช้กันทั่วไปใน Node)
}
function isSameBangkokDay(dateVal) {
  if (!dateVal) return false;
  const d = new Date(dateVal);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) === todayStr();
}

// =============================================
// GET /api/data-summary — เทียบเท่า getDataSummary() เดิม (เวอร์ชันย่อ: รายชื่อ + ยอดขาย)
// =============================================
app.get('/api/data-summary', async (req, res) => {
  try {
    // 🆕 แคชผลลัพธ์ไว้ 45 วิ เหมือนเวอร์ชัน Apps Script เดิม เพื่อลดจำนวนครั้งที่ต้องยิง Sheets API จริง
    const cached = await redisDb.getCache('data_summary');
    if (cached) return res.json(JSON.parse(cached));

    const { [REG_SHEET]: regData, [SALES_SHEET]: salesData, [PRODUCTS_SHEET]: prodData } = await sheetsDb.batchGetValues([REG_SHEET, SALES_SHEET, PRODUCTS_SHEET]);

    // 🆕 คลังรายการสินค้าหลัก (ชื่อ, ราคา, คงเหลือ) — ใช้แสดงในหน้าขายของฝั่งแอดมิน
    const masterProducts = [];
    for (let p = 1; p < (prodData || []).length; p++) {
      const row = prodData[p];
      if (!row[0]) continue;
      const stockRaw = row[2];
      const stockVal = (stockRaw === '' || stockRaw === undefined || isNaN(Number(stockRaw))) ? null : Number(stockRaw);
      masterProducts.push({ row: p + 1, name: row[0], price: Number(row[1]) || 0, stock: stockVal });
    }

    // สรุปยอดขาย/ค้างจ่ายต่อคน จากชีต ProductSales (Timestamp, PlayerName, ItemDetail, Amount, PaymentStatus)
    const salesByPlayer = {};
    for (let i = 1; i < (salesData || []).length; i++) {
      const row = salesData[i];
      const name = row[1];
      if (!name) continue;
      if (!salesByPlayer[name]) salesByPlayer[name] = { unpaid: 0, paid: 0, details: [] };
      const amount = Number(row[3]) || 0;
      const status = row[4];
      if (status === 'จ่ายแล้ว') salesByPlayer[name].paid += amount;
      else salesByPlayer[name].unpaid += amount;
      salesByPlayer[name].details.push(`${row[2]} (${amount} บ.)`);
    }

    const list = [];
    let totalRegistered = 0;
    for (let i = 1; i < (regData || []).length; i++) {
      const row = regData[i];
      const name = row[COL.NAME - 1];
      if (!name || String(name).trim() === '') continue;
      const isWalkIn = String(row[COL.IS_WALKIN - 1] || '').trim() === 'WALKIN';
      const isWithdrawn = String(row[COL.ATTENDANCE - 1] || '').trim() === 'ถอน';
      if (!isWalkIn && !isWithdrawn) totalRegistered++;

      const sales = salesByPlayer[name] || { unpaid: 0, paid: 0, details: [] };
      list.push({
        row: i + 1, // แถวจริงในชีต (1-index, บวก 1 เพราะ i เริ่มนับจาก 0 แต่แถวที่ 1 คือหัวตาราง)
        id: row[COL.ID - 1],
        timestamp: row[COL.TIMESTAMP - 1],
        name,
        nickname: row[COL.NICKNAME - 1],
        phone: row[COL.PHONE - 1],
        memberType: row[COL.MEMBER_TYPE - 1] || 'บุคคลทั่วไป',
        timeSlot: row[COL.TIME_SLOT - 1],
        attendance: row[COL.ATTENDANCE - 1] || 'ยังไม่มา',
        customFee: (row[COL.CUSTOM_FEE - 1] === '' || row[COL.CUSTOM_FEE - 1] === undefined) ? null : Number(row[COL.CUSTOM_FEE - 1]),
        isWalkIn,
        isWithdrawn,
        unpaidAmount: sales.unpaid,
        paidAmount: sales.paid,
        productDetails: sales.details.join(', ') || 'ไม่มี'
      });
    }

    const cap = Number(await redisDb.getSetting('registrationCap', 40));

    const result = {
      totalRegistered,
      registrationCap: cap,
      registrationIsOpen: true, // TODO: ย้ายตรรกะเปิด-ปิดตามเวลา/วันเสาร์-อาทิตย์มาในรอบถัดไป
      list,
      masterProducts
    };

    await redisDb.setCache('data_summary', JSON.stringify(result), 45);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, msg: e.message, list: [], totalRegistered: 0, registrationCap: 40, masterProducts: [] });
  }
});

// =============================================
// POST /api/register — เทียบเท่า registerUser(formData) เดิม
// body: { name, nickname, phone, memberType, timeSlot }
// =============================================
app.post('/api/register', async (req, res) => {
  const lockKey = 'register';
  const gotLock = await redisDb.acquireLock(lockKey, 10000);
  if (!gotLock) return res.status(429).json({ success: false, msg: 'ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง' });

  try {
    const { name, nickname, phone, memberType, timeSlot } = req.body || {};
    if (!nickname || !String(nickname).trim()) {
      return res.json({ success: false, msg: 'กรุณากรอกชื่อเล่น' });
    }
    if (!timeSlot) {
      return res.json({ success: false, msg: 'กรุณาเลือกเวลาที่ต้องการเข้าใช้บริการ' });
    }

    const regData = await sheetsDb.getValues(REG_SHEET);
    const today = todayStr();
    const cleanPhoneVal = cleanPhone(phone);
    const cleanNickname = String(nickname).trim().toLowerCase();

    let totalRegistered = 0;
    for (let i = 1; i < regData.length; i++) {
      const row = regData[i];
      if (!row[COL.NAME - 1]) continue;
      const isWithdrawn = String(row[COL.ATTENDANCE - 1] || '').trim() === 'ถอน';
      const isWalkIn = String(row[COL.IS_WALKIN - 1] || '').trim() === 'WALKIN';

      // เช็คลงทะเบียนซ้ำด้วยเบอร์เดิมวันนี้ (ข้ามแถวที่ถอนไปแล้ว)
      if (!isWithdrawn && cleanPhoneVal && cleanPhone(row[COL.PHONE - 1]) === cleanPhoneVal && isSameBangkokDay(row[COL.TIMESTAMP - 1])) {
        return res.json({ success: false, msg: 'เบอร์โทรศัพท์นี้ลงทะเบียนไปแล้ววันนี้ ไม่สามารถลงทะเบียนซ้ำได้', isDuplicate: true });
      }
      // เช็คชื่อเล่นซ้ำวันนี้ (ข้ามแถวที่ถอนไปแล้ว)
      if (!isWithdrawn && String(row[COL.NICKNAME - 1] || '').trim().toLowerCase() === cleanNickname && isSameBangkokDay(row[COL.TIMESTAMP - 1])) {
        return res.json({ success: false, msg: `ชื่อเล่น "${nickname}" มีผู้ลงทะเบียนไปแล้ววันนี้ กรุณาเปลี่ยนชื่อเล่นใหม่`, isDuplicateNickname: true });
      }
      if (!isWalkIn && !isWithdrawn) totalRegistered++;
    }

    const cap = Number(await redisDb.getSetting('registrationCap', 40));
    if (totalRegistered >= cap) {
      const fullMsg = await redisDb.getSetting('registrationFullMessage', 'ระบบได้ปิดรับการลงทะเบียนเนื่องจากสิทธิ์เต็มจำนวน');
      return res.json({ success: false, msg: fullMsg, isFull: true });
    }

    const nextId = regData.length; // เทียบเท่า data.length ของเดิม (ID ไล่ตามจำนวนแถวที่มีอยู่)
    const finalName = (name && String(name).trim()) || nickname; // ถ้าไม่กรอกชื่อจริง (บุคคลทั่วไป) ใช้ชื่อเล่นแทน
    await sheetsDb.appendRow(REG_SHEET, [
      nextId, new Date().toISOString(), finalName, nickname, phone,
      memberType || 'บุคคลทั่วไป', timeSlot, 'ลงทะเบียนแล้ว', 'ยังไม่มา', '', ''
    ]);

    await redisDb.clearCache('data_summary');
    res.json({ success: true, msg: 'ลงทะเบียนสำเร็จ!' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, msg: e.message });
  } finally {
    await redisDb.releaseLock(lockKey);
  }
});

// =============================================
// POST /api/admin/login — เข้าสู่ระบบแอดมิน (แทนการส่งรหัสผ่านซ้ำทุกคำสั่งแบบเดิม)
// body: { password }
// =============================================
app.post('/api/admin/login', (req, res) => {
  try {
    const token = auth.login((req.body || {}).password);
    if (!token) return res.json({ success: false, msg: 'รหัสผ่านไม่ถูกต้อง' });
    res.cookie(auth.COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, msg: e.message });
  }
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie(auth.COOKIE_NAME);
  res.json({ success: true });
});

// 🆕 เช็คสถานะล็อกอินแอดมิน — หน้า admin.html เรียกตอนโหลดหน้าครั้งแรก เพื่อรู้ว่าจะโชว์หน้าล็อกอินหรือแผงควบคุมเลย
app.get('/api/admin/me', (req, res) => {
  res.json({ loggedIn: auth.isAdminLoggedIn(req) });
});

// =============================================
// POST /api/admin/checkin — เทียบเท่า updateAttendance(row, status) เดิม (ต้องล็อกอินแอดมินก่อน)
// body: { row, status }  (status: 'มาแล้ว' หรือ 'ยังไม่มา')
// =============================================
app.post('/api/admin/checkin', auth.requireAdmin, async (req, res) => {
  const { row, status } = req.body || {};
  if (!row || !status) return res.json({ success: false, msg: 'ข้อมูลไม่ครบถ้วน' });

  const lockKey = `checkin_${row}`;
  const gotLock = await redisDb.acquireLock(lockKey, 10000);
  if (!gotLock) return res.status(429).json({ success: false, msg: 'กำลังประมวลผลรายการนี้อยู่ กรุณารอสักครู่' });

  try {
    await sheetsDb.updateCell(REG_SHEET, row, COL.ATTENDANCE, status);

    let feeCharged = 0, fee = 0, alreadyCharged = false, memberType = '';
    if (status === 'มาแล้ว') {
      const regData = await sheetsDb.getValues(REG_SHEET);
      const rowData = regData[row - 1]; // row เป็น 1-index ตรงกับเลขแถวจริงในชีต, แถวที่ 1 = หัวตาราง ดังนั้น index อาเรย์ = row - 1
      const playerName = rowData[COL.NAME - 1];
      memberType = rowData[COL.MEMBER_TYPE - 1] || 'บุคคลทั่วไป';
      const customFeeRaw = rowData[COL.CUSTOM_FEE - 1];

      if (playerName) {
        let feeLabel;
        if (customFeeRaw !== '' && customFeeRaw !== undefined && !isNaN(Number(customFeeRaw))) {
          fee = Number(customFeeRaw);
          feeLabel = 'ค่าสนาม (ราคาเฉพาะบุคคล)';
        } else {
          const feesRaw = await redisDb.getSetting('courtFees', null);
          const fees = feesRaw ? JSON.parse(feesRaw) : DEFAULT_COURT_FEES;
          fee = Number(fees[memberType]);
          if (isNaN(fee)) fee = 0;
          feeLabel = `ค่าสนาม (${memberType})`;
        }

        if (fee > 0) {
          const salesData = await sheetsDb.getValues(SALES_SHEET);
          for (let i = 1; i < salesData.length; i++) {
            if (salesData[i][1] === playerName && String(salesData[i][2]).indexOf('ค่าสนาม') === 0 && isSameBangkokDay(salesData[i][0])) {
              alreadyCharged = true;
              break;
            }
          }
          if (!alreadyCharged) {
            await sheetsDb.appendRow(SALES_SHEET, [new Date().toISOString(), playerName, feeLabel, fee, 'ยังไม่จ่าย']);
            feeCharged = fee;
          }
        }
      }
    }

    await redisDb.clearCache('data_summary');
    res.json({ success: true, feeCharged, fee, alreadyCharged, memberType });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, msg: e.message });
  } finally {
    await redisDb.releaseLock(lockKey);
  }
});

// =============================================
// POST /api/walkin — เทียบเท่า registerWalkIn(formData) เดิม (ต้องล็อกอินแอดมินก่อน)
// Walk-in ลงทะเบียนได้เสมอ ไม่เช็คโควต้า/เวลาเปิดรับ เพราะเป็นการลงทะเบียนโดยแอดมินหน้างานโดยตรง
// เช็คอินทันทีตั้งแต่ลงทะเบียน จึงบวกค่าสนามเข้ายอดค้างจ่ายอัตโนมัติเหมือนตอนกดเช็คอินปกติ
// =============================================
app.post('/api/walkin', auth.requireAdmin, async (req, res) => {
  const lockKey = 'walkin';
  const gotLock = await redisDb.acquireLock(lockKey, 10000);
  if (!gotLock) return res.status(429).json({ success: false, msg: 'ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง' });

  try {
    const { name, nickname, phone, memberType, timeSlot } = req.body || {};
    if (!nickname || !String(nickname).trim()) return res.json({ success: false, msg: 'กรุณากรอกชื่อเล่น' });

    const regData = await sheetsDb.getValues(REG_SHEET);
    const cleanNickname = String(nickname).trim().toLowerCase();
    const cleanPhoneVal = cleanPhone(phone);
    for (let i = 1; i < regData.length; i++) {
      const row = regData[i];
      if (!row[COL.NAME - 1]) continue;
      const isWithdrawn = String(row[COL.ATTENDANCE - 1] || '').trim() === 'ถอน';
      if (isWithdrawn) continue;
      // เช็คชื่อเล่นซ้ำวันนี้ (ยกเว้นถ้าเป็นเบอร์เดียวกัน ถือว่าเป็นคนเดิม ไม่นับซ้ำ)
      if (String(row[COL.NICKNAME - 1] || '').trim().toLowerCase() === cleanNickname
        && cleanPhone(row[COL.PHONE - 1]) !== cleanPhoneVal
        && isSameBangkokDay(row[COL.TIMESTAMP - 1])) {
        return res.json({ success: false, msg: `ชื่อเล่น "${nickname}" มีผู้ลงทะเบียนไว้แล้วในวันนี้ กรุณาเปลี่ยนชื่อเล่นเป็นชื่ออื่น`, isDuplicateNickname: true });
      }
    }

    const nextId = regData.length;
    const finalName = (name && String(name).trim()) || nickname;
    // คอลัมน์ 10 (CustomFee) เว้นว่าง, คอลัมน์ 11 ใส่ 'WALKIN' ให้ระบบรู้ว่าคนนี้เป็น Walk-in (ไม่แสดง/ไม่นับในหน้าลงทะเบียนสาธารณะ)
    await sheetsDb.appendRow(REG_SHEET, [
      nextId, new Date().toISOString(), finalName, nickname, phone,
      memberType || 'บุคคลทั่วไป', timeSlot || 'Walk-in', 'ลงทะเบียนแล้ว', 'มาแล้ว', '', 'WALKIN'
    ]);

    // เช็คอินทันที จึงบวกค่าสนามเข้ายอดค้างจ่ายอัตโนมัติ
    let feeCharged = 0;
    const feesRaw = await redisDb.getSetting('courtFees', null);
    const fees = feesRaw ? JSON.parse(feesRaw) : DEFAULT_COURT_FEES;
    const fee = Number(fees[memberType]);
    if (!isNaN(fee) && fee > 0 && finalName) {
      await sheetsDb.appendRow(SALES_SHEET, [new Date().toISOString(), finalName, `ค่าสนาม (${memberType})`, fee, 'ยังไม่จ่าย']);
      feeCharged = fee;
    }

    await redisDb.clearCache('data_summary');
    res.json({ success: true, msg: 'ลงทะเบียน Walk-in สำเร็จ!', feeCharged });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, msg: e.message });
  } finally {
    await redisDb.releaseLock(lockKey);
  }
});

// =============================================
// POST /api/admin/shop-sale — เทียบเท่า addProductSale(playerName, itemDetail, amount, paymentStatus) เดิม
// body: { playerName, itemDetail, amount, paymentStatus }
// =============================================
app.post('/api/admin/shop-sale', auth.requireAdmin, async (req, res) => {
  try {
    const { playerName, itemDetail, amount, paymentStatus } = req.body || {};
    if (!playerName || !itemDetail || amount === undefined) return res.json({ success: false, msg: 'ข้อมูลไม่ครบถ้วน' });

    // 🆕 กันกดซ้ำ: ถ้ามีรายการเดียวกันเป๊ะๆ (คน+สินค้า+ราคา+สถานะ) เพิ่งถูกบันทึกไปใน 5 วิที่ผ่านมา ให้ข้ามไปเฉย (เทียบเท่า CacheService dedup เดิม)
    const dupKey = `prodsale_${playerName}_${itemDetail}_${amount}_${paymentStatus}`.replace(/\s+/g, '_');
    const alreadyDone = await redisDb.getCache(dupKey);
    if (alreadyDone) return res.json({ success: true, duplicateSkipped: true });

    await sheetsDb.appendRow(SALES_SHEET, [new Date().toISOString(), playerName, itemDetail, Number(amount), paymentStatus || 'ยังไม่จ่าย']);
    await sheetsDb.deductProductStock(itemDetail, 1); // ตัดสต๊อก 1 ชิ้น (ถ้าสินค้านั้นมีการนับสต๊อกไว้ — ถ้าไม่พบสินค้าชื่อตรงกัน เช่น เป็นค่าสนาม จะไม่ทำอะไร)
    await redisDb.setCache(dupKey, '1', 5);
    await redisDb.clearCache('data_summary');
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, msg: e.message });
  }
});

// =============================================
// POST /api/admin/shuttlecock — เทียบเท่า buyShuttlecockSplit(playerNames) เดิม
// ซื้อลูกแบด 1 ลูก หารราคาเฉลี่ยตามจำนวนผู้เล่นที่เลือก แต่ละคนได้ยอดหารเข้า "ยอดค้างจ่าย" ของตัวเอง
// body: { playerNames: string[] }
// =============================================
app.post('/api/admin/shuttlecock', auth.requireAdmin, async (req, res) => {
  try {
    const playerNames = (req.body || {}).playerNames;
    if (!playerNames || playerNames.length === 0) return res.json({ success: false, msg: 'ไม่พบผู้เล่นที่เลือก' });

    const prodData = await sheetsDb.getValues(PRODUCTS_SHEET);
    let itemName = 'ลูกแบด';
    let price = 80; // ราคาสำรอง กรณีไม่พบสินค้าลูกแบดในคลังสินค้า
    for (let i = 1; i < prodData.length; i++) {
      const pName = String(prodData[i][0] || '');
      if (pName.indexOf('ลูกแบด') !== -1) { itemName = pName; price = Number(prodData[i][1]) || price; break; }
    }

    const count = playerNames.length;
    const splitAmount = Math.round((price / count) * 100) / 100;
    const splitLabel = `${itemName} (หารจ่าย ${count} คน)`;
    const now = new Date().toISOString();
    for (const name of playerNames) {
      await sheetsDb.appendRow(SALES_SHEET, [now, name, splitLabel, splitAmount, 'ยังไม่จ่าย']);
    }
    await sheetsDb.deductProductStock(itemName, 1); // ซื้อลูกแบด 1 ลูก (หารจ่ายกันกี่คนก็ตัดสต๊อกแค่ 1 ลูก)

    await redisDb.clearCache('data_summary');
    res.json({ success: true, msg: 'บันทึกการหารค่าลูกแบดสำเร็จ', itemName, price, splitAmount, count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, msg: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Badminton club server running on port ${process.env.PORT || 3000}`);
});
