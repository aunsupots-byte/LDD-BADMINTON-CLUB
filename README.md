# LDD Badminton Club — เวอร์ชันย้ายจาก Apps Script (MVP)

## สถานะตอนนี้ — อ่านก่อนใช้งาน

- ✅ ดูรายชื่อผู้ลงทะเบียนวันนี้
- ✅ ลงทะเบียนเข้าใช้สนาม (กันชื่อเล่น/เบอร์ซ้ำ, เช็คโควต้า)
- ✅ แอดมินล็อกอิน (ใช้ตั๋ว JWT แทนการส่งรหัสผ่านซ้ำทุกครั้งแบบเดิม)
- ✅ แอดมินเช็คอิน + คิดค่าสนามอัตโนมัติตามประเภทสมาชิก
- ✅ Walk-in ลงทะเบียนหน้างาน (เช็คอินทันที + คิดค่าสนามอัตโนมัติ)
- ✅ ขายของให้ผู้เล่น + ตัดสต๊อกสินค้าอัตโนมัติ (อ่าน/เขียนจากชีต Products)
- ✅ ซื้อลูกแบดหารจ่ายตามจำนวนผู้เล่นที่เลือก (เลือกจากรายชื่อคนที่เช็คอินแล้ว แทนการอิงจากคอร์ทจริงเพราะยังไม่ได้ย้ายระบบจัดคิวสนามมา)

**ยังไม่ได้ย้ายมาในรอบนี้:** จัดคิวสนามเรียลไทม์ (คอร์ท 1-4, จับเวลาแข่ง), ปิดสนามประจำวันอัตโนมัติ, รายงาน PDF ส่ง Drive, ตั้งค่าเสาร์-อาทิตย์, ระบบถอนรายชื่อ, โลโก้/พื้นหลัง — พอทดสอบรอบนี้ผ่านแล้ว แจ้งได้เลย จะทยอยย้ายเพิ่มให้ครบทีละฟีเจอร์

---

## โครงสร้างไฟล์

```
badminton-server/
├── server.js              ← เซิร์ฟเวอร์หลัก (แทน Code.gs)
├── lib/
│   ├── sheets.js           ← ตัวเชื่อมต่อ Google Sheets API (แทน SpreadsheetApp)
│   ├── redis.js             ← ตัวเชื่อมต่อ Upstash Redis (แทน PropertiesService/CacheService/LockService)
│   └── auth.js               ← ระบบล็อกอินแอดมินด้วย JWT
├── public/
│   └── index.html            ← หน้าเว็บ (แทน Index.html เดิม เวอร์ชันย่อ)
├── package.json
├── .env.example              ← ตัวอย่างค่า environment variables ที่ต้องตั้ง
└── .gitignore
```

---

## ขั้นตอน Deploy (ทำตามลำดับ)

### Phase 1: เตรียม repo บน GitHub
1. สร้าง repo ใหม่บน github.com ตั้งเป็น **Private**
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้น repo (ลากไฟล์วางในหน้าเว็บ GitHub ได้เลย ไม่ต้องใช้คำสั่งเขียนโปรแกรม หรือจะใช้ `git push` ก็ได้ถ้าถนัด)

### Phase 2: สร้าง Service Account ให้เซิร์ฟเวอร์คุยกับ Google Sheets ได้
1. เข้า https://console.cloud.google.com → สร้างโปรเจกต์ใหม่
2. เมนูค้นหา → เปิดใช้งาน **Google Sheets API**
3. เมนูซ้าย → **IAM & Admin → Service Accounts** → **Create Service Account** → ตั้งชื่อ เช่น `badminton-server`
4. เข้าไปที่ Service Account ที่สร้าง → แท็บ **Keys** → **Add Key → Create new key** → เลือก **JSON** → ดาวน์โหลดไฟล์เก็บไว้
5. เปิดไฟล์ JSON ที่ได้ จะเจอ `client_email` และ `private_key` — สองค่านี้จะใช้กรอกใน environment variables ตอน deploy
6. เปิด Google Sheet ที่ใช้งานอยู่จริง → กด **Share** → วาง `client_email` ลงไป → ตั้งสิทธิ์เป็น **Editor** → Share

