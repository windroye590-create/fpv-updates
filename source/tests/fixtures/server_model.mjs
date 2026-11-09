import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import {zipReportParts} from '../../web/excel-report.js';

const {version: releaseName, versionCode: releaseCode} = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url)));

class Range {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }
  getValues() {
    return Array.from({length: this.rowCount}, (_, y) =>
      Array.from({length: this.columnCount}, (_, x) =>
        this.sheet.rows[this.row - 1 + y]?.[this.column - 1 + x] ?? ""));
  }
  setValues(values) {
    for (let y = 0; y < this.rowCount; y += 1) {
      const target = this.sheet.ensureRow(this.row - 1 + y);
      for (let x = 0; x < this.columnCount; x += 1) target[this.column - 1 + x] = values[y][x];
    }
    return this;
  }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValues() {return this.getValues().map(row=>row.map(value=>String(value)));}
  setValue(value) { return this.setValues([[value]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setBackgrounds() { return this; }
  setFontColor() { return this; }
  setNumberFormat() { return this; }
  setNumberFormats() { return this; }
  setWrap() { return this; }
  setVerticalAlignment() { return this; }
  getRow() { return this.row; }
  getColumn() { return this.column; }
  getNumColumns() { return this.columnCount; }
  getNumRows() { return this.rowCount; }
  createFilter() {const range=this,criteria=new Map(),filter={getRange:()=>range,getColumnFilterCriteria:column=>criteria.get(column)||null,setColumnFilterCriteria(column,value){criteria.set(column,value);return filter;},remove(){range.sheet.filter=null;}};this.sheet.filter=filter;return filter;}
  applyRowBanding() {const b={getRange:()=>this,remove:()=>{this.sheet.bandings=this.sheet.bandings.filter(v=>v!==b);},setHeaderRowColor(){return b;},setFirstRowColor(){return b;},setSecondRowColor(){return b;}};this.sheet.bandings.push(b);return b;}
}

class Sheet {
  constructor(name) {
    this.id=crypto.randomInt(1,2000000000);
    this.name = name;
    this.rows = [];
    this.maxColumns = 1;
    this.maxRows = 1000;
    this.hidden = false;
    this.hiddenColumns = new Set();
    this.bandings=[];this.rules=[];this.filter=null;
  }
  ensureRow(index) {
    while (this.rows.length <= index) this.rows.push([]);
    return this.rows[index];
  }
  getMaxColumns() { return this.maxColumns; }
  insertColumnsAfter(after, count) {
    this.rows.forEach((row) => {
      while (row.length < after) row.push("");
      row.splice(after, 0, ...Array(count).fill(""));
    });
    this.hiddenColumns = new Set([...this.hiddenColumns].map((column) => column > after ? column + count : column));
    this.maxColumns += count;
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, count) { this.maxRows += count; }
  getLastRow() {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if (this.rows[index].some((value) => value !== "" && value != null)) return index + 1;
    }
    return 0;
  }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    assert.ok(row + rowCount - 1 <= this.maxRows, "Range exceeds sheet row capacity");
    return new Range(this, row, column, rowCount, columnCount);
  }
  appendRow(values) {
    this.rows.push([...values]);
    this.maxRows = Math.max(this.maxRows, this.rows.length);
    return this;
  }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  deleteRows(row,count) { this.rows.splice(row - 1,count); }
  setFrozenRows() {}
  setFrozenColumns() {}
  setRowHeight() {}
  autoResizeRows() {}
  getFilter() {return this.filter;}
  getBandings() {return this.bandings;}
  getConditionalFormatRules() {return this.rules;}
  setConditionalFormatRules(rules) {this.rules=rules;}
  moveColumns(range,destination) {
    const from=range.column-1,to=destination-1,count=range.columnCount;
    const order=Array.from({length:this.maxColumns},(_,i)=>i);order.splice(to,0,...order.splice(from,count));
    this.rows=this.rows.map(row=>order.map(i=>row[i]??''));
    this.hiddenColumns=new Set([...this.hiddenColumns].map(c=>order.indexOf(c-1)+1));
  }
  copyTo(book) {const copy=book.insertSheet('Copy '+this.name+' '+book.getSheets().length);copy.rows=this.rows.map(r=>[...r]);copy.maxColumns=this.maxColumns;copy.maxRows=this.maxRows;copy.hiddenColumns=new Set(this.hiddenColumns);return copy;}
  setColumnWidth() {}
  setColumnWidths() {}
  hideColumns(start, count = 1) { for (let i = 0; i < count; i += 1) this.hiddenColumns.add(start + i); }
  showColumns(start, count = 1) { for (let i = 0; i < count; i += 1) this.hiddenColumns.delete(start + i); }
  getName() { return this.name; }
  getSheetId() {return this.id;}
  setName(name) {if(this.book){this.book.sheets.delete(this.name);this.book.sheets.set(name,this);}this.name = name; return this; }
  isSheetHidden() { return this.hidden; }
  hideSheet() { this.hidden = true; }
}

class Spreadsheet {
  constructor(id, title = "") { this.id = id; this.title = title; this.sheets = new Map(); }
  getId() { return this.id; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }
  getSheets() { return [...this.sheets.values()]; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const sheet = new Sheet(name);
    sheet.book=this;
    this.sheets.set(name, sheet);
    return sheet;
  }
}

class KeyValueStore {
  constructor() { this.values = new Map(); }
  getProperties() { return Object.fromEntries(this.values); }
  getProperty(key) { return this.values.get(key) ?? null; }
  setProperty(key, value) { this.values.set(key, String(value)); return this; }
  deleteProperty(key) { this.values.delete(key); return this; }
}

class CacheStore {
  constructor() { this.values = new Map(); }
  get(key) { return this.values.get(key) ?? null; }
  put(key, value) { this.values.set(key, String(value)); }
  remove(key) { this.values.delete(key); }
}

function bytes(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.from(Array.from(value || [], (item) => item < 0 ? item + 256 : item));
}

