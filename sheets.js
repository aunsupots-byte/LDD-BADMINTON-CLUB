// lib/sheets.js
// ตัวเชื่อมต่อ Google Sheets API (แทน SpreadsheetApp ของ Apps Script เดิม)
// ใช้ Service Account (ดูวิธีสร้างใน README.md หัวข้อ Phase 2) เพื่ออ่าน/เขียนชีตแบบเซิร์ฟเวอร์ต่อเซิร์ฟเวอร์ ไม่ต้องมีคนล็อกอิน

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

let _sheetsClient = null;

// สร้าง client เชื่อมต่อ Google Sheets API ด้วย Service Account แล้วแคชไว้ใช้ซ้ำ
// (ไม่ต้อง authorize ใหม่ทุกครั้งที่เรียกใช้ฟังก์ชันด้านล่าง ประหยัดเวลา round-trip)
async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // 🆕 ค่า private key ที่วางใน environment variable มักมี "\n" เป็นตัวอักษรจริง (ไม่ใช่ขึ้นบรรทัดใหม่จริง)
  // ต้องแปลงกลับเป็นขึ้นบรรทัดใหม่จริงก่อน ไม่งั้น JWT auth จะ parse คีย์ไม่ผ่าน
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('ไม่พบ GOOGLE_SERVICE_ACCOUNT_EMAIL หรือ GOOGLE_PRIVATE_KEY ใน environment variables กรุณาตั้งค่าตาม README.md Phase 2-3');
  }
  if (!SPREADSHEET_ID) {
    throw new Error('ไม่พบ SPREADSHEET_ID ใน environment variables');
  }

  const auth = new google.auth.JWT({
    email: email,
    key: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  await auth.authorize();

  _sheetsClient = google.sheets({ version: 'v4', auth: auth });
  return _sheetsClient;
}

// ดึงค่าทั้งหมดของชีตเดียว คืนเป็น array 2 มิติ (แถวที่ 0 = หัวตาราง) เทียบเท่า sheet.getDataRange().getValues() เดิม
async function getValues(sheetName) {
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName
  });
  return resp.data.values || [];
}

// ดึงหลายชีตพร้อมกันในคำขอเดียว (เร็วกว่าเรียก getValues() หลายรอบแยกกัน) คืนเป็น object { ชื่อชีต: values }
async function batchGetValues(sheetNames) {
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: sheetNames
  });
  const result = {};
  (resp.data.valueRanges || []).forEach(function(valueRange, idx) {
    result[sheetNames[idx]] = valueRange.values || [];
  });
  return result;
}

// เพิ่มแถวใหม่ต่อท้ายชีต เทียบเท่า sheet.appendRow([...]) เดิมใน Apps Script
async function appendRow(sheetName, rowValues) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] }
  });
}

// แก้ไขค่าช่องเดียว — row/col เป็น 1-index ตรงกับของเดิมใน Apps Script (แถวที่ 1 = หัวตาราง)
async function updateCell(sheetName, row, col, value) {
  const sheets = await getSheetsClient();
  const a1 = sheetName + '!' + columnToLetter(col) + row;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: a1,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] }
  });
}

// แปลงเลขคอลัมน์ (1,2,3...) เป็นตัวอักษรคอลัมน์แบบ A1 notation (1=A, 2=B, ..., 27=AA, ...)
function columnToLetter(col) {
  let letter = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

module.exports = { getValues: getValues, batchGetValues: batchGetValues, appendRow: appendRow, updateCell: updateCell };