### Phase 3: Deploy บน Render
1. เข้า https://render.com → สมัคร/ล็อกอินด้วย GitHub
2. กด **New → Web Service** → เลือก repo ที่เพิ่งอัปโหลด
3. ตั้งค่า:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
4. เลื่อนลงหา **Environment Variables** → เพิ่มค่าตามไฟล์ `.env.example` ทีละตัว:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` (จาก Phase 2)
   - `GOOGLE_PRIVATE_KEY` (จาก Phase 2 — คัดลอกทั้งก้อนรวม `-----BEGIN...-----END-----` มาด้วย)
   - `SPREADSHEET_ID` (คัดลอกจาก URL ของ Google Sheet)
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (จาก Phase 4 ด้านล่าง)
   - `ADMIN_PASSWORD` (ตั้งรหัสผ่านแอดมินเอง)
   - `JWT_SECRET` (ตั้งข้อความยาวๆ สุ่มๆ เอง)
5. กด **Create Web Service** แล้วรอสักครู่ Render จะสร้าง URL ให้ เช่น `https://badminton-club.onrender.com`

### Phase 4: สร้าง Upstash Redis (ถ้ายังไม่มี)
1. เข้า https://upstash.com → สมัคร/ล็อกอิน
2. กด **Create Database** → ตั้งชื่อ → เลือก Region ใกล้ไทยที่สุด (เช่น Singapore)
3. หน้ารายละเอียด database จะมีค่า `UPSTASH_REDIS_REST_URL` และ `UPSTASH_REDIS_REST_TOKEN` ให้คัดลอกไปใส่ใน Render (Phase 3 ข้อ 4)

### Phase 5: ทดสอบ
1. เปิด URL ที่ Render ให้มา
2. ลองลงทะเบียนด้วยเบอร์โทร/ชื่อเล่นทดสอบ → เช็คในชีต Registrations ว่ามีแถวใหม่ขึ้นจริง
3. กด "แอดมิน" มุมขวาบน → ใส่รหัสผ่านที่ตั้งไว้ใน `ADMIN_PASSWORD` → ควรเข้าแผงแอดมินได้
4. ลองติ๊กเช็คอินคนที่ลงทะเบียนไว้ → ควรมีแจ้งเตือนราคาค่าสนาม และมีแถวใหม่ในชีต ProductSales
5. ลองกดปุ่ม **Walk-in** → กรอกชื่อเล่นทดสอบ → บันทึก → ควรขึ้นในตารางทันทีพร้อมเช็คอินให้อัตโนมัติ
6. ลองกดปุ่ม **ขายของ** ข้างชื่อใครสักคน → เลือกสินค้า → ควรมีแถวใหม่ในชีต ProductSales และถ้าสินค้านั้นมีเลขในคอลัมน์ Stock ของชีต Products ตัวเลขควรลดลง 1
7. ลองกดปุ่ม **ซื้อลูกแบด** → ติ๊กเลือกผู้เล่นที่เช็คอินไว้ 2-4 คน → ยืนยัน → ควรมีแถวใหม่ในชีต ProductSales ของทุกคนที่เลือก ราคาหารเท่ากัน

---

## เมื่อทดสอบผ่านแล้ว

บอกได้เลยว่าจะให้ย้ายฟีเจอร์ไหนต่อ (Walk-in, จัดคิวสนาม, ขายของ, ปิดสนามประจำวัน ฯลฯ) จะทยอยเพิ่ม endpoint ใหม่ใน `server.js` และหน้าจอใน `public/index.html` ให้ครบทีละส่วน โครงสร้างที่วางไว้ (`lib/sheets.js`, `lib/redis.js`, `lib/auth.js`) รองรับการขยายต่อได้โดยไม่ต้องแก้ของเดิม