class ModelBlob {
 constructor(value,type='',name=''){this.value=bytes(value);this.type=type;this.name=name;}
 getBytes(){return [...this.value];}getDataAsString(){return this.value.toString('utf8');}getName(){return this.name;}
 setName(name){this.name=name;return this;}setContentType(type){this.type=type;return this;}getContentType(){return this.type;}
 copyBlob(){return new ModelBlob(this.value,this.type,this.name);}
}
const serverSourceText = fs.readFileSync(process.env.LITAKOVA_SERVER_SOURCE || new URL("../../Code.gs", import.meta.url), "utf8");
const BACKEND_SPREADSHEET_ID = serverSourceText.match(/^const SPREADSHEET_ID = '([^']+)';/m)?.[1];
assert.ok(BACKEND_SPREADSHEET_ID,"The isolated server model needs the configured database identity");
const spreadsheet = new Spreadsheet(BACKEND_SPREADSHEET_ID);
const spreadsheets = new Map([[spreadsheet.id, spreadsheet]]);
let createdSpreadsheetCounter = 0;
const properties = new KeyValueStore();properties.setProperty('LK_EXCEL_LAYOUT_ARMED_V1','1');
const cache = new CacheStore();
const lock = {tryLock: () => true, waitLock() {}, releaseLock() {}};
const context = vm.createContext({
  console,
  Date,
  JSON,
  Math,
  Number,
  String,
  Boolean,
  Object,
  Array,
  RegExp,
  Error,
  isFinite,
  isNaN,
  decodeURIComponent,
  SpreadsheetApp: {
    newConditionalFormatRule:()=>{const r={whenFormulaSatisfied(v){r.formula=v;return r;},setBackground(){return r;},setFontColor(){return r;},setRanges(v){r.ranges=v;return r;},build(){return {getBooleanCondition:()=>({getCriteriaValues:()=>[r.formula]}),ranges:r.ranges};}};return r;},
    openById: (id) => {
      if (String(id) === BACKEND_SPREADSHEET_ID) return spreadsheet;
      const value = spreadsheets.get(String(id));
      if (!value) throw new Error("Spreadsheet not found");
      return value;
    },
    create: (title) => {
      const value = new Spreadsheet(`public-${++createdSpreadsheetCounter}`, title);
      spreadsheets.set(value.id, value);
      return value;
    }
  },
  PropertiesService: {getScriptProperties: () => properties},
  CacheService: {getScriptCache: () => cache},
  LockService: {getScriptLock: () => lock},
  Utilities: {
    Charset:{UTF_8:"UTF-8"},
    DigestAlgorithm: {SHA_256:"sha256"},
    computeDigest: (algorithm,value) => [...crypto.createHash(algorithm).update(bytes(value)).digest()],
    getUuid: () => crypto.randomUUID(),
    newBlob: (value,type,name) =>new ModelBlob(value,type,name),
    zip:(blobs,name)=>new ModelBlob(zipReportParts(blobs.map(b=>({name:b.getName(),data:b.getDataAsString()}))),'application/zip',name),
    unzip:blob=>{const raw=Buffer.from(blob.getBytes()),parts=[];for(let p=0;p+30<=raw.length&&raw.readUInt32LE(p)===0x04034b50;){assert.equal(raw.readUInt16LE(p+8),0);const size=raw.readUInt32LE(p+18),names=raw.readUInt16LE(p+26),extra=raw.readUInt16LE(p+28),start=p+30+names+extra;parts.push(new ModelBlob(raw.subarray(start,start+size),'application/xml',raw.subarray(p+30,p+30+names).toString('utf8')));p=start+size;}return parts;},
    base64Encode: (value) => bytes(value).toString("base64"),
    base64Decode: (value) => [...Buffer.from(String(value), "base64")],
    base64EncodeWebSafe: (value) => bytes(value).toString("base64url"),
    base64DecodeWebSafe: (value) => [...Buffer.from(String(value), "base64url")],
    computeHmacSha256Signature: (value, key) => [...crypto.createHmac("sha256", bytes(key)).update(bytes(value)).digest()]
  },
  ContentService: {
    MimeType: {JSON: "application/json"},
    createTextOutput: (text) => ({text, setMimeType() { return this; }})
  }
});

const source = serverSourceText;
vm.runInContext(source, context, {filename: "Код.gs"});


function publicRows(sheet){return [['ПІБ курсанта','Правильних','Неправильних','Час проходження','Правильних, %','Тест','_ID курсанта','_ID результату','Стан перевірки','Набрано балів','Максимум балів','Підсумковий бал, %','Група','Дата завершення','Результат'],...Array.from(context.publicRowsFromSheet_(sheet),row=>Array.from(row))];}

function credential(password) {
  const salt = crypto.randomBytes(16);
  return {
    passwordSalt: salt.toString("base64"),
    passwordHash: crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("base64")
  };
}

function api(method, path, token = "", body = {}) {
  const r=JSON.parse(context.doPost({postData:{contents:JSON.stringify({action:"api",method,path,token,body,writtenProtocol:1,choiceProtocol:2})}}).text);
  if(!r.ok)throw Object.assign(Error(r.error),{code:r.code});return r;
}

function expectCode(action, expected) {
  let actual = "";
  try { action(); }
  catch (error) { actual = error.code; }
  assert.equal(actual, expected);
}

assert.match(context.setupCommission(), /окрема таблиця результатів/i);
assert.equal(spreadsheet.sheets.size, 21);
assert.ok(spreadsheet.getSheetByName('_Частини_тестів'));
assert.ok(spreadsheet.getSheetByName('_Видалені_результати'));
assert.equal(api("GET", "/api/app-info").latestVersionName, releaseName);
assert.equal(api("GET", "/api/app-info").latestVersionCode, releaseCode);
assert.equal(spreadsheet.getSheetByName("_Результати_дані").rows[0][2], "ПІБ",
  "Службовий заголовок має залишатися сумісним із сервером версії 3");
const publicSpreadsheet = spreadsheets.get(properties.getProperty("PUBLIC_RESULTS_SPREADSHEET_ID"));
assert.ok(publicSpreadsheet, "Має бути створено окрему таблицю результатів");
assert.deepEqual(publicSpreadsheet.getSheetByName("Результати курсантів").rows[0].slice(0, 5),
  ["ПІБ курсанта", "Група", "Тест", "Дата завершення", "Результат"]);

const initialCode = context.createInitialInstructorCode().match(/[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}/)?.[0];
assert.ok(initialCode);
const instructorPassword = "instructor-password";
const instructorRegistration = api("POST", "/api/instructor/register", "", {
  fullName: "Розробник",
  username: "WindRoy",
  inviteCode: initialCode,
  ...credential(instructorPassword)
});
assert.equal(instructorRegistration.user.role, "instructor");
const instructorToken = instructorRegistration.token;

const bankQuestion = api("POST", "/api/instructor/question-bank", instructorToken, {
  category: "Авіаційні основи",
  difficulty: "medium",
  question: {
    text: "Що показує висотомір?",
    explanation: "Висоту польоту.",
    answers: [{text: "Висоту", isCorrect: true}, {text: "Курс", isCorrect: false}]
  }
}).question;
assert.equal(api("GET", "/api/instructor/question-bank", instructorToken).questions.length, 1);
const updatedBankQuestion = api("POST", `/api/instructor/question-bank/${bankQuestion.id}`, instructorToken, {
  category: "Прилади", difficulty: "easy", question: bankQuestion.question
}).question;
assert.equal(updatedBankQuestion.category, "Прилади");

const group = api("POST", "/api/instructor/groups", instructorToken, {name: "Лелека-100"}).group;
assert.equal(group.name, "Лелека-100");

const cadetPassword = "cadet-password";
const cadetRegistration = api("POST", "/api/register", "", {
  fullName: "Тестовий Курсант",
  username: "cadet",
  groupId: group.id,
  ...credential(cadetPassword)
});
assert.equal(cadetRegistration.user.groupName, "Лелека-100");

