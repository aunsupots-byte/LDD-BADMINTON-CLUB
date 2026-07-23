// lib/sheets.js
// ตัวเชื่อมต่อ Google Sheets API v4 แทน SpreadsheetApp ของ Apps Script เดิม
// ใช้ Service Account (บัญชีหุ่นยนต์) ยืนยันตัวตน ตามที่ตั้งค่าไว้ในคู่มือ Phase 2

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Render/ระบบ env var มักเก็บ private key เป็นบรรทัดเดียวโดยแทน newline ด้วย "\n" ตัวอักษร
  // ต้องแปลงกลับเป็น newline จริงก่อนใช้งาน ไม่งั้นจะ auth ไม่ผ่าน
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_EMAIL หรือ GOOGLE_PRIVATE_KEY ใน environment variables');
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file' // สำหรับฟีเจอร์บันทึกรายงาน PDF ลง Drive ในอนาคต
    ]
  });
}

let _sheetsClient = null;
function getSheetsClient() {
  if (!_sheetsClient) {
    _sheetsClient = google.sheets({ version: 'v4', auth: getAuth() });
  }
  return _sheetsClient;
}

// อ่านข้อมูลทั้งชีต (เทียบเท่า sheet.getDataRange().getValues() ของ Apps Script)
async function getValues(sheetName) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName
  });
  return res.data.values || [];
}

// อ่านหลายชีตพร้อมกันในคำขอเดียว (เทียบเท่าการเปิดหลายชีตแยกกันของเดิม แต่เร็วกว่าเพราะยิง HTTP request ครั้งเดียว)
// คืนค่าเป็น object { sheetName: values }
async function batchGetValues(sheetNames) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: sheetNames
  });
  const out = {};
  (res.data.valueRanges || []).forEach((vr, i) => {
    out[sheetNames[i]] = vr.values || [];
  });
  return out;
}

// เพิ่มแถวใหม่ต่อท้ายชีต (เทียบเท่า sheet.appendRow([...]))
async function appendRow(sheetName, rowArray) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowArray] }
  });
}

// แก้ไขค่าช่องเดียว (เทียบเท่า sheet.getRange(row, col).setValue(value))
// row/col นับแบบ 1-index เหมือน Apps Script (row 1 = หัวตาราง)
async function updateCell(sheetName, row, col, value) {
  const colLetter = columnToLetter(col);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${colLetter}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] }
  });
}

// แก้ไขทั้งแถว (เทียบเท่า sheet.getRange(row, 1, 1, n).setValues([[...]]))
async function updateRow(sheetName, row, rowArray) {
  const lastCol = columnToLetter(rowArray.length);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${row}:${lastCol}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowArray] }
  });
}

function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

module.exports = { getValues, batchGetValues, appendRow, updateCell, updateRow, columnToLetter };