const challenge = api("POST", "/api/challenge", "", {username: "cadet", groupName: "Лелека-100"});
const derived = crypto.pbkdf2Sync(cadetPassword, Buffer.from(challenge.salt, "base64"), 120000, 32, "sha256");
const proof = crypto.createHmac("sha256", derived).update(challenge.nonce, "utf8").digest("base64");
const cadetLogin = api("POST", "/api/login", "", {
  username: "cadet", groupName: "Лелека-100", nonce: challenge.nonce, proof
});
assert.equal(cadetLogin.user.id, cadetRegistration.user.id);

const groupMarker = `[[LK-GROUPS:${Buffer.from("Лелека-100", "utf8").toString("base64url")}]]`;
const test = api("POST", "/api/instructor/tests", instructorToken, {
  title: "Контрольний тест",
  description: groupMarker,
  mode: "training",
  passingPercent: 70,
  published: true,
  questions: [{
    text: "Столиця України?",
    explanation: "Київ — столиця України.",
    answers: [{text: "Київ", isCorrect: true}, {text: "Львів", isCorrect: false}]
  }]
}).test;
assert.equal(test.questionCount, 1);

const cadetTest = api("GET", `/api/tests/${test.id}`, cadetLogin.token).test;
assert.equal(cadetTest.questions[0].answers[0].isCorrect, undefined);
assert.equal(cadetTest.questions[0].explanation, undefined);

const result = api("POST", "/api/results", cadetLogin.token, {
  testId: test.id,
  durationSeconds: 42,
  submissionId: "contract-result-1",
  answers: [{questionId: test.questions[0].id, answerId: test.questions[0].answers[0].id}]
}).result;
assert.equal(result.score, 100);
assert.equal(api("GET", "/api/my-results", cadetLogin.token).results.length, 1);
assert.equal(api("GET", "/api/instructor/dashboard", instructorToken).results.length, 1);
const analytics = api("GET", "/api/instructor/analytics", instructorToken);
assert.equal(analytics.attempts, 1);
assert.equal(analytics.average, 100);
assert.equal(analytics.hardestQuestions[0].correct, 1);
assert.equal(analytics.detailedAttempts, 1);

let duplicateCode = "";
try {
  api("POST", "/api/results", cadetLogin.token, {testId: test.id, durationSeconds: 50, answers: []});
} catch (error) {
  duplicateCode = error.code;
}
assert.equal(duplicateCode, "ALREADY_COMPLETED");

let occupiedCode = "";
try {
  api("DELETE", `/api/instructor/groups/${group.id}`, instructorToken);
} catch (error) {
  occupiedCode = error.code;
}
assert.equal(occupiedCode, "GROUP_NOT_EMPTY");

const emptyGroup = api("POST", "/api/instructor/groups", instructorToken, {name: "Тимчасова"}).group;
assert.equal(api("DELETE", `/api/instructor/groups/${emptyGroup.id}`, instructorToken).deleted, true);
assert.equal(api("GET", "/api/groups").groups.some((item) => item.name === "Тимчасова"), false);

const visibleRows = publicRows(publicSpreadsheet.getSheetByName("Результати курсантів"));
assert.equal(visibleRows.length, 2);
assert.deepEqual(visibleRows[1].slice(0, 5), ["Тестовий Курсант", 1, 0, "0 хв 42 с", 100]);
assert.equal(visibleRows[1][5], "Контрольний тест");
assert.equal(String(visibleRows[1][6]), String(cadetRegistration.user.id));
assert.equal(String(visibleRows[1][7]), String(result.id));

const invite = api("POST", "/api/instructor/invite", instructorToken).code;
assert.ok(invite);
const secondInstructor = api("POST", "/api/instructor/register", "", {
  fullName: "Другий Інструктор · Викладач",
  username: "teacher2",
  inviteCode: invite,
  ...credential("teacher-password")
});
assert.equal(secondInstructor.user.role, "instructor");
expectCode(() => api("POST", "/api/instructor/register", "", {
  fullName: "Третій Інструктор",
  username: "teacher3",
  inviteCode: invite,
  ...credential("teacher3-password")
}), "INVALID_INVITE");
const secondSheetInfo = api("POST", "/api/instructor/results-sheet/sync", secondInstructor.token);
assert.equal(secondSheetInfo.synced, true);
assert.equal(secondSheetInfo.url, publicSpreadsheet.getUrl()+'#gid='+publicSpreadsheet.getSheetByName('Результати курсантів').getSheetId());

const secondCadet = api("POST", "/api/register", "", {
  fullName: "Інший Курсант",
  username: "cadet2",
  groupId: group.id,
  ...credential("cadet2-password")
});
// Simulate records created by an older server; no production data is used.
function seedLegacyRetry(source, userId, resultId, completedToken = '') {
  source=context.getTestById_(source.id)||source;
  const seeded = api('POST', '/api/instructor/tests', instructorToken, {
    title: String(source.title).slice(0,150) + ' — повторна спроба',
    description: String(source.description || ''), mode: source.mode,
    durationMinutes: source.durationMinutes, passingPercent: source.passingPercent,
    published: true, questions: source.questions
  }).test;
  if (completedToken) api('POST', '/api/results', completedToken, {
    testId: seeded.id, writtenProtocol:1, choiceProtocol:2, durationSeconds:30,
    submissionId:'historical-' + seeded.id,
    answers:seeded.questions.map(q=>({questionId:q.id,answerId:q.answers.find(a=>a.isCorrect)?.id||'0'}))
  });
  const stored=context.getTestById_(seeded.id);
  seeded.description='[[LK-RETRY:' + String(userId) + ']]\n' + seeded.description;
  spreadsheet.getSheetByName('_Тести').getRange(stored.rowNumber,3).setValue(seeded.description);
  spreadsheet.getSheetByName('_Повторні_спроби').appendRow([resultId,userId,source.id,seeded.id,new Date(),!completedToken]);
  return seeded;
}
expectCode(()=>api('POST', `/api/instructor/results/${result.id}/retry`, secondInstructor.token),'RETAKES_DISABLED');
expectCode(()=>api('POST', `/api/instructor/results/${result.id}/retry`, instructorToken),'RETAKES_DISABLED');
const retry={test:seedLegacyRetry(test,cadetRegistration.user.id,result.id,cadetLogin.token)};
assert.equal(api('GET','/api/tests',cadetLogin.token).tests.some(t=>String(t.id)===String(retry.test.id)),false);

const secondChallenge = api("POST", "/api/challenge", "", {username: "cadet2", groupName: "Лелека-100"});
const secondDerived = crypto.pbkdf2Sync("cadet2-password", Buffer.from(secondChallenge.salt, "base64"), 120000, 32, "sha256");
const secondProof = crypto.createHmac("sha256", secondDerived).update(secondChallenge.nonce, "utf8").digest("base64");
const secondCadetLogin = api("POST", "/api/login", "", {
  username: "cadet2", groupName: "Лелека-100", nonce: secondChallenge.nonce, proof: secondProof
});
assert.equal(api("GET", "/api/tests", secondCadetLogin.token).tests.some((item) => String(item.id) === String(retry.test.id)), false,
  "Персональний повтор не повинен бути доступний іншому курсанту");

expectCode(()=>api('GET', `/api/tests/${retry.test.id}`,cadetLogin.token),'RETAKES_DISABLED');
assert.deepEqual(api('GET','/api/instructor/dashboard',instructorToken).retries,[]);

const replacement = api("POST", `/api/instructor/tests/${test.id}/replace`, instructorToken, {
  title: "Контрольний тест — оновлений",
  description: groupMarker,
  mode: "training",
  passingPercent: 75,
  published: true,
  questions: [{
    text: "Оновлене питання?",
    explanation: "Так.",
    answers: [{text: "Так", isCorrect: true}, {text: "Ні", isCorrect: false}]
  }]
}).test;
assert.notEqual(String(replacement.id), String(test.id));
expectCode(() => api("GET", `/api/tests/${test.id}`, cadetLogin.token), "TEST_NOT_FOUND");
assert.equal(api("GET", "/api/tests", cadetLogin.token).tests.some((item) => String(item.id) === String(replacement.id)), true);
assert.equal(api("DELETE", `/api/instructor/tests/${retry.test.id}`, instructorToken).deleted, true);
assert.ok(api("GET", "/api/instructor/results", instructorToken).results.some(item => String(item.testId) === String(retry.test.id)));

const assignedGroup = api("POST", "/api/instructor/groups", instructorToken, {name: "Призначена група"}).group;
const assignedMarker = `[[LK-GROUPS:${Buffer.from(JSON.stringify([assignedGroup.name]), "utf8").toString("base64url")}]]`;
api("POST", "/api/instructor/tests", instructorToken, {
  title: "Тест призначеної групи", description: assignedMarker, mode: "training", published: true,
  questions: [{text: "Питання", answers: [{text: "Так", isCorrect: true}, {text: "Ні", isCorrect: false}]}]
});
expectCode(() => api("DELETE", `/api/instructor/groups/${assignedGroup.id}`, instructorToken), "GROUP_IN_USE");
expectCode(() => api("POST", "/api/instructor/tests", instructorToken, {
  title: "Пошкоджене призначення", description: "[[LK-GROUPS:Ww]]", mode: "training", published: true,
  questions: [{text: "Питання", answers: [{text: "Так", isCorrect: true}, {text: "Ні", isCorrect: false}]}]
}), "BAD_GROUP_ASSIGNMENT");

assert.equal(api("GET", "/api/instructor/results", secondInstructor.token).results.length, 2,
  "Кожен інструктор повинен бачити повну історію результатів");
api("POST", `/api/instructor/users/${cadetRegistration.user.id}/password`, instructorToken,
  credential("cadet-new-password"));
expectCode(() => api("GET", "/api/my-results", cadetLogin.token), "SESSION_EXPIRED");

const audit = api("GET", "/api/instructor/audit", instructorToken).entries;
assert.ok(audit.some((entry) => entry.action === "GROUP_CREATE"));
assert.ok(audit.some((entry) => entry.action === "TEST_CREATE"));
assert.ok(audit.some((entry) => entry.action === "CADET_PASSWORD"));
assert.equal(api("DELETE", `/api/instructor/question-bank/${bankQuestion.id}`, instructorToken).deleted, true);
assert.equal(api("GET", "/api/instructor/question-bank", instructorToken).questions.length, 0);

console.log("Apps Script v7 contract tests passed: schema, bank, analytics, audit, shared results, sessions, invites, groups, replace and disabled retakes.");

const failures = [];
let regressionCount = 0;
function regression(name, run) {
  regressionCount += 1;
  try { run(); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
}
function regressionTest(title, questionCount = 1) {
  return api("POST", "/api/instructor/tests", instructorToken, {
    title, description: "", mode: "training", published: true, passingPercent: 70,
    questions: Array.from({length: questionCount}, (_, index) => ({
      text: `${title} — питання ${index + 1}`, explanation: "Перевірка регресії.",
      answers: [{text: "Так", isCorrect: true}, {text: "Ні", isCorrect: false}]
    }))
  }).test;
}
function regressionBody(test, key) {
  return {
    testId: test.id, durationSeconds: 17, submissionId: key,
    answers: test.questions.map((question) => ({questionId: question.id, answerId: question.answers[0].id}))
  };
}

regression("Retransmitting an acknowledged submission is idempotent", () => {
  const test = regressionTest("Повторна доставка");
  const body = regressionBody(test, "regression-idempotent");
  const first = api("POST", "/api/results", secondCadetLogin.token, body).result;
  const again = api("POST", "/api/results", secondCadetLogin.token, body).result;
  assert.equal(String(again.id), String(first.id));
  assert.equal(api("GET", "/api/my-results", secondCadetLogin.token).results
    .filter((item) => String(item.testId) === String(test.id)).length, 1);
  expectCode(() => api("POST", "/api/results", secondCadetLogin.token,
    {...body, submissionId: "a-different-attempt"}), "ALREADY_COMPLETED");
});

regression("Blank test rows do not change which questions are fetched", () => {
  const sheet = spreadsheet.getSheetByName("_Тести");
  sheet.rows.splice(1, 0, []);
  try {
    const full = api("GET", `/api/tests/${replacement.id}`, instructorToken).test;
    assert.equal(full.questions[0].text, "Оновлене питання?");
    const newer = api("POST", `/api/instructor/tests/${replacement.id}/replace`, instructorToken, {
      title: "Оновлення після порожнього рядка", description: "", mode: "training", published: true,
      questions: [{text: "Саме це питання", answers: [{text: "Так", isCorrect: true}, {text: "Ні"}]}]
    }).test;
    expectCode(() => api("GET", `/api/tests/${replacement.id}`, instructorToken), "TEST_NOT_FOUND");
    assert.equal(api("GET", `/api/tests/${newer.id}`, instructorToken).test.questions[0].text, "Саме це питання");
  } finally { sheet.rows.splice(1, 1); }
});

regression("Legacy personal retries cannot be edited into new attempts", () => {
  const source=regressionTest('Старий персональний повтор');
  const completed=api('POST','/api/results',secondCadetLogin.token,regressionBody(source,'regression-old-retry')).result;
  const personal=seedLegacyRetry(source,secondCadetLogin.user.id,completed.id);
  const previousIds=context.listTests_(false).map(t=>String(t.id));
  expectCode(()=>api('POST',`/api/instructor/tests/${personal.id}/replace`,instructorToken,{title:'Повтор після редагування',description:'',mode:'training',published:true,questions:personal.questions}),'RETAKES_DISABLED');
  assert.deepEqual(context.listTests_(false).map(t=>String(t.id)),previousIds);
  assert.equal(api('GET','/api/tests',secondCadetLogin.token).tests.some(t=>String(t.id)===String(personal.id)),false);
});

regression("An analytics write failure cannot reject a saved result", () => {
  const test = regressionTest("Збій статистики");
  const details = spreadsheet.getSheetByName("_Деталі_відповідей");
  const original = details.getRange;
  details.getRange = function (row, ...rest) {
    const range = original.call(this, row, ...rest);
    if (row > 1) range.setValues = () => { throw new Error("Injected details write failure"); };
    return range;
  };
  try {
    const body = regressionBody(test, "regression-details-failure");
    const accepted = api("POST", "/api/results", secondCadetLogin.token, body).result;
    assert.equal(accepted.score, 100);
    assert.equal(String(api("POST", "/api/results", secondCadetLogin.token, body).result.id), String(accepted.id));
  } finally { details.getRange = original; }
});

regression("Answer details extend a full sheet before a batch write", () => {
  const details = spreadsheet.getSheetByName("_Деталі_відповідей");
  const previousRows = details.rows.map((row) => [...row]);
  const previousCapacity = details.maxRows;
  try {
    while (details.rows.length < 1000) details.rows.push(["historical", "", "", "", "", "", false, ""]);
    details.maxRows = 1000;
    const test = regressionTest("Місткість таблиці", 2);
    const result = api("POST", "/api/results", secondCadetLogin.token,
      regressionBody(test, "regression-capacity")).result;
    assert.ok(details.maxRows >= 1002);
    assert.equal(details.rows.filter((row) => String(row[0]) === String(result.id)).length, 2);
  } finally { details.rows = previousRows; details.maxRows = previousCapacity; }
});

regression("An audit write failure cannot reject a created test", () => {
  const sheet = spreadsheet.getSheetByName("_Журнал_дій");
  const original = sheet.appendRow;
  sheet.appendRow = () => { throw new Error("Injected audit write failure"); };
  try {
    const test = regressionTest("Збій журналу");
    assert.ok(test.id);
    assert.equal(api("GET", `/api/tests/${test.id}`, instructorToken).test.title, "Збій журналу");
  } finally { sheet.appendRow = original; }
});

regression("User-defined group names do not collide with object properties", () => {
  const group = api("POST", "/api/instructor/groups", instructorToken, {name: "constructor"}).group;
  const cadet = api("POST", "/api/register", "", {
    fullName: "Перевірка назви групи", username: "regression_group", groupId: group.id,
    ...credential("regression-password")
  });
  const test = regressionTest("Назва групи");
  api("POST", "/api/results", cadet.token, regressionBody(test, "regression-property-name"));
  const stats = api("GET", "/api/instructor/analytics", instructorToken).groups.find((g) => g.name === "constructor");
  assert.equal(stats.attempts, 1);
  assert.equal(stats.average, 100);
  assert.equal(stats.passRate, 100);
});

regression("Retakes remain disabled for maximum-length test titles", () => {
  const test=regressionTest('Т'.repeat(180));
  const result=api('POST','/api/results',secondCadetLogin.token,regressionBody(test,'regression-long-title')).result;
  expectCode(()=>api('POST',`/api/instructor/results/${result.id}/retry`,instructorToken),'RETAKES_DISABLED');
});

regression("A disabled retry never creates tests or writes retry links", () => {
  const test=regressionTest('Вимкнений повтор');
  const result=api('POST','/api/results',secondCadetLogin.token,regressionBody(test,'regression-no-retry-write')).result;
  const previousIds=context.listTests_(false).map(t=>String(t.id));
  const retries=spreadsheet.getSheetByName('_Повторні_спроби'),original=retries.appendRow;
  retries.appendRow=()=>{throw Error('Retry storage must not be used');};
  try {
    expectCode(()=>api('POST',`/api/instructor/results/${result.id}/retry`,instructorToken),'RETAKES_DISABLED');
    assert.deepEqual(context.listTests_(false).map(t=>String(t.id)),previousIds);
  }finally{retries.appendRow=original;}
});

regression("Primary result key remains idempotent when the sync ledger fails", () => {
  const test = regressionTest("Надійний первинний запис", 2);
  const body = regressionBody(test, "primary-key-without-ledger");
  body.answers[1].answerId = test.questions[1].answers[1].id;
  const sync = spreadsheet.getSheetByName("_Синхронізація");
  const original = sync.appendRow;
  sync.appendRow = () => { throw new Error("Injected sync ledger failure"); };
  try {
    const first = api("POST", "/api/results", secondCadetLogin.token, body);
    const again = api("POST", "/api/results", secondCadetLogin.token, body);
    assert.equal(again.result.id, first.result.id);
    assert.equal(again.alreadyAccepted, true);
    assert.equal(again.practice.questions.length, 1);
    assert.equal(again.practice.questions[0].id, test.questions[1].id);
    expectCode(() => api("POST", "/api/results", secondCadetLogin.token,
      {...body, submissionId: "unauthorized-new-attempt"}), "ALREADY_COMPLETED");
  } finally { sync.appendRow = original; }
});

regression("Mistakes are available only to the result owner after submission", () => {
  const test = regressionTest("Захищені помилки");
  const body = regressionBody(test, "private-mistakes");
  body.answers[0].answerId = test.questions[0].answers[1].id;
  const sanitized = api("GET", `/api/tests/${test.id}`, secondCadetLogin.token).test;
  assert.ok(sanitized.questions[0].answers.every((answer) => !answer.isCorrect));
  const accepted = api("POST", "/api/results", secondCadetLogin.token, body);
  const path = `/api/results/${accepted.result.id}/mistakes`;
  assert.equal(api("GET", path, secondCadetLogin.token).practice.questions[0].answers.filter((a) => a.isCorrect).length, 1);
  const outsider = api("POST", "/api/register", "", {fullName: "Інший курсант", username: "private_review_other",
    groupId: group.id, ...credential("other-cadet-password")});
  expectCode(() => api("GET", path, outsider.token), "FORBIDDEN");
  expectCode(() => api("GET", path, instructorToken), "FORBIDDEN");
  assert.equal(api("GET", "/api/my-results", secondCadetLogin.token).results.filter((r) => r.testId === test.id).length, 1);
  expectCode(() => api("POST", "/api/results", secondCadetLogin.token,
    {...body, submissionId: "practice-is-not-an-official-attempt"}), "ALREADY_COMPLETED");
});

regression("Practice survives an auxiliary details failure and test archival", () => {
  const test = regressionTest("Помилки без допоміжного запису", 2);
  const body = regressionBody(test, "primary-answers-without-details");
  body.answers = [];
  const details = spreadsheet.getSheetByName("_Деталі_відповідей");
  const original = details.getRange;
  details.getRange = function (...args) {
    const range = original.apply(this, args);
    range.setValues = () => { throw new Error("Injected details write failure"); };
    return range;
  };
  let accepted;
  try { accepted = api("POST", "/api/results", secondCadetLogin.token, body); }
  finally { details.getRange = original; }
  api("POST", `/api/instructor/tests/${test.id}/replace`, instructorToken, {
    title: "Нова редакція", mode: "training", published: true,
    questions: [{text: "Інше питання", answers: [{text: "Так", isCorrect: true}, {text: "Ні"}]}]
  });
  const practice = api("GET", `/api/results/${accepted.result.id}/mistakes`, secondCadetLogin.token).practice;
  assert.equal(practice.questions.length, 2);
  assert.equal(practice.questions[0].text, test.questions[0].text);
});

regression("Legacy result practice requires complete historical details", () => {
  const test = regressionTest("Старі помилки");
  const body = regressionBody(test, "legacy-practice");
  body.answers = [];
  const accepted = api("POST", "/api/results", secondCadetLogin.token, body).result;
  const row = spreadsheet.getSheetByName("_Результати_дані").rows.find((r) => r[0] === accepted.id);
  row[12] = ""; row[13] = "";
  const path = `/api/results/${accepted.id}/mistakes`;
  assert.equal(api("GET", path, secondCadetLogin.token).practice.questions.length, 1);
  const details = spreadsheet.getSheetByName("_Деталі_відповідей");
  const index = details.rows.findIndex((r) => r[0] === accepted.id);
  const saved = details.rows.splice(index, 1)[0];
  try { expectCode(() => api("GET", path, secondCadetLogin.token), "REVIEW_UNAVAILABLE"); }
  finally { details.rows.splice(index, 0, saved); }
});

regression("Lesson uses full history and eligible active cadets", () => {
  const test = regressionTest("Заняття з повною історією");
  const accepted = api("POST", "/api/results", secondCadetLogin.token,
    regressionBody(test, "lesson-full-history")).result;
  const resultSheet = spreadsheet.getSheetByName("_Результати_дані");
  const size = resultSheet.rows.length;
  for (let index = 0; index < 505; index += 1) resultSheet.appendRow([
    `unrelated-${index}`, "another-user", "Інша група", "Інша група", "another-test", "Інший тест", 100, 1, 1, 10, new Date(), true
  ]);
  try {
    assert.ok(!api("GET", "/api/instructor/dashboard", instructorToken).results.some((r) => r.id === accepted.id));
    const lesson = api("GET", `/api/instructor/lesson/${test.id}/${group.id}`, instructorToken);
    assert.equal(lesson.results.length, 1);
    assert.equal(lesson.results[0].id, accepted.id);
    assert.ok(lesson.cadets.every((user) => user.active && user.groupName === group.name));
    expectCode(() => api("GET", `/api/instructor/lesson/${test.id}/${group.id}`, secondCadetLogin.token), "FORBIDDEN");
  } finally { resultSheet.rows.splice(size); }
});

regression("Busy response returns quickly without altering results", () => {
  const original = lock.tryLock;
  const size = spreadsheet.getSheetByName("_Результати_дані").rows.length;
  let requestedWait;
  lock.tryLock = (milliseconds) => { requestedWait = milliseconds; return false; };
  try {
    const response = JSON.parse(context.doPost({postData: {contents: JSON.stringify({action: "api", method: "POST",
      path: "/api/results", token: secondCadetLogin.token, body: {testId: "busy"}})}}).text);
    assert.equal(response.code, "BUSY");
    assert.equal(requestedWait, 2000);
    assert.equal(spreadsheet.getSheetByName("_Результати_дані").rows.length, size);
  } finally { lock.tryLock = original; }
});

regression("Combined workspace is private and keeps tests and results together", () => {
  const workspace = api("GET", "/api/cadet/workspace", secondCadetLogin.token);
  assert.ok(workspace.results.every((r) => String(r.userId) === String(secondCadetLogin.user.id)));
  assert.ok(Array.isArray(workspace.tests));
  expectCode(() => api("GET", "/api/cadet/workspace", instructorToken), "FORBIDDEN");
});

regression("Direct exam submission requires a server-owned timed attempt", () => {
  const test = api("POST", "/api/instructor/tests", instructorToken, {title:"Захищений іспит",mode:"exam",durationMinutes:10,published:true,questions:[{text:"Питання",answers:[{text:"Так",isCorrect:true},{text:"Ні"}]}]}).test;
  expectCode(()=>api("POST","/api/results",secondCadetLogin.token,regressionBody(test,"exam-integrity")),"EXAM_SESSION_REQUIRED");
});

regression("Release announcement rejects unsafe URLs and stale stored versions", () => {
  assert.equal(api("GET", "/api/app-info").latestVersionCode, releaseCode);
  if(releaseCode>1)context.setAppDownloadUrl("https://example.invalid/legacy.exe", releaseCode-1, "0.0.0");
  else {const props=context.PropertiesService.getScriptProperties();props.setProperty('PC_DOWNLOAD_URL','https://example.invalid/legacy.exe');props.setProperty('PC_DOWNLOAD_VERSION_CODE','0');props.setProperty('PC_DOWNLOAD_VERSION_NAME','0.0.0');}
  const stale = api("GET", "/api/app-info");
  assert.equal(stale.latestVersionCode, releaseCode); assert.equal(stale.latestVersionName, releaseName); assert.equal(stale.downloadUrl, "");
  assert.throws(() => context.setAppDownloadUrl("http://unsafe.example/app.exe", 72, "3.3.1"));
  assert.equal(api("GET", "/api/app-info").latestVersionCode, releaseCode);
  context.setAppDownloadUrl("https://example.invalid/FPV-Komisiia-PC.exe", releaseCode + 1, "1.3.0");
  const info = api("GET", "/api/app-info");
  assert.equal(info.latestVersionCode, releaseCode + 1); assert.equal(info.latestVersionName, "1.3.0");
  assert.equal(info.downloadUrl, "https://example.invalid/FPV-Komisiia-PC.exe");
});

regression("Different tests for one cadet retain separate titled rows", () => {
  const firstTest = regressionTest("Аеродинаміка — колонка");
  const secondTest = regressionTest("Навігація — колонка");
  const firstBody = regressionBody(firstTest, "test-column-first");
  const first = api("POST", "/api/results", secondCadetLogin.token, firstBody).result;
  const sheet = publicSpreadsheet.getSheetByName("Результати курсантів");
  const firstRow = [...publicRows(sheet).find((row) => String(row[7]) === String(first.id))];
  const second = api("POST", "/api/results", secondCadetLogin.token,
    regressionBody(secondTest, "test-column-second")).result;
  assert.equal(publicRows(sheet).find((row) => String(row[7]) === String(first.id))[5], firstTest.title);
  assert.equal(publicRows(sheet).find((row) => String(row[7]) === String(second.id))[5], secondTest.title);
  assert.deepEqual(publicRows(sheet).find((row) => String(row[7]) === String(first.id)), firstRow);
  const rowCount = sheet.rows.length;
  api("POST", "/api/results", secondCadetLogin.token, firstBody);
  context.publishVisibleResult_(first);
  assert.equal(sheet.rows.length, rowCount);
  assert.equal(publicRows(sheet).filter((row) => String(row[7]) === String(first.id)).length, 1);
});

regression("Legacy layout migration preserves results, IDs and manual columns once", () => {
 const sheet=publicSpreadsheet.getSheetByName('Результати курсантів'),saved=sheet.rows.map(r=>[...r]),capacity=sheet.maxColumns,hidden=new Set(sheet.hiddenColumns);
 const ready='LK_PUBLIC_LAYOUT_READY_V4_'+publicSpreadsheet.id,backup='LK_PUBLIC_LAYOUT_BACKUP_V1_'+publicSpreadsheet.id;
 const oldReady=properties.getProperty(ready),oldBackup=properties.getProperty(backup),oldCopy=publicSpreadsheet.sheets.get('Резерв таблиці до Excel');
 try{
  sheet.rows=publicRows(sheet).map((r,i)=>r.slice(0,5).concat(r.slice(6,8),i===0?'Примітка інструктора':'Примітка '+i));sheet.maxColumns=8;sheet.hiddenColumns=new Set([6,7]);
  const before=sheet.rows.map(r=>[...r]);properties.deleteProperty(ready);properties.deleteProperty(backup);publicSpreadsheet.sheets.delete('Резерв таблиці до Excel');context.publicLayouts_=[];
  context.ensurePublicResultsSheet_(publicSpreadsheet);
  const headers=sheet.rows[0],canonical=publicRows(sheet);assert.equal(headers[1],'Група');assert.equal(headers[2],'Тест');assert.equal(sheet.maxColumns,16);
  assert.ok(sheet.hiddenColumns.has(headers.indexOf('_ID курсанта')+1));assert.ok(sheet.hiddenColumns.has(headers.indexOf('_ID результату')+1));
  before.slice(1).forEach((r,i)=>{assert.deepEqual(canonical[i+1].slice(0,5),r.slice(0,5));assert.deepEqual(canonical[i+1].slice(6,8),r.slice(5,7));assert.equal(sheet.rows[i+1][headers.indexOf('Примітка інструктора')],r[7]);});
  assert.ok(publicSpreadsheet.getSheetByName('Резерв таблиці до Excel'));
  const migrated=sheet.rows.map(r=>[...r]);context.ensurePublicResultsSheet_(publicSpreadsheet);assert.deepEqual(sheet.rows,migrated);assert.equal(sheet.maxColumns,16);
 }finally{sheet.rows=saved;sheet.maxColumns=capacity;sheet.hiddenColumns=hidden;context.publicLayouts_=[];oldReady?properties.setProperty(ready,oldReady):properties.deleteProperty(ready);oldBackup?properties.setProperty(backup,oldBackup):properties.deleteProperty(backup);if(oldCopy)publicSpreadsheet.sheets.set('Резерв таблиці до Excel',oldCopy);else publicSpreadsheet.sheets.delete('Резерв таблиці до Excel');}
});

regression("Filling missing titles repairs managed fields and stays idempotent", () => {
 const sheet=publicSpreadsheet.getSheetByName('Результати курсантів'),saved=sheet.rows.map(r=>[...r]);
 try{
  const title=sheet.rows[0].indexOf('Тест'),correct=sheet.rows[0].indexOf('Правильних');sheet.rows.slice(1).forEach(r=>r[title]='');const index=publicRows(sheet).findIndex((r,i)=>i>0&&r[7]);sheet.rows[index][correct]=77;
  const before=publicRows(sheet),count=sheet.rows.length;assert.match(context.updateResultsTestColumn(),/Колонку «Тест» додано/);
  const results=new Map(context.listResults_(null).map(r=>[String(r.id),r]));publicRows(sheet).slice(1).forEach((row,i)=>{const r=results.get(String(row[7]));if(r){assert.equal(row[5],context.safeCellText_(r.testTitle));assert.deepEqual(row.slice(0,5),Array.from(context.publicResultValues_(r)).slice(0,5));}else{assert.equal(row[5],'');assert.deepEqual(row.slice(0,5),before[i+1].slice(0,5));}});
  assert.equal(sheet.rows.length,count);const filled=sheet.rows.map(r=>[...r]);context.updateResultsTestColumn();assert.deepEqual(sheet.rows,filled);
 }finally{sheet.rows=saved;context.publicLayouts_=[];}
});

regression("A historical five-column result is adopted without a duplicate", () => {
 const sheet=publicSpreadsheet.getSheetByName('Результати курсантів'),saved=sheet.rows.map(r=>[...r]);
 try{
  const index=publicRows(sheet).findIndex(r=>String(r[7])===String(result.id)),row=publicRows(sheet)[index];context.writePublicRows_(sheet,index+1,[row.slice(0,5)]);
  const count=sheet.rows.length;context.repairPublicResults_();assert.equal(sheet.rows.length,count);const restored=publicRows(sheet)[index];assert.equal(restored[5],'Контрольний тест');assert.equal(String(restored[6]),String(result.userId));assert.equal(String(restored[7]),String(result.id));
 }finally{sheet.rows=saved;context.publicLayouts_=[];}
});

// Complete deletion must cascade by IDs, including accounts in other groups.
const deletionGroupA = api('POST','/api/instructor/groups',instructorToken,{name:'Видалення — група А'}).group;
const deletionGroupB = api('POST','/api/instructor/groups',instructorToken,{name:'Видалення — група Б'}).group;
let deletionCounter=0;
function deletionCadet(group=deletionGroupA, name='Однакове ПІБ курсантів') {
  return api('POST','/api/register','',{fullName:name,username:'delete_case_'+(++deletionCounter),groupId:group.id,...credential('delete-test-password')});
}
function deleteAccount(cadet, actorToken=instructorToken, confirmUserId=String(cadet.user.id)) {
  return api('DELETE','/api/instructor/users/'+cadet.user.id,actorToken,{confirmUserId});
}

regression('Deletion requires instructor role and matching explicit confirmation',()=>{
  const cadet=deletionCadet();
  expectCode(()=>deleteAccount(cadet,cadet.token),'FORBIDDEN');
  expectCode(()=>deleteAccount(cadet,instructorToken,'another-id'),'CONFIRMATION_REQUIRED');
  expectCode(()=>api('DELETE','/api/instructor/users/'+cadet.user.id,instructorToken),'CONFIRMATION_REQUIRED');
  expectCode(()=>api('DELETE','/api/instructor/users/'+instructorRegistration.user.id,instructorToken,{confirmUserId:String(instructorRegistration.user.id)}),'FORBIDDEN');
  assert.ok(context.findUserById_(cadet.user.id)?.active);
  assert.equal(context.requiresWriteLock_({action:'api',method:'DELETE',path:'/api/instructor/users/'+cadet.user.id}),true);
});

regression('Full deletion clears both groups without touching same-name cadets or shared tests',()=>{
  const a=deletionCadet(),b=deletionCadet(deletionGroupB),keep=deletionCadet();
  const test=regressionTest('Спільний тест для видалення');
  const aResult=api('POST','/api/results',a.token,regressionBody(test,'delete-result-a')).result;
  const bResult=api('POST','/api/results',b.token,regressionBody(test,'delete-result-b')).result;
  const keepResult=api('POST','/api/results',keep.token,regressionBody(test,'delete-keep')).result;
  const retry=seedLegacyRetry(test,a.user.id,aResult.id);
  // A corrupt legacy retry link must not cause a shared test to be deleted.
  spreadsheet.getSheetByName('_Повторні_спроби').appendRow([aResult.id,a.user.id,test.id,test.id,new Date(),true]);
  spreadsheet.getSheetByName('_Результати').appendRow(['legacy-a','old-device','1',String(aResult.id),a.user.id,a.user.fullName,a.user.groupName,test.id,test.title,100,1,1,true,17,new Date(),new Date()]);
  api('POST','/api/instructor/users/'+a.user.id+'/status',instructorToken,{active:false});
  for (const cadet of [a,b]) {
    const reply=deleteAccount(cadet);assert.equal(reply.deleted,true);assert.equal(reply.userId,String(cadet.user.id));
    assert.equal(context.findUserById_(cadet.user.id),null);
    expectCode(()=>api('GET','/api/cadet/workspace',cadet.token),'SESSION_EXPIRED');
    const refs=[['_Результати_дані',1],['_Результати',4],['_Деталі_відповідей',1],['_Повторні_спроби',1]];
    for(const [name,column] of refs)assert.equal(spreadsheet.getSheetByName(name).rows.slice(1).some(r=>String(r[column])===String(cadet.user.id)),false,name);
    assert.equal(publicRows(publicSpreadsheet.getSheetByName('Результати курсантів')).slice(1).some(r=>String(r[6])===String(cadet.user.id)),false);
    const audit=spreadsheet.getSheetByName('_Журнал_дій').rows.slice(1).filter(r=>String(r[4])==='cadet'&&String(r[5])===String(cadet.user.id));
    assert.equal(audit.length,1);assert.equal(audit[0][3],'CADET_DELETE');assert.equal(audit[0][6],'');
  }
  assert.ok(context.getTestById_(test.id));assert.equal(context.getTestById_(retry.id),null);
  assert.ok(context.findUserById_(keep.user.id));assert.equal(api('GET','/api/my-results',keep.token).results.some(r=>String(r.id)===String(keepResult.id)),true);
  assert.equal(spreadsheet.getSheetByName('_Синхронізація').rows.some(r=>['result:'+aResult.id,'result:'+bResult.id].includes(String(r[1]))||['delete-result-a','delete-result-b','legacy-a'].includes(String(r[0]))),false);
  assert.equal(context.listGroups_().some(g=>String(g.id)===String(deletionGroupA.id)),true);
});

regression('Deletion is idempotent after a lost acknowledgement and permits a fresh account with a new ID',()=>{
 const cadet=deletionCadet();deleteAccount(cadet);assert.equal(deleteAccount(cadet).alreadyDeleted,true);
 const fresh=api('POST','/api/register','',{fullName:cadet.user.fullName,username:cadet.user.username,groupId:deletionGroupA.id,...credential('new-account-password')});
 assert.notEqual(String(fresh.user.id),String(cadet.user.id));
 expectCode(()=>api('GET','/api/cadet/workspace',cadet.token),'SESSION_EXPIRED');
});

regression('Configured public spreadsheet access failure prevents any deletion',()=>{
 const cadet=deletionCadet(),before=JSON.stringify([...spreadsheet.sheets].map(([n,s])=>[n,s.rows]));
 const open=context.SpreadsheetApp.openById;
 context.SpreadsheetApp.openById=id=>{if(String(id)===publicSpreadsheet.id)throw Error('Access denied');return open(id);};
 try{assert.throws(()=>deleteAccount(cadet),/Access denied/);assert.equal(JSON.stringify([...spreadsheet.sheets].map(([n,s])=>[n,s.rows])),before);assert.ok(context.findUserById_(cadet.user.id)?.active);}
 finally{context.SpreadsheetApp.openById=open;}
});

regression('Unidentified public rows stop safely before deleting another same-name person',()=>{
 const cadet=deletionCadet(),sheet=publicSpreadsheet.getSheetByName('Результати курсантів');
 const saved=sheet.rows[0].slice();sheet.rows[0][sheet.rows[0].indexOf('_ID курсанта')]='Без ID';context.publicLayouts_=[];
 try{expectCode(()=>deleteAccount(cadet),'PUBLIC_RESULTS_SCHEMA');assert.ok(context.findUserById_(cadet.user.id)?.active);}
 finally{sheet.rows[0]=saved;context.publicLayouts_=[];}
});

regression('Old five-column migration source is cleaned only with unambiguous complete result identity',()=>{
 const cadet=deletionCadet(deletionGroupA,'Старий запис для видалення'),test=regressionTest('Старе джерело результатів');
 const result=api('POST','/api/results',cadet.token,regressionBody(test,'legacy-visible-delete')).result;
 const legacy=spreadsheet.insertSheet('Результати курсантів');legacy.maxColumns=5;legacy.rows=[['ПІБ курсанта','Правильних','Неправильних','Час проходження','Правильних, %'],Array.from(context.publicResultValues_(result)).slice(0,5)];
 try{assert.equal(deleteAccount(cadet).deleted,true);assert.equal(legacy.getLastRow(),1);}
 finally{spreadsheet.sheets.delete('Результати курсантів');}
});

regression('Ambiguous same-name historical rows are never erased by name',()=>{
 const a=deletionCadet(deletionGroupA,'Тезка старої таблиці'),b=deletionCadet(deletionGroupB,'Тезка старої таблиці'),test=regressionTest('Ідентичні результати');
 const result=api('POST','/api/results',a.token,regressionBody(test,'ambiguous-a')).result;
 api('POST','/api/results',b.token,regressionBody(test,'ambiguous-b'));
 const legacy=spreadsheet.insertSheet('Результати курсантів');legacy.maxColumns=5;legacy.rows=[['ПІБ курсанта','Правильних','Неправильних','Час проходження','Правильних, %'],Array.from(context.publicResultValues_(result)).slice(0,5)];
 try{expectCode(()=>deleteAccount(a),'PUBLIC_RESULTS_ID_REQUIRED');assert.equal(legacy.getLastRow(),2);assert.ok(context.findUserById_(a.user.id).active);assert.ok(context.findUserById_(b.user.id).active);}
 finally{spreadsheet.sheets.delete('Результати курсантів');}
});

regression('Interrupted deletion blocks access and reactivation, then safely resumes',()=>{
 const cadet=deletionCadet(),test=regressionTest('Перерване видалення');
 api('POST','/api/results',cadet.token,regressionBody(test,'interrupted-delete'));
 const details=spreadsheet.getSheetByName('_Деталі_відповідей'),remove=details.deleteRows;
 details.deleteRows=()=>{throw Error('Temporary write failure');};
 try{expectCode(()=>deleteAccount(cadet),'DELETION_INCOMPLETE');assert.equal(context.findUserById_(cadet.user.id).active,false);expectCode(()=>api('GET','/api/my-results',cadet.token),'SESSION_EXPIRED');expectCode(()=>api('POST','/api/instructor/users/'+cadet.user.id+'/status',instructorToken,{active:true}),'DELETION_PENDING');expectCode(()=>api('POST','/api/instructor/users/'+cadet.user.id+'/password',instructorToken,credential('changed-pass')),'DELETION_PENDING');}
 finally{details.deleteRows=remove;}
 assert.equal(deleteAccount(cadet).deleted,true);assert.equal(context.findUserById_(cadet.user.id),null);
 assert.equal(context.listResults_(cadet.user.id).length,0);assert.equal(context.cadetDeletionPending_(cadet.user.id),false);
});

if (failures.length) {
  console.error(failures.join("\n"));
  assert.fail(`${failures.length}/${regressionCount} regression checks failed`);
}
console.log(`Server regression checks passed: ${regressionCount}/${regressionCount}.`);

export {context, api, credential, spreadsheet, lock, instructorToken, regressionTest, regressionBody, seedLegacyRetry, publicRows};
