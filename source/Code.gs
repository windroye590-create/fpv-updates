/**
 * FPV Комісія — безкоштовний хмарний сервер Google Apps Script.
 * API v25. Окреме видалення результату зі збереженням обмеження спроб.
 *
 * Для першого налаштування комісії запустіть setupCommission() один раз.
 * Для оновлення чинної комісії достатньо зберегти код і створити нову
 * версію того самого веб-додатка. Повторне налаштування не потрібне.
 */

const SPREADSHEET_ID = '1681BlupvfIfWmQKy1BiGK8SOFpd7guAtaH20nn_5g64';
// Only the owner receives the random first-registration code. Its hash may be public.
const OWNER_SETUP_INVITE_HASH = '00750c25cc5a6a48428e671917bee2604a2ab43e6bde2a4d017c8d13ed6eb2c1';
const OWNER_SETUP_INVITE_UNTIL = 1794337368008;
const OWNER_SETUP_LOGIN = 'WindRoy';
const API_VERSION = 26;
const PUBLIC_SYNC_COLUMN = 27;
const RESULT_DELETING = 'deleting';
const PUBLIC_SYNC_CACHE = 'LK_PUBLIC_SYNC_SUMMARY_V1';
const PUBLIC_SYNC_RETRY = 'LK_PUBLIC_SYNC_RETRY_V1';
const PUBLIC_SYNC_DELAY_MS = 30000;
const REVIEW_LEASE_MS = 120000;
const REVIEW_LEASE_PREFIX = 'LK_REVIEW_SESSION_V1_';
const LATEST_APP_VERSION_CODE = 1;
const LATEST_APP_VERSION_NAME = '1.0.0';
const APP_DOWNLOAD_URL_PROPERTY = 'PC_DOWNLOAD_URL';
const ROLE_INSTRUCTOR = 'instructor';
const ROLE_CADET = 'cadet';
const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_LIFETIME_SECONDS = 5 * 60;
const MAX_TEST_JSON_LENGTH = 48000;
const TEST_PART_LENGTH = 45000;
const MAX_TEST_PARTS = 64;
const TEST_PARTS_PREFIX = '[[LK-TEST-PARTS:1]]';
const MAX_PC_STATE_JSON_LENGTH = 2800000;
const MAX_API_REQUEST_JSON_LENGTH = MAX_PC_STATE_JSON_LENGTH + 16384;
const MAX_PC_STATE_PARTS = 64;
const DASHBOARD_RESULT_LIMIT = 500;
const PUBLIC_RESULTS_TITLE = 'FPV Комісія — Результати курсантів';
const PUBLIC_RESULTS_SHEET = 'Результати курсантів';
const PUBLIC_RESULTS_PROPERTY = 'PUBLIC_RESULTS_SPREADSHEET_ID';

const SHEETS = Object.freeze({
  users: '_Користувачі',
  groups: '_Групи',
  tests: '_Тести',
  testParts: '_Частини_тестів',
  testAccess: '_Доступ_до_тестів',
  intakeJobs: '_Підготовка_набору',
  results: '_Результати_дані',
  deletedResults: '_Видалені_результати',
  sync: '_Синхронізація',
  legacyResults: '_Результати',
  retries: '_Повторні_спроби',
  questionBank: '_Банк_питань',
  resultDetails: '_Деталі_відповідей',
  audit: '_Журнал_дій',
  materials: '_Навчальні_матеріали',
  materialFiles: '_Файли_матеріалів',
  materialChunks: '_Частини_матеріалів',
  materialProgress: '_Перегляди_матеріалів',
  cadetNotes: '_Примітки_курсантів',
  pcState: '_Чернетки_ПК',
  examRecoveries: '_Відновлення_іспитів'
});

const HEADERS = Object.freeze({
  testAccess: ['ID тесту', 'Ревізія', 'Правила JSON', 'Оновлено', 'ID інструктора'],
  intakeJobs: ['ID операції', 'Тип', 'ID курсанта', 'Дані JSON', 'Оновлено'],
  testParts: ['ID тесту', 'Покоління', 'Частина', 'Частин', 'Дані JSON'],
  examRecoveries: ['ID','ID курсанта','ID тесту','Ключ відправлення','SHA256','ПІБ','Група','Назва тесту','Відповіді JSON','Час, с','Перерви','Отримано','Стан','ID результату','Підтвердив','Підтверджено'],
  pcState: ['ID користувача','Ключ','Ревізія','Покоління','Частина','Частин','Оновлено','ID запиту','SHA256','Дані'],
  materials: ['ID','Назва','Опис','Тема','Групи JSON','ID тесту','ID файлу','Ревізія','Розмір','SHA256','Сторінок','Створив','Створено','Оновлено','Активний'],
  materialFiles: ['ID','ID інструктора','ID матеріалу','Створено','Розмір','SHA256','Частин','Стан','Перший рядок'],
  materialChunks: ['ID файлу','Частина','Base64'],
  materialProgress: ['ID матеріалу','Ревізія','ID курсанта','Сторінка','Найбільша сторінка','Сторінок','Відкрито','Оновлено'],
  cadetNotes: ['ID курсанта','ID запиту','ID інструктора','Примітка JSON','Створено'],
  users: ['ID', 'Логін', 'ПІБ', 'Група', 'Роль', 'Хеш пароля', 'Сіль пароля', 'Активний', 'Створено', 'Публікація таблиці'],
  groups: ['ID', 'Назва', 'Створив', 'Створено', 'Архівна', 'Ревізія'],
  tests: ['ID', 'Назва', 'Опис', 'Режим', 'Тривалість, хв', 'Прохідний бал, %', 'Опубліковано', 'Питання JSON', 'Створено', 'Кількість питань', 'Ключ створення JSON'],
  // Назву «ПІБ» збережено для сумісності з уже розгорнутою версією 3.
  results: ['ID', 'ID курсанта', 'ПІБ', 'Група', 'ID тесту', 'Назва тесту', 'Оцінка, %', 'Правильних', 'Усього', 'Час, с', 'Завершено', 'Складено', 'Ключ відправлення', 'Відповіді JSON', 'Перерви іспиту', 'Екран закріплено', 'Стан перевірки', 'Набрано балів', 'Максимум балів', 'Питань з вибором', 'Письмових без оцінки', 'Ревізія перевірки', 'Перевірка JSON', 'Відновлено інструктором', 'Підтвердив', 'Підтверджено', 'Публікація таблиці'],
  sync: ['Унікальний ключ', 'Тип', 'Отримано'],
  deletedResults: ['ID результату', 'ID курсанта', 'ID тесту'],
  legacyResults: ['Ключ результату', 'ID джерела', 'Версія застосунку', 'ID результату', 'ID курсанта', 'ПІБ курсанта', 'Навчальна група', 'ID тесту', 'Назва тесту', 'Оцінка, %', 'Правильних', 'Усього', 'Статус', 'Час, с', 'Дата й час завершення', 'Отримано таблицею'],
  retries: ['ID результату', 'ID курсанта', 'ID початкового тесту', 'ID тесту повтору', 'Створено', 'Активний'],
  questionBank: ['ID', 'Категорія', 'Складність', 'Питання JSON', 'ID автора', 'Автор', 'Створено', 'Активне'],
  resultDetails: ['ID результату', 'ID курсанта', 'ID тесту', 'Назва тесту', 'ID питання', 'Текст питання', 'Правильно', 'Завершено'],
  audit: ['ID', 'ID інструктора', 'Інструктор', 'Дія', 'Тип об’єкта', 'ID об’єкта', 'Назва об’єкта', 'Деталі', 'Створено']
});

const PUBLIC_RESULTS_CANONICAL_HEADERS = Object.freeze([
  'ПІБ курсанта', 'Правильних', 'Неправильних', 'Час проходження', 'Правильних, %',
  'Тест', '_ID курсанта', '_ID результату', 'Стан перевірки', 'Набрано балів', 'Максимум балів', 'Підсумковий бал, %',
  'Група', 'Дата завершення', 'Результат'
]);
const PUBLIC_RESULTS_HEADERS = Object.freeze([
  'ПІБ курсанта', 'Група', 'Тест', 'Дата завершення', 'Результат', 'Підсумковий бал, %',
  'Набрано балів', 'Максимум балів', 'Час проходження', 'Правильних', 'Неправильних', 'Правильних, %',
  'Стан перевірки', '_ID курсанта', '_ID результату'
]);

const GROUP_PREFIX = '[[LK-GROUPS:';
const RETRY_PREFIX = '[[LK-RETRY:';
const ARCHIVE_MARKER = '[[LK-ARCHIVED]]';
const MARKER_SUFFIX = ']]';

var workspaceMutation_ = null;
var workspaceWriteRequest_ = false;
var spreadsheetCache_ = null;
var publicResultsSpreadsheetCache_ = null;
var publicResultsSheetCache_ = null;
var publicLayouts_ = [];
var testAccessCache_ = null;
var testAccessGroupsCache_ = null;
var publicSyncActor_ = null;
var publicSyncScan_ = null;
var publicSyncCacheBypass_ = false;

function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'FPV Комісія',
    version: API_VERSION,
    serverBuild: 'pc-api26-acac48e64011cc1f',
    resultDeletion: true,
    singleAttempt: true,
    privateLocalStorage: true,
    trainingResume: true,
    publicTableSync: true,
    testAccess: true,
    newIntake: true,
    reviewPresence: true,
    chunkedTests: true,
    examRecovery: true,
    testDeletion: true,
    pcAccountSync: true,
    multipleChoice: true,
    examResume: true,
    writtenTests: true,
    listPerformance: true,
    conditionalWorkspace: true,
    groupArchive: true,bulkAssignment: true,filteredAnalytics: true,
    materials: true,
    cadetDeletion: true,
    cadetTransfer: true,
    cadetCard: true,
    formattedReports: true,
    formattedResultsReady: publicReportLayoutReady_(),
    intakeArchives: true,
    recentResultsRead: true,
    status: 'online',
    price: 'Безкоштовно'
  });
}

function appInfo_() {
  var properties = PropertiesService.getScriptProperties();
  var downloadUrl = String(properties.getProperty(APP_DOWNLOAD_URL_PROPERTY) || '');
  var versionCode = Number(properties.getProperty('PC_DOWNLOAD_VERSION_CODE') || LATEST_APP_VERSION_CODE);
  var versionName = String(properties.getProperty('PC_DOWNLOAD_VERSION_NAME') || LATEST_APP_VERSION_NAME);
  var current = Number.isInteger(versionCode) && versionCode >= LATEST_APP_VERSION_CODE
    && /^\d+\.\d+\.\d+$/.test(versionName)
    && (versionCode !== LATEST_APP_VERSION_CODE || versionName === LATEST_APP_VERSION_NAME)
    && (!downloadUrl || /^https:\/\/[^\s?#]+\.exe(?:\?[^#\s]*)?$/i.test(downloadUrl));
  return {
    platform: 'windows-x64',
    latestVersionCode: current ? versionCode : LATEST_APP_VERSION_CODE,
    latestVersionName: current ? versionName : LATEST_APP_VERSION_NAME,
    downloadUrl: current ? downloadUrl : '',
    message: 'Доступна нова версія «FPV Комісії».'
  };
}

/** Необов’язково: запустіть вручну після розміщення нового EXE для Windows. */
function setAppDownloadUrl(url, versionCode, versionName) {
  var value = cleanText_(url, 1000);
  if (value && !/^https:\/\/[^\s?#]+\.exe(?:\?[^#\s]*)?$/i.test(value)) {
    throw new Error('Потрібне HTTPS-посилання на файл EXE для Windows');
  }
  var properties = PropertiesService.getScriptProperties();
  if (versionCode != null || versionName != null) {
    if (!Number.isInteger(Number(versionCode)) || Number(versionCode) < 1 || !/^\d+\.\d+\.\d+$/.test(String(versionName || ''))) {
      throw new Error('Вкажіть код і назву версії для Windows.');
    }
    properties.setProperty('PC_DOWNLOAD_VERSION_CODE', String(versionCode));
    properties.setProperty('PC_DOWNLOAD_VERSION_NAME', String(versionName));
  }
  properties.setProperty(APP_DOWNLOAD_URL_PROPERTY, value);
  return value ? 'Посилання на оновлення збережено.' : 'Посилання на оновлення очищено.';
}

function doPost(e) {
  workspaceMutation_ = null; workspaceWriteRequest_ = false;
  publicSyncActor_ = null; publicSyncScan_ = null; publicSyncCacheBypass_ = false; publicLayouts_ = [];
  testAccessCache_ = null;
  testAccessGroupsCache_ = null;
  var lock = null;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    // Leave room for the envelope around a supported 2.8M-character document.
    if (raw.length > MAX_API_REQUEST_JSON_LENGTH) fail_('Запит перевищує дозволений розмір.', 'PAYLOAD_TOO_LARGE');
    var request = JSON.parse(raw);
    var mutation = requiresWriteLock_(request);
    if (mutation) {
      lock = LockService.getScriptLock();
      // Return quickly instead of occupying all Apps Script execution slots.
      // PCs retain the same submission key and retry with exponential jitter.
      if (!lock.tryLock(2000)) fail_('Сервер зайнятий. Результат буде надіслано повторно.', 'BUSY');
    }
    workspaceWriteRequest_ = Boolean(lock);
    if(request&&request.action==='api'&&request.method==='GET'&&request.path==='/api/groups'&&request.body&&request.body.initializeReports===true)PropertiesService.getScriptProperties().setProperty('LK_EXCEL_LAYOUT_ARMED_V1','1');
    ensureSchema_(Boolean(lock));
    recoverWorkspaceChange_(Boolean(lock));
    if(request&&request.action==='local-storage-authorize'){
      var localOwner=requireSession_(request.token);
      if(String(request.userId)!==String(localOwner.id)||typeof request.nonce!=='string'||!/^[a-f0-9]{64}$/.test(request.nonce))fail_('Локальна копія належить іншому обліковому запису.','FORBIDDEN');
      return jsonResponse_({ok:true,localStorageAuthorization:request.nonce});
    }
    if (!request || request.action !== 'api') {
      fail_('Ця версія сервера приймає лише захищені API-запити.', 'UNSUPPORTED_CLIENT');
    }
    var response = routeApi_(request);
    if (publicSyncActor_) {
      // A bounded worker runs only after authentication and a successful API
      // operation. It uses the same script lock as result/grade mutations.
      try {
        drainPublicResults_(Boolean(lock), 2);
        response.publicTableSync = publicSyncStatus_(publicSyncActor_);
      } catch (syncError) {
        response.publicTableSync = {protocol:1,state:'pending',pendingCount:1,retryAfterSeconds:30};
        console.warn('Стан синхронізації таблиці: '+String(syncError.message||syncError));
      }
    }
    if(String(request.method).toUpperCase()==='GET' && request.writtenProtocol!==1)response=legacyChoiceResponse_(response);
    if(request.choiceProtocol!==2)response=legacyMultiChoiceResponse_(response);
    response.ok = true;
    return jsonResponse_(response);
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message ? error.message : error || 'Невідома помилка сервера'),
      code: String(error && error.code ? error.code : 'SERVER_ERROR'),
      retryAfterSeconds: Number(error && error.retryAfterSeconds) || 0
    });
  } finally {
    if (lock) {
      try { finishWorkspaceChange_(); } catch (error) { console.warn('Не завершено ревізії кабінету: '+String(error.message||error)); }
      // A fresh scan made while holding this write lock is still valid for
      // the revision just committed. Keep dashboard reads bounded to 500 rows.
      if(publicSyncScan_&&publicSyncScan_.entries!==null)try{cachePublicSyncSummary_(publicSyncScan_.summary);}catch(ignored){}
      workspaceWriteRequest_ = false;
      try { lock.releaseLock(); } catch (ignored) {}
    }
  }
}


/** A separate gate controls starting, without hiding the catalog or deleting tests. */
function testAccessIndex_() {
  if(testAccessCache_)return testAccessCache_;
  var index=Object.create(null);
  dataRows_('testAccess').forEach(function(row,i){
    if(!row[0])return;
    var id=String(row[0]),policy;
    try{policy=JSON.parse(String(row[2]));}catch(error){fail_('Пошкоджено правила доступу до тесту. Зверніться до інструктора.','ACCESS_STATE_ERROR');}
    if(index[id]||!Number.isSafeInteger(Number(row[1]))||Number(row[1])<1||!policy||typeof policy.defaultOpen!=='boolean'
      ||!policy.groups||typeof policy.groups!=='object'||Array.isArray(policy.groups)
      ||Object.keys(policy.groups).some(function(key){return !/^[A-Za-z0-9_-]{1,80}$/.test(key)||typeof policy.groups[key]!=='boolean';})) {
      fail_('Пошкоджено правила доступу до тесту. Зверніться до інструктора.','ACCESS_STATE_ERROR');
    }
    index[id]={revision:Number(row[1]),defaultOpen:policy.defaultOpen,groups:policy.groups,rowNumber:i+2};
  });
  testAccessCache_=index;return index;
}
function testAccessPolicy_(id) {
  return testAccessIndex_()[String(id)]||{revision:0,defaultOpen:true,groups:{}};
}
function writeTestAccess_(id,policy,actor,revision) {
  var previous=testAccessPolicy_(id),row=[String(id),revision+1,JSON.stringify(policy),new Date(),String(actor.id)];
  if(row[2].length>45000)fail_('Забагато окремих правил для груп. Встановіть спільний доступ.','BAD_REQUEST');
  if(previous.rowNumber)sheet_('testAccess').getRange(previous.rowNumber,1,1,row.length).setValues([row]);
  else sheet_('testAccess').appendRow(row);
  testAccessCache_=null;return testAccessPolicy_(id);
}
function testOpenFor_(test,user) {
  var policy=testAccessPolicy_(test.id);if(!testAccessGroupsCache_)testAccessGroupsCache_=listGroups_();
  var group=testAccessGroupsCache_.filter(function(g){return normalize_(g.name)===normalize_(user.groupName);})[0];
  if(group&&group.archived)return false;
  return group&&Object.prototype.hasOwnProperty.call(policy.groups,String(group.id))?policy.groups[String(group.id)]:policy.defaultOpen;
}
function attachTestAccess_(test,user) {
  var policy=testAccessPolicy_(test.id);
  test.access={protocol:1,revision:policy.revision};
  if(user.role===ROLE_INSTRUCTOR){test.access.defaultOpen=policy.defaultOpen;test.access.groups=copyObject_(policy.groups);}
  else test.access.open=testOpenFor_(test,user);
  return test;
}
function requireTestOpen_(test,user) {
  if(!testOpenFor_(test,user))fail_('Тест закрито. Дочекайтеся відкриття інструктором.','TEST_CLOSED');
}
function instructorTestAccess_(id) {
  var test=listTests_(false).filter(function(t){return String(t.id)===String(id)&&!isArchivedTest_(t);})[0];
  if(!test)fail_('Тест не знайдено.','TEST_NOT_FOUND');
  return {test:attachTestAccess_(test,{role:ROLE_INSTRUCTOR}),groups:listGroups_()};
}
function changeTestAccess_(actor,id,body) {
  var response=instructorTestAccess_(id),test=response.test,previous=testAccessPolicy_(id);
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision!==previous.revision)fail_('Інший інструктор уже змінив доступ. Оновіть налаштування тесту.','REVISION_CONFLICT');
  if(typeof body.open!=='boolean'||!['all','group'].includes(body.scope))fail_('Оберіть дію та область доступу.','BAD_REQUEST');
  if(body.open&&!test.published)fail_('Спочатку опублікуйте тест.','BAD_TEST');
  var policy={defaultOpen:previous.defaultOpen,groups:copyObject_(previous.groups)};
  if(body.scope==='all'){policy.defaultOpen=body.open;policy.groups={};}
  else{
    var group=response.groups.filter(function(g){return String(g.id)===String(body.groupId);})[0];
    if(!group||(body.open&&group.archived))fail_('Оберіть активну навчальну групу.','GROUP_NOT_FOUND');
    var assigned=assignedGroups_(test.description);
    if(assigned===null||(assigned.length&&!assigned.some(function(name){return normalize_(name)===normalize_(group.name);})))fail_('Тест не призначено цій групі. Спочатку змініть призначення.','BAD_GROUP_ASSIGNMENT');
    if(body.open===policy.defaultOpen)delete policy.groups[String(group.id)];else policy.groups[String(group.id)]=body.open;
  }
  writeTestAccess_(id,policy,actor,previous.revision);
  logAudit_(actor,'TEST_ACCESS','test',id,test.title,(body.open?'Відкрито':'Закрито')+' для '+(body.scope==='all'?'всіх призначених груп.':'групи #'+String(body.groupId)+'.'));
  return instructorTestAccess_(id);
}
function signedDocument_(value){var encoded=base64UrlText_(JSON.stringify(value));return encoded+'.'+signText_(encoded);}
function readSignedDocument_(token,code) {
  try{if(typeof token!=='string'||token.length>2000)throw Error('length');var parts=token.split('.');if(parts.length!==2||!secureEquals_(signText_(parts[0]),parts[1]))throw Error('signature');return JSON.parse(base64UrlToText_(parts[0]));}
  catch(error){fail_('Дозвіл не підтверджено сервером. Оновіть дані та повторіть дію.',code);}
}
function startTraining_(user,id,body,choiceProtocol) {
  requireRole_(user,ROLE_CADET);
  if(typeof body.submissionId!=='string'||!/^pc-[A-Za-z0-9_-]{16,100}$/.test(body.submissionId))fail_('Некоректний ключ спроби.','BAD_REQUEST');
  var resume=Object.prototype.hasOwnProperty.call(body,'startPermit'),test;
  if(resume){
    if(body.resumeProtocol!==1)fail_('Оновіть застосунок для продовження збереженого тренування.','UPDATE_REQUIRED');
    test=getTestById_(id);
    if(!test||isArchivedTest_(test)||!test.published||!visibleTestForUser_(test,user))fail_('Тренування більше недоступне.','TEST_NOT_FOUND');
    verifyTrainingPermit_(user,test,body.submissionId,body.startPermit);
    requireChoiceProtocol_(test,choiceProtocol);
    test=sanitizeTestForCadet_(attachTestAccess_(test,user));
  }else test=getTestForUser_(id,user,1,choiceProtocol);
  requireSingleAttemptTest_(test);
  if(test.mode!=='training')fail_('Іспит потрібно починати через збережену серверну спробу.','EXAM_SESSION_REQUIRED');
  if(findResultRecord_(user.id,id)||hasDeletedAttempt_(user.id,id))fail_('Цей тест уже пройдено.','ALREADY_COMPLETED');
  if(resume)return {test:test,submissionId:body.submissionId,startPermit:body.startPermit,trainingResumeProtocol:1};
  var permit=signedDocument_({kind:'training-start',v:1,userId:String(user.id),testId:String(id),submissionId:body.submissionId,startedAt:Date.now()});
  return {test:test,submissionId:body.submissionId,startPermit:permit};
}
function verifyTrainingPermit_(user,test,submissionId,permit) {
  var value=readSignedDocument_(permit,'INVALID_START_PERMIT');
  if(!value||value.kind!=='training-start'||value.v!==1||value.userId!==String(user.id)||value.testId!==String(test.id)
    ||value.submissionId!==String(submissionId)||!Number.isSafeInteger(value.startedAt)||value.startedAt>Date.now()+5000)fail_('Дозвіл належить іншій спробі. Почніть тест після відкриття інструктором.','INVALID_START_PERMIT');
  return value;
}

/** Whole-cohort cleanup is explicitly confirmed, serialized and resumable. */
const INTAKE_PHASES = ['close','public','legacyPublic','sync','legacyResults','materialProgress','pcState','examRecoveries','resultDetails','retries','privateTests','testParts','audit','results','users','finish'];
function intakeJob_(id) {
  if(!id)return null;
  var rows=dataRows_('intakeJobs'),header=null,targets=[];
  rows.forEach(function(row,i){if(String(row[0])!==String(id))return;if(row[1]==='job'){if(header)fail_('Пошкоджено запис підготовки набору.','INTAKE_STATE_ERROR');header={rowNumber:i+2,row:row};}else if(row[1]==='cadet')targets.push(String(row[2]));});
  if(!header)fail_('Не знайдено запис підготовки набору.','INTAKE_STATE_ERROR');
  var value;try{value=JSON.parse(String(header.row[3]));}catch(error){fail_('Пошкоджено запис підготовки набору.','INTAKE_STATE_ERROR');}
  if(!value||value.id!==String(id)||!Number.isInteger(value.phase)||value.phase<0||value.phase>INTAKE_PHASES.length||value.cadets!==targets.length)fail_('Пошкоджено запис підготовки набору.','INTAKE_STATE_ERROR');
  return {value:value,rowNumber:header.rowNumber,targets:targets};
}
function intakePublic_(job) {
  var v=job.value;
  return {id:v.id,state:v.phase===INTAKE_PHASES.length?'completed':'running',phase:v.phase,steps:INTAKE_PHASES.length,cadets:v.cadets,results:v.results,tests:v.tests,startedAt:v.startedAt,finishedAt:v.finishedAt||'',error:v.error||'',archiveRequired:v.archiveRequired===true,archiveName:v.archiveName||'',archive:v.archive||null};
}
function intakeStatus_(){var id=PropertiesService.getScriptProperties().getProperty('LK_INTAKE_ACTIVE');return id?intakePublic_(intakeJob_(id)):null;}
function saveIntakeJob_(job){sheet_('intakeJobs').getRange(job.rowNumber,4,1,2).setValues([[JSON.stringify(job.value),new Date()]]);}
function intakePublicSheets_() {
  var props=PropertiesService.getScriptProperties(),id=props.getProperty(PUBLIC_RESULTS_PROPERTY),out={public:null,legacyPublic:null};
  if(id){var book=SpreadsheetApp.openById(id);out.public=book.getSheetByName(PUBLIC_RESULTS_SHEET);if(!out.public)fail_('Не знайдено таблицю результатів. Відновіть її перед очищенням.','PUBLIC_RESULTS_SCHEMA');}
  if(!id||String(id)!==String(SPREADSHEET_ID))out.legacyPublic=spreadsheet_().getSheetByName(PUBLIC_RESULTS_SHEET);
  return out;
}
function intakeSnapshot_() {
  testAccessIndex_();
  var users=listUsers_(),cadets=users.filter(function(u){return u.role===ROLE_CADET;}),tests=listTests_(false).filter(function(t){return !isArchivedTest_(t)&&!markerValue_(t.description,RETRY_PREFIX);}),sheets=intakePublicSheets_();
  var counts={cadets:cadets.length,results:listResults_(null).length,tests:tests.length};
  var fingerprint={users:users.map(function(u){return [String(u.id),u.role,u.username,u.fullName,u.groupName,u.active];}),tests:tests.map(function(t){return [String(t.id),t.description,t.published];}),revisions:workspaceRevisions_({id:'intake',role:ROLE_INSTRUCTOR},true),counts:counts,publicRows:sheets.public?sheets.public.getLastRow():0,legacyRows:sheets.legacyPublic?sheets.legacyPublic.getLastRow():0};
  return {cadets:cadets,tests:tests,counts:counts,digest:sha256Hex_(JSON.stringify(fingerprint))};
}
function intakePreview_(actor) {
  var active=intakeStatus_();if(active)return {intake:active};
  var snapshot=intakeSnapshot_();
  return {intake:null,preview:snapshot.counts,previewToken:signedDocument_({kind:'new-intake',actorId:String(actor.id),digest:snapshot.digest,expiresAt:Date.now()+600000})};
}
function startIntake_(actor,body) {
  if(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(body.requestId)||body.confirmation!=='НОВИЙ НАБІР')fail_('Для очищення введіть «НОВИЙ НАБІР».','CONFIRMATION_REQUIRED');
  var previous=dataRows_('intakeJobs').filter(function(row){if(row[1]!=='job')return false;try{return JSON.parse(String(row[3])).requestId===body.requestId;}catch(error){return false;}})[0];
  if(previous){
    var old=intakeJob_(previous[0]);if(old.value.actorId!==String(actor.id)||old.value.previewToken!==body.previewToken)fail_('Ключ запиту вже використано.','REQUEST_CONFLICT');
    var running=intakeStatus_();if(running&&running.id!==old.value.id)return {intake:running};
    if(!running&&old.value.phase<INTAKE_PHASES.length){
      // The durable plan may have been written just before a failed property
      // write. Adopt it only if no one joined or submitted in the meantime.
      var originalPreview=readSignedDocument_(old.value.previewToken,'INVALID_PREVIEW');
      if(old.value.phase!==0||originalPreview.digest!==intakeSnapshot_().digest)fail_('Дані змінилися після перерваного підтвердження. Перевірте новий попередній перегляд.','REVISION_CONFLICT');
      PropertiesService.getScriptProperties().setProperty('LK_INTAKE_ACTIVE',old.value.id);
    }
    return {intake:intakePublic_(old)};
  }
  var active=intakeStatus_();if(active)return {intake:active};
  var signed=readSignedDocument_(body.previewToken,'INVALID_PREVIEW'),snapshot=intakeSnapshot_();
  if(!signed||signed.kind!=='new-intake'||signed.actorId!==String(actor.id)||signed.expiresAt<Date.now())fail_('Підтвердження застаріло. Відкрийте підготовку набору ще раз.','PREVIEW_EXPIRED');
  if(signed.digest!==snapshot.digest)fail_('Склад курсантів, тести або результати змінилися. Перевірте оновлені кількості перед очищенням.','REVISION_CONFLICT');
  var id='intake-'+Utilities.getUuid(),now=new Date(),value={id:id,requestId:body.requestId,actorId:String(actor.id),previewToken:body.previewToken,phase:0,cadets:snapshot.counts.cadets,results:snapshot.counts.results,tests:snapshot.counts.tests,startedAt:now.toISOString(),error:'',archiveRequired:true,archiveName:cleanText_(body.archiveName,80)||'Набір '+now.toISOString().slice(0,10),timezoneOffsetMinutes:Number.isFinite(body.timezoneOffsetMinutes)&&Math.abs(body.timezoneOffsetMinutes)<=840?body.timezoneOffsetMinutes:0};
  var rows=[[id,'job','',JSON.stringify(value),now]].concat(snapshot.cadets.map(function(u){return [id,'cadet',String(u.id),'',now];})),sheet=sheet_('intakeJobs'),first=sheet.getLastRow()+1;
  if(sheet.getMaxRows()<first+rows.length-1)sheet.insertRowsAfter(sheet.getMaxRows(),first+rows.length-1-sheet.getMaxRows());
  sheet.getRange(first,1,rows.length,5).setValues(rows);
  PropertiesService.getScriptProperties().setProperty('LK_INTAKE_ACTIVE',id);
  return {intake:intakePublic_(intakeJob_(id))};
}
function intakeDeleteRows_(sheet,predicate,keepPositions) {
  if(!sheet||sheet.getLastRow()<2)return true;
  var rows=sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getMaxColumns()).getValues(),indices=[];
  rows.forEach(function(row,i){if(predicate(row))indices.push(i+2);});
  if(!keepPositions&&indices.length&&sheet.getMaxRows()-indices.length<2)sheet.insertRowsAfter(sheet.getMaxRows(),2-(sheet.getMaxRows()-indices.length));
  // Recompute the remaining ranges on every retry. Never retain row positions
  // after deletion, and limit one request to 20 spreadsheet delete operations.
  var operations=0;
  for(var end=indices.length-1;end>=0;){
    var start=end;while(start>0&&indices[start-1]===indices[start]-1)start--;
    var count=end-start+1;
    // Published large-test manifests address immutable ranges. Clear orphan
    // payloads in place so a retained test never moves during cohort cleanup.
    if(keepPositions)sheet.getRange(indices[start],1,count,rows[0].length).setValues(Array.from({length:count},function(){return Array(rows[0].length).fill('');}));
    else sheet.deleteRows(indices[start],count);
    end=start-1;operations++;if(operations>=20)return end<0;
  }
  return true;
}
function closeAllTests_(actor) {
  var policies=testAccessIndex_(),rows=dataRows_('testAccess'),byId=Object.create(null);
  rows.forEach(function(row,i){byId[String(row[0])]=i;});
  listTests_(false).filter(function(t){return !isArchivedTest_(t)&&!markerValue_(t.description,RETRY_PREFIX);}).forEach(function(t){
    var old=policies[String(t.id)]||{revision:0},row=[String(t.id),old.revision+1,JSON.stringify({defaultOpen:false,groups:{}}),new Date(),String(actor.id)];
    if(Object.prototype.hasOwnProperty.call(byId,String(t.id)))rows[byId[String(t.id)]]=row;else rows.push(row);
  });
  if(rows.length){var sheet=sheet_('testAccess');if(sheet.getMaxRows()<rows.length+1)sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());sheet.getRange(2,1,rows.length,5).setValues(rows);}
  testAccessCache_=null;
}
function continueIntake_(actor,body) {
  if(typeof body.jobId!=='string'||!/^intake-[A-Za-z0-9_-]{16,100}$/.test(body.jobId))fail_('Некоректний ідентифікатор підготовки набору.','BAD_REQUEST');
  var props=PropertiesService.getScriptProperties(),active=props.getProperty('LK_INTAKE_ACTIVE'),job=intakeJob_(body.jobId);
  if(job.value.phase===INTAKE_PHASES.length){if(active===job.value.id)props.deleteProperty('LK_INTAKE_ACTIVE');return {intake:intakePublic_(job)};}
  if(active!==job.value.id)fail_('Операцію вже змінено. Оновіть дані.','REVISION_CONFLICT');
  var phase=INTAKE_PHASES[job.value.phase],done=true,targets=Object.create(null);job.targets.forEach(function(id){targets[id]=true;});
  function all(){return true;}
  try{
    if(ensureIntakeArchive_(actor,job))return {intake:intakePublic_(job)};
    if(phase==='close')closeAllTests_(actor);
    else if(phase==='public'||phase==='legacyPublic')done=intakeDeleteRows_(intakePublicSheets_()[phase],all);
    else if(phase==='pcState'){
      var instructors=Object.create(null);listUsers_().filter(function(u){return u.role===ROLE_INSTRUCTOR;}).forEach(function(u){instructors[String(u.id)]=true;});
      done=intakeDeleteRows_(sheet_('pcState'),function(row){return !instructors[String(row[0])]||String(row[1]).indexOf('grading:')===0;});
    }else if(phase==='privateTests')done=intakeDeleteRows_(sheet_('tests'),function(row){return !!markerValue_(String(row[2]||''),RETRY_PREFIX);});
    else if(phase==='testParts'){
      var existing=Object.create(null);listTests_(false).forEach(function(t){existing[String(t.id)]=true;});
      done=intakeDeleteRows_(sheet_('testParts'),function(row){return String(row[0])!==''&&!existing[String(row[0])];},true);
    }else if(phase==='audit')done=intakeDeleteRows_(sheet_('cadetNotes'),all)&&intakeDeleteRows_(sheet_('audit'),function(row){return ['cadet','result'].indexOf(String(row[4]))>=0;});
    else if(phase==='sync')done=intakeDeleteRows_(sheet_('sync'),function(row){return String(row[1]).indexOf('result:')===0;});
    else if(phase==='results')done=intakeDeleteRows_(sheet_('deletedResults'),all)&&intakeDeleteRows_(sheet_('results'),all);
    else if(phase==='users')done=intakeDeleteRows_(sheet_('users'),function(row){return row[4]===ROLE_CADET&&targets[String(row[0])];});
    else if(phase==='finish'){
      var values=props.getProperties(),keys=Object.keys(values).filter(function(key){return key.indexOf(REVIEW_LEASE_PREFIX)===0||['LK_PC_STATE_','SESSION_VERSION_','DELETING_CADET_'].some(function(prefix){return key.indexOf(prefix)===0&&targets[key.slice(prefix.length)];});});
      keys.slice(0,30).forEach(function(key){props.deleteProperty(key);});done=keys.length<=30;
      if(done){props.setProperty('LK_INTAKE_GENERATION',job.value.id);job.value.finishedAt=new Date().toISOString();}
    }else done=intakeDeleteRows_(sheet_(phase),all);
    if(done)job.value.phase++;job.value.error='';saveIntakeJob_(job);
    if(job.value.phase===INTAKE_PHASES.length){props.deleteProperty('LK_INTAKE_ACTIVE');logAudit_(actor,'INTAKE_COMPLETE','intake',job.value.id,'','Підготовлено новий набір. Видалено курсантів: '+job.value.cadets+'; результатів: '+job.value.results+'. Тести збережено та закрито.');}
  }catch(error){job.value.error=String(error.message||error).slice(0,500);try{saveIntakeJob_(job);}catch(ignored){}throw error;}
  return {intake:intakePublic_(job)};
}

function workspaceScopes_(path) {
  if (/\/tests\/[^/]+\/start$/.test(path)) return [];
  if (/\/intake(?:\/|$)/.test(path)) return ['tests','cadets','results','materials','progress'];
  if (/review-session$/.test(path)) return [];
  if (/exam-recoveries/.test(path)) return ['results'];
  if (/materials\/uploads/.test(path)) return [];
  if (/materials.*progress/.test(path)) return ['progress'];
  if (/materials/.test(path)) return ['materials'];
  if (/instructor\/users/.test(path)) return ['cadets','results','tests','materials','progress'];
  if (/groups/.test(path)) return ['groups','tests'];
  if (/tests|retry/.test(path)) return ['tests'];
  if (/results/.test(path)) return ['results'];
  return [];
}
// Record affected scopes before touching Sheets. A later lock holder can finish
// an interrupted revision commit, including writes left by older server versions.
function recoverWorkspaceChange_(lockHeld) {
  var props=PropertiesService.getScriptProperties();
  if(!props.getProperty('LK_WORKSPACE_WRITE'))return;
  var ownLock=null;
  if(!lockHeld){ownLock=LockService.getScriptLock();if(!ownLock.tryLock(1))return;}
  try{
    var raw=props.getProperty('LK_WORKSPACE_WRITE');if(!raw)return;
    var marker;try{marker=JSON.parse(raw);}catch(ignored){}
    var allowed=['groups','tests','cadets','results','materials','progress'];
    var valid=marker&&marker.v===1&&typeof marker.nonce==='string'&&marker.nonce
      &&Array.isArray(marker.scopes)&&marker.scopes.length&&marker.scopes.every(function(k){return allowed.indexOf(k)>=0;});
    var scopes=valid?marker.scopes:allowed,nonce=valid?marker.nonce:Utilities.getUuid();
    scopes.forEach(function(k){props.setProperty('LK_REV_'+k,nonce);});
    // Never remove the recovery obligation before every affected cursor commits.
    props.deleteProperty('LK_WORKSPACE_WRITE');
  }finally{if(ownLock)ownLock.releaseLock();}
}
function beginWorkspaceChange_(scopes) {
  if (!workspaceWriteRequest_ || !scopes.length) return;
  var next=workspaceMutation_?copyObject_(workspaceMutation_):{v:1,nonce:Utilities.getUuid(),scopes:[]};
  scopes.forEach(function(k){if(next.scopes.indexOf(k)<0)next.scopes.push(k);});
  PropertiesService.getScriptProperties().setProperty('LK_WORKSPACE_WRITE',JSON.stringify(next));
  workspaceMutation_=next;
}
function finishWorkspaceChange_() {
  if (!workspaceMutation_) return;
  recoverWorkspaceChange_(true);workspaceMutation_=null;
}
function workspaceRevisions_(user,all) {
  var p=PropertiesService.getScriptProperties(),out={},finger=String(user.id)+':'+user.role+':'+String(user.groupName||'')+':written1';
  ['groups','tests','cadets','results','materials','progress'].forEach(function(k){out[k]=(p.getProperty('LK_REV_'+k)||'0')+':'+finger;});
  out.results+=':'+(user.role===ROLE_INSTRUCTOR?(all?'all':'recent'):'own');return out;
}
function conditionalWorkspace_(user,body) {
  var all=body.allResults===true,known=body.known||{},before=workspaceRevisions_(user,all),props=PropertiesService.getScriptProperties();
  var busy=props.getProperty('LK_WORKSPACE_WRITE'),changes={},out={workspaceProtocol:1,user:publicUser_(user),revisions:before,changes:changes,
    capabilities:{singleAttempt:true,resultDeletion:user.role===ROLE_INSTRUCTOR,privateLocalStorage:true,trainingResume:true,testAccess:true,newIntake:true,reviewPresence:true,chunkedTests:true,examRecovery:true,testDeletion:true,multipleChoice:true,examResume:true,pcAccountSync:true,writtenTests:true,conditionalWorkspace:true,listPerformance:true,materials:true,groupArchive:true,bulkAssignment:true,filteredAnalytics:true,cadetTransfer:true,cadetCard:true,formattedReports:true,intakeArchives:true},resultScope:all?'all':'recent',intakeGeneration:props.getProperty('LK_INTAKE_GENERATION')||'0'};
  if(user.role===ROLE_INSTRUCTOR)out.intake=intakeStatus_();
  if(known.groups!==before.groups)changes.groups=listGroups_();
  if(known.tests!==before.tests)changes.tests=listTestsForUser_(user);
  if(user.role===ROLE_INSTRUCTOR&&known.cadets!==before.cadets)changes.cadets=listUsers_().filter(function(u){return u.role===ROLE_CADET;}).map(publicUser_);
  if(known.results!==before.results){
    // Match the existing dashboard: read only the latest appended rows for its
    // preview. Full instructor history and each cadet's own history stay whole.
    var recent=user.role===ROLE_INSTRUCTOR&&!all;
    var results=recent?listRecentResults_(DASHBOARD_RESULT_LIMIT):listResults_(user.role===ROLE_INSTRUCTOR?null:user.id);
    out.resultTotal=recent?resultCount_():results.length;
    changes.results=results;out.resultsTruncated=results.length<out.resultTotal;
    out.deletedResults=deletedResultRows_(user.role===ROLE_INSTRUCTOR?null:user.id).map(function(row){
      return user.role===ROLE_INSTRUCTOR?{id:String(row[0])}:{id:String(row[0]),testId:String(row[2])};
    });
    if(user.role===ROLE_CADET)out.examRecoveries=listExamRecoveries_(user,false);
  }
  out.snapshotStable=!busy&&!props.getProperty('LK_WORKSPACE_WRITE')&&JSON.stringify(before)===JSON.stringify(workspaceRevisions_(user,all));
  return out;
}

function routeApi_(request) {
  var method = String(request.method || 'GET').toUpperCase();
  var path = String(request.path || '');
  var body = request.body && typeof request.body === 'object' ? request.body : {};
  if (!/^(GET|POST|DELETE)$/.test(method) || !/^\/api\//.test(path) || path.indexOf('..') >= 0) {
    fail_('Некоректний API-запит.', 'BAD_REQUEST');
  }

  if (method !== 'GET' && PropertiesService.getScriptProperties().getProperty('LK_INTAKE_ACTIVE')
      && path !== '/api/challenge' && path !== '/api/login' && path !== '/api/instructor/intake/continue' && path !== '/api/instructor/intake/start') {
    fail_('Триває підготовка нового набору. Продовжіть її в розділі «Курсанти».', 'INTAKE_IN_PROGRESS');
  }

  if (method === 'POST' && path === '/api/challenge') return createChallenge_(body);
  if (method === 'POST' && path === '/api/login') return login_(body);
  if (method === 'POST' && path === '/api/register') return registerCadet_(body);
  if (method === 'POST' && path === '/api/instructor/register') return registerInstructor_(body);
  if (method === 'GET' && path === '/api/groups') return {groups: listGroups_()};
  if (method === 'GET' && path === '/api/app-info') return appInfo_();

  var user = requireSession_(request.token);
  publicSyncActor_ = user;
  if (method !== 'GET') {
    if (path.indexOf('/api/instructor/') === 0) requireRole_(user, ROLE_INSTRUCTOR);
    beginWorkspaceChange_(workspaceScopes_(path));
  }
  if (method === 'GET' && path === '/api/workspace') return conditionalWorkspace_(user, body);
  if (method === 'GET' && path === '/api/public-table-sync') return {};
  if (method === 'GET' && path === '/api/account-state') return pcStateIndex_(user, body);
  if (method === 'GET' && path === '/api/account-state/document') return pcStateGet_(user, body);
  if (method === 'POST' && path === '/api/account-state/document') return pcStatePut_(user, body);
  if (method === 'GET' && path === '/api/local-storage/key') return localStorageKey_(user);
  var examResponse = routeExam_(method,path,body,user,request.choiceProtocol);
  if(examResponse!==null)return examResponse;
  var recoveryResponse = routeExamRecovery_(method,path,body,user);
  if(recoveryResponse!==null)return recoveryResponse;
  var materialResponse = routeMaterials_(method, path, body, user);
  if (materialResponse !== null) return materialResponse;

  if (method === 'GET' && path === '/api/tests') return {tests: listTestsForUser_(user)};
  if (method === 'GET' && path === '/api/my-results') {
    requireRole_(user, ROLE_CADET);
    return {results: listResults_(user.id)};
  }
  if (method === 'GET' && path === '/api/cadet/workspace') {
    requireRole_(user, ROLE_CADET);
    return {tests: listTestsForUser_(user), results: listResults_(user.id)};
  }
  var reviewMatch = path.match(/^\/api\/results\/([^/]+)\/review$/);
  if (method === 'GET' && reviewMatch) return resultReview_(user, decodePart_(reviewMatch[1]));
  var mistakesMatch = path.match(/^\/api\/results\/([^/]+)\/mistakes$/);
  if (method === 'GET' && mistakesMatch) {
    requireRole_(user, ROLE_CADET);
    return {practice: resultMistakes_(user, decodePart_(mistakesMatch[1]))};
  }
  if (method === 'POST' && path === '/api/results') {
    requireRole_(user, ROLE_CADET);
    return submitResult_(user, body);
  }

  var testMatch = path.match(/^\/api\/tests\/([^/]+)$/);
  if (method === 'GET' && testMatch) return {test: getTestForUser_(decodePart_(testMatch[1]), user, request.writtenProtocol, request.choiceProtocol)};
  var trainingStartMatch = path.match(/^\/api\/tests\/([^/]+)\/start$/);
  if (method === 'POST' && trainingStartMatch) return startTraining_(user, decodePart_(trainingStartMatch[1]), body, request.choiceProtocol);

  requireRole_(user, ROLE_INSTRUCTOR);

  var cadetCardMatch=path.match(/^\/api\/instructor\/cadets\/([^/]+)(\/notes)?$/);
  if(cadetCardMatch){
    var cadetId=decodePart_(cadetCardMatch[1]);
    if(method==='GET'&&!cadetCardMatch[2])return instructorCadetCard_(cadetId);
    if(method==='POST'&&cadetCardMatch[2])return addCadetNote_(user,cadetId,body);
  }

  if(method === 'GET' && path === '/api/instructor/intake')return intakePreview_(user);
  if(method === 'POST' && path === '/api/instructor/intake/start')return startIntake_(user,body);
  if(method === 'POST' && path === '/api/instructor/intake/continue')return continueIntake_(user,body);
  var testAccessMatch = path.match(/^\/api\/instructor\/tests\/([^/]+)\/access$/);
  if(testAccessMatch && method === 'GET')return instructorTestAccess_(decodePart_(testAccessMatch[1]));
  if(testAccessMatch && method === 'POST')return changeTestAccess_(user,decodePart_(testAccessMatch[1]),body);

  if(method==='GET'&&path==='/api/instructor/reports/results')return instructorReportData_(user,body);
  if(method==='GET'&&path==='/api/instructor/intake/archives')return listIntakeArchives_();
  if(method==='GET'&&path==='/api/instructor/intake/archive')return intakeArchiveContent_(body);
  if (method === 'GET' && path === '/api/instructor/dashboard') return instructorDashboard_();
  var lessonMatch = path.match(/^\/api\/instructor\/lesson\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && lessonMatch) {
    return instructorLesson_(decodePart_(lessonMatch[1]), decodePart_(lessonMatch[2]));
  }
  if (method === 'GET' && path === '/api/instructor/reviews') return reviewQueueWithPresence_(user, body);
  if (method === 'GET' && path === '/api/instructor/review-presence') return reviewPresenceSnapshot_(user);
  var reviewSessionMatch = path.match(/^\/api\/instructor\/results\/([^/]+)\/review-session$/);
  if ((method === 'GET' || method === 'POST') && reviewSessionMatch) return reviewSession_(user, decodePart_(reviewSessionMatch[1]), body, method);
  var gradeMatch = path.match(/^\/api\/instructor\/results\/([^/]+)\/grade$/);
  if (method === 'POST' && gradeMatch) return gradeResult_(user, decodePart_(gradeMatch[1]), body);
  var deleteResultMatch = path.match(/^\/api\/instructor\/results\/([^/]+)$/);
  if (method === 'DELETE' && deleteResultMatch) return deleteResult_(user, decodePart_(deleteResultMatch[1]), body);
  if (method === 'GET' && path === '/api/instructor/results') return {results: listResults_(null)};
  if (method === 'GET' && path === '/api/instructor/results-sheet') return resultsSheetInfo_();
  if (method === 'POST' && path === '/api/instructor/results-sheet/sync') {
    return repairPublicResults_();
  }
  if (method === 'GET' && path === '/api/instructor/instructors') return {instructors: listInstructors_()};
  if (method === 'GET' && path === '/api/instructor/question-bank') return {questions: listQuestionBank_()};
  if (method === 'GET' && path === '/api/instructor/analytics') return instructorAnalytics_(body);
  if (method === 'GET' && path === '/api/instructor/audit') return {entries: listAudit_()};
  if (method === 'GET' && path === '/api/instructor/invite') return getInvite_(user);
  if (method === 'POST' && path === '/api/instructor/invite') return generateInvite_(user);
  if (method === 'POST' && path === '/api/instructor/groups') return {group: createGroup_(user, body)};
  if (method === 'POST' && path === '/api/instructor/tests/assign') return bulkAssignTests_(user,body);
  var archiveGroupMatch=path.match(/^\/api\/instructor\/groups\/([^/]+)\/archive$/);
  if(method==='POST'&&archiveGroupMatch)return archiveGroup_(decodePart_(archiveGroupMatch[1]),user,body);
  if (method === 'POST' && path === '/api/instructor/tests') return {test: createTest_(user, body)};
  if (method === 'POST' && path === '/api/instructor/users') return {user: createCadetByInstructor_(user, body)};
  if (method === 'POST' && path === '/api/instructor/question-bank') {
    return {question: saveBankQuestion_('', user, body)};
  }

  var bankQuestionMatch = path.match(/^\/api\/instructor\/question-bank\/([^/]+)$/);
  if (method === 'POST' && bankQuestionMatch) {
    return {question: saveBankQuestion_(decodePart_(bankQuestionMatch[1]), user, body)};
  }
  if (method === 'DELETE' && bankQuestionMatch) {
    return deleteBankQuestion_(decodePart_(bankQuestionMatch[1]), user);
  }

  var replaceTestMatch = path.match(/^\/api\/instructor\/tests\/([^/]+)\/replace$/);
  if (method === 'POST' && replaceTestMatch) {
    return {test: replaceTest_(decodePart_(replaceTestMatch[1]), user, body)};
  }

  var retryResultMatch = path.match(/^\/api\/instructor\/results\/([^/]+)\/retry$/);
  if (method === 'POST' && retryResultMatch) {
    requireRole_(user, ROLE_INSTRUCTOR);
    fail_('Повторне проходження тестів вимкнено. Доступна одна спроба.', 'RETAKES_DISABLED');
  }

  var deleteGroupMatch = path.match(/^\/api\/instructor\/groups\/([^/]+)$/);
  if (method === 'DELETE' && deleteGroupMatch) return deleteGroup_(decodePart_(deleteGroupMatch[1]), user);

  var deleteTestMatch = path.match(/^\/api\/instructor\/tests\/([^/]+)$/);
  if (method === 'DELETE' && deleteTestMatch) return deleteTest_(decodePart_(deleteTestMatch[1]), user);

  var statusMatch = path.match(/^\/api\/instructor\/users\/([^/]+)\/status$/);
  if (method === 'POST' && statusMatch) return updateUserStatus_(decodePart_(statusMatch[1]), user, body);

  var userGroupMatch = path.match(/^\/api\/instructor\/users\/([^/]+)\/group$/);
  if (method === 'POST' && userGroupMatch) return transferCadet_(decodePart_(userGroupMatch[1]), user, body);

  var passwordMatch = path.match(/^\/api\/instructor\/users\/([^/]+)\/password$/);
  if (method === 'POST' && passwordMatch) return updateUserPassword_(decodePart_(passwordMatch[1]), user, body);

  var deleteUserMatch = path.match(/^\/api\/instructor\/users\/([^/]+)$/);
  if (method === 'DELETE' && deleteUserMatch) return deleteCadet_(decodePart_(deleteUserMatch[1]), user, body);

  fail_('Запит не підтримується цією версією сервера.', 'NOT_FOUND');
}

function requiresWriteLock_(request) {
  if(request&&request.action==='api'&&request.method==='GET'&&request.path==='/api/groups'&&request.body&&request.body.initializeReports===true)return true;
  if(request&&request.action==='local-storage-authorize')return false;
  if (!request || request.action !== 'api') return true;
  var method = String(request.method || '').toUpperCase();
  var path = String(request.path || '');
  if (method === 'GET') return false;
  return !(method === 'POST' && (path === '/api/challenge' || path === '/api/login'));
}

function setupCommission() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    CacheService.getScriptCache().remove('LK_SCHEMA_READY_V5');
    CacheService.getScriptCache().remove('LK_SCHEMA_READY_V6');
    CacheService.getScriptCache().remove('LK_SCHEMA_READY_V11');
    ensureSchema_(true, true);
    ensureAppSecret_();
    ensurePrimaryInstructor_();
    var publicSheet = publicResultsSpreadsheet_(true);
    ensurePublicResultsSheet_(publicSheet);
    repairPublicResults_();
    return 'Готово. Службову базу оновлено. Окрема таблиця результатів: ' + publicSheet.getUrl()
      + '. Надайте доступ інструкторам саме до неї, після чого створіть нову версію веб-додатка.';
  } finally {
    lock.releaseLock();
  }
}

/**
 * Запустіть тільки якщо таблиця ще не має жодного інструктора.
 * Отриманий код діє 30 хвилин і дозволяє зареєструвати першого інструктора.
 */
function createInitialInstructorCode() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSchema_(true);
    if (listUsers_().some(function (user) { return user.role === ROLE_INSTRUCTOR; })) {
      throw new Error('Головний інструктор уже існує. Новий код створюється в застосунку.');
    }
    var code = generateInviteCode_();
    var expires = Date.now() + 30 * 60 * 1000;
    var properties = PropertiesService.getScriptProperties();
    properties.setProperty('INITIAL_INVITE_CODE', code);
    properties.setProperty('INITIAL_INVITE_EXPIRES_AT', String(expires));
    return 'Код першого інструктора: ' + code + '. Діє 30 хвилин.';
  } finally {
    lock.releaseLock();
  }
}

function ensureSchema_(lockHeld, force) {
  var cache = CacheService.getScriptCache();
  var schemaReady=cache.get('LK_SCHEMA_READY_API25')==='1'&&cache.get('LK_SCHEMA_READY_PUBLIC_CADETS_V1')==='1'&&cache.get('LK_SCHEMA_CADET_CARD_V1')==='1';
  if(!force&&schemaReady&&cache.get('LK_SCHEMA_EXCEL_V1')==='1')return;
  var ownLock = null;
  if (!lockHeld) {
    ownLock = LockService.getScriptLock();
    if (!ownLock.tryLock(2000)) fail_('Сервер зайнятий. Спробуйте ще раз.', 'BUSY');
  }
  try {
    var properties=PropertiesService.getScriptProperties();
    if(force||!schemaReady){
    var spreadsheet = spreadsheet_();
    Object.keys(SHEETS).forEach(function (key) {
      ensureSheet_(spreadsheet, SHEETS[key], HEADERS[key], false);
    });
    migrateTestQuestionCounts_();
    ensureAppSecret_();
    ensurePrimaryInstructor_();
    // The publication flag shares the authoritative result row. Existing
    // releases are queued once as well, including copies missed by API 19.
    var properties=PropertiesService.getScriptProperties();
    if(properties.getProperty('LK_PUBLIC_SYNC_MIGRATED_V1')!=='1') {
      var resultSheet=sheet_('results'),resultRows=Math.max(0,resultSheet.getLastRow()-1);
      if(resultRows)resultSheet.getRange(2,PUBLIC_SYNC_COLUMN,resultRows,1).setValues(Array.from({length:resultRows},function(){return ['pending'];}));
      invalidatePublicSync_();
      properties.setProperty('LK_PUBLIC_SYNC_MIGRATED_V1','1');
    }
    if(properties.getProperty('LK_CADET_PUBLIC_MIGRATED_V1')!=='1') {
      var userSheet=sheet_('users'),userRows=dataRows_('users');
      if(userRows.length)userSheet.getRange(2,10,userRows.length,1).setValues(userRows.map(function(row){return [row[4]===ROLE_CADET?'pending':''];}));
      invalidatePublicSync_();
      properties.setProperty('LK_CADET_PUBLIC_MIGRATED_V1','1');
    }
    cache.put('LK_SCHEMA_READY_API25', '1', 21600);
    cache.put('LK_SCHEMA_READY_PUBLIC_CADETS_V1', '1', 21600);
    cache.put('LK_SCHEMA_CADET_CARD_V1','1',21600);
    }
    migratePublicReports_();
    if(publicReportLayoutReady_())cache.put('LK_SCHEMA_EXCEL_V1','1',21600);
  } finally {
    if (ownLock) ownLock.releaseLock();
  }
}

function ensureSheet_(spreadsheet, name, headers, visible) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground(visible ? '#17365d' : '#d9eaf7')
    .setFontColor(visible ? '#ffffff' : '#102746');
  if (!visible && !sheet.isSheetHidden()) {
    try { sheet.hideSheet(); } catch (ignored) {}
  }
  return sheet;
}

function getResultsTableLink() {
  publicResultsSpreadsheet_(true);return resultsSheetInfo_().url;
}

/** Додає назви тестів до наявної таблиці без повторного запису оцінок. */
function updateResultsTestColumn() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    publicResultsSheetCache_ = null;
    ensurePublicResultsSheet_(publicResultsSpreadsheet_(true));
    var info = repairPublicResults_();
    var message = 'Готово. Колонку «Тест» додано, назви збережених результатів заповнено. Таблиця: ' + info.url;
    console.log(message);
    return message;
  } finally {
    lock.releaseLock();
  }
}

function migrateTestQuestionCounts_() {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('TEST_COUNTS_MIGRATED_V1') === '1') return;
  var sheet = sheet_('tests');
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var range = sheet.getRange(2, 8, lastRow - 1, 3);
    var rows = range.getValues();
    var changed = false;
    rows.forEach(function (row) {
      if (!Number(row[2] || 0)) {
        row[2] = parseQuestions_(row[0]).length;
        changed = true;
      }
    });
    if (changed) range.setValues(rows);
  }
  properties.setProperty('TEST_COUNTS_MIGRATED_V1', '1');
}

function publicResultsSpreadsheet_(createIfMissing) {
  if (publicResultsSpreadsheetCache_) return publicResultsSpreadsheetCache_;
  var properties = PropertiesService.getScriptProperties();
  var id = String(properties.getProperty(PUBLIC_RESULTS_PROPERTY) || '');
  if (id) {
    try {
      var existing = SpreadsheetApp.openById(id);
      publicResultsSpreadsheetCache_ = existing;
      return existing;
    } catch (ignored) {
      if (!createIfMissing) return null;
      // A temporary Google failure must not silently replace the shared book.
      fail_('Не вдалося відкрити чинну таблицю результатів. Спробуйте пізніше; її адресу та доступ інструкторів збережено.', 'PUBLIC_RESULTS_UNAVAILABLE');
    }
  }
  if (!createIfMissing) return null;
  var created = SpreadsheetApp.create(PUBLIC_RESULTS_TITLE);
  properties.setProperty(PUBLIC_RESULTS_PROPERTY, created.getId());
  var target = ensurePublicResultsSheet_(created);
  migrateLegacyVisibleResults_(target);
  publicResultsSpreadsheetCache_ = created;
  return created;
}

function publicReportLayoutReady_(){var p=PropertiesService.getScriptProperties(),id=p.getProperty(PUBLIC_RESULTS_PROPERTY);return p.getProperty('LK_EXCEL_LAYOUT_ARMED_V1')==='1'&&(!id||p.getProperty('LK_PUBLIC_LAYOUT_READY_V4_'+id)==='1');}
function migratePublicReports_(){
 var props=PropertiesService.getScriptProperties(),id=props.getProperty(PUBLIC_RESULTS_PROPERTY);if(props.getProperty('LK_EXCEL_LAYOUT_ARMED_V1')!=='1'||!id||publicReportLayoutReady_()||Date.now()<Number(props.getProperty('LK_PUBLIC_FORMAT_RETRY_V4')||0))return;
 try{ensurePublicResultsSheet_(SpreadsheetApp.openById(id));props.deleteProperty('LK_PUBLIC_FORMAT_ERROR_V4');props.deleteProperty('LK_PUBLIC_FORMAT_RETRY_V4');}
 catch(error){props.setProperty('LK_PUBLIC_FORMAT_ERROR_V4',String(error.message||error).slice(0,500));props.setProperty('LK_PUBLIC_FORMAT_RETRY_V4',String(Date.now()+30000));console.warn('Оформлення таблиці буде повторено: '+String(error.message||error));}
}
function publicLayout_(sheet) {
  var found=publicLayouts_.filter(function(entry){return entry.sheet===sheet;})[0];if(found)return found;
  var headers=sheet.getRange(1,1,1,sheet.getMaxColumns()).getValues()[0].map(String);
  var columns=PUBLIC_RESULTS_CANONICAL_HEADERS.map(function(name){var index=headers.indexOf(name);return index>=0?index:name==='ПІБ курсанта'?headers.indexOf('ПІБ'):name==='Правильних, %'?headers.indexOf('Оцінка, %'):-1;});
  found={sheet:sheet,headers:headers,columns:columns,modern:headers.indexOf('Група')>=0&&headers.indexOf('Дата завершення')>=0&&headers.indexOf('Результат')>=0};publicLayouts_.push(found);return found;
}
function publicCanonicalRow_(sheet,row,legacyValues) {
  var layout=publicLayout_(sheet),out=layout.columns.map(function(index){return index<0?'':row[index]==null?'':row[index];});
  // Legacy matching and deletion use the original values, irrespective of display order.
  if(!legacyValues&&typeof out[3]==='number')out[3]=formatDuration_(Math.round(out[3]*86400));
  [4,11].forEach(function(index){if(!legacyValues&&typeof out[index]==='number'&&layout.modern)out[index]=Math.round(out[index]*10000)/100;});
  var shown=String(out[3]||'').match(/^(\d+):(\d{2})(?::(\d{2}))?$/);if(shown)out[3]=formatDuration_(shown[3]==null?Number(shown[1])*60+Number(shown[2]):Number(shown[1])*3600+Number(shown[2])*60+Number(shown[3]));
  if(out[13] instanceof Date)out[13]=out[13].toISOString();
  return out;
}
function publicRowsFromSheet_(sheet,legacyValues) {
  var count=Math.max(0,sheet.getLastRow()-1);if(!count)return [];var rows=sheet.getRange(2,1,count,sheet.getMaxColumns()).getValues(),time=publicLayout_(sheet).columns[3];
  if(time>=0&&rows.some(function(row){return row[time] instanceof Date;})){var displayed=sheet.getRange(2,time+1,count,1).getDisplayValues();rows.forEach(function(row,index){if(row[time] instanceof Date)row[time]=displayed[index][0];});}
  return rows.map(function(row){return publicCanonicalRow_(sheet,row,legacyValues);});
}
function publicPhysicalValue_(index,value,modern) {
  if(modern===false)return value==null?'':value;
  if(value===''||value==null)return '';
  if(index===4||index===11)return Number(value)/100;
  if(index===13){var ms=Date.parse(value);return isFinite(ms)?new Date(ms):'';}
  if(index===3){var text=String(value),match=text.match(/^(\d+):(\d{2})$/),uk=text.match(/^(?:(\d+) год )?(\d+) хв (\d+) с$/);return match?(Number(match[1])*60+Number(match[2]))/86400:uk?(Number(uk[1]||0)*3600+Number(uk[2])*60+Number(uk[3]))/86400:value;}
  return value;
}
function writePublicRows_(sheet,first,rows) {
  if(!rows.length)return;
  var needed=first+rows.length-1,grew=sheet.getMaxRows()<needed;if(grew)sheet.insertRowsAfter(sheet.getMaxRows(),Math.max(250,needed-sheet.getMaxRows()));
  var layout=publicLayout_(sheet),pairs=[];layout.columns.forEach(function(column,index){if(column>=0)pairs.push({column:column,index:index});});pairs.sort(function(a,b){return a.column-b.column;});
  for(var from=0;from<pairs.length;){var to=from+1;while(to<pairs.length&&pairs[to].column===pairs[to-1].column+1)to++;
    var fields=pairs.slice(from,to);sheet.getRange(first,fields[0].column+1,rows.length,fields.length).setValues(rows.map(function(row){return fields.map(function(field){return publicPhysicalValue_(field.index,row[field.index],layout.modern);});}));from=to;
  }
  if(grew&&layout.modern)formatPublicResults_(sheet);
}
function appendPublicRow_(sheet,row){var layout=publicLayout_(sheet),columns=layout.columns,width=Math.max.apply(null,columns)+1,values=Array(width).fill(''),grew=sheet.getLastRow()+1>sheet.getMaxRows();if(grew)sheet.insertRowsAfter(sheet.getMaxRows(),250);columns.forEach(function(column,index){if(column>=0)values[column]=publicPhysicalValue_(index,row[index],layout.modern);});sheet.appendRow(values);if(grew&&layout.modern)formatPublicResults_(sheet);}
function publicPlaceholder_(user){return [safeCellText_(user.fullName),'','','','','',String(user.id),'','','','','',safeCellText_(user.groupName),'','Не проходив'];}
function ensurePublicResultsSheet_(spreadsheet) {
  var sheet=spreadsheet.getSheetByName(PUBLIC_RESULTS_SHEET);
  if(!sheet){var sheets=spreadsheet.getSheets?spreadsheet.getSheets():[];sheet=sheets.length===1&&sheetIsEmpty_(sheets[0])?sheets[0]:spreadsheet.insertSheet(PUBLIC_RESULTS_SHEET);if(sheet.getName()!==PUBLIC_RESULTS_SHEET)sheet.setName(PUBLIC_RESULTS_SHEET);}
  if(sheetIsEmpty_(sheet)){if(sheet.getMaxColumns()<PUBLIC_RESULTS_HEADERS.length)sheet.insertColumnsAfter(sheet.getMaxColumns(),PUBLIC_RESULTS_HEADERS.length-sheet.getMaxColumns());sheet.getRange(1,1,1,PUBLIC_RESULTS_HEADERS.length).setValues([PUBLIC_RESULTS_HEADERS]);}
  var headers=sheet.getRange(1,1,1,sheet.getMaxColumns()).getValues()[0].map(String),modern=headers.indexOf('Група')>=0&&headers.indexOf('Дата завершення')>=0&&headers.indexOf('Результат')>=0;
  var props=PropertiesService.getScriptProperties(),readyKey='LK_PUBLIC_LAYOUT_READY_V4_'+spreadsheet.getId(),ready=props.getProperty(readyKey)==='1',backup=null;
  // Keep a sheet-level copy, including instructor formulas and extra columns,
  // before moving an existing legacy layout. Retries reuse the same copy.
  if(!ready&&sheet.getLastRow()>1){
    var key='LK_PUBLIC_LAYOUT_BACKUP_V1_'+spreadsheet.getId(),backupName=props.getProperty(key);
    if(!backupName){backupName=spreadsheet.getSheetByName('Резерв таблиці до Excel')?'Резерв Excel '+Utilities.getUuid().slice(0,8):'Резерв таблиці до Excel';props.setProperty(key,backupName);}
    backup=spreadsheet.getSheetByName(backupName);if(!backup)backup=sheet.copyTo(spreadsheet).setName(backupName);if(!backup.isSheetHidden())backup.hideSheet();
  }
  if(headers[0]==='ПІБ'){sheet.getRange(1,1).setValue('ПІБ курсанта');headers[0]='ПІБ курсанта';}
  if(!modern&&headers[4]==='Оцінка, %'){sheet.getRange(1,5).setValue('Правильних, %');headers[4]='Правильних, %';}
  PUBLIC_RESULTS_HEADERS.forEach(function(name){
    if(headers.filter(function(v){return v===name;}).length>1)fail_('У таблиці повторюється колонка «'+name+'». Усуньте повтор перед синхронізацією.','PUBLIC_RESULTS_SCHEMA');
    if(headers.indexOf(name)>=0)return;
    var column=sheet.getMaxColumns()+1;sheet.insertColumnsAfter(column-1,1);sheet.getRange(1,column).setValue(name);while(headers.length<column-1)headers.push('');headers.push(name);
  });
  PUBLIC_RESULTS_HEADERS.forEach(function(name,index){var from=headers.indexOf(name);if(from!==index){sheet.moveColumns(sheet.getRange(1,from+1,sheet.getMaxRows(),1),index+1);headers.splice(index,0,headers.splice(from,1)[0]);}});
  publicLayouts_=publicLayouts_.filter(function(entry){return entry.sheet!==sheet;});
  if(!ready&&sheet.getLastRow()>1){
    // Rebuild only managed fields from authoritative IDs; user columns remain intact.
    var results=Object.create(null),users=Object.create(null);listResults_(null).forEach(function(r){results[String(r.id)]=r;});listUsers_().forEach(function(u){users[String(u.id)]=u;});
    var rows=publicRowsFromSheet_(backup||sheet,true).map(function(row){var result=results[String(row[7])];if(result)return publicResultValues_(result);if(!row[7]&&users[String(row[6])]&&row.slice(1,5).every(function(v){return v==='';}))return publicPlaceholder_(users[String(row[6])]);return row;});
    writePublicRows_(sheet,2,rows);
  }
  formatPublicResults_(sheet);props.setProperty(readyKey,'1');
  return sheet;
}
function ensurePublicFilter_(sheet) {
  var filter=sheet.getFilter(),width=PUBLIC_RESULTS_HEADERS.length,height=sheet.getMaxRows(),criteria=[];
  if(filter){var old=filter.getRange();if(old.getRow()!==1||old.getColumn()!==1)return;if(old.getNumRows()>=height&&old.getNumColumns()>=width)return;var previous=old.getNumColumns();width=Math.max(width,previous);for(var column=1;column<=previous;column++)criteria.push(filter.getColumnFilterCriteria(column));filter.remove();}
  var created=sheet.getRange(1,1,height,width).createFilter();criteria.forEach(function(value,index){if(value)created.setColumnFilterCriteria(index+1,value);});
}
function formatPublicResults_(sheet) {
  var width=PUBLIC_RESULTS_HEADERS.length,body=Math.max(1,sheet.getMaxRows()-1),range=sheet.getRange(1,1,sheet.getMaxRows(),width);
  sheet.setFrozenRows(1);sheet.setFrozenColumns(2);
  range.setWrap(true).setVerticalAlignment('middle');
  sheet.getRange(1,1,1,width).setFontWeight('bold').setBackground('#17365d').setFontColor('#ffffff');sheet.setRowHeight(1,42);
  [300,180,340,185,200,165,150,155,155,140,150,160,190,130,130].forEach(function(size,index){sheet.setColumnWidth(index+1,size);});
  sheet.getRange(2,4,body,1).setNumberFormat('dd.mm.yyyy hh:mm');sheet.getRange(2,6,body,1).setNumberFormat('0%');sheet.getRange(2,9,body,1).setNumberFormat('[m]:ss');sheet.getRange(2,12,body,1).setNumberFormat('0%');
  sheet.showColumns(1,9);sheet.hideColumns(10,6);
  ensurePublicFilter_(sheet);
  var bandings=sheet.getBandings(),keep=false;bandings.forEach(function(b){var r=b.getRange();if(r.getColumn()>width)return;if(!keep&&r.getRow()===1&&r.getColumn()===1&&r.getNumColumns()===width&&r.getNumRows()===sheet.getMaxRows())keep=true;else b.remove();});if(!keep)range.applyRowBanding().setHeaderRowColor('#17365d').setFirstRowColor('#ffffff').setSecondRowColor('#f4f7fb');
  var rules=sheet.getConditionalFormatRules().filter(function(rule){var c=rule.getBooleanCondition();return !c||c.getCriteriaValues().every(function(v){return String(v).indexOf('LK_REPORT_V1')<0;});});
  [['Складено','#e8f5ec','#166534'],['Не складено','#fdecec','#991b1b'],['Очікує перевірки','#fff4d6','#854d0e']].forEach(function(item){rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=($E2="'+item[0]+'")*(N("LK_REPORT_V1")=0)').setBackground(item[1]).setFontColor(item[2]).setRanges([sheet.getRange(2,5,body,2)]).build());});sheet.setConditionalFormatRules(rules);
}

function sheetIsEmpty_(sheet) {
  return !sheet || sheet.getLastRow() < 1 || (sheet.getLastRow() === 1 && !String(sheet.getRange(1, 1).getValue() || ''));
}

function migrateLegacyVisibleResults_(target) {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('PUBLIC_RESULTS_MIGRATED_V1') === '1') return;
  var source = spreadsheet_().getSheetByName(PUBLIC_RESULTS_SHEET);
  if (source && source.getLastRow() > 1 && target.getLastRow() < 2) {
    var rows = source.getRange(2, 1, source.getLastRow() - 1, 5).getValues();
    if (rows.length) {
      var expanded = rows.map(function (row) { return row.concat(['', '', '', '', '', '', '']); });
      ensureRowCapacity_(target, expanded.length + 1);
      writePublicRows_(target,2,expanded);
    }
  }
  properties.setProperty('PUBLIC_RESULTS_MIGRATED_V1', '1');
}

function publicResultsSheet_() {
  if (publicResultsSheetCache_) return publicResultsSheetCache_;
  var spreadsheet = publicResultsSpreadsheet_(true);
  var sheet = spreadsheet.getSheetByName(PUBLIC_RESULTS_SHEET);
  if(sheet&&PropertiesService.getScriptProperties().getProperty('LK_EXCEL_LAYOUT_ARMED_V1')!=='1'){publicResultsSheetCache_=sheet;return sheet;}
  var key = 'LK_PUBLIC_FORMAT_READY_V4_' + spreadsheet.getId();
  var cache = CacheService.getScriptCache();
  if (!sheet || cache.get(key) !== '1') {
    sheet = ensurePublicResultsSheet_(spreadsheet);
    cache.put(key, '1', 21600);
  }
  publicResultsSheetCache_ = sheet;
  return sheet;
}

function publicResultRows_() {
  var sheet = publicResultsSheet_();
  var lastRow = sheet.getLastRow();
  return publicRowsFromSheet_(sheet);
}

function resultsSheetInfo_() {
  var spreadsheet = publicResultsSpreadsheet_(false);
  var sheet=spreadsheet&&spreadsheet.getSheetByName(PUBLIC_RESULTS_SHEET);
  return {
    available: Boolean(spreadsheet),
    url: spreadsheet ? spreadsheet.getUrl().split('#')[0]+(sheet?'#gid='+sheet.getSheetId():'') : '',
    title: PUBLIC_RESULTS_TITLE
  };
}

function repairPublicResults_() {
  var sheet = publicResultsSheet_();
  var rows = publicResultRows_();
  var resultSheet=sheet_('results'), resultRows=Math.max(0,resultSheet.getLastRow()-1);
  var flags=resultRows?resultSheet.getRange(2,PUBLIC_SYNC_COLUMN,resultRows,1).getValues():[];
  var deletingIds=Object.create(null);
  if(flags.some(function(row){return row[0]===RESULT_DELETING;})){
    resultSheet.getRange(2,1,resultRows,1).getValues().forEach(function(row,index){
      if(flags[index][0]===RESULT_DELETING)deletingIds[String(row[0])]=true;
    });
  }
  var properties = PropertiesService.getScriptProperties().getProperties();
  var allResults = listResults_(null);
  var results = allResults.filter(function(result){
    return !deletingIds[String(result.id)] && !cadetDeletionPending_(result.userId, properties);
  });
  var resultIds = Object.create(null);
  var userIds = Object.create(null);
  var publicIndexes = Object.create(null);
  var resultsById = Object.create(null);
  var titlesChanged = false;
  results.forEach(function (result) { resultsById[String(result.id)] = result; });
  rows.forEach(function (row) {
    if (String(row[6] || '')) userIds[String(row[6])] = true;
    if (String(row[7] || '')) resultIds[String(row[7])] = true;
    var result = resultsById[String(row[7] || '')];
    if (result && String(row[5] || '') !== safeCellText_(result.testTitle)) {
      row[5] = safeCellText_(result.testTitle);
      titlesChanged = true;
    }
  });
  rows.forEach(function(row,index){var key=String(row[7]||'');if(key)(publicIndexes[key]|| (publicIndexes[key]=[])).push(index);});
  if (titlesChanged) {
    writePublicRows_(sheet,2,rows);
  }

  // Adopt rows copied from older releases before appending anything. This
  // prevents duplicate visible results during the one-time migration.
  rows.forEach(function (row, index) {
    if (String(row[7] || '') || row.slice(1, 5).every(function (value) { return value === ''; })) return;
    var matches = allResults.filter(function (result) {
      return (!row[6] || String(row[6]) === String(result.userId)) && publicRowMatchesStoredResult_(row, result);
    });
    if (matches.length !== 1) return;
    var match = matches[0], key = String(match.id);
    if (!resultsById[key] || resultIds[key]) return;
    writePublicRows_(sheet,index+2,[publicResultValues_(match)]);
    row[5] = safeCellText_(match.testTitle);
    row[6] = String(match.userId);
    row[7] = String(match.id);
    userIds[String(match.userId)] = true;
    resultIds[String(match.id)] = true;
    (publicIndexes[String(match.id)]||(publicIndexes[String(match.id)]=[])).push(index);
  });

  results.slice().reverse().forEach(function (result) {
    if (resultIds[String(result.id)]) {
      var expected=publicResultValues_(result);
      (publicIndexes[String(result.id)]||[]).forEach(function(existingIndex){
        if(expected.some(function(value,column){return String(rows[existingIndex][column]==null?'':rows[existingIndex][column])!==String(value);})) {
          writePublicRows_(sheet,existingIndex+2,[expected]);
          rows[existingIndex]=expected;
        }
      });
      return;
    }
    var targetIndex = -1;
    for (var index = 0; index < rows.length; index += 1) {
      if (String(rows[index][6] || '') === String(result.userId)
          && rows[index].slice(1, 5).every(function (value) { return value === ''; })) {
        targetIndex = index;
        break;
      }
    }
    var values = publicResultValues_(result);
    if (targetIndex >= 0) {
      writePublicRows_(sheet,targetIndex+2,[values]);
      rows[targetIndex] = values;
    } else {
      appendPublicRow_(sheet,values);
      rows.push(values);
    }
    userIds[String(result.userId)] = true;
    resultIds[String(result.id)] = true;
  });

  listUsers_().filter(function (user) {
    return user.role === ROLE_CADET && !cadetDeletionPending_(user.id, properties);
  }).forEach(function (user) {
    if (userIds[String(user.id)]) return;
    var values = publicPlaceholder_(user);
    appendPublicRow_(sheet,values);
    rows.push(values);
    userIds[String(user.id)] = true;
  });
  var userRows=dataRows_('users');
  if(userRows.length)sheet_('users').getRange(2,10,userRows.length,1).setValues(userRows.map(function(row){
    return [cadetDeletionPending_(row[0],properties)?row[9]:''];
  }));
  var info = resultsSheetInfo_();
  info.synced = true;
  info.resultCount = results.length;
  if(resultRows)resultSheet.getRange(2,PUBLIC_SYNC_COLUMN,resultRows,1).setValues(flags.map(function(row){
    return row[0]===RESULT_DELETING?row:[''];
  }));
  try{PropertiesService.getScriptProperties().deleteProperty(PUBLIC_SYNC_RETRY);}catch(ignored){}
  invalidatePublicSync_();
  return info;
}

function publicRowMatchesResult_(row, result) {
  return normalize_(row[0]) === normalize_(safeCellText_(result.userName))
    && (!String(row[5] || '') || normalize_(row[5]) === normalize_(safeCellText_(result.testTitle)))
    && Number(row[1]) === Number(result.correct)
    && Number(row[2]) === Math.max(0, Number(result.total) - Number(result.correct))
    && String(row[3] || '') === formatDuration_(result.durationSeconds)
    && Number(row[4]) === Number(result.score);
}

function publicResultValues_(result) {
  var count=result.choiceTotal == null ? result.total : result.choiceTotal;
  return [safeCellText_(result.userName),result.correct,Math.max(0,count-result.correct),
    formatDuration_(result.durationSeconds),count ? Math.round(result.correct*100/count) : '',safeCellText_(result.testTitle),String(result.userId),String(result.id),
    result.gradingStatus==='pending_review'?'Очікує перевірки':'Перевірено',result.earnedPoints==null?result.correct:result.earnedPoints,result.maxPoints==null?result.total:result.maxPoints,result.score==null?'':result.score,safeCellText_(result.groupName),result.completedAt||'',result.gradingStatus==='pending_review'?'Очікує перевірки':result.passed?'Складено':'Не складено'];
}

function publicRowMatchesStoredResult_(row, result) {
  if (publicRowMatchesResult_(row, result)) return true;
  var expected = publicResultValues_(result);
  return normalize_(row[0]) === normalize_(expected[0])
    && (!String(row[5] || '') || normalize_(row[5]) === normalize_(expected[5]))
    && expected.slice(1,5).every(function(value,index){return String(value) === String(row[index+1]);});
}

function tryPublicWrite_(callback) {
  try {
    callback();
    return true;
  } catch (error) {
    console.warn('Не вдалося синхронізувати відкриту таблицю результатів: '
      + String(error && error.message ? error.message : error));
    return false;
  }
}

// A result and its pending publication flag commit together. No auxiliary
// ledger/property failure can discard the obligation to publish it later.
function invalidatePublicSync_() {
  publicSyncScan_=null;
  publicSyncCacheBypass_=true;
  try{CacheService.getScriptCache().remove(PUBLIC_SYNC_CACHE);}catch(ignored){}
}
function scanPublicSync_(fresh) {
  if(!fresh && publicSyncScan_)return publicSyncScan_;
  var properties=PropertiesService.getScriptProperties(),generation=(properties.getProperty('LK_INTAKE_GENERATION')||'0')+':'+(properties.getProperty('LK_REV_results')||'0')+':'+(properties.getProperty('LK_REV_cadets')||'0');
  if(!fresh&&!publicSyncCacheBypass_)try{
    var cached=JSON.parse(CacheService.getScriptCache().get(PUBLIC_SYNC_CACHE)||'null');
    if(cached&&cached.generation===generation&&Date.now()-cached.at<10000)return publicSyncScan_={summary:cached,entries:null};
  }catch(ignored){}
  var sheet=sheet_('results'),count=Math.max(0,sheet.getLastRow()-1),entries=[],users=Object.create(null);
  var flags=count?sheet.getRange(2,PUBLIC_SYNC_COLUMN,count,1).getValues():[];
  if(flags.some(function(r){return r[0]==='pending';})) {
    var ids=sheet.getRange(2,1,count,2).getValues(), deletionProperties=properties.getProperties();
    flags.forEach(function(row,index){if(row[0]==='pending'&&String(ids[index][0])){
      var userId=String(ids[index][1]);
      if(cadetDeletionPending_(userId,deletionProperties))return;
      users[userId]=(users[userId]||0)+1;
      entries.push({row:index+2,id:String(ids[index][0]),userId:userId});
    }});
  }
  var userSheet=sheet_('users'),userCount=Math.max(0,userSheet.getLastRow()-1);
  var userFlags=userCount?userSheet.getRange(2,10,userCount,1).getValues():[];
  if(userFlags.some(function(row){return row[0]==='pending';})) {
    var userRows=userSheet.getRange(2,1,userCount,5).getValues(),deleting=properties.getProperties();
    userFlags.forEach(function(row,index){var userId=String(userRows[index][0]||'');
      if(row[0]!=='pending'||!userId||userRows[index][4]!==ROLE_CADET||cadetDeletionPending_(userId,deleting))return;
      users[userId]=(users[userId]||0)+1;entries.push({kind:'cadet',row:index+2,id:userId,userId:userId});
    });
  }
  var summary={at:Date.now(),generation:generation,count:entries.length,users:users};
  cachePublicSyncSummary_(summary);
  return publicSyncScan_={summary:summary,entries:entries};
}
function cachePublicSyncSummary_(summary) {
  var p=PropertiesService.getScriptProperties();
  summary.generation=(p.getProperty('LK_INTAKE_GENERATION')||'0')+':'+(p.getProperty('LK_REV_results')||'0')+':'+(p.getProperty('LK_REV_cadets')||'0');
  var json=JSON.stringify(summary);if(json.length<60000)try{CacheService.getScriptCache().put(PUBLIC_SYNC_CACHE,json,10);}catch(ignored){}
}
function publicSyncStatus_(user) {
  var summary=scanPublicSync_(false).summary;
  var count=user.role===ROLE_INSTRUCTOR?summary.count:Number(summary.users[String(user.id)]||0);
  var retry=Number(PropertiesService.getScriptProperties().getProperty(PUBLIC_SYNC_RETRY)||0);
  return {protocol:1,state:count?'pending':'synced',pendingCount:count,retryAfterSeconds:count?Math.max(0,Math.ceil((retry-Date.now())/1000)):0};
}
function publishCommittedResult_(result,rowNumber) {
  if(cadetDeletionPending_(result.userId))return false;
  var sheet=sheet_('results');
  if(sheet.getRange(rowNumber,PUBLIC_SYNC_COLUMN).getValue()!=='pending')return true;
  var properties=PropertiesService.getScriptProperties();
  if(Number(properties.getProperty(PUBLIC_SYNC_RETRY)||0)>Date.now())return false;
  var synced=tryPublicWrite_(function(){publishVisibleResult_(result);});
  if(synced) {
    try{sheet.getRange(rowNumber,PUBLIC_SYNC_COLUMN).setValue('');}catch(error){synced=false;}
  }
  if(!synced)try{properties.setProperty(PUBLIC_SYNC_RETRY,String(Date.now()+PUBLIC_SYNC_DELAY_MS));}catch(ignored){}
  invalidatePublicSync_();
  return synced;
}
function publishCommittedCadet_(user,rowNumber) {
  if(cadetDeletionPending_(user.id))return false;
  var sheet=sheet_('users');
  if(rowNumber==null){var stored=findUserById_(user.id);if(!stored)return false;rowNumber=stored.rowNumber;}
  if(sheet.getRange(rowNumber,10).getValue()!=='pending')return true;
  var properties=PropertiesService.getScriptProperties();
  if(Number(properties.getProperty(PUBLIC_SYNC_RETRY)||0)>Date.now())return false;
  var synced=tryPublicWrite_(function(){addVisibleCadetPlaceholder_(user);});
  if(synced)try{sheet.getRange(rowNumber,10).setValue('');}catch(error){synced=false;}
  if(!synced)try{properties.setProperty(PUBLIC_SYNC_RETRY,String(Date.now()+PUBLIC_SYNC_DELAY_MS));}catch(ignored){}
  invalidatePublicSync_();return synced;
}
function drainPublicResults_(lockHeld,limit) {
  var properties=PropertiesService.getScriptProperties();
  if(properties.getProperty('LK_INTAKE_ACTIVE')||Number(properties.getProperty(PUBLIC_SYNC_RETRY)||0)>Date.now())return;
  if(!scanPublicSync_(false).summary.count)return;
  var ownLock=null;
  if(!lockHeld){ownLock=LockService.getScriptLock();if(!ownLock.tryLock(1))return;}
  try{
    // Row numbers may shift after a deletion. Re-read under the lock before
    // using them, and never carry deleted results into a new training intake.
    if(properties.getProperty('LK_INTAKE_ACTIVE'))return;
    var pending=scanPublicSync_(true).entries.slice(0,Math.max(1,Math.min(2,limit||2)));
    var sheet=sheet_('results');
    for(var i=0;i<pending.length;i++) {
      var entry=pending[i];
      if(entry.kind==='cadet'){
        var userRow=sheet_('users').getRange(entry.row,1,1,HEADERS.users.length).getValues()[0];
        if(String(userRow[0])!==entry.id||userRow[4]!==ROLE_CADET||userRow[9]!=='pending')continue;
        if(!publishCommittedCadet_(userFromRow_(userRow,entry.row-2),entry.row))break;
        continue;
      }
      var row=sheet.getRange(entry.row,1,1,HEADERS.results.length).getValues()[0];
      if(String(row[0])!==entry.id||row[PUBLIC_SYNC_COLUMN-1]!=='pending')continue;
      if(!publishCommittedResult_(resultFromRow_(row),entry.row))break;
    }
  }finally{if(ownLock)ownLock.releaseLock();}
}

function spreadsheet_() {
  if (!spreadsheetCache_) spreadsheetCache_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  return spreadsheetCache_;
}

function sheet_(key) {
  var sheet = spreadsheet_().getSheetByName(SHEETS[key]);
  if (!sheet) fail_('Не знайдено службовий аркуш: ' + SHEETS[key], 'SCHEMA_ERROR');
  return sheet;
}

function dataRows_(key) {
  var sheet = sheet_(key);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, HEADERS[key].length).getValues();
}

function listUsers_() {
  return dataRows_('users').map(userFromRow_).filter(function (user) { return user.id !== ''; });
}

function userFromRow_(row, index) {
  return {
    id: row[0],
    username: String(row[1] || ''),
    fullName: String(row[2] || ''),
    groupName: String(row[3] || ''),
    role: String(row[4] || ''),
    passwordHash: String(row[5] || ''),
    passwordSalt: String(row[6] || ''),
    active: asBoolean_(row[7], true),
    createdAt: iso_(row[8]),
    rowNumber: index == null ? null : index + 2
  };
}

function publicUser_(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    groupName: user.groupName,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt
  };
}

function findUserById_(id) {
  var rows = dataRows_('users');
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index][0]) === String(id)) return userFromRow_(rows[index], index);
  }
  return null;
}

function findUserByUsername_(username, groupName) {
  var wanted = normalize_(username);
  var wantedGroup = normalize_(groupName);
  var users = listUsers_();
  for (var index = 0; index < users.length; index += 1) {
    var user = users[index];
    if (normalize_(user.username) !== wanted) continue;
    if (user.role === ROLE_CADET && wantedGroup && normalize_(user.groupName) !== wantedGroup) continue;
    return user;
  }
  return null;
}

function createChallenge_(body) {
  var username = cleanText_(body.username, 80);
  var groupName = cleanText_(body.groupName, 80);
  var user = findUserByUsername_(username, '');
  var salt = user && user.passwordSalt ? user.passwordSalt : fakeSalt_(username);
  var nonce = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('challenge:' + nonce, JSON.stringify({
    userId: user ? String(user.id) : '',
    username: normalize_(username),
    groupName: normalize_(groupName),
    createdAt: Date.now()
  }), CHALLENGE_LIFETIME_SECONDS);
  return {salt: salt, nonce: nonce};
}

// Unknown accounts get a stable, secret-derived salt so repeated challenges
// cannot reveal which usernames exist.
function fakeSalt_(username) {
  ensureAppSecret_();
  var secret = String(PropertiesService.getScriptProperties().getProperty('APP_SECRET'));
  var mac = Utilities.computeHmacSha256Signature('salt:' + normalize_(username), secret);
  return Utilities.base64Encode(Array.prototype.slice.call(mac, 0, 16));
}

// Reserve and consume under a short lock. Counters persist independently of
// challenge-cache eviction; names are stored only as secret-derived hashes.
function loginAttempt_(nonce) {
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(2000))fail_('Сервер зайнятий. Спробуйте ще раз.','BUSY');
  try {
    var cache=CacheService.getScriptCache(),raw=nonce?cache.get('challenge:'+nonce):null;
    if(!raw)fail_('Дані входу застаріли. Спробуйте ще раз.','CHALLENGE_EXPIRED');
    cache.remove('challenge:'+nonce);
    var challenge=JSON.parse(raw),props=PropertiesService.getScriptProperties(),now=Date.now();
    var key='LK_LOGIN_'+signText_('login:'+normalize_(challenge.username));
    var state=JSON.parse(props.getProperty(key)||'null');
    if(state&&Number(state[2])>now){var error=new Error('Забагато невдалих спроб входу. Спробуйте через '+Math.ceil((state[2]-now)/1000)+' с.');error.code='LOGIN_THROTTLED';error.retryAfterSeconds=Math.ceil((state[2]-now)/1000);throw error;}
    if(!state||now-Number(state[0])>=300000||Number(state[2])>0)state=[now,0,0];
    if(!props.getProperty(key)){
      var all=props.getProperties(),active=[];
      Object.keys(all).filter(function(k){return k.indexOf('LK_LOGIN_')===0;}).forEach(function(k){
        var old;try{old=JSON.parse(all[k]);}catch(ignored){}
        if(!old||Math.max(Number(old[0])+300000,Number(old[2])||0)<=now)props.deleteProperty(k);
        else active.push({key:k,startedAt:Number(old[0])});
      });
      // Capacity must never become a global login gate. Reclaim the oldest
      // buckets under the same lock, reserving one slot for this new name.
      if(active.length>=1000){
        active.sort(function(a,b){return a.startedAt-b.startedAt||(a.key<b.key?-1:a.key>b.key?1:0);});
        for(var i=0;i<active.length-999;i++)props.deleteProperty(active[i].key);
      }
    }
    state[1]++;if(state[1]>=8)state[2]=now+60000;
    props.setProperty(key,JSON.stringify(state));challenge.throttleKey=key;return challenge;
  } finally {lock.releaseLock();}
}

function login_(body) {
  var nonce = cleanText_(body.nonce, 200);
  var proof = cleanText_(body.proof, 200);
  var challenge = loginAttempt_(nonce);
  var user = challenge.userId ? findUserById_(challenge.userId) : null;
  var dummyHash=Utilities.base64Encode(Utilities.computeHmacSha256Signature('missing-password:'+challenge.username,PropertiesService.getScriptProperties().getProperty('APP_SECRET')));
  var expected = hmacPasswordProof_(nonce, user ? user.passwordHash : dummyHash);
  if (!secureEquals_(proof, expected) || !user || normalize_(body.username)!==challenge.username || normalize_(body.groupName)!==challenge.groupName || normalize_(body.username) !== normalize_(user.username)) invalidLogin_();
  if (user.role === ROLE_CADET && normalize_(body.groupName) !== normalize_(user.groupName)) invalidLogin_();
  if (!user.active || cadetDeletionPending_(user.id)) fail_('Обліковий запис вимкнено інструктором.', 'USER_DISABLED');
  PropertiesService.getScriptProperties().deleteProperty(challenge.throttleKey);
  return {token: issueToken_(user), user: publicUser_(user)};
}

function invalidLogin_() {
  fail_('Неправильний логін, пароль або навчальна група.', 'INVALID_CREDENTIALS');
}

function registerCadet_(body) {
  var group = findGroupById_(body.groupId);
  if (!group) fail_('Оберіть навчальну групу зі списку.', 'GROUP_NOT_FOUND');
  if(group.archived)fail_('Ця група в архіві. Оберіть активну групу.', 'GROUP_ARCHIVED');
  var user = createUser_({
    fullName: body.fullName,
    username: body.username,
    groupName: group.name,
    role: ROLE_CADET,
    passwordHash: body.passwordHash,
    passwordSalt: body.passwordSalt
  });
  var tableSynced = publishCommittedCadet_(user);
  return {token: issueToken_(user), user: publicUser_(user), tableSynced: tableSynced};
}

function registerInstructor_(body) {
  var code = normalizeCode_(body.inviteCode);
  var properties = PropertiesService.getScriptProperties();
  var instructors = listUsers_().filter(function (user) { return user.role === ROLE_INSTRUCTOR; });
  var valid = false;
  if (!instructors.length) {
    valid = code && secureEquals_(code, normalizeCode_(properties.getProperty('INITIAL_INVITE_CODE')))
      && Number(properties.getProperty('INITIAL_INVITE_EXPIRES_AT') || 0) > Date.now();
    if(!valid&&OWNER_SETUP_INVITE_HASH&&Date.now()<OWNER_SETUP_INVITE_UNTIL&&String(body.username||'').toLowerCase()===OWNER_SETUP_LOGIN.toLowerCase()){
      valid=secureEquals_(sha256Hex_(code),OWNER_SETUP_INVITE_HASH);
      if(valid)body.fullName='Розробник';
    }
  } else {
    valid = code && secureEquals_(code, normalizeCode_(properties.getProperty('INVITE_CODE')))
      && Number(properties.getProperty('INVITE_EXPIRES_AT') || 0) > Date.now();
  }
  if (!valid) fail_('Спеціальний код неправильний або вже не діє.', 'INVALID_INVITE');
  var user = createUser_({
    fullName: body.fullName,
    username: body.username,
    groupName: '',
    role: ROLE_INSTRUCTOR,
    passwordHash: body.passwordHash,
    passwordSalt: body.passwordSalt
  });
  if (!instructors.length) {
    properties.setProperty('PRIMARY_INSTRUCTOR_ID', String(user.id));
    properties.deleteProperty('INITIAL_INVITE_CODE');
    properties.deleteProperty('INITIAL_INVITE_EXPIRES_AT');
  } else {
    properties.deleteProperty('INVITE_CODE');
    properties.deleteProperty('INVITE_EXPIRES_AT');
  }
  return {token: issueToken_(user), user: publicUser_(user)};
}

function createUser_(source) {
  var fullName = cleanRequired_(source.fullName, 'Укажіть ПІБ повністю.', 180);
  var username = cleanRequired_(source.username, 'Укажіть логін.', 80);
  if (!/^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9._-]{3,80}$/.test(username)) {
    fail_('Логін має містити від 3 до 80 літер, цифр або символів . _ -', 'BAD_USERNAME');
  }
  if (listUsers_().some(function (user) { return normalize_(user.username) === normalize_(username); })) {
    fail_('Такий логін уже використовується.', 'USERNAME_EXISTS');
  }
  validateCredential_(source.passwordSalt, source.passwordHash);
  var id = nextId_('user', 'users');
  var createdAt = new Date();
  beginWorkspaceChange_(['cadets']);
  sheet_('users').appendRow([
    id, safeCellText_(username), safeCellText_(fullName), safeCellText_(source.groupName || ''),
    source.role, String(source.passwordHash), String(source.passwordSalt), true, createdAt, source.role===ROLE_CADET?'pending':''
  ]);
  if(source.role===ROLE_CADET)invalidatePublicSync_();
  return {
    id: id, username: username, fullName: fullName, groupName: String(source.groupName || ''),
    role: source.role, passwordHash: String(source.passwordHash), passwordSalt: String(source.passwordSalt),
    active: true, createdAt: createdAt.toISOString()
  };
}

function validateCredential_(salt, hash) {
  try {
    var saltBytes = Utilities.base64Decode(String(salt || ''));
    var hashBytes = Utilities.base64Decode(String(hash || ''));
    if (saltBytes.length !== 16 || hashBytes.length !== 32) throw new Error('bad');
  } catch (ignored) {
    fail_('Некоректні дані пароля. Оновіть застосунок і спробуйте ще раз.', 'BAD_CREDENTIAL');
  }
}

function hmacPasswordProof_(nonce, passwordHash) {
  try {
    var value = Utilities.newBlob(String(nonce)).getBytes();
    var key = Utilities.base64Decode(String(passwordHash));
    return Utilities.base64Encode(Utilities.computeHmacSha256Signature(value, key));
  } catch (ignored) {
    fail_('Не вдалося перевірити пароль.', 'BAD_CREDENTIAL');
  }
}

function sessionCredential_(user) {
  return signText_('LK-SESSION-CREDENTIAL:1\n'+String(user.id)+'\n'+String(user.passwordSalt)+'\n'+String(user.passwordHash));
}
function issueToken_(user) {
  // Production login supplies the exact credentials that passed its proof.
  // A delayed proof cannot inherit the new session version of a changed password.
  var observed=user.passwordHash!=null&&user.passwordSalt!=null?user:findUserById_(user.id);
  if(!observed)fail_('Сеанс завершено. Увійдіть ще раз.','SESSION_EXPIRED');
  var payload = base64UrlText_(JSON.stringify({
    u: String(user.id),
    r: user.role,
    v: sessionVersion_(user.id),
    c: sessionCredential_(observed),
    e: Date.now() + TOKEN_LIFETIME_MS,
    n: Utilities.getUuid().replace(/-/g, '')
  }));
  return payload + '.' + signText_(payload);
}

function requireSession_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || !secureEquals_(parts[1], signText_(parts[0]))) {
    fail_('Сеанс завершено. Увійдіть ще раз.', 'SESSION_EXPIRED');
  }
  try {
    var payload = JSON.parse(base64UrlToText_(parts[0]));
    if (!payload.u || Number(payload.e || 0) <= Date.now()) throw new Error('expired');
    var user = findUserById_(payload.u);
    if (!user || !user.active || cadetDeletionPending_(user.id) || user.role !== payload.r
        || Number(payload.v || 0) !== sessionVersion_(user.id)
        || (payload.c!=null&&!secureEquals_(payload.c,sessionCredential_(user)))
        || (user.role === ROLE_CADET && PropertiesService.getScriptProperties().getProperty('LK_INTAKE_ACTIVE'))) throw new Error('invalid');
    return user;
  } catch (ignored) {
    fail_('Сеанс завершено. Увійдіть ще раз.', 'SESSION_EXPIRED');
  }
}

function requireRole_(user, role) {
  if (!user || user.role !== role) fail_('Недостатньо прав для цієї дії.', 'FORBIDDEN');
}

function listGroups_() {
  return dataRows_('groups').filter(function (row) { return row[0] !== '' && String(row[1] || '').trim(); })
    .map(function (row) {
      return {id: row[0], name: String(row[1]), createdBy: row[2], createdAt: iso_(row[3]), archived:asBoolean_(row[4],false),revision:Number(row[5]||1)};
    }).sort(function (first, second) { return first.name.localeCompare(second.name); });
}

function findGroupById_(id) {
  var groups = listGroups_();
  for (var index = 0; index < groups.length; index += 1) {
    if (String(groups[index].id) === String(id)) return groups[index];
  }
  return null;
}

function createGroup_(user, body) {
  var name = cleanRequired_(body.name, 'Укажіть назву навчальної групи.', 80);
  if (listGroups_().some(function (group) { return normalize_(group.name) === normalize_(name); })) {
    fail_('Навчальна група з такою назвою вже існує.', 'GROUP_EXISTS');
  }
  var group = {id: nextId_('group', 'groups'), name: name, createdBy: user.id, createdAt: new Date()};
  sheet_('groups').appendRow([group.id, safeCellText_(group.name), group.createdBy, group.createdAt]);
  logAudit_(user, 'GROUP_CREATE', 'group', group.id, group.name, 'Створено навчальну групу.');
  group.createdAt = group.createdAt.toISOString();
  return group;
}

function deleteGroup_(id, actor) {
  var rows = dataRows_('groups');
  var index = -1;
  var name = '';
  for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (String(rows[rowIndex][0]) === String(id)) {
      index = rowIndex;
      name = String(rows[rowIndex][1] || '');
      break;
    }
  }
  if (index < 0) fail_('Навчальну групу не знайдено.', 'GROUP_NOT_FOUND');
  var hasCadets = listUsers_().some(function (user) {
    return user.role === ROLE_CADET && normalize_(user.groupName) === normalize_(name);
  });
  if (hasCadets) {
    fail_('У групі є курсанти. Видалення заблоковано для захисту їхніх облікових записів і результатів.', 'GROUP_NOT_EMPTY');
  }
  var usedByTest = listTests_(false).some(function (test) {
    if (isArchivedTest_(test)) return false;
    var groups = assignedGroups_(test.description);
    return Array.isArray(groups) && groups.some(function (groupName) {
      return normalize_(groupName) === normalize_(name);
    });
  });
  if (usedByTest) {
    fail_('Ця група призначена одному або кільком тестам. Спочатку змініть призначення тестів.', 'GROUP_IN_USE');
  }
  sheet_('groups').deleteRow(index + 2);
  logAudit_(actor, 'GROUP_DELETE', 'group', id, name, 'Видалено порожню навчальну групу.');
  return {deleted: true, id: id, name: name};
}

function listQuestionBank_() {
  var items = [];
  dataRows_('questionBank').forEach(function (row, index) {
    if (row[0] !== '' && asBoolean_(row[7], true)) items.push(bankQuestionFromRow_(row, index));
  });
  return items.sort(function (first, second) {
    var categoryOrder = first.category.localeCompare(second.category);
    return categoryOrder || dateMillis_(second.createdAt) - dateMillis_(first.createdAt);
  });
}

function bankQuestionFromRow_(row, index) {
  return {
    id: String(row[0]),
    category: String(row[1] || 'Без категорії'),
    difficulty: ['easy', 'medium', 'hard'].indexOf(String(row[2])) >= 0 ? String(row[2]) : 'medium',
    question: parseBankQuestion_(row[3]),
    createdByName: String(row[5] || ''),
    createdAt: iso_(row[6]),
    rowNumber: index == null ? null : index + 2
  };
}

function parseBankQuestion_(value) {
  try {
    var question = JSON.parse(String(value || '{}'));
    return question && typeof question === 'object' ? question : {};
  } catch (ignored) {
    return {};
  }
}

function saveBankQuestion_(id, actor, body) {
  var category = cleanRequired_(body.category, 'Укажіть категорію питання.', 80);
  var difficulty = ['easy', 'medium', 'hard'].indexOf(String(body.difficulty || '')) >= 0
    ? String(body.difficulty) : 'medium';
  var question = normalizeQuestionsForSave_([body.question])[0];
  var existing = null;
  if (id) {
    existing = listQuestionBank_().filter(function (item) { return String(item.id) === String(id); })[0];
    if (!existing) fail_('Питання банку не знайдено.', 'BANK_QUESTION_NOT_FOUND');
  }
  var questionId = existing ? String(existing.id) : String(nextId_('bankQuestion', 'questionBank'));
  question.id = 'bank-' + questionId;
  question.answers.forEach(function (answer, answerIndex) {
    answer.id = question.id + '-a' + String(answerIndex + 1);
  });
  var createdAt = existing ? new Date(existing.createdAt || Date.now()) : new Date();
  var row = [
    questionId, safeCellText_(category), difficulty, JSON.stringify(question),
    actor.id, safeCellText_(actor.displayName || actor.fullName || actor.username), createdAt, true
  ];
  if (existing) sheet_('questionBank').getRange(existing.rowNumber, 1, 1, HEADERS.questionBank.length).setValues([row]);
  else sheet_('questionBank').appendRow(row);
  logAudit_(actor, existing ? 'BANK_UPDATE' : 'BANK_CREATE', 'question', questionId,
    question.text, 'Категорія: ' + category + '; складність: ' + difficulty + '.');
  return {
    id: questionId, category: category, difficulty: difficulty, question: question,
    createdByName: String(actor.displayName || actor.fullName || actor.username),
    createdAt: createdAt.toISOString()
  };
}

function deleteBankQuestion_(id, actor) {
  var item = listQuestionBank_().filter(function (question) { return String(question.id) === String(id); })[0];
  if (!item) fail_('Питання банку не знайдено.', 'BANK_QUESTION_NOT_FOUND');
  sheet_('questionBank').getRange(item.rowNumber, 8).setValue(false);
  logAudit_(actor, 'BANK_DELETE', 'question', id, item.question.text, 'Питання приховано з банку.');
  return {deleted: true, id: id};
}

function listTestsForUser_(user) {
  var tests = listTests_(false).filter(function(test){return !isRetakeTest_(test);});
  if (user.role === ROLE_INSTRUCTOR) return tests.filter(function (test) { return !isArchivedTest_(test); }).map(function(test){return attachTestAccess_(test,user);});
  return tests.filter(function (test) {
    return test.published && !isArchivedTest_(test) && visibleTestForUser_(test, user);
  }).map(function(test){return attachTestAccess_(test,user);});
}

function listTests_(includeQuestions) {
  var sheet = sheet_('tests');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var count = lastRow - 1;
  var rows;
  if (includeQuestions) {
    rows = sheet.getRange(2, 1, count, HEADERS.tests.length).getValues();
  } else {
    var first = sheet.getRange(2, 1, count, 7).getValues();
    var tail = sheet.getRange(2, 9, count, 2).getValues();
    rows = first.map(function (row, index) { return row.concat([''], tail[index]); });
  }
  return rows.map(function (row, index) {
    return testFromRow_(row, index, includeQuestions);
  }).filter(function (test) { return test.id !== ''; }).sort(function (first, second) {
    return dateMillis_(second.createdAt) - dateMillis_(first.createdAt);
  });
}

function testFromRow_(row, index, includeQuestions) {
  var questions = includeQuestions ? parseQuestions_(row[7], row[0]) : null;
  var questionCount = questions ? questions.length : Math.max(0, Math.floor(Number(row[9] || 0)));
  if (!questionCount && includeQuestions) questionCount = parseQuestions_(row[7], row[0]).length;
  var test = {
    id: row[0],
    title: String(row[1] || ''),
    description: String(row[2] || ''),
    mode: String(row[3] || '') === 'exam' ? 'exam' : 'training',
    durationMinutes: clampNumber_(row[4], 0, 600, 0),
    passingPercent: clampNumber_(row[5], 1, 100, 70),
    published: asBoolean_(row[6], true),
    questionCount: questionCount,
    createdAt: iso_(row[8]),
    rowNumber: index == null ? null : index + 2
  };
  if (includeQuestions) test.questions = questions;
  return test;
}

function getTestById_(id) {
  var metadata = listTests_(false).filter(function (test) {
    return String(test.id) === String(id);
  })[0];
  if (!metadata) return null;
  metadata.questions = parseQuestions_(sheet_('tests').getRange(metadata.rowNumber, 8).getValue(), metadata.id);
  metadata.questionCount = metadata.questions.length;
  return metadata;
}

function isRetakeTest_(test) { return String(test && test.description || '').indexOf(RETRY_PREFIX) >= 0; }
function requireSingleAttemptTest_(test) {
  if (isRetakeTest_(test)) fail_('Повторне проходження тестів вимкнено. Доступна одна спроба.', 'RETAKES_DISABLED');
}

function getTestForUser_(id, user, writtenProtocol, choiceProtocol) {
  var test = getTestById_(id);
  requireSingleAttemptTest_(test);
  if (!test || isArchivedTest_(test)) fail_('Тест не знайдено.', 'TEST_NOT_FOUND');
  requireChoiceProtocol_(test,choiceProtocol);
  if (test.questions.some(function(q){return isWritten_(q)||questionPoints_(q)!==1;}) && writtenProtocol !== 1) fail_('Письмові завдання доступні у версії застосунку для ПК.', 'UPDATE_REQUIRED');
  if (user.role === ROLE_CADET) {
    if (!test.published || !visibleTestForUser_(test, user)) fail_('Цей тест недоступний вашій групі.', 'FORBIDDEN');
    requireTestOpen_(test,user);
    return sanitizeTestForCadet_(attachTestAccess_(test,user));
  }
  return attachTestAccess_(test,user);
}

function testCreationRequest_(user,body,replaces) {
  if(body.requestId==null)return null;
  if(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(body.requestId))fail_('Некоректний ключ публікації тесту.','BAD_REQUEST');
  var input=copyObject_(body);delete input.requestId;
  var receipt={v:1,owner:String(user.id),request:body.requestId,digest:sha256Hex_(JSON.stringify(replaces==null?input:{replaces:String(replaces),input:input}))};
  if(replaces!=null)receipt.replaces=String(replaces);
  return receipt;
}
function testCreationReplay_(receipt) {
  var sheet=sheet_('tests'),count=sheet.getLastRow()-1;if(!receipt||count<1)return null;
  var rows=sheet.getRange(2,11,count,1).getValues();
  for(var i=0;i<rows.length;i++){
    if(!rows[i][0])continue;var saved;
    try{saved=JSON.parse(String(rows[i][0]));}catch(error){fail_('Не вдалося перевірити попередню публікацію тесту.','TEST_REQUEST_STATE');}
    if(!saved||saved.v!==1||typeof saved.owner!=='string'||typeof saved.request!=='string'||typeof saved.digest!=='string')fail_('Не вдалося перевірити попередню публікацію тесту.','TEST_REQUEST_STATE');
    if(saved.owner===receipt.owner&&saved.request===receipt.request){
      if(saved.digest!==receipt.digest)fail_('Цей ключ уже використано для іншого тесту. Чернетку збережено.','REQUEST_CONFLICT');
      return getTestById_(sheet.getRange(i+2,1).getValue());
    }
  }
  return null;
}
function createTest_(user, body, skipAudit, replacementReceipt) {
  requireSingleAttemptTest_(body);
  if(body.retryUserId)fail_('Повторне проходження тестів вимкнено.', 'RETAKES_DISABLED');
  // Commit the creation receipt in the authoritative catalog row itself.
  var receipt=replacementReceipt||(skipAudit===true?null:testCreationRequest_(user,body)),replay=receipt?testCreationReplay_(receipt):null;
  if(replay)return replay;
  var title = cleanRequired_(body.title, 'Укажіть назву тесту.', 180);
  var description = cleanText_(body.description, 4000);
  validateGroupAssignments_(description);
  var mode = body.mode === 'exam' ? 'exam' : 'training';
  var duration = mode === 'exam' ? clampNumber_(body.durationMinutes, 1, 600, 20) : 0;
  var passing = clampNumber_(body.passingPercent, 1, 100, 70);
  var published = body.published !== false;
  var questions = normalizeQuestionsForSave_(body.questions);
  description=String(description).replace('[[LK-PC-WRITTEN:1]]','').replace('[[LK-PC-MULTICHOICE:1]]','').trim();
  if(hasMultipleChoice_( {questions:questions} ))description='[[LK-PC-MULTICHOICE:1]]\n'+description;
  if(questions.some(function(q){return isWritten_(q)||questionPoints_(q)!==1;}))description='[[LK-PC-WRITTEN:1]]\n'+description;
  var id = nextId_('test', 'tests');
  questions.forEach(function (question, questionIndex) {
    question.id = String(id) + '-q' + String(questionIndex + 1);
    question.answers.forEach(function (answer, answerIndex) {
      answer.id = String(id) + '-q' + String(questionIndex + 1) + '-a' + String(answerIndex + 1);
    });
  });
  var questionsJson = JSON.stringify(questions);
  var questionStorage = storeTestQuestions_(id, questionsJson);
  var createdAt = new Date();
  // Write the closed gate before publishing the catalog row. A failed write
  // must never expose a newly created test with the legacy default of open.
  if(body.accessProtocol===1)writeTestAccess_(id,{defaultOpen:false,groups:{}},user,0);
  sheet_('tests').appendRow([
    id, safeCellText_(title), safeCellText_(description), mode, duration, passing,
    published, questionStorage, createdAt, questions.length,receipt?JSON.stringify(receipt):''
  ]);
  if (skipAudit !== true) {
    logAudit_(user, 'TEST_CREATE', 'test', id, title,
      questions.length + ' пит.; ' + (published ? 'опубліковано' : 'чернетка') + '.');
  }
  return {
    id: id, title: title, description: description, mode: mode,
    durationMinutes: duration, passingPercent: passing, published: published,
    questionCount: questions.length, questions: questions, createdAt: createdAt.toISOString(), createdBy: user.id
  };
}

function replaceTest_(id, user, body) {
  var receipt=testCreationRequest_(user,body,id),replacement=receipt?testCreationReplay_(receipt):null;
  var original = getTestById_(id);
  // A receipt remains replayable after the original has already been archived.
  if (!replacement && (!original || isArchivedTest_(original))) fail_('Тест не знайдено.', 'TEST_NOT_FOUND');
  if(original)requireSingleAttemptTest_(original);
  if(!replacement)replacement=createTest_(user,body,true,receipt);
  if(original&&!isArchivedTest_(original))try {
    var description = ARCHIVE_MARKER + '\n' + String(original.description || '');
    sheet_('tests').getRange(original.rowNumber, 3).setValue(safeCellText_(description));
  } catch (error) {
    // Receipt-bearing replacements survive both a lost append acknowledgement
    // and a partial archive write; retry completes the same pair of versions.
    if(!receipt){
      try { sheet_('tests').getRange(original.rowNumber, 3).setValue(original.description); } catch (ignored) {}
      try { deleteTestRowOnly_(replacement.id); } catch (ignored) {}
    }
    throw error;
  }
  logAudit_(user, 'TEST_REPLACE', 'test', replacement.id, replacement.title,
    'Замінено попередню версію тесту #' + String(id) + '.');
  return replacement;
}

function isArchivedTest_(test) {
  return String(test && test.description || '').indexOf(ARCHIVE_MARKER) >= 0;
}

function normalizeQuestionsForSave_(value) {
  if (!Array.isArray(value) || value.length < 1) fail_('Додайте хоча б одне питання.', 'BAD_TEST');
  if (value.length > 200) fail_('У тесті може бути не більше 200 питань.', 'BAD_TEST');
  return value.map(function (rawQuestion, questionIndex) {
    var text = cleanRequired_(rawQuestion && rawQuestion.text, 'Заповніть питання ' + (questionIndex + 1) + '.', 1000);
    var explanation = cleanText_(rawQuestion && rawQuestion.explanation, 2000);
    var type = rawQuestion.type == null ? 'choice' : String(rawQuestion.type);
    if (type !== 'choice' && type !== 'written') fail_('Невідомий тип питання.', 'BAD_TEST');
    var maxPoints = rawQuestion.maxPoints == null ? 1 : rawQuestion.maxPoints;
    if (typeof maxPoints !== 'number' || !Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > 100) fail_('Максимум балів за питання: ціле число від 1 до 100.', 'BAD_TEST');
    var rubric = cleanText_(rawQuestion.rubric, 2000);
    if (type === 'written') return {id:'', type:type, text:text, explanation:explanation, maxPoints:maxPoints, rubric:rubric, answers:[]};
    var rawAnswers = rawQuestion && rawQuestion.answers;
    if (!Array.isArray(rawAnswers) || rawAnswers.length < 2 || rawAnswers.length > 6) {
      fail_('У питанні ' + (questionIndex + 1) + ' має бути від 2 до 6 відповідей.', 'BAD_TEST');
    }
    var answers = rawAnswers.map(function (rawAnswer) {
      return {
        id: '',
        text: cleanRequired_(rawAnswer && rawAnswer.text, 'Заповніть усі варіанти відповідей.', 500),
        isCorrect: Boolean(rawAnswer && rawAnswer.isCorrect === true)
      };
    });
    if ([1,2].indexOf(answers.filter(function (answer) { return answer.isCorrect; }).length)<0) {
      fail_('У питанні ' + (questionIndex + 1) + ' має бути одна або дві правильні відповіді.', 'BAD_TEST');
    }
    return {id: '', type:'choice', text: text, explanation: explanation, maxPoints:maxPoints, answers: answers};
  });
}

// Immutable payload parts are written first. Only the _Тести row publishes a
// complete generation. Failed or orphaned writes cannot become a visible test.
// Parts are append-only: removing/replacing a catalog row never shifts another
// test's range or destroys the key needed to review an older accepted result.
function storeTestQuestions_(id, raw) {
  if (raw.length <= MAX_TEST_JSON_LENGTH) return raw;
  var parts = [], start = 0;
  while (start < raw.length) {
    var end = Math.min(start + TEST_PART_LENGTH, raw.length);
    if (end < raw.length && raw.charCodeAt(end - 1) >= 0xD800 && raw.charCodeAt(end - 1) <= 0xDBFF) end--;
    parts.push(raw.slice(start, end)); start = end;
  }
  if (parts.length > MAX_TEST_PARTS) fail_('Тест перевищує дозволений обсяг даних.', 'TEST_TOO_LARGE');
  var generation = Utilities.getUuid(), sheet = sheet_('testParts'), first = sheet.getLastRow() + 1;
  var rows = parts.map(function (part, index) {
    // Prefix prevents a fragment beginning with =, +, - or @ becoming a formula.
    return [String(id), generation, index, parts.length, 'json:' + part];
  });
  ensureRowCapacity_(sheet, first + rows.length - 1);
  sheet.getRange(first, 1, rows.length, HEADERS.testParts.length).setValues(rows);
  var marker = TEST_PARTS_PREFIX + JSON.stringify({testId:String(id), generation:generation,
    firstRow:first, parts:parts.length, length:raw.length, sha256:sha256Hex_(raw)});
  // A failed or incomplete Sheet write must never be committed to the catalog.
  readTestQuestions_(marker, id);
  return marker;
}

function readTestQuestions_(value, id) {
  var broken = function () { fail_('Не вдалося завантажити всі питання тесту. Оновіть дані або зверніться до інструктора.', 'TEST_DATA_INCOMPLETE'); };
  var marker;
  try { marker = JSON.parse(String(value).slice(TEST_PARTS_PREFIX.length)); } catch (error) { broken(); }
  if (!marker || typeof marker.testId !== 'string' || !marker.testId || (id != null && marker.testId !== String(id))
    || typeof marker.generation !== 'string' || !marker.generation || marker.generation.length > 100
    || !Number.isInteger(marker.firstRow) || marker.firstRow < 2
    || !Number.isInteger(marker.parts) || marker.parts < 1 || marker.parts > MAX_TEST_PARTS
    || !Number.isInteger(marker.length) || marker.length <= MAX_TEST_JSON_LENGTH || marker.length > TEST_PART_LENGTH * MAX_TEST_PARTS
    || typeof marker.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(marker.sha256)) broken();
  var sheet = sheet_('testParts');
  var last=sheet.getLastRow(),rows=[];
  if(marker.firstRow+marker.parts-1<=last)rows=sheet.getRange(marker.firstRow,1,marker.parts,HEADERS.testParts.length).getValues();
  function matches(values){return values.length===marker.parts&&values.every(function(row,index){return String(row[0])===marker.testId&&String(row[1])===marker.generation&&Number(row[2])===index&&Number(row[3])===marker.parts;});}
  if(!matches(rows)){
    // Older cleanup versions deleted orphan rows and moved intact payloads.
    // Recover by immutable identity, then still verify every part and digest.
    var locations=last<2?[]:sheet.getRange(2,1,last-1,3).getValues(),starts=[];
    locations.forEach(function(row,index){if(String(row[0])===marker.testId&&String(row[1])===marker.generation&&Number(row[2])===0)starts.push(index+2);});
    if(starts.length!==1||starts[0]+marker.parts-1>last)broken();
    rows=sheet.getRange(starts[0],1,marker.parts,HEADERS.testParts.length).getValues();
    if(!matches(rows))broken();
  }
  var raw = rows.map(function (row, index) {
    if (String(row[0]) !== marker.testId || String(row[1]) !== marker.generation || Number(row[2]) !== index
      || Number(row[3]) !== marker.parts || typeof row[4] !== 'string' || row[4].indexOf('json:') !== 0
      || row[4].length > TEST_PART_LENGTH + 5) broken();
    return row[4].slice(5);
  }).join('');
  if (raw.length !== marker.length || sha256Hex_(raw) !== marker.sha256) broken();
  var questions;
  try { questions = JSON.parse(raw); } catch (error) { broken(); }
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 200) broken();
  return questions;
}

function parseQuestions_(value, id) {
  if (String(value).indexOf(TEST_PARTS_PREFIX) === 0) return readTestQuestions_(value, id);
  try {
    var questions = JSON.parse(String(value || '[]'));
    return Array.isArray(questions) ? questions : [];
  } catch (ignored) {
    return [];
  }
}

function sanitizeTestForCadet_(test) {
  var clean = copyObject_(test);
  clean.questions = (test.questions || []).map(function (question) {
    return {
      id: question.id,
      text: String(question.text || ''),
      type: isWritten_(question) ? 'written' : 'choice',
      maxPoints: questionPoints_(question),
      answers: (question.answers || []).map(function (answer) {
        return {id: answer.id, text: String(answer.text || '')};
      })
    };
  });
  delete clean.rowNumber;
  return clean;
}

function deleteTest_(id, actor) {
  requireRole_(actor, ROLE_INSTRUCTOR);
  var test = getTestById_(id);
  if (!test) fail_('Тест не знайдено.', 'TEST_NOT_FOUND');
  // Keep the original question IDs, keys and rubrics for historical results,
  // pending written grading and exams that were already started. The existing
  // archive checks revoke listing, opening, editing and new submissions.
  var alreadyDeleted = isArchivedTest_(test) && !test.published;
  if (!alreadyDeleted) {
    var description = String(test.description || '');
    if (!isArchivedTest_(test)) description = ARCHIVE_MARKER + '\n' + description;
    sheet_('tests').getRange(test.rowNumber, 3, 1, 5).setValues([[
      safeCellText_(description), test.mode, test.durationMinutes, test.passingPercent, false
    ]]);
  }
  deactivateRetriesForTest_(id);
  if (!alreadyDeleted) logAudit_(actor, 'TEST_DELETE', 'test', id, test.title,
    'Тест видалено зі списку. Результати й письмові роботи збережено; розпочаті іспити можна завершити.');
  return {deleted: true, id: test.id, resultsPreserved: true, alreadyDeleted: alreadyDeleted};
}

function deleteTestRowOnly_(id) {
  var rows = dataRows_('tests');
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index][0]) === String(id)) {
      sheet_('tests').deleteRow(index + 2);
      return {deleted: true, id: id};
    }
  }
  fail_('Тест не знайдено.', 'TEST_NOT_FOUND');
}

function normalizeResultAnswers_(test,body) {
  var incoming = Object.create(null);
  if (!Array.isArray(body.answers) || body.answers.length > 200) fail_('Некоректний список відповідей.', 'BAD_REQUEST');
  body.answers.forEach(function(a){if(a && a.questionId != null){var k=String(a.questionId);if(Object.prototype.hasOwnProperty.call(incoming,k))fail_('Питання повторюється у відповідях.','BAD_REQUEST');incoming[k]=a;}});
  var selected = Object.create(null);
  test.questions.forEach(function(q){
    var a=incoming[String(q.id)] || {};
    if(isWritten_(q)) {
      if(a.text != null && typeof a.text !== 'string')fail_('Письмова відповідь має бути текстом.','BAD_REQUEST');
      var text=String(a.text || '').replace(/\u0000/g,'');
      if(text.length>3000)fail_('Письмова відповідь перевищує 3000 символів.','ANSWER_TOO_LONG');
      selected[String(q.id)]=text;
    } else {
      if(a.answerIds!=null&&a.answerId!=null&&String(a.answerId)!=='0')fail_('Передайте один список вибраних відповідей.','BAD_REQUEST');
      selected[String(q.id)]=choiceValue_(q,a.answerIds!=null?a.answerIds:a.answerId);
    }
  });
  if(JSON.stringify(selected).length>48000)fail_('Сумарний обсяг письмових відповідей перевищує 48 000 символів. Скоротіть відповіді.','ANSWERS_TOO_LARGE');
  return selected;
}

function submitResult_(user, body, examSource, recoveryApproval) {
  var submissionId = cleanText_(body.submissionId, 200);
  var record = findResultRecord_(user.id, body.testId);
  if (record) {
    if(record.row[PUBLIC_SYNC_COLUMN-1]===RESULT_DELETING)fail_('Інструктор видаляє цю роботу.','RESULT_DELETION_PENDING');
    var existing = record.result;
    var accepted = submissionId && (String(record.row[12] || '') === submissionId || dataRows_('sync').some(function (row) {
      return String(row[0]) === submissionId && String(row[1]) === 'result:' + String(existing.id);
    }));
    if (accepted) return {result: existing, review: safeResultReview_(user, record), practice: safeResultMistakes_(user, existing.id), alreadyAccepted: true,tableSynced:publishCommittedResult_(existing,record.rowNumber)};
    fail_('Цей тест уже пройдено. Повторне проходження недоступне.', 'ALREADY_COMPLETED');
  }
  requireAttemptNotDeleted_(user.id,body.testId);
  if(!examSource){var attempt=examDocument_(user).value;if(attempt&&String(attempt.test.id)===String(body.testId))fail_('Продовжіть збережену спробу іспиту.','EXAM_SESSION_REQUIRED');}
  var test = examSource || getTestById_(body.testId);
  requireSingleAttemptTest_(test);
  if (!test || (!examSource && (isArchivedTest_(test) || !test.published || !visibleTestForUser_(test, user)))) {
    fail_('Тест не знайдено або він уже недоступний.', 'TEST_NOT_FOUND');
  }
  if(!examSource && test.mode === 'training') {
    if(body.startPermit)verifyTrainingPermit_(user,test,body.submissionId,body.startPermit);
    else { requireTestOpen_(test,user);if(testAccessPolicy_(test.id).revision>0)fail_('Для керованого проходження оновіть застосунок до 1.2.14.', 'UPDATE_REQUIRED'); }
  }
  // Exams are timed by the server attempt; a direct submission would skip the deadline.
  if (!examSource && test.mode === 'exam') fail_('Іспит проходить через серверну спробу. Оновіть застосунок і почніть іспит знову.', 'EXAM_SESSION_REQUIRED');
  if (!test.questions.length) fail_('У тесті немає питань.', 'BAD_TEST');

  requireChoiceProtocol_(test,body.choiceProtocol);
  if (test.questions.some(function(q){return isWritten_(q)||questionPoints_(q)!==1;}) && body.writtenProtocol !== 1) fail_('Письмові відповіді приймає версія застосунку для ПК.', 'UPDATE_REQUIRED');
  var selected=normalizeResultAnswers_(test,body);
  var grading = resultGrading_(test, selected, {});
  var correct=grading.correct, total=test.questions.length, score=grading.score, passed=grading.passed;
  var durationSeconds = clampNumber_(body.durationSeconds, 1, 24 * 60 * 60, 1);
  var completedAt = new Date();
  var result = {
    id: nextId_('result', 'results'),
    userId: user.id,
    userName: user.fullName,
    groupName: user.groupName,
    testId: test.id,
    testTitle: test.title,
    score: score,
    correct: correct,
    total: total,
    durationSeconds: durationSeconds,
    completedAt: completedAt.toISOString(),
    passed: passed,
    examExitCount: test.mode === 'exam' ? clampNumber_(body.examExitCount, 0, 10000, 0) : 0,
    examPinned: test.mode === 'exam' && body.examPinned === true,
    gradingStatus: grading.gradingStatus, earnedPoints: grading.earnedPoints, maxPoints: grading.maxPoints,
    choiceTotal: grading.choiceTotal, pendingWritten: grading.pendingWritten, gradingRevision: 0,
    examRecovered: Boolean(recoveryApproval), recoveredBy: recoveryApproval ? recoveryApproval.name : '', recoveredAt: recoveryApproval ? recoveryApproval.at : ''
  };
  sheet_('results').appendRow([
    result.id, result.userId, safeCellText_(result.userName), safeCellText_(result.groupName),
    result.testId, safeCellText_(result.testTitle), result.score == null ? '' : result.score, result.correct, result.total,
    result.durationSeconds, completedAt, result.passed == null ? '' : result.passed, safeCellText_(submissionId),
    JSON.stringify(selected), result.examExitCount, result.examPinned, result.gradingStatus, result.earnedPoints, result.maxPoints, result.choiceTotal, result.pendingWritten, 0, '{}', result.examRecovered, safeCellText_(result.recoveredBy), result.recoveredAt,'pending'
  ]);
  var committedRow=sheet_('results').getLastRow();
  invalidatePublicSync_();
  // The result is committed. Failures in auxiliary sheets must not turn an
  // accepted attempt into an apparent failure or cause a duplicate submission.
  tryAuxiliaryWrite_('Ключ синхронізації', function () {
    sheet_('sync').appendRow([safeCellText_(submissionId || ('result-' + result.id)), 'result:' + result.id, completedAt]);
  });
  var detailRows = (test.questions || []).filter(function(q){return !isWritten_(q);}).map(function (question) {
    var right = (question.answers || []).filter(function (answer) { return answer.isCorrect === true; })[0];
    var selectedId = selected[String(question.id)] || '0';
    return [
      result.id, result.userId, result.testId, safeCellText_(result.testTitle), question.id,
      safeCellText_(String(question.text || '')), choiceCorrect_(question,selectedId), completedAt
    ];
  });
  if (detailRows.length) {
    tryAuxiliaryWrite_('Деталі відповідей', function () {
      var detailSheet = sheet_('resultDetails');
      var startRow = detailSheet.getLastRow() + 1;
      ensureRowCapacity_(detailSheet, startRow + detailRows.length - 1);
      detailSheet.getRange(startRow, 1, detailRows.length, HEADERS.resultDetails.length).setValues(detailRows);
    });
  }
  var tableSynced = publishCommittedResult_(result,committedRow);
  return {result: result, review: buildResultReview_(user, result, test, selected, {}), practice: mistakePractice_(result, test, selected, null), tableSynced: tableSynced};
}

function examRecoveryFromRow_(row) {
  return {id:String(row[0]),userId:String(row[1]),testId:String(row[2]),submissionId:String(row[3]),userName:String(row[5]),groupName:String(row[6]),testTitle:String(row[7]),durationSeconds:Number(row[9]),examExitCount:Number(row[10]),submittedAt:iso_(row[11]),status:String(row[12]),resultId:String(row[13]||''),approvedBy:String(row[14]||''),approvedAt:iso_(row[15]),timeVerified:false};
}
function listExamRecoveries_(user,pendingOnly) {
  var sheet=sheet_('examRecoveries'),count=sheet.getLastRow()-1;if(count<1)return [];
  var first=sheet.getRange(2,1,count,8).getValues(),last=sheet.getRange(2,10,count,7).getValues();
  return first.map(function(row,i){return examRecoveryFromRow_(row.concat([''],last[i]));})
    .filter(function(x){return (user.role===ROLE_INSTRUCTOR||x.userId===String(user.id))&&(!pendingOnly||x.status==='pending');});
}
function examRecoveryRecord_(id) {
  var sheet=sheet_('examRecoveries'),count=sheet.getLastRow()-1;if(count<1)return null;
  var ids=sheet.getRange(2,1,count,1).getValues();
  for(var i=0;i<ids.length;i++)if(String(ids[i][0])===String(id)){var row=sheet.getRange(i+2,1,1,HEADERS.examRecoveries.length).getValues()[0];return {row:row,rowNumber:i+2,value:examRecoveryFromRow_(row)};}
  return null;
}
function queueExamRecovery_(user,body) {
  requireRole_(user,ROLE_CADET);
  var key=cleanRequired_(body.submissionId,'Не задано ключ збереженої роботи.',200);
  if(!/^[A-Za-z0-9_-]{8,200}$/.test(key))fail_('Некоректний ключ збереженої роботи.','BAD_REQUEST');
  var done=findResultRecord_(user.id,body.testId);
  if(done)return submitResult_(user,body);
  requireAttemptNotDeleted_(user.id,body.testId);
  var test=getTestById_(body.testId);
  if(!test||test.mode!=='exam'||!visibleTestForUser_(test,user))fail_('Іспит недоступний для відновлення.','TEST_NOT_FOUND');
  var active=examDocument_(user).value;
  if(active&&active.status!=='completed'&&String(active.test.id)===String(test.id))fail_('Продовжіть наявну серверну спробу іспиту.','EXAM_ACTIVE');
  requireChoiceProtocol_(test,body.choiceProtocol);
  var selected=normalizeResultAnswers_(test,body),seconds=clampNumber_(body.durationSeconds,1,86400,1),exits=clampNumber_(body.examExitCount,0,10000,0);
  var digest=sha256Hex_(JSON.stringify({testId:String(test.id),answers:selected,durationSeconds:seconds,examExitCount:exits}));
  var existing=listExamRecoveries_(user,false).filter(function(x){return x.testId===String(test.id)||x.submissionId===key;})[0];
  if(existing){var record=examRecoveryRecord_(existing.id);if(existing.testId!==String(test.id)||existing.submissionId!==key||String(record.row[4])!==digest)fail_('Для цієї роботи вже збережено інші дані. Відповіді на цьому ПК залишено.','REQUEST_CONFLICT');return {examRecoveryProtocol:1,recovery:existing};}
  var row=[Utilities.getUuid(),String(user.id),String(test.id),key,digest,safeCellText_(user.fullName),safeCellText_(user.groupName),safeCellText_(test.title),JSON.stringify(selected),seconds,exits,new Date(),'pending','','',''];
  sheet_('examRecoveries').appendRow(row);
  logAudit_(user,'EXAM_RECOVERY_SUBMIT','cadet',user.id,user.fullName,'Збережений іспит #'+test.id+' передано на підтвердження; час не перевірено сервером.');
  return {examRecoveryProtocol:1,recovery:examRecoveryFromRow_(row)};
}
function examRecoveryReview_(user,id) {
  requireRole_(user,ROLE_INSTRUCTOR);
  var record=examRecoveryRecord_(id);if(!record)fail_('Збережену роботу не знайдено.','NOT_FOUND');
  var test=getTestById_(record.value.testId);if(!test)fail_('Питання цього іспиту недоступні.','REVIEW_UNAVAILABLE');
  var selected=JSON.parse(String(record.row[8])),draft={gradingStatus:'pending_review'};
  return {recovery:record.value,review:buildResultReview_(user,draft,test,selected,{})};
}
function approveExamRecovery_(actor,id,body) {
  requireRole_(actor,ROLE_INSTRUCTOR);
  if(body.confirmTimeUnverified!==true)fail_('Підтвердіть прийняття роботи з неперевіреним сервером часом.','CONFIRMATION_REQUIRED');
  var record=examRecoveryRecord_(id);if(!record)fail_('Збережену роботу не знайдено.','NOT_FOUND');
  var saved=record.value,cadet=findUserById_(saved.userId),test=getTestById_(saved.testId);
  if(!cadet||cadet.role!==ROLE_CADET||cadetDeletionPending_(cadet.id)||!test)fail_('Курсант або іспит більше недоступний.','NOT_FOUND');
  var selected=JSON.parse(String(record.row[8]));
  var submission={submissionId:saved.submissionId,testId:saved.testId,writtenProtocol:1,choiceProtocol:2,durationSeconds:saved.durationSeconds,examExitCount:saved.examExitCount,answers:test.questions.map(function(q){var value=selected[String(q.id)];return isWritten_(q)?{questionId:q.id,text:value||''}:Array.isArray(value)?{questionId:q.id,answerIds:value}:{questionId:q.id,answerId:value||'0'};})};
  var approval={name:String(actor.fullName||actor.username),at:new Date().toISOString()};
  var completion=submitResult_(cadet,submission,test,approval);
  sheet_('examRecoveries').getRange(record.rowNumber,13,1,4).setValues([['approved',String(completion.result.id),safeCellText_(completion.result.recoveredBy),completion.result.recoveredAt]]);
  if(saved.status!=='approved')logAudit_(actor,'EXAM_RECOVERY_APPROVE','result',completion.result.id,test.title,'Прийнято збережену роботу; час підтверджено інструктором, не серверним таймером.');
  return completion;
}
function routeExamRecovery_(method,path,body,user) {
  if(path==='/api/exam-recoveries'){
    requireRole_(user,ROLE_CADET);
    return method==='GET'?{examRecoveryProtocol:1,recoveries:listExamRecoveries_(user,false)}:method==='POST'?queueExamRecovery_(user,body):null;
  }
  if(path==='/api/instructor/exam-recoveries'&&method==='GET'){requireRole_(user,ROLE_INSTRUCTOR);return {recoveries:listExamRecoveries_(user,true)};}
  var match=path.match(/^\/api\/instructor\/exam-recoveries\/([^/]+)(\/approve)?$/);
  if(!match)return null;
  requireRole_(user,ROLE_INSTRUCTOR);
  if(method==='GET'&&!match[2])return examRecoveryReview_(user,decodePart_(match[1]));
  if(method==='POST'&&match[2])return approveExamRecovery_(user,decodePart_(match[1]),body);
  return null;
}

function listResults_(userId) {
  var sheet = sheet_('results');
  return readResultSummaries_(sheet, 2, Math.max(0, sheet.getLastRow() - 1)).filter(function (row) {
    return row[0] !== '' && (userId == null || String(row[1]) === String(userId));
  }).map(resultFromRow_).sort(function (first, second) {
    return dateMillis_(second.completedAt) - dateMillis_(first.completedAt);
  });
}

// List views never need the large answers JSON or the submission key.
// Keep their column positions so the existing serializer remains compatible.
function readResultSummaries_(sheet, startRow, count) {
  if (count < 1) return [];
  var first = sheet.getRange(startRow, 1, count, 12).getValues();
  var tail = sheet.getRange(startRow, 15, count, 8).getValues();
  var recovery = sheet.getRange(startRow, 24, count, 3).getValues();
  return first.map(function(row, i) { return row.concat(['', ''], tail[i], [''], recovery[i]); });
}

function listRecentResults_(limit) {
  var sheet = sheet_('results');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var count = Math.max(1, Math.min(Number(limit || DASHBOARD_RESULT_LIMIT), lastRow - 1));
  var startRow = Math.max(2, lastRow - count + 1);
  return readResultSummaries_(sheet, startRow, lastRow - startRow + 1)
    .filter(function (row) { return row[0] !== ''; })
    .map(resultFromRow_)
    .sort(function (first, second) { return dateMillis_(second.completedAt) - dateMillis_(first.completedAt); });
}

function resultCount_() {
  return Math.max(0, sheet_('results').getLastRow() - 1);
}

function deletedResultRows_(userId) {
  return dataRows_('deletedResults').filter(function(row) {
    return String(row[0]) && (userId==null || String(row[1])===String(userId));
  });
}

function hasDeletedAttempt_(userId,testId) {
  return deletedResultRows_(userId).some(function(row){return String(row[2])===String(testId);});
}

function requireAttemptNotDeleted_(userId,testId) {
  if(hasDeletedAttempt_(userId,testId))fail_('Інструктор видалив результат. Спробу цього тесту вже використано.','RESULT_DELETED');
}

function plannedRowNumbers_(rows,predicate) {
  var indices=[];
  rows.forEach(function(row,index){if(predicate(row,index))indices.push(index+2);});
  return indices;
}

function deleteSheetRows_(sheet,rows) {
  if(rows.length && sheet.getMaxRows()-rows.length<2){
    sheet.insertRowsAfter(sheet.getMaxRows(),2-(sheet.getMaxRows()-rows.length));
  }
  for(var end=rows.length-1;end>=0;){
    var start=end;
    while(start>0&&rows[start-1]===rows[start]-1)start--;
    sheet.deleteRows(rows[start],end-start+1);
    end=start-1;
  }
}

function planPublicResultDeletion_(sheet,result,allResults,legacySheet) {
  if(!sheet||sheet.getLastRow()<2)return [];
  var width=sheet.getMaxColumns();
  var headers=sheet.getRange(1,1,1,width).getValues()[0];
  var resultColumn=headers.indexOf('_ID результату'), userColumn=headers.indexOf('_ID курсанта');
  if(resultColumn<0&&!legacySheet)fail_('У таблиці немає ID результатів. Спочатку натисніть «Оновити таблицю».','PUBLIC_RESULTS_SCHEMA');
  var titleColumn=headers.indexOf('Тест');
  var rows=sheet.getRange(2,1,sheet.getLastRow()-1,width).getValues();
  var canonicalRows=publicRowsFromSheet_(sheet,headers.indexOf('Група')<0);
  return plannedRowNumbers_(rows,function(row,index){
    var rowId=resultColumn<0?'':String(row[resultColumn]||'');
    var owner=userColumn<0?'':String(row[userColumn]||'');
    if(rowId){
      if(rowId!==String(result.id))return false;
      if(owner&&owner!==String(result.userId))fail_('ID роботи й курсанта в таблиці не збігаються. Оновіть таблицю.','PUBLIC_RESULTS_SCHEMA');
      return true;
    }
    var canonical=canonicalRows[index];
    if((owner&&owner!==String(result.userId))||canonical.slice(1,5).every(function(value){return value==='';}))return false;
    // Legacy rows without IDs can be removed only if their full values match
    // exactly one server result. A repeated name or score alone is insufficient.
    var legacy=canonical.slice(0,6);
    function matches(candidate){
      if(owner&&String(candidate.userId)!==owner)return false;
      return publicRowMatchesStoredResult_(legacy,candidate);
    }
    if(!matches(result))return false;
    if(allResults.filter(matches).length!==1)fail_('У таблиці є неоднозначний рядок без ID результату. Спочатку натисніть «Оновити таблицю».','PUBLIC_RESULTS_ID_REQUIRED');
    return true;
  });
}

function deleteResult_(actor,id,body) {
  requireRole_(actor,ROLE_INSTRUCTOR);
  if(String(body.confirmResultId||'')!==id)fail_('Підтвердіть видалення вибраної роботи.','CONFIRMATION_REQUIRED');
  var marker=deletedResultRows_(null).some(function(row){return String(row[0])===id;});
  var record=resultRecordById_(id);
  if(!record){
    if(marker)return {deleted:true,resultId:id,alreadyDeleted:true};
    fail_('Результат не знайдено.','RESULT_NOT_FOUND');
  }
  var result=record.result, userId=String(result.userId), testId=String(result.testId);
  requireCadetNotDeleting_(userId);
  var submissionId=String(record.row[12]||'');
  var tables=intakePublicSheets_(), allResults=listResults_(null);
  var plans=[
    {sheet:tables.public,rows:planPublicResultDeletion_(tables.public,result,allResults)},
    {sheet:tables.legacyPublic,rows:planPublicResultDeletion_(tables.legacyPublic,result,allResults,true)}
  ];
  function plan(key,predicate) {
    plans.push({sheet:sheet_(key),rows:plannedRowNumbers_(dataRows_(key),predicate)});
  }
  plan('resultDetails',function(row){return String(row[0])===id;});
  plan('legacyResults',function(row){
    return String(row[3])===id&&String(row[4])===userId&&String(row[7])===testId;
  });
  plan('sync',function(row){return String(row[1])==='result:'+id;});
  plan('examRecoveries',function(row){
    return String(row[1])===userId&&String(row[2])===testId&&
      (String(row[13])===id||(submissionId&&String(row[3])===submissionId));
  });
  var owner=findUserById_(userId), attemptKeys=[];
  if(owner){
    var headers=pcStateHeaders_(owner);
    ['training',EXAM_STATE_KEY_].forEach(function(key){
      var state=pcStateRead_(owner,key,pcStateLatest_(headers,key)).value;
      if(state&&String(state.test.id)===testId&&(!submissionId||String(state.submissionId)===submissionId))attemptKeys.push(key);
    });
  }
  plan('pcState',function(row){
    return String(row[1])==='grading:'+id||(String(row[0])===userId&&attemptKeys.indexOf(String(row[1]))>=0);
  });
  plan('audit',function(row){return String(row[4])==='result'&&String(row[5])===id;});
  var results=sheet_('results');
  // The original row remains available for retries until cleanup finishes.
  // This flag prevents automatic publication or grading from restoring it.
  results.getRange(record.rowNumber,PUBLIC_SYNC_COLUMN).setValue(RESULT_DELETING);
  invalidatePublicSync_();
  try{
    plans.forEach(function(item){if(item.rows.length)deleteSheetRows_(item.sheet,item.rows);});
    if(owner&&tables.public)addVisibleCadetPlaceholder_(owner);
    PropertiesService.getScriptProperties().deleteProperty(reviewLeaseKey_(id));
    if(!marker)sheet_('deletedResults').appendRow([result.id,result.userId,result.testId]);
    deleteSheetRows_(results,[record.rowNumber]);
  }catch(error){
    console.warn('Не завершено видалення результату '+id+': '+String(error.message||error));
    fail_('Не вдалося завершити видалення. Повторіть «Видалити результат».','RESULT_DELETION_PENDING');
  }
  invalidatePublicSync_();
  logAudit_(actor,'RESULT_DELETE','result',id,'','Видалено результат. Спробу тесту залишено використаною.');
  return {deleted:true,resultId:id,alreadyDeleted:false};
}

function resultFromRow_(row) {
  return {
    id: row[0], userId: row[1], userName: String(row[2] || ''), groupName: String(row[3] || ''),
    testId: row[4], testTitle: String(row[5] || ''), score: row[16] === 'pending_review' ? null : Number(row[6] || 0),
    correct: Number(row[7] || 0), total: Number(row[8] || 0), durationSeconds: Number(row[9] || 0),
    completedAt: iso_(row[10]), passed: row[16] === 'pending_review' ? null : asBoolean_(row[11], false),
    examExitCount: Number(row[14] || 0), examPinned: asBoolean_(row[15], false),
    gradingStatus: String(row[16] || 'graded'), earnedPoints: row[17] === '' || row[17] == null ? Number(row[7] || 0) : Number(row[17]),
    maxPoints: row[18] === '' || row[18] == null ? Number(row[8] || 0) : Number(row[18]),
    choiceTotal: row[19] === '' || row[19] == null ? Number(row[8] || 0) : Number(row[19]),
    pendingWritten: Number(row[20] || 0), gradingRevision: Number(row[21] || 0),
    examRecovered: row[23]===true, recoveredBy: String(row[24]||''), recoveredAt: String(row[25]||'')
  };
}

function findResult_(userId, testId) {
  var record = findResultRecord_(userId, testId);
  return record ? record.result : null;
}

function findResultRecord_(userId, testId) {
  var sheet = sheet_('results');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var keys = sheet.getRange(2, 2, lastRow - 1, 4).getValues();
  for (var index = keys.length - 1; index >= 0; index -= 1) {
    if (String(keys[index][0]) === String(userId) && String(keys[index][3]) === String(testId)) {
      var row = sheet.getRange(index + 2, 1, 1, HEADERS.results.length).getValues()[0];
      return {result: resultFromRow_(row), row: row,rowNumber:index+2};
    }
  }
  return null;
}

function findResultById_(id) {
  var sheet = sheet_('results');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var index = ids.length - 1; index >= 0; index -= 1) {
    if (String(ids[index][0]) === String(id)) {
      return resultFromRow_(sheet.getRange(index + 2, 1, 1, HEADERS.results.length).getValues()[0]);
    }
  }
  return null;
}

function hasResultsForTest_(testId) {
  var sheet = sheet_('results');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  return sheet.getRange(2, 5, lastRow - 1, 1).getValues().some(function (row) {
    return String(row[0]) === String(testId);
  });
}

function instructorDashboard_() {
  var recentResults = listRecentResults_(DASHBOARD_RESULT_LIMIT);
  var resultTotal = resultCount_();
  var sheetInfo = resultsSheetInfo_();
  return {
    tests: listTestsForUser_({role:ROLE_INSTRUCTOR}),
    cadets: listUsers_().filter(function (user) { return user.role === ROLE_CADET; }).map(publicUser_),
    results: recentResults,
    resultTotal: resultTotal,
    resultsTruncated: resultTotal > recentResults.length,
    retries: [],
    resultsSheetUrl: sheetInfo.url
  };
}

function instructorLesson_(testId, groupId) {
  var group = listGroups_().filter(function (item) { return String(item.id) === String(groupId); })[0];
  var test = getTestById_(testId);
  if (!group) fail_('Навчальну групу не знайдено.', 'GROUP_NOT_FOUND');
  if (!test) fail_('Тест не знайдено.', 'TEST_NOT_FOUND');
  var cadets = listUsers_().filter(function (user) {
    return user.role === ROLE_CADET && user.active && normalize_(user.groupName) === normalize_(group.name)
      && visibleTestForUser_(test, user);
  }).map(publicUser_);
  var ids = Object.create(null);
  cadets.forEach(function (user) { ids[String(user.id)] = true; });
  // Read the full history; dashboard's most recent 500 results cannot establish absence.
  var results = listResults_(null).filter(function (result) {
    return String(result.testId) === String(testId) && ids[String(result.userId)] === true;
  });
  return {testId: testId, groupId: groupId, cadets: cadets, results: results, updatedAt: new Date().toISOString()};
}

function mistakePractice_(result, test, selected, wrongIds) {
  var questions = test.questions.filter(function (question) {
    if (isWritten_(question)) return false;
    if (wrongIds) return wrongIds[String(question.id)] === true;
    return !choiceCorrect_(question,selected[String(question.id)]);
  });
  return {resultId: result.id, title: result.testTitle, questions: questions};
}

function resultMistakes_(user, resultId) {
  var row = dataRows_('results').filter(function (item) { return String(item[0]) === String(resultId); })[0];
  if (!row) fail_('Результат не знайдено.', 'RESULT_NOT_FOUND');
  var result = resultFromRow_(row);
  if (String(result.userId) !== String(user.id)) fail_('Недостатньо прав.', 'FORBIDDEN');
  var test = getTestById_(result.testId);
  if (!test) fail_('Питання цього тесту більше не збережені.', 'REVIEW_UNAVAILABLE');
  if (row[13]) {
    var selected;
    try { selected = JSON.parse(String(row[13])); }
    catch (error) { fail_('Не вдалося прочитати збережені відповіді.', 'REVIEW_UNAVAILABLE'); }
    return mistakePractice_(result, test, selected, null);
  }
  // Older releases stored only correctness in the auxiliary detail sheet.
  var details = dataRows_('resultDetails').filter(function (item) {
    return String(item[0]) === String(result.id) && String(item[1]) === String(user.id);
  });
  if (result.correct === result.total) return {resultId: result.id, title: result.testTitle, questions: []};
  if (details.length !== test.questions.length) {
    fail_('Для цього старого результату немає повних деталей відповідей.', 'REVIEW_UNAVAILABLE');
  }
  var wrongIds = Object.create(null);
  details.forEach(function (item) { if (!asBoolean_(item[6], false)) wrongIds[String(item[4])] = true; });
  return mistakePractice_(result, test, null, wrongIds);
}

function safeResultMistakes_(user, resultId) {
  try { return resultMistakes_(user, resultId); }
  catch (ignored) { return null; } // A historical review must never reject a committed result.
}

function safeResultReview_(user, record) {
  try {
    if(!record.row[13] || String(record.result.userId)!==String(user.id))return [];
    return buildResultReview_(user,record.result,getTestById_(record.result.testId),JSON.parse(String(record.row[13])),JSON.parse(String(record.row[22]||'{}')));
  } catch(ignored){return [];}
}

function instructorAnalytics_(filters) {
  filters=filters||{};
  var allResults = listResults_(null);
  var results = allResults.filter(function(r){return r.gradingStatus !== 'pending_review';}).filter(function(r){return (!filters.groupName||normalize_(r.groupName)===normalize_(filters.groupName))&&(!filters.testId||String(r.testId)===String(filters.testId));});
  var allowedResults=Object.create(null);results.forEach(function(r){allowedResults[String(r.id)]=true;});
  var groupStats = Object.create(null);
  var testStats = Object.create(null);
  var scoreSum = 0;
  var passedCount = 0;
  results.forEach(function (result) {
    scoreSum += Number(result.score || 0);
    if (result.passed) passedCount += 1;
    var groupKey = String(result.groupName || 'Без групи');
    if (!groupStats[groupKey]) groupStats[groupKey] = {name: groupKey, attempts: 0, score: 0, passed: 0};
    groupStats[groupKey].attempts += 1;
    groupStats[groupKey].score += Number(result.score || 0);
    if (result.passed) groupStats[groupKey].passed += 1;
    var testKey = String(result.testId);
    if (!testStats[testKey]) {
      testStats[testKey] = {id: testKey, title: String(result.testTitle || 'Тест'), attempts: 0, score: 0, passed: 0};
    }
    testStats[testKey].attempts += 1;
    testStats[testKey].score += Number(result.score || 0);
    if (result.passed) testStats[testKey].passed += 1;
  });

  var questionStats = Object.create(null);
  var detailedResultIds = Object.create(null);
  dataRows_('resultDetails').filter(function (row) { return row[0] !== '' && allowedResults[String(row[0])]; }).forEach(function (row) {
    var key = String(row[2]) + ':' + String(row[4]);
    if (!questionStats[key]) {
      questionStats[key] = {
        testId: String(row[2]), testTitle: String(row[3] || 'Тест'), questionId: String(row[4]),
        text: String(row[5] || 'Питання'), attempts: 0, correct: 0
      };
    }
    questionStats[key].attempts += 1;
    if (asBoolean_(row[6], false)) questionStats[key].correct += 1;
    detailedResultIds[String(row[0])] = true;
  });

  var groups = Object.keys(groupStats).map(function (key) { return analyticsBucket_(groupStats[key]); })
    .sort(function (first, second) { return first.name.localeCompare(second.name); });
  var tests = Object.keys(testStats).map(function (key) { return analyticsBucket_(testStats[key]); })
    .sort(function (first, second) { return second.attempts - first.attempts || first.title.localeCompare(second.title); });
  var hardestQuestions = Object.keys(questionStats).map(function (key) {
    var item = questionStats[key];
    item.percent = item.attempts ? Math.round(item.correct * 100 / item.attempts) : 0;
    return item;
  }).sort(function (first, second) {
    return first.percent - second.percent || second.attempts - first.attempts;
  }).slice(0, 20);

  return {
    pendingReview: allResults.filter(function(r){return r.gradingStatus==='pending_review' && (!filters.groupName||normalize_(r.groupName)===normalize_(filters.groupName))&&(!filters.testId||String(r.testId)===String(filters.testId));}).length,
    attempts: results.length,
    average: results.length ? Math.round(scoreSum / results.length) : 0,
    passRate: results.length ? Math.round(passedCount * 100 / results.length) : 0,
    groups: groups,
    tests: tests,
    hardestQuestions: hardestQuestions,
    detailedAttempts: Object.keys(detailedResultIds).length
  };
}

function analyticsBucket_(item) {
  var result = {
    attempts: item.attempts,
    average: item.attempts ? Math.round(item.score / item.attempts) : 0,
    passRate: item.attempts ? Math.round(item.passed * 100 / item.attempts) : 0
  };
  if (item.id != null) result.id = item.id;
  if (item.title != null) result.title = item.title;
  if (item.name != null) result.name = item.name;
  return result;
}

function listRetries_() {
  return dataRows_('retries').map(function (row, index) {
    return {
      resultId: row[0], userId: row[1], sourceTestId: row[2], retryTestId: row[3],
      createdAt: iso_(row[4]), active: asBoolean_(row[5], true), rowNumber: index + 2
    };
  }).filter(function (retry) { return retry.resultId !== ''; });
}

function deactivateRetriesForTest_(testId) {
  listRetries_().forEach(function (retry) {
    if (retry.active && String(retry.retryTestId) === String(testId)) {
      sheet_('retries').getRange(retry.rowNumber, 6).setValue(false);
    }
  });
}

function logAudit_(actor, action, targetType, targetId, targetName, details) {
  if (!actor) return;
  var createdAt = new Date();
  tryAuxiliaryWrite_('Журнал дій', function () { sheet_('audit').appendRow([
    nextId_('audit', 'audit'), actor.id,
    safeCellText_(String(actor.fullName || actor.username || 'Інструктор')),
    safeCellText_(String(action || 'ACTION')), safeCellText_(String(targetType || 'object')),
    safeCellText_(String(targetId == null ? '' : targetId)), safeCellText_(String(targetName || '')),
    safeCellText_(String(details || '')), createdAt
  ]); });
}

function tryAuxiliaryWrite_(name, callback) {
  try { callback(); return true; }
  catch (error) {
    console.warn(name + ': ' + String(error && error.message ? error.message : error));
    return false;
  }
}

function ensureRowCapacity_(sheet, lastRow) {
  var maximum = sheet.getMaxRows();
  if (lastRow > maximum) sheet.insertRowsAfter(maximum, Math.max(100, lastRow - maximum));
}

function listAudit_() {
  var sheet = sheet_('audit');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var count = Math.min(200, lastRow - 1);
  var startRow = lastRow - count + 1;
  return sheet.getRange(startRow, 1, count, HEADERS.audit.length).getValues()
    .filter(function (row) { return row[0] !== ''; })
    .map(function (row) {
      return {
        id: String(row[0]), actorId: String(row[1]), actorName: String(row[2] || 'Інструктор'),
        action: String(row[3] || ''), targetType: String(row[4] || ''), targetId: String(row[5] || ''),
        targetName: String(row[6] || ''), details: String(row[7] || ''), createdAt: iso_(row[8])
      };
    }).map(function(entry){
      // Older releases wrote the live invitation secret as the target ID.
      if(entry.targetType==='instructor-invite')entry.targetId='';
      return entry;
    }).sort(function (first, second) { return dateMillis_(second.createdAt) - dateMillis_(first.createdAt); });
}

function listInstructors_() {
  return listUsers_().filter(function (user) { return user.role === ROLE_INSTRUCTOR; })
    .map(publicUser_).sort(function (first, second) { return dateMillis_(first.createdAt) - dateMillis_(second.createdAt); });
}

function createCadetByInstructor_(actor, body) {
  var groupName = cleanRequired_(body.groupName, 'Оберіть навчальну групу.', 80);
  var groupExists = listGroups_().some(function (group) { return normalize_(group.name) === normalize_(groupName) && !group.archived; });
  if (!groupExists) fail_('Навчальну групу не знайдено.', 'GROUP_NOT_FOUND');
  var user = createUser_({
    fullName: body.fullName,
    username: body.username,
    groupName: groupName,
    role: ROLE_CADET,
    passwordHash: body.passwordHash,
    passwordSalt: body.passwordSalt
  });
  var tableSynced = publishCommittedCadet_(user);
  var result = publicUser_(user);
  result.tableSynced = tableSynced;
  logAudit_(actor, 'CADET_CREATE', 'cadet', user.id, user.fullName,
    'Група: ' + user.groupName + '; логін: ' + user.username + '.');
  return result;
}

/** Change current membership only. Accepted results retain their historical group. */
function transferCadet_(id, actor, body) {
  requireRole_(actor, ROLE_INSTRUCTOR);
  var user = findUserById_(id);
  if (!user || user.role !== ROLE_CADET) fail_('Курсанта не знайдено.', 'USER_NOT_FOUND');
  requireCadetNotDeleting_(id);
  var target = findGroupById_(body.groupId);
  if (!target || target.archived) fail_('Оберіть наявну активну навчальну групу.', 'GROUP_NOT_FOUND');
  if (typeof body.expectedGroupName !== 'string') fail_('Оновіть список курсантів і повторіть переведення.', 'BAD_REQUEST');
  // A lost response can be retried without another write or duplicate audit entry.
  if (user.groupName === target.name) return {transferred:true,changed:false,user:publicUser_(user)};
  if (user.groupName !== body.expectedGroupName) {
    fail_('Інший інструктор уже змінив групу курсанта. Оновіть список і перевірте нову групу.', 'REVISION_CONFLICT');
  }
  var previous = user.groupName;
  sheet_('users').getRange(user.rowNumber, 4).setValue(safeCellText_(target.name));
  user.groupName = target.name;
  // Keep the stable user ID, credentials, active flag, results and session version.
  tryAuxiliaryWrite_('Журнал переведення курсанта', function () {
    logAudit_(actor, 'CADET_TRANSFER', 'cadet', user.id, user.fullName,
      'Група: ' + previous + ' → ' + target.name + '. Історію результатів збережено.');
  });
  return {transferred:true,changed:true,user:publicUser_(user)};
}

function updateUserStatus_(id, actor, body) {
  var user = findUserById_(id);
  if (!user || user.role !== ROLE_CADET) fail_('Курсанта не знайдено.', 'USER_NOT_FOUND');
  requireCadetNotDeleting_(id);
  var active = body.active === true;
  sheet_('users').getRange(user.rowNumber, 8).setValue(active);
  bumpSessionVersion_(user.id);
  user.active = active;
  logAudit_(actor, 'CADET_STATUS', 'cadet', user.id, user.fullName,
    active ? 'Обліковий запис увімкнено.' : 'Обліковий запис вимкнено.');
  return {user: publicUser_(user)};
}

function updateUserPassword_(id, actor, body) {
  var user = findUserById_(id);
  if (!user || user.role !== ROLE_CADET) fail_('Курсанта не знайдено.', 'USER_NOT_FOUND');
  requireCadetNotDeleting_(id);
  validateCredential_(body.passwordSalt, body.passwordHash);
  bumpSessionVersion_(user.id);
  sheet_('users').getRange(user.rowNumber, 6, 1, 2).setValues([[String(body.passwordHash), String(body.passwordSalt)]]);
  logAudit_(actor, 'CADET_PASSWORD', 'cadet', user.id, user.fullName, 'Пароль змінено інструктором.');
  return {changed: true};
}

function cadetDeletionPending_(id, properties) {
  var key = 'DELETING_CADET_' + String(id);
  return (properties ? properties[key] : PropertiesService.getScriptProperties().getProperty(key)) === '1';
}

function requireCadetNotDeleting_(id) {
  if (cadetDeletionPending_(id)) fail_('Видалення курсанта не завершено. Повторіть «Видалити повністю».', 'DELETION_PENDING');
}

/** Delete by stable IDs and preflight historical rows before any erasure. */
function deleteCadet_(id, actor, body) {
  requireRole_(actor, ROLE_INSTRUCTOR);
  id = String(id);
  if (String(body.confirmUserId || '') !== id) {
    fail_('Підтвердіть повне видалення вибраного курсанта.', 'CONFIRMATION_REQUIRED');
  }
  var user = findUserById_(id), properties = PropertiesService.getScriptProperties();
  var pendingKey = 'DELETING_CADET_' + id;
  if (user && user.role !== ROLE_CADET) fail_('Видаляти можна лише курсантів.', 'FORBIDDEN');
  if (!user) {
    if (properties.getProperty(pendingKey)) properties.deleteProperty(pendingKey);
    return {deleted: true, userId: id, alreadyDeleted: true};
  }

  var resultRows = dataRows_('results'), legacyRows = dataRows_('legacyResults'), deletedRows = dataRows_('deletedResults');
  var resultOwners = Object.create(null);
  var resultIds = Object.create(null);
  var ownedKeys = Object.create(null), otherKeys = Object.create(null);
  resultRows.concat(deletedRows).forEach(function (row) {
    if (row[0] && row[1] && !resultOwners[String(row[0])]) resultOwners[String(row[0])] = String(row[1]);
    if (row[12]) (String(row[1]) === id ? ownedKeys : otherKeys)[String(row[12])] = true;
  });
  var legacyOwners = Object.create(null);
  legacyRows.forEach(function (row) {
    var owner = String(row[4] || ''), resultId = String(row[3] || '');
    if (!owner) return;
    if (row[0]) (owner === id ? ownedKeys : otherKeys)[String(row[0])] = true;
    if (!resultId || resultOwners[resultId]) return;
    if (legacyOwners[resultId] === undefined) legacyOwners[resultId] = owner;
    else if (legacyOwners[resultId] !== owner) legacyOwners[resultId] = '';
  });
  Object.keys(legacyOwners).forEach(function(key){resultOwners[key]=legacyOwners[key];});
  Object.keys(resultOwners).forEach(function(key){if(resultOwners[key]===id)resultIds[key]=true;});

  var names = Object.create(null), candidates = Object.create(null);
  function indexName(name, owner) {
    var key = normalize_(safeCellText_(name));
    if (key) (names[key] || (names[key] = Object.create(null)))[String(owner)] = true;
    return key;
  }
  listUsers_().forEach(function (person) {
    if (person.role === ROLE_CADET) indexName(person.fullName, person.id);
  });
  var legacyResults = legacyRows.filter(function(row){return row[4]&&row[5];}).map(function(row){
    return {userId:row[4],userName:row[5],testTitle:row[8],score:row[9],correct:row[10],total:row[11],durationSeconds:row[13]};
  });
  resultRows.map(resultFromRow_).concat(legacyResults).forEach(function (result) {
    var key = indexName(result.userName, result.userId);
    if (key) (candidates[key] || (candidates[key] = [])).push(result);
  });

  var privateTestIds = Object.create(null);
  dataRows_('tests').forEach(function (row) {
    if (markerValue_(String(row[2] || ''), RETRY_PREFIX) === id) privateTestIds[String(row[0])] = true;
  });

  var plans = [];
  function plan(sheet, rows, predicate) {
    plans.push({sheet: sheet, rows: plannedRowNumbers_(rows, predicate)});
  }
  function planPrivate(key, predicate) { plan(sheet_(key), dataRows_(key), predicate); }
  function planPublic(sheet, legacy) {
    if (!sheet || sheet.getLastRow() < 2) return;
    var width = sheet.getMaxColumns();
    var headers = sheet.getRange(1, 1, 1, width).getValues()[0];
    var userColumn = headers.indexOf('_ID курсанта');
    var resultColumn = headers.indexOf('_ID результату');
    if (!legacy && (userColumn < 0 || resultColumn < 0)) {
      fail_('У таблиці результатів немає ID. Спочатку оновіть її через «Оновити таблицю».', 'PUBLIC_RESULTS_SCHEMA');
    }
    var titleColumn = headers.indexOf('Тест');
    var canonicalRows=publicRowsFromSheet_(sheet,headers.indexOf('Група')<0);
    plan(sheet, sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues(), function (row,index) {
      var owner = String(row[userColumn] || ''), resultId = String(row[resultColumn] || '');
      var resultOwner = resultOwners[resultId] || '';
      if (owner && resultOwner && owner !== resultOwner && (owner === id || resultOwner === id)) {
        fail_('ID роботи й курсанта в таблиці не збігаються. Виправте цей рядок перед видаленням.', 'PUBLIC_RESULTS_SCHEMA');
      }
      if (owner || resultOwner) return owner === id || resultOwner === id;
      var name = normalize_(row[0]);
      if (!names[name] || !names[name][id]) return false;
      var visible=canonicalRows[index].slice(0,6);
      var owners = !resultId && visible.slice(1).every(function(value){return value === '';})
        ? Object.keys(names[name])
        : (candidates[name] || []).filter(function(result){return publicRowMatchesStoredResult_(visible,result);})
          .map(function(result){return String(result.userId);});
      if (resultId || !owners.length || (owners.indexOf(id) >= 0 && owners.some(function(value){return value !== id;}))) {
        fail_('Не вдалося однозначно визначити курсанта в старих рядках таблиці. Уточніть ID цих рядків перед видаленням.', 'PUBLIC_RESULTS_ID_REQUIRED');
      }
      return owners.indexOf(id) >= 0;
    });
  }
  var tables = intakePublicSheets_();
  planPublic(tables.public, false);
  planPublic(tables.legacyPublic, true);
  planPrivate('sync', function (row) {
    var type = String(row[1] || '');
    if (type.indexOf('result:') === 0) return Boolean(resultIds[type.slice(7)]);
    return Boolean(ownedKeys[String(row[0])] && !otherKeys[String(row[0])]);
  });
  planPrivate('materialProgress', function (row) { return String(row[2]) === id; });
  planPrivate('cadetNotes', function (row) { return String(row[0]) === id; });
  var draftOwners = Object.create(null);
  planPrivate('pcState', function (row) {
    if (String(row[0]) === id) return true;
    var key = String(row[1]);
    if (key.indexOf('grading:') !== 0 || !resultIds[key.slice(8)]) return false;
    draftOwners[String(row[0])] = true;
    return true;
  });
  planPrivate('examRecoveries', function (row) { return String(row[1]) === id; });
  function ownsResultRow(row) { return row[1] ? String(row[1]) === id : Boolean(resultIds[String(row[0])]); }
  planPrivate('resultDetails', ownsResultRow);
  planPrivate('retries', ownsResultRow);
  planPrivate('testParts', function (row) { return Boolean(privateTestIds[String(row[0])]); });
  planPrivate('testAccess', function (row) { return Boolean(privateTestIds[String(row[0])]); });
  planPrivate('tests', function (row) { return Boolean(privateTestIds[String(row[0])]); });
  planPrivate('audit', function (row) {
    return String(row[1]) === id || (String(row[4]) === 'cadet' && String(row[5]) === id)
      || (String(row[4]) === 'result' && Boolean(resultIds[String(row[5])]))
      || (String(row[4]) === 'test' && Boolean(privateTestIds[String(row[5])]));
  });
  // Keep result IDs available until auxiliary cleanup finishes, so retrying an
  // interrupted deletion is safe. The disabled account is removed last.
  plan(sheet_('legacyResults'), legacyRows, function (row) {
    return row[4] ? String(row[4]) === id : Boolean(resultIds[String(row[3])]);
  });
  plan(sheet_('deletedResults'), deletedRows, function (row) { return String(row[1]) === id; });
  plan(sheet_('results'), resultRows, function (row) { return String(row[1]) === id; });
  planPrivate('users', function (row) { return String(row[0]) === id; });
  try {
    properties.setProperty(pendingKey, '1');
    invalidatePublicSync_();
    sheet_('users').getRange(user.rowNumber, 8).setValue(false);
    Object.keys(draftOwners).forEach(function(owner){properties.setProperty('LK_PC_STATE_'+owner, Utilities.getUuid());});
    Object.keys(resultIds).forEach(function(resultId){properties.deleteProperty(reviewLeaseKey_(resultId));});
    properties.deleteProperty('LK_PC_STATE_' + id);
    properties.deleteProperty('SESSION_VERSION_' + id);
    plans.forEach(function (item) {
      deleteSheetRows_(item.sheet,item.rows);
    });
    properties.deleteProperty(pendingKey);
  } catch (error) {
    console.warn('Не завершено видалення курсанта ' + id + ': ' + String(error.message || error));
    fail_('Видалення не завершено. Повторіть «Видалити повністю».', 'DELETION_INCOMPLETE');
  }
  invalidatePublicSync_();
  // Retain only an anonymous action record; removed names and logins stay erased.
  logAudit_(actor, 'CADET_DELETE', 'cadet', id, '', 'Обліковий запис і пов’язані дані видалено.');
  return {deleted: true, userId: id, resultIds: Object.keys(resultIds), alreadyDeleted: false};
}

function sessionVersion_(userId) {
  return Math.max(0, Math.floor(Number(PropertiesService.getScriptProperties()
    .getProperty('SESSION_VERSION_' + String(userId)) || 0)));
}

function bumpSessionVersion_(userId) {
  var properties = PropertiesService.getScriptProperties();
  var key = 'SESSION_VERSION_' + String(userId);
  var next = Math.max(0, Math.floor(Number(properties.getProperty(key) || 0))) + 1;
  properties.setProperty(key, String(next));
  return next;
}

function getInvite_(user) {
  var primary = isPrimaryInstructor_(user.id);
  if (!primary) return {primary: false, code: '', expiresAt: ''};
  var properties = PropertiesService.getScriptProperties();
  var expires = Number(properties.getProperty('INVITE_EXPIRES_AT') || 0);
  var code = expires > Date.now() ? String(properties.getProperty('INVITE_CODE') || '') : '';
  return {primary: true, code: code, expiresAt: code ? new Date(expires).toISOString() : ''};
}

function generateInvite_(user) {
  if (!isPrimaryInstructor_(user.id)) fail_('Новий код може створити лише головний інструктор.', 'FORBIDDEN');
  var code = generateInviteCode_();
  var expires = Date.now() + INVITE_LIFETIME_MS;
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty('INVITE_CODE', code);
  properties.setProperty('INVITE_EXPIRES_AT', String(expires));
  logAudit_(user, 'INVITE_CREATE', 'instructor-invite', '', 'Код запрошення інструктора',
    'Код чинний 30 днів.');
  return {primary: true, code: code, expiresAt: new Date(expires).toISOString()};
}

function ensurePrimaryInstructor_() {
  var properties = PropertiesService.getScriptProperties();
  var primaryId = String(properties.getProperty('PRIMARY_INSTRUCTOR_ID') || '');
  var instructors = listUsers_().filter(function (user) { return user.role === ROLE_INSTRUCTOR; });
  if (primaryId && instructors.some(function (user) { return String(user.id) === primaryId; })) return;
  var windRoy = instructors.filter(function (user) { return normalize_(user.username) === 'windroy'; })[0];
  var primary = windRoy || instructors.sort(function (first, second) {
    return dateMillis_(first.createdAt) - dateMillis_(second.createdAt);
  })[0];
  if (primary) properties.setProperty('PRIMARY_INSTRUCTOR_ID', String(primary.id));
}

function isPrimaryInstructor_(userId) {
  ensurePrimaryInstructor_();
  return String(PropertiesService.getScriptProperties().getProperty('PRIMARY_INSTRUCTOR_ID') || '') === String(userId);
}

function generateInviteCode_() {
  var raw = Utilities.getUuid().replace(/-/g, '').toUpperCase().slice(0, 12);
  return raw.match(/.{1,4}/g).join('-');
}

function addVisibleCadetPlaceholder_(user) {
  var sheet = publicResultsSheet_();
  var rows = publicResultRows_();
  var exists = rows.some(function (row) {
    return String(row[6]) === String(user.id);
  });
  if (!exists) appendPublicRow_(sheet,publicPlaceholder_(user));
}

function publishVisibleResult_(result) {
  var sheet = publicResultsSheet_();
  var rows = publicResultRows_();
  var existingIndex=rows.findIndex(function(row){return String(row[7]||'')===String(result.id);});
  if(existingIndex>=0){writePublicRows_(sheet,existingIndex+2,[publicResultValues_(result)]);return;}
  var targetRow = -1;
  for (var index = 0; index < rows.length; index += 1) {
    if (String(rows[index][6]) === String(result.userId)
        && rows[index].slice(1, 5).every(function (value) { return value === ''; })) {
      targetRow = index + 2;
      break;
    }
  }
  var values = [publicResultValues_(result)];
  if (targetRow > 0) writePublicRows_(sheet,targetRow,values);
  else appendPublicRow_(sheet,values[0]);
}

function visibleTestForUser_(test, user) {
  if (isRetakeTest_(test)) return false;
  var groups = assignedGroups_(test.description);
  if (groups === null) return false;
  if (!groups.length) return true;
  return groups.some(function (name) { return normalize_(name) === normalize_(user.groupName); });
}

function validateGroupAssignments_(description) {
  if (String(description || '').indexOf(GROUP_PREFIX) < 0) return;
  var groups = assignedGroups_(description);
  if (!Array.isArray(groups) || !groups.length) {
    fail_('Некоректно вказані групи для тесту.', 'BAD_GROUP_ASSIGNMENT');
  }
  var existing = listGroups_().map(function (group) { return normalize_(group.name); });
  var missing = groups.filter(function (name) { return existing.indexOf(normalize_(name)) < 0; });
  if (missing.length) {
    fail_('Навчальну групу «' + missing[0] + '» не знайдено.', 'GROUP_NOT_FOUND');
  }
}

function markerValue_(text, prefix) {
  var value = String(text || '');
  var start = value.indexOf(prefix);
  if (start < 0) return '';
  var from = start + prefix.length;
  var end = value.indexOf(MARKER_SUFFIX, from);
  return end < 0 ? '' : value.slice(from, end);
}

function removeMarker_(text, prefix) {
  var value = String(text || '');
  var start = value.indexOf(prefix);
  if (start < 0) return value;
  var end = value.indexOf(MARKER_SUFFIX, start + prefix.length);
  if (end < 0) return value;
  end += MARKER_SUFFIX.length;
  if (value.charAt(end) === '\n') end += 1;
  return value.slice(0, start) + value.slice(end);
}

function assignedGroups_(description) {
  var encoded = markerValue_(description, GROUP_PREFIX);
  if (!encoded) return String(description || '').indexOf(GROUP_PREFIX) >= 0 ? null : [];
  try {
    while (encoded.length % 4) encoded += '=';
    var text = Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8');
    if (text.charAt(0) === '[') {
      var parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      return parsed.map(function (name) { return String(name || '').trim(); }).filter(Boolean);
    }
    return text.split('|').map(function (name) { return name.trim(); }).filter(Boolean);
  } catch (ignored) {
    return null;
  }
}

function nextId_(type, sheetKey) {
  var properties = PropertiesService.getScriptProperties();
  var key = 'NEXT_ID_' + String(type).toUpperCase();
  var current = Number(properties.getProperty(key) || 0);
  if (!current && sheetKey) {
    var rows=dataRows_(sheetKey);
    if(sheetKey==='results')rows=rows.concat(deletedResultRows_(null));
    rows.forEach(function (row) {
      var value = Number(row[0]);
      if (isFinite(value)) current = Math.max(current, value);
    });
  }
  current = Math.max(0, Math.floor(current)) + 1;
  properties.setProperty(key, String(current));
  return current;
}

function ensureAppSecret_() {
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('APP_SECRET')) {
    properties.setProperty('APP_SECRET', randomBase64_(48));
  }
}

function signText_(text) {
  ensureAppSecret_();
  var secret = PropertiesService.getScriptProperties().getProperty('APP_SECRET');
  return stripPadding_(Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(text), String(secret))));
}

function base64UrlText_(text) {
  return stripPadding_(Utilities.base64EncodeWebSafe(Utilities.newBlob(String(text)).getBytes()));
}

function base64UrlToText_(encoded) {
  var value = String(encoded || '');
  while (value.length % 4) value += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(value)).getDataAsString('UTF-8');
}

function randomBase64_(length) {
  var bytes = [];
  while (bytes.length < length) {
    var uuidBytes = Utilities.newBlob(Utilities.getUuid()).getBytes();
    for (var index = 0; index < uuidBytes.length && bytes.length < length; index += 1) bytes.push(uuidBytes[index]);
  }
  return Utilities.base64Encode(bytes);
}

function secureEquals_(first, second) {
  var a = String(first || '');
  var b = String(second || '');
  var difference = a.length ^ b.length;
  var length = Math.max(a.length, b.length);
  for (var index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index % Math.max(1, a.length)) || 0)
      ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return difference === 0;
}

function normalize_(value) {
  return String(value == null ? '' : value).trim().toLocaleLowerCase('uk-UA');
}

function normalizeCode_(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function cleanRequired_(value, message, maxLength) {
  var text = cleanText_(value, maxLength);
  if (!text) fail_(message, 'VALIDATION');
  return text;
}

function cleanText_(value, maxLength) {
  var text = String(value == null ? '' : value).trim();
  if (maxLength && text.length > maxLength) fail_('Значення перевищує ' + maxLength + ' символів.', 'VALIDATION');
  return text;
}

function safeCellText_(value) {
  var text = String(value == null ? '' : value);
  return /^[=+@-]/.test(text) ? "'" + text : text;
}

function asBoolean_(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === '' || value == null) return Boolean(fallback);
  var text = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'ні'].indexOf(text) >= 0) return false;
  if (['true', '1', 'yes', 'так'].indexOf(text) >= 0) return true;
  return Boolean(value);
}

function clampNumber_(value, min, max, fallback) {
  var number = Number(value);
  if (!isFinite(number)) number = Number(fallback || 0);
  return Math.max(min, Math.min(max, Math.round(number)));
}

function formatDuration_(seconds) {
  var clean = Math.max(0, Math.floor(Number(seconds) || 0));
  var hours = Math.floor(clean / 3600);
  var minutes = Math.floor((clean % 3600) / 60);
  var rest = clean % 60;
  if (hours) return hours + ' год ' + String(minutes).padStart(2, '0') + ' хв ' + String(rest).padStart(2, '0') + ' с';
  return minutes + ' хв ' + String(rest).padStart(2, '0') + ' с';
}

function iso_(value) {
  if (!value) return '';
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function dateMillis_(value) {
  var date = new Date(value || 0);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

function stripPadding_(value) {
  return String(value || '').replace(/=+$/g, '');
}

function decodePart_(value) {
  try { return decodeURIComponent(String(value || '')); }
  catch (ignored) { fail_('Некоректний ідентифікатор.', 'BAD_REQUEST'); }
}

function copyObject_(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail_(message, code) {
  var error = new Error(message);
  error.code = code || 'API_ERROR';
  throw error;
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

// PDF bytes stay in the existing private spreadsheet. No public file links or new Drive permission.
const MATERIAL_MAX_BYTES = 8 * 1024 * 1024;
const MATERIAL_PART_BYTES = 24576;
const MATERIAL_BATCH = 16;

function routeMaterials_(method, path, body, user) {
  if (method === 'GET' && path === '/api/materials') return materialCatalog_(user);
  var detail = path.match(/^\/api\/materials\/([^/]+)$/);
  if (method === 'GET' && detail) {
    var material = requireMaterial_(decodePart_(detail[1]), user);
    if (String(body.revision || '') !== String(material.revision)) fail_('Матеріал оновлено. Оновіть список.', 'MATERIAL_CHANGED');
    return {material:publicMaterial_(material)};
  }
  var m = path.match(/^\/api\/materials\/([^/]+)\/(chunks|progress)(?:\/(\d+))?$/);
  if (m) {
    var item = requireMaterial_(decodePart_(m[1]), user);
    if (String(body.revision || '') !== String(item.revision)) fail_('Матеріал оновлено. Оновіть список і відкрийте його знову.', 'MATERIAL_CHANGED');
    if (method === 'GET' && m[2] === 'chunks' && m[3] != null) return materialContent_(item, Number(m[3]));
    if (method === 'POST' && m[2] === 'progress' && m[3] == null) return saveMaterialProgress_(item, user, body);
  }
  if (path.indexOf('/api/instructor/material') !== 0) return null;
  requireRole_(user, ROLE_INSTRUCTOR);
  if (method === 'POST' && path === '/api/instructor/material-uploads') return beginMaterialUpload_(user, body);
  m = path.match(/^\/api\/instructor\/material-uploads\/([^/]+)\/parts$/);
  if (method === 'POST' && m) return uploadMaterialParts_(user, decodePart_(m[1]), body);
  if (method === 'POST' && path === '/api/instructor/materials') return publishMaterial_(user, body);
  m = path.match(/^\/api\/instructor\/materials\/([^/]+)(\/progress)?$/);
  if (m && method === 'GET' && m[2]) return materialReaders_(requireMaterial_(decodePart_(m[1]), user));
  if (m && method === 'DELETE' && !m[2]) {
    var item = requireMaterial_(decodePart_(m[1]), user);
    if (String(body.expectedRevision) !== String(item.revision)) fail_('Матеріал уже змінено іншим інструктором.', 'MATERIAL_CHANGED');
    sheet_('materials').getRange(item.row, 15).setValue(false);
    logAudit_(user, 'Видалено матеріал', 'material', item.id, item.title, '');
    return {deleted:true,materialId:item.id};
  }
  return null;
}
function requireCardCadet_(id) {
  requireCadetNotDeleting_(id);
  var cadet=findUserById_(id);
  if(!cadet||cadet.role!==ROLE_CADET)fail_('Курсанта не знайдено.','NOT_FOUND');
  return cadet;
}
function cadetNoteFromRow_(row) {
  var data=JSON.parse(String(row[3]||'{}'));
  return {id:String(row[1]),cadetId:String(row[0]),authorId:String(row[2]),authorName:String(data.authorName||''),text:String(data.text||''),createdAt:iso_(row[4])};
}
function instructorCadetCard_(id) {
  var cadet=requireCardCadet_(id),uid=String(cadet.id),groups=listGroups_(),progress=Object.create(null),visited=Object.create(null);
  dataRows_('materialProgress').forEach(function(row){
    if(String(row[2])!==uid)return;
    visited[String(row[0])]=true;var key=String(row[0])+':'+String(row[1]);
    progress[key]={revision:Number(row[1]),lastPage:Number(row[3]),maxPage:Number(row[4]),pageCount:Number(row[5]),openedAt:iso_(row[6]),updatedAt:iso_(row[7])};
  });
  var materials=materialRows_().filter(function(item){return canReadMaterial_(item,cadet,groups)||visited[item.id];}).map(function(item){
    return {material:publicMaterial_(item),assigned:canReadMaterial_(item,cadet,groups),progress:progress[item.id+':'+item.revision]||null};
  });
  return {cadetCardProtocol:1,cadet:publicUser_(cadet),results:listResults_(uid),tests:listTestsForUser_(cadet),materials:materials,
    recoveries:listExamRecoveries_(cadet,true),notes:dataRows_('cadetNotes').filter(function(row){return String(row[0])===uid;}).map(cadetNoteFromRow_).reverse(),updatedAt:new Date().toISOString()};
}
function addCadetNote_(actor,id,body) {
  requireRole_(actor,ROLE_INSTRUCTOR);
  var cadet=requireCardCadet_(id),text=typeof body.text==='string'?body.text.trim():'',requestId=String(body.requestId||'');
  if(!text||text.length>2000||!/^[A-Za-z0-9_-]{8,80}$/.test(requestId))fail_('Примітка має містити від 1 до 2000 символів.','INVALID_NOTE');
  var old=dataRows_('cadetNotes').filter(function(row){return String(row[1])===requestId&&String(row[2])===String(actor.id);})[0];
  if(old){var saved=cadetNoteFromRow_(old);if(saved.cadetId!==String(id)||saved.text!==text)fail_('Цей ключ уже використано для іншої примітки.','NOTE_CONFLICT');return {saved:true,cadetId:String(id),note:saved};}
  var row=[String(id),requestId,String(actor.id),JSON.stringify({text:text,authorName:String(actor.fullName||actor.username)}),new Date().toISOString()];
  sheet_('cadetNotes').appendRow(row);
  logAudit_(actor,'CADET_NOTE_ADD','cadet',String(id),cadet.fullName,'Додано примітку інструктора.');
  return {saved:true,cadetId:String(id),note:cadetNoteFromRow_(row)};
}

function materialRows_() {
  return dataRows_('materials').map(function(r,i) {
    return {id:String(r[0]),title:String(r[1]),description:String(r[2]||''),topic:String(r[3]||''),groupIds:JSON.parse(r[4]||'[]'),testId:String(r[5]||''),fileId:String(r[6]),revision:Number(r[7]),size:Number(r[8]),sha256:String(r[9]),pageCount:Number(r[10]),createdBy:String(r[11]),createdAt:iso_(r[12]),updatedAt:iso_(r[13]),active:asBoolean_(r[14],true),row:i+2};
  }).filter(function(m){return m.id&&m.active;});
}
function canReadMaterial_(item,user,groups) {
  if (user.role === ROLE_INSTRUCTOR) return true;
  return groups.some(function(g){return g.name === user.groupName && item.groupIds.indexOf(String(g.id)) >= 0;});
}
function publicMaterial_(item) {
  var m = Object.assign({},item); delete m.row; delete m.fileId; delete m.active; return m;
}
function requireMaterial_(id,user) {
  var m = materialRows_().filter(function(v){return v.id === String(id);})[0];
  if (!m || !canReadMaterial_(m,user,listGroups_())) fail_('Матеріал видалено або він недоступний вашій групі.', 'MATERIAL_NOT_FOUND');
  return m;
}
function materialCatalog_(user) {
  var groups=listGroups_(),allowed=Object.create(null);
  groups.forEach(function(g){if(g.name===user.groupName)allowed[String(g.id)]=true;});
  var items=materialRows_().filter(function(m){return user.role===ROLE_INSTRUCTOR||m.groupIds.some(function(id){return allowed[String(id)];});});
  var progress=dataRows_('materialProgress').filter(function(r){return String(r[2])===String(user.id);}).map(function(r){return {materialId:String(r[0]),revision:Number(r[1]),lastPage:Number(r[3]),maxPage:Number(r[4]),pageCount:Number(r[5]),openedAt:iso_(r[6]),updatedAt:iso_(r[7])};});
  return {materials:items.map(publicMaterial_),progress:progress,partBytes:MATERIAL_PART_BYTES,batchParts:MATERIAL_BATCH,maxBytes:MATERIAL_MAX_BYTES};
}
function materialUpload_(id,user) {
  var found=dataRows_('materialFiles').map(function(r,i){return {r:r,row:i+2};}).filter(function(v){return String(v.r[0])===id;})[0];
  if (!found || String(found.r[1])!==String(user.id)) fail_('Завантаження недоступне.', 'UPLOAD_NOT_FOUND');
  return found;
}
function beginMaterialUpload_(user,body) {
  var id=String(body.uploadId||''),size=Number(body.size),sha=String(body.sha256||'');
  if (!/^[a-zA-Z0-9-]{20,80}$/.test(id)||!Number.isInteger(size)||size<12||size>MATERIAL_MAX_BYTES||!/^[a-f0-9]{64}$/.test(sha)) fail_('Оберіть PDF розміром до 8 МБ.', 'INVALID_PDF');
  var existing=dataRows_('materialFiles').filter(function(r){return String(r[0])===id;})[0];
  if (existing) {
    if(String(existing[1])!==String(user.id)||Number(existing[4])!==size||String(existing[5])!==sha) fail_('Конфлікт завантаження.', 'UPLOAD_CONFLICT');
    return {uploadId:id,partBytes:MATERIAL_PART_BYTES};
  }
  reclaimMaterialStorage_();
  var files=dataRows_('materialFiles');
  var total=files.reduce(function(n,r){return n+Number(r[4]||0);},0);
  if(total+size>100*1024*1024) fail_('Сховище матеріалів заповнено (100 МБ). Зверніться до головного інструктора.', 'MATERIAL_STORAGE_FULL');
  var count=Math.ceil(size/MATERIAL_PART_BYTES),start=2;
  files.slice().sort(function(a,b){return Number(a[8])-Number(b[8]);}).forEach(function(r){if(Number(r[8])<start+count)start=Math.max(start,Number(r[8])+Number(r[6]));});
  var chunks=sheet_('materialChunks');if(start+count-1>chunks.getMaxRows())chunks.insertRowsAfter(chunks.getMaxRows(),start+count-1-chunks.getMaxRows());
  // The small metadata row reserves a stable contiguous block before parts arrive.
  sheet_('materialFiles').appendRow([id,String(user.id),'',new Date().toISOString(),size,sha,count,'upload',start]);
  return {uploadId:id,partBytes:MATERIAL_PART_BYTES};
}
function uploadMaterialParts_(user,id,body) {
  var file=materialUpload_(id,user),r=file.r,parts=body.parts;
  if(String(r[7])!=='upload') return {uploadId:id,complete:true};
  if(!Array.isArray(parts)||parts.length<1||parts.length>MATERIAL_BATCH) fail_('Некоректні частини файлу.', 'INVALID_PART');
  var first=Number(parts[0].index);
  if(!Number.isInteger(first)||first<0||first+parts.length>Number(r[6])||parts.some(function(p,i){return Number(p.index)!==first+i;}))fail_('Некоректний порядок частин.', 'INVALID_PART');
  var old=sheet_('materialChunks').getRange(Number(r[8])+first,1,parts.length,3).getValues(),added=[];
  parts.forEach(function(part,j){
    var i=Number(part.index),data=String(part.data||''),expected=Math.min(MATERIAL_PART_BYTES,Number(r[4])-i*MATERIAL_PART_BYTES);
    if(data.length!==4*Math.ceil(expected/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))fail_('Некоректна частина PDF.', 'INVALID_PART');
    var decoded=Utilities.base64Decode(data);
    if(decoded.length!==expected||Utilities.base64Encode(decoded)!==data)fail_('Пошкоджена частина PDF.', 'INVALID_PART');
    if(old[j][0]&&String(old[j][0])!==id)fail_('Конфлікт сховища.', 'UPLOAD_CONFLICT');
    if(old[j][2]&&String(old[j][2])!==data)fail_('Повторна частина відрізняється.', 'UPLOAD_CONFLICT');
    added.push([id,i,data]);
  });
  sheet_('materialChunks').getRange(Number(r[8])+first,1,added.length,3).setValues(added);
  return {uploadId:id,accepted:parts.length};
}
function orderedMaterialParts_(fileId,offset,limit) {
  var f=dataRows_('materialFiles').filter(function(r){return String(r[0])===fileId;})[0];
  if(!f)fail_('Файл матеріалу не знайдено.', 'INVALID_PDF');
  offset=offset||0;var count=Math.min(limit||Number(f[6]),Number(f[6])-offset);
  return sheet_('materialChunks').getRange(Number(f[8])+offset,1,count,3).getValues().filter(function(r){return String(r[0])===fileId&&Boolean(r[2]);});
}

function publishMaterial_(user,body) {
  var id=String(body.id||''),old=id?requireMaterial_(id,user):null;
  var uploadId=String(body.uploadId||'');
  if(uploadId){
    var prior=materialRows_().filter(function(m){return m.fileId===uploadId;})[0];
    if(prior){materialUpload_(uploadId,user);if(!id||id===prior.id)return {material:publicMaterial_(prior),duplicate:true};fail_('Цей файл уже опубліковано.', 'UPLOAD_CONFLICT');}
  }
  var revision=Number(body.expectedRevision||0);
  if(old&&old.revision!==revision) fail_('Матеріал уже змінено іншим інструктором.', 'MATERIAL_CHANGED');
  var title=cleanText_(body.title,160),description=cleanText_(body.description,2000),topic=cleanText_(body.topic,80),groups=body.groupIds,testId=String(body.testId||'');
  if(!title||!Array.isArray(groups)||!groups.length||groups.length>100)fail_('Вкажіть назву та хоча б одну групу.', 'INVALID_MATERIAL');
  groups=groups.map(String).filter(function(v,i,a){return a.indexOf(v)===i;});
  var known=listGroups_().map(function(g){return String(g.id);});
  if(groups.some(function(g){return known.indexOf(g)<0;}))fail_('Навчальну групу видалено. Оновіть список.', 'GROUP_NOT_FOUND');
  if(testId&&!listTestsForUser_(user).some(function(t){return String(t.id)===testId&&t.published;}))fail_('Оберіть опублікований тест.', 'TEST_NOT_FOUND');
  var upload=String(body.uploadId||''),f=upload?materialUpload_(upload,user):null;
  // A lost success response must not publish a second material on retry.
  if(f&&String(f.r[7])==='published'){
    var committed=materialRows_().filter(function(m){return m.fileId===upload;})[0];
    if(committed&&(!id||committed.id===id))return {material:publicMaterial_(committed),duplicate:true};
    fail_('Цей файл уже опубліковано.', 'UPLOAD_CONFLICT');
  }
  var pages=Number(body.pageCount||old&&old.pageCount||0);
  if(!Number.isInteger(pages)||pages<1||pages>500)fail_('PDF має містити від 1 до 500 сторінок.', 'INVALID_PDF');
  if(!old&&!f)fail_('Спочатку завантажте PDF.', 'INVALID_PDF');
  if(f){
    var parts=orderedMaterialParts_(upload),count=Number(f.r[6]);
    if(parts.length!==count||parts.some(function(r,i){return Number(r[1])!==i;}))fail_('PDF завантажено не повністю. Повторіть публікацію.', 'UPLOAD_INCOMPLETE');
    var bytes=Utilities.base64Decode(parts.map(function(r){return String(r[2]);}).join(''));
    var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
    var head=bytes.slice(0,5).map(function(b){return String.fromCharCode((b+256)%256);}).join(''),tail=bytes.slice(-2048).map(function(b){return String.fromCharCode((b+256)%256);}).join('');
    if(bytes.length!==Number(f.r[4])||digest!==String(f.r[5])||head!=='%PDF-'||tail.indexOf('%%EOF')<0)fail_('Файл PDF пошкоджений. Оберіть файл повторно.', 'INVALID_PDF');
  }
  id=old?old.id:Utilities.getUuid();var now=new Date().toISOString();
  var row=[id,safeCellText_(title),safeCellText_(description),safeCellText_(topic),JSON.stringify(groups),testId,f?upload:old.fileId,(old?old.revision:0)+1,f?Number(f.r[4]):old.size,f?String(f.r[5]):old.sha256,pages,old?old.createdBy:String(user.id),old?old.createdAt:now,now,true];
  if(old)sheet_('materials').getRange(old.row,1,1,row.length).setValues([row]);else sheet_('materials').appendRow(row);
  if(f)sheet_('materialFiles').getRange(f.row,3).setValue(id);
  if(f)sheet_('materialFiles').getRange(f.row,8).setValue('published');
  logAudit_(user,old?'Оновлено матеріал':'Додано матеріал','material',id,title,'');
  return {material:publicMaterial_(requireMaterial_(id,user))};
}
function materialContent_(item,batch) {
  var total=Math.ceil(item.size/MATERIAL_PART_BYTES),start=batch*MATERIAL_BATCH;
  if(!Number.isInteger(batch)||batch<0||start>=total)fail_('Некоректна частина PDF.', 'INVALID_PART');
  var parts=orderedMaterialParts_(item.fileId,start,MATERIAL_BATCH);
  if(parts.length!==Math.min(MATERIAL_BATCH,total-start))fail_('Файл збережено не повністю.', 'INVALID_PDF');
  return {revision:item.revision,sha256:item.sha256,totalParts:total,parts:parts.map(function(r){return {index:Number(r[1]),data:String(r[2])};})};
}
function saveMaterialProgress_(item,user,body) {
  requireRole_(user,ROLE_CADET);
  var page=Number(body.lastPage),max=Number(body.maxPage||page);
  if(!Number.isInteger(page)||page<1||page>item.pageCount||!Number.isInteger(max)||max<page||max>item.pageCount)fail_('Некоректний номер сторінки.', 'INVALID_PROGRESS');
  var rows=dataRows_('materialProgress'),index=-1;
  rows.forEach(function(r,i){if(String(r[0])===item.id&&Number(r[1])===item.revision&&String(r[2])===String(user.id))index=i;});
  var old=index<0?null:rows[index],now=new Date().toISOString(),row=[item.id,item.revision,String(user.id),page,Math.max(max,old?Number(old[4]):0),item.pageCount,old?old[6]:now,now];
  if(index<0)sheet_('materialProgress').appendRow(row);else sheet_('materialProgress').getRange(index+2,1,1,row.length).setValues([row]);
  return {saved:true,revision:item.revision};
}
function materialReaders_(item) {
  var groups=listGroups_(),rows=dataRows_('materialProgress'),results=item.testId?listResults_(null):[];
  var progressByUser=Object.create(null),resultByUser=Object.create(null);
  rows.forEach(function(r){var uid=String(r[2]);if(String(r[0])===item.id&&Number(r[1])===item.revision&&!progressByUser[uid])progressByUser[uid]=r;});
  // Results are newest first; preserve the existing selection for legacy duplicates.
  results.forEach(function(r){if(String(r.testId)===item.testId&&!resultByUser[String(r.userId)])resultByUser[String(r.userId)]=r;});
  var readers=listUsers_().filter(function(u){return u.role===ROLE_CADET&&canReadMaterial_(item,u,groups);}).map(function(u){
    var r=progressByUser[String(u.id)],result=resultByUser[String(u.id)];
    return {userId:String(u.id),fullName:u.fullName,username:u.username,groupName:u.groupName,openedAt:r?iso_(r[6]):'',lastPage:r?Number(r[3]):0,maxPage:r?Number(r[4]):0,pageCount:item.pageCount,result:result||null};
  });
  return {material:publicMaterial_(item),readers:readers};
}

/** Drop bytes that are no longer referenced; abandoned incomplete uploads expire after one day. */
function reclaimMaterialStorage_() {
  var active=Object.create(null);materialRows_().forEach(function(m){active[m.fileId]=true;});
  var expired=Object.create(null),files=dataRows_('materialFiles'),cutoff=Date.now()-86400000;
  files.forEach(function(r){if(!active[String(r[0])]&&(String(r[7])==='published'||new Date(r[3]).getTime()<cutoff))expired[String(r[0])]=true;});
  files.forEach(function(r){if(expired[String(r[0])])sheet_('materialChunks').getRange(Number(r[8]),1,Number(r[6]),3).setValues(Array.from({length:Number(r[6])},function(){return ['','',''];}));});
  for(var i=files.length-1;i>=0;i--)if(expired[String(files[i][0])])sheet_('materialFiles').deleteRow(i+2);
}

function archiveGroup_(id,actor,body) {
  if(typeof body.archived!=='boolean')fail_('Укажіть стан групи.', 'BAD_REQUEST');
  var group=findGroupById_(id);if(!group)fail_('Групу не знайдено.','GROUP_NOT_FOUND');
  if(group.archived===body.archived)return {group:group};
  if(Number(body.expectedRevision)!==group.revision)fail_('Групу змінено іншим інструктором. Оновіть список.','REVISION_CONFLICT');
  var rows=dataRows_('groups'),index=rows.findIndex(function(r){return String(r[0])===String(id);});
  sheet_('groups').getRange(index+2,5,1,2).setValues([[body.archived,group.revision+1]]);
  logAudit_(actor,body.archived?'GROUP_ARCHIVE':'GROUP_RESTORE','group',group.id,group.name,'Облікові записи й результати збережено.');
  return {group:findGroupById_(id)};
}
function bulkAssignTests_(actor,body) {
  var selected=body.tests,groupIds=body.groupIds;
  if(!Array.isArray(selected)||!selected.length||selected.length>200||!Array.isArray(groupIds)||!groupIds.length||groupIds.length>200)fail_('Оберіть від 1 до 200 тестів і груп.','BAD_REQUEST');
  var seen=Object.create(null),groups=groupIds.map(function(id){var g=findGroupById_(id);if(!g||g.archived)fail_('Оберіть активні навчальні групи.','GROUP_NOT_FOUND');if(seen[String(id)])fail_('Групу вказано двічі.','BAD_REQUEST');seen[String(id)]=true;return g.name;});
  var names=groups.slice().sort(),marker=GROUP_PREFIX+Utilities.base64EncodeWebSafe(JSON.stringify(names)).replace(/=+$/,'')+MARKER_SUFFIX;
  var rows=dataRows_('tests'),updates=Object.create(null);seen=Object.create(null);
  selected.forEach(function(item){
    var id=String(item.testId||'');if(seen[id])fail_('Тест указано двічі.','BAD_REQUEST');seen[id]=true;
    var test=getTestById_(id);if(!test||isArchivedTest_(test)||markerValue_(test.description,RETRY_PREFIX))fail_('Тест недоступний. Оновіть каталог.','TEST_NOT_FOUND');
    var current=assignedGroups_(test.description),same=Array.isArray(current)&&JSON.stringify(current.slice().sort())===JSON.stringify(names);
    if(!same && (typeof item.expectedDescription!=='string'||item.expectedDescription!==test.description))fail_('Призначення тесту змінено іншим інструктором. Оновіть каталог.','REVISION_CONFLICT');
    var description=marker+'\n'+removeMarker_(test.description,GROUP_PREFIX).trim();
    if(description.length>4000)fail_('Опис тесту разом із групами надто довгий.','BAD_REQUEST');
    updates[id]=description;
  });
  // Validate everything before one batch write. Questions and accepted attempts are untouched.
  var descriptions=rows.map(function(row){return [safeCellText_(Object.prototype.hasOwnProperty.call(updates,String(row[0]))?updates[String(row[0])]:String(row[2]||''))];});
  sheet_('tests').getRange(2,3,descriptions.length,1).setValues(descriptions);
  logAudit_(actor,'TESTS_ASSIGN','tests','bulk','Тестів: '+selected.length,'Групи: '+names.join(', '));
  return {assignedTestIds:selected.map(function(i){return String(i.testId);}),groupIds:groupIds.map(String),assignedCount:selected.length};
}

function isWritten_(q) { return q && q.type === 'written'; }
function questionPoints_(q) { return Number.isInteger(q.maxPoints) && q.maxPoints>=1 && q.maxPoints<=100 ? q.maxPoints : 1; }
function resultGrading_(test,selected,grades) {
  var out={correct:0,choiceTotal:0,pendingWritten:0,earnedPoints:0,maxPoints:0};
  test.questions.forEach(function(q){
    var max=questionPoints_(q);out.maxPoints+=max;
    if(isWritten_(q)) {
      var g=grades[String(q.id)];
      if(g && Number.isInteger(g.points) && g.points>=0 && g.points<=max)out.earnedPoints+=g.points;
      else out.pendingWritten++;
    } else {
      out.choiceTotal++;
      if(choiceCorrect_(q,selected[String(q.id)])) {out.correct++;out.earnedPoints+=max;}
    }
  });
  out.gradingStatus=out.pendingWritten?'pending_review':'graded';
  out.score=out.pendingWritten?null:Math.round(out.earnedPoints*100/out.maxPoints);
  out.passed=out.pendingWritten?null:out.score>=test.passingPercent;
  return out;
}
function resultRecordById_(id) {
  var sheet=sheet_('results'),n=sheet.getLastRow();if(n<2)return null;
  var ids=sheet.getRange(2,1,n-1,1).getValues();
  for(var i=0;i<ids.length;i++)if(String(ids[i][0])===String(id)) {
    var row=sheet.getRange(i+2,1,1,HEADERS.results.length).getValues()[0];
    return {row:row,rowNumber:i+2,result:resultFromRow_(row)};
  }
  return null;
}
function buildResultReview_(user,result,test,selected,grades) {
  return test.questions.map(function(q){
    if(isWritten_(q)) {
      var g=grades[String(q.id)] || {};
      var out={questionId:q.id,type:'written',questionText:String(q.text||''),text:String(selected[String(q.id)]||''),maxPoints:questionPoints_(q),
        points:Number.isInteger(g.points)?g.points:null,comment:String(g.comment||''),reviewerName:String(g.reviewerName||''),reviewedAt:String(g.reviewedAt||'')};
      if(user.role===ROLE_INSTRUCTOR || result.gradingStatus!=='pending_review'){out.rubric=String(q.rubric||'');out.explanation=String(q.explanation||'');}
      return out;
    }
    var correctIds=q.answers.filter(function(a){return a.isCorrect===true;}).map(function(a){return String(a.id);}).sort(),selectedIds=choiceIds_(q,selected[String(q.id)]);
    function text(ids){return ids.map(function(id){return q.answers.filter(function(a){return String(a.id)===id;})[0].text;}).join('; ');}
    return {questionId:q.id,type:'choice',questionText:String(q.text||''),selectedAnswerId:selectedIds[0]||'0',correctAnswerId:correctIds[0]||'0',selectedAnswerIds:selectedIds,correctAnswerIds:correctIds,isCorrect:choiceCorrect_(q,selected[String(q.id)]),
      selectedAnswerText:selectedIds.length?text(selectedIds):'Без відповіді',correctAnswerText:correctIds.length?text(correctIds):'Відповідь недоступна',explanation:String(q.explanation||''),maxPoints:questionPoints_(q)};
  });
}
function resultReview_(user,id) {
  var r=resultRecordById_(id);if(!r)fail_('Результат не знайдено.','RESULT_NOT_FOUND');
  if(user.role!==ROLE_INSTRUCTOR && String(r.result.userId)!==String(user.id))fail_('Недостатньо прав.','FORBIDDEN');
  var test=getTestById_(r.result.testId);if(!test)fail_('Деталі тесту недоступні.','REVIEW_UNAVAILABLE');
  return {result:r.result,review:buildResultReview_(user,r.result,test,JSON.parse(String(r.row[13]||'{}')),JSON.parse(String(r.row[22]||'{}')))};
}
function reviewLeaseKey_(id) { return REVIEW_LEASE_PREFIX + encodeURIComponent(String(id)); }
function reviewClientId_(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value)) fail_('Не вдалося визначити вікно перевірки. Відкрийте роботу знову.', 'BAD_REQUEST');
  return value;
}
function readReviewLease_(id, now, properties) {
  var raw = properties.getProperty(reviewLeaseKey_(id));
  if (!raw) return null;
  var value;
  try { value = JSON.parse(raw); } catch (ignored) { fail_('Не вдалося прочитати стан перевірки. Повторіть пізніше.', 'REVIEW_STATE_ERROR'); }
  if (!value || String(value.resultId) !== String(id) || !value.userId || !value.clientId || !value.leaseId
      || !Number.isFinite(value.expiresAt)) fail_('Некоректний стан перевірки. Повторіть пізніше.', 'REVIEW_STATE_ERROR');
  return value.expiresAt > now ? value : null;
}
function publicReviewLease_(id, value, user, clientId, now) {
  var owned = Boolean(value && String(value.userId) === String(user.id) && value.clientId === clientId);
  var result = {resultId:String(id), state:value ? (owned ? 'owned' : 'busy') : 'free', serverNow:now};
  if (value) {
    result.reviewerName = value.reviewerName;
    result.reviewerId = String(value.userId);
    result.expiresAt = value.expiresAt;
    if (owned) result.leaseId = value.leaseId;
  }
  return result;
}
function reviewQueueWithPresence_(user, body) {
  var now = Date.now(), properties = PropertiesService.getScriptProperties();
  var all = properties.getProperties();
  var lookup = {getProperty:function(key){return all[key] || null;}};
  var results = listResults_(null).filter(function(r){return r.gradingStatus === 'pending_review' && (!body.groupName || r.groupName === body.groupName) && (!body.testId || String(r.testId) === String(body.testId));});
  results.forEach(function(result){
    var lease = readReviewLease_(result.id, now, lookup);
    // Queue readers never receive the private lease credential.
    result.reviewPresence = publicReviewLease_(result.id, lease, user, '', now);
  });
  var stable = !all.LK_WORKSPACE_WRITE && !properties.getProperty('LK_WORKSPACE_WRITE') && String(all.LK_REV_results || '0') === String(properties.getProperty('LK_REV_results') || '0');
  return {results:results, reviewPresence:true, serverNow:now, resultsRevision:stable ? String(all.LK_REV_results || '0') : null};
}
function reviewPresenceSnapshot_(user) {
  var properties=PropertiesService.getScriptProperties(),all=properties.getProperties(),now=Date.now(),sessions=[];
  var lookup={getProperty:function(key){return all[key] || null;}};
  Object.keys(all).forEach(function(key){
    if(key.indexOf(REVIEW_LEASE_PREFIX)!==0)return;
    var id=decodeURIComponent(key.slice(REVIEW_LEASE_PREFIX.length)),lease=readReviewLease_(id,now,lookup);
    if(lease)sessions.push(publicReviewLease_(id,lease,user,'',now));
  });
  // This poll reads only small properties; it never scans the results sheet.
  return {sessions:sessions,serverNow:now,stable:!all.LK_WORKSPACE_WRITE,resultsRevision:String(all.LK_REV_results || '0')};
}
function reviewSession_(user, id, body, method) {
  requireRole_(user, ROLE_INSTRUCTOR);
  var clientId = reviewClientId_(body.clientId), properties = PropertiesService.getScriptProperties(), now = Date.now();
  var lease = readReviewLease_(id, now, properties), action = method === 'GET' ? 'status' : body.action;
  if (['open','renew','release','status'].indexOf(action) < 0) fail_('Невідома дія перевірки.', 'BAD_REQUEST');
  var owned = lease && String(lease.userId) === String(user.id) && lease.clientId === clientId && lease.leaseId === body.leaseId;
  if (action === 'release') {
    if (owned) properties.deleteProperty(reviewLeaseKey_(id));
    return {reviewSession:publicReviewLease_(id, owned ? null : lease, user, clientId, now)};
  }
  var review;
  if (action === 'open') {
    review = resultReview_(user, id);
    if (!review.review.some(isWritten_)) {
      review.reviewSession = {resultId:String(id), state:'view', serverNow:now};
      return review;
    }
    // Expired crashed sessions are collected under the same short script lock.
    var all = properties.getProperties();
    Object.keys(all).forEach(function(key){
      if (key.indexOf(REVIEW_LEASE_PREFIX) !== 0) return;
      try { if (Number(JSON.parse(all[key]).expiresAt) <= now) properties.deleteProperty(key); } catch (ignored) {}
    });
    if (!lease || (String(lease.userId) === String(user.id) && lease.clientId === clientId)) {
      lease = {resultId:String(id),userId:String(user.id),clientId:clientId,leaseId:Utilities.getUuid(),
        reviewerName:String(user.displayName || user.fullName || user.username),expiresAt:now + REVIEW_LEASE_MS};
      properties.setProperty(reviewLeaseKey_(id), JSON.stringify(lease));
    }
  } else if (action === 'renew' && owned) {
    lease.expiresAt = now + REVIEW_LEASE_MS;
    properties.setProperty(reviewLeaseKey_(id), JSON.stringify(lease));
  }
  var response = review || {};
  response.reviewSession = publicReviewLease_(id, lease, user, action === 'open' || owned ? clientId : '', now);
  return response;
}
function requireReviewLease_(user, id, credential) {
  var lease = readReviewLease_(id, Date.now(), PropertiesService.getScriptProperties());
  // Older PCs retain revision protection, but cannot write over an active session.
  if (!credential && !lease) return;
  if (!credential || !lease || String(lease.userId) !== String(user.id)
      || lease.clientId !== credential.clientId || lease.leaseId !== credential.leaseId) {
    if (lease) fail_('Роботу зараз перевіряє ' + lease.reviewerName + '. Вашу чернетку збережено.', 'REVIEW_IN_PROGRESS');
    fail_('Час спільної перевірки минув. Почніть перевірку знову; чернетку збережено.', 'REVIEW_LEASE_EXPIRED');
  }
}
function gradeResult_(user,id,body) {
  requireRole_(user,ROLE_INSTRUCTOR);
  var r=resultRecordById_(id);if(!r)fail_('Результат не знайдено.','RESULT_NOT_FOUND');
  requireCadetNotDeleting_(r.result.userId);
  if(r.row[PUBLIC_SYNC_COLUMN-1]===RESULT_DELETING)fail_('Триває видалення цієї роботи.','RESULT_DELETION_PENDING');
  var test=getTestById_(r.result.testId);if(!test || !test.questions.some(isWritten_))fail_('У роботі немає письмових завдань.','BAD_REQUEST');
  if(!Array.isArray(body.grades) || body.grades.length>200 || !body.grades.length)fail_('Укажіть хоча б одну оцінку.','BAD_REQUEST');
  var requestId=cleanRequired_(body.requestId,'Не задано ключ збереження перевірки.',100);
  var byId=Object.create(null);test.questions.forEach(function(q){if(isWritten_(q))byId[String(q.id)]=q;});
  var seen=Object.create(null);
  var normalized=body.grades.map(function(g){
    var key=String(g.questionId),q=byId[key];if(!q || seen[key])fail_('Некоректне питання перевірки.','BAD_REQUEST');seen[key]=true;
    if(typeof g.points!=='number' || !Number.isInteger(g.points) || g.points<0 || g.points>questionPoints_(q))fail_('Бали мають бути цілим числом від 0 до максимуму питання.','BAD_GRADE');
    if(g.comment!=null && (typeof g.comment!=='string' || g.comment.length>1000))fail_('Коментар: до 1000 символів.','BAD_GRADE');
    return {questionId:key,points:g.points,comment:String(g.comment||'')};
  }).sort(function(a,b){return a.questionId.localeCompare(b.questionId);});
  var fingerprint=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(normalized),Utilities.Charset.UTF_8));
  var grades=JSON.parse(String(r.row[22]||'{}'));
  if(grades._requestId===requestId) {
    if(grades._fingerprint!==fingerprint)fail_('Ключ збереження вже використано для інших балів.','REVISION_CONFLICT');
    var replay=resultReview_(user,id);replay.tableSynced=publishCommittedResult_(r.result,r.rowNumber);return replay;
  }
  if(!Number.isInteger(body.expectedRevision) || body.expectedRevision!==r.result.gradingRevision)fail_('Інший викладач уже перевірив цю роботу. Відкрийте її знову.','REVISION_CONFLICT');
  requireReviewLease_(user, id, body.reviewLease);
  var now=new Date().toISOString();
  normalized.forEach(function(g){var old=grades[g.questionId];if(!old || old.points!==g.points || old.comment!==g.comment)grades[g.questionId]={points:g.points,comment:g.comment,reviewerId:String(user.id),reviewerName:String(user.displayName||user.fullName||user.username),reviewedAt:now};});
  grades._requestId=requestId;grades._fingerprint=fingerprint;
  var json=JSON.stringify(grades);if(json.length>48000)fail_('Сумарний обсяг коментарів завеликий. Скоротіть коментарі.','BAD_GRADE');
  var updated=resultGrading_(test,JSON.parse(String(r.row[13]||'{}')),grades);
  if(body.finalize===true && updated.pendingWritten)fail_('Перевірте всі письмові відповіді.','BAD_GRADE');
  r.row[6]=updated.score==null?'':updated.score;r.row[11]=updated.passed==null?'':updated.passed;r.row[PUBLIC_SYNC_COLUMN-1]='pending';
  r.row[16]=updated.gradingStatus;r.row[17]=updated.earnedPoints;r.row[18]=updated.maxPoints;r.row[19]=updated.choiceTotal;r.row[20]=updated.pendingWritten;r.row[21]=r.result.gradingRevision+1;r.row[22]=json;
  sheet_('results').getRange(r.rowNumber,7,1,HEADERS.results.length-6).setValues([r.row.slice(6)]);
  invalidatePublicSync_();
  var result=resultFromRow_(r.row);
  logAudit_(user,'RESULT_GRADE','result',id,result.testTitle,'Ревізія '+result.gradingRevision+'; '+result.earnedPoints+'/'+result.maxPoints+' балів; очікує: '+result.pendingWritten+'.');
  var tableSynced=publishCommittedResult_(result,r.rowNumber);
  return {result:result,review:buildResultReview_(user,result,test,JSON.parse(String(r.row[13]||'{}')),grades),tableSynced:tableSynced};
}

function containsWrittenResult_(value) {
  if(!value || typeof value!=='object')return false;
  if(Array.isArray(value))return value.some(containsWrittenResult_);
  if(value.gradingStatus==='pending_review' || (value.choiceTotal!=null && value.total>value.choiceTotal) || (value.maxPoints!=null && value.maxPoints>value.total))return true;
  return ['result','results','changes'].some(function(key){return containsWrittenResult_(value[key]);});
}

// Older PC clients keep ordinary tests without treating written work as 0%.
function legacyChoiceResponse_(response) {
  if(!response || typeof response!=='object')return response;
  if(Array.isArray(response.tests))response.tests=response.tests.filter(function(t){return String(t.description||'').indexOf('[[LK-PC-WRITTEN:1]]')<0;});
  if(Array.isArray(response.results))response.results=response.results.filter(function(r){return !containsWrittenResult_(r);});
  if(Array.isArray(response.questions))response.questions=response.questions.filter(function(item){var q=item.question;return !q || (!isWritten_(q)&&questionPoints_(q)===1);});
  if(response.changes)legacyChoiceResponse_(response.changes);
  if(response.result && containsWrittenResult_(response.result))fail_('Ця робота доступна у версії застосунку для ПК.','UPDATE_REQUIRED');
  return response;
}

// Account-owned documents. Payload chunks precede the commit marker, so a
// failed upload cannot replace the last complete revision. Retain three versions.
function sha256Hex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8)
    .map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
var pcStateNullDigest_ = null;
function pcStateIsNull_(digest) {
  if(!pcStateNullDigest_)pcStateNullDigest_=sha256Hex_('null');
  return String(digest)===pcStateNullDigest_;
}
function localStorageKey_(user) {
  var secret=PropertiesService.getScriptProperties().getProperty('APP_SECRET');
  if(!secret)fail_('Не вдалося відкрити захищене сховище.','STORAGE_KEY_UNAVAILABLE');
  var context='LK-PC-VAULT-KEY:1\n'+String(user.id)+'\n'+String(user.createdAt)+'\n'+String(user.role);
  var bytes=Utilities.computeHmacSha256Signature(context,String(secret));
  var key=bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  return {localStorageProtocol:2,userId:String(user.id),key:key};
}

function pcStateKey_(user, value) {
  var key=String(value||'');
  if(user.role===ROLE_INSTRUCTOR&&(key==='test-draft'||/^grading:[A-Za-z0-9_-]{1,80}$/.test(key)))return key;
  if(user.role===ROLE_CADET&&key==='training')return key;
  fail_('Цей тип чернетки недоступний для облікового запису.','FORBIDDEN');
}
function pcStateHeaders_(user) {
  var sheet=sheet_('pcState'),count=sheet.getLastRow()-1;
  if(count<1)return [];
  return sheet.getRange(2,1,count,9).getValues().map(function(row,i){return {row:row,number:i+2};})
    .filter(function(x){return String(x.row[0])===String(user.id)&&Number(x.row[4])===-1;});
}
function pcStateLatest_(headers,key) {
  return headers.filter(function(x){return String(x.row[1])===key;})
    .sort(function(a,b){return Number(b.row[2])-Number(a.row[2])||b.number-a.number;})[0]||null;
}
function pcStateDescriptor_(header) {
  return {key:String(header.row[1]),revision:Number(header.row[2]),updatedAt:String(header.row[6]),generation:String(header.row[3]),deleted:pcStateIsNull_(header.row[8])};
}
function pcStateIndex_(user,body) {
  var props=PropertiesService.getScriptProperties(),property='LK_PC_STATE_'+user.id,cursor=props.getProperty(property)||'0';
  var out={accountSyncProtocol:1,userId:String(user.id),cursor:cursor,documents:[],unchanged:false,stable:true};
  if(typeof body.known==='string'&&body.known===cursor){out.unchanged=true;return out;}
  var latest=Object.create(null);
  pcStateHeaders_(user).filter(function(h){return String(h.row[1])!=='exam-attempt';}).forEach(function(h){var key=String(h.row[1]);if(!latest[key]||Number(h.row[2])>Number(latest[key].row[2]))latest[key]=h;});
  out.documents=Object.keys(latest).map(function(key){return pcStateDescriptor_(latest[key]);});
  out.stable=cursor===(props.getProperty(property)||'0');return out;
}
function pcStateRead_(user,key,header) {
  if(!header)return {key:key,revision:0,value:null,updatedAt:''};
  var r=header.row,total=Number(r[5]),sheet=sheet_('pcState');
  if(!Number.isInteger(total)||total<1||total>MAX_PC_STATE_PARTS)fail_('Чернетка потребує повторного завантаження.','STATE_BUSY');
  var first=header.number-total;
  if(first<2)fail_('Чернетка потребує повторного завантаження.','STATE_BUSY');
  var rows=sheet.getRange(first,1,total,10).getValues(),parts=[];
  rows.forEach(function(row,i){
    if(String(row[0])!==String(user.id)||String(row[1])!==key||String(row[3])!==String(r[3])||Number(row[4])!==i||Number(row[5])!==total)fail_('Чернетка зараз оновлюється. Повторіть синхронізацію.','STATE_BUSY');
    if(String(row[9]).indexOf('json:')!==0)fail_('Некоректна частина чернетки.','STATE_BUSY');
    parts.push(String(row[9]).slice(5));
  });
  var raw=parts.join('');
  if(sha256Hex_(raw)!==String(r[8]))fail_('Чернетка зараз оновлюється. Повторіть синхронізацію.','STATE_BUSY');
  var out=pcStateDescriptor_(header);out.value=JSON.parse(raw);return out;
}
function pcStateGet_(user,body) {
  var key=pcStateKey_(user,body.key),headers=pcStateHeaders_(user);
  return {accountSyncProtocol:1,userId:String(user.id),document:pcStateRead_(user,key,pcStateLatest_(headers,key))};
}
function pcStateValidate_(user,key,value) {
  if(value===null)return;
  if(!value||typeof value!=='object'||Array.isArray(value))fail_('Некоректна чернетка.','BAD_REQUEST');
  if(key==='test-draft'){
    if(typeof value.localId!=='string'||!value.localId||value.localId.length>100||typeof value.title!=='string'||value.title.length>180||typeof value.description!=='string'||value.description.length>2000||!Array.isArray(value.questions)||value.questions.length>200)fail_('Некоректні дані чернетки тесту.','BAD_REQUEST');
    value.questions.forEach(function(q){
      if(!q||typeof q.text!=='string'||q.text.length>1000||!Array.isArray(q.answers)||q.answers.length>6||String(q.rubric||'').length>2000||String(q.explanation||'').length>2000)fail_('Некоректне питання чернетки.','BAD_REQUEST');
      q.answers.forEach(function(a){if(!a||typeof a.text!=='string'||a.text.length>500)fail_('Некоректна відповідь чернетки.','BAD_REQUEST');});
    });
  }else if(key.indexOf('grading:')===0){
    var result = resultRecordById_(key.slice(8));
    if(!result||result.row[PUBLIC_SYNC_COLUMN-1]===RESULT_DELETING)fail_('Роботу видалено або триває її видалення. Оновіть кабінет.','REVIEW_UNAVAILABLE');
    requireCadetNotDeleting_(result.result.userId);
    if(!Number.isInteger(value.revision)||value.revision<0||!value.items||typeof value.items!=='object'||Array.isArray(value.items)||Object.keys(value.items).length>200)fail_('Некоректна чернетка перевірки.','BAD_REQUEST');
    Object.keys(value.items).forEach(function(id){var item=value.items[id];if(!item||String(item.points==null?'':item.points).length>4||typeof item.comment!=='string'||item.comment.length>1000)fail_('Некоректні бали або коментар.','BAD_REQUEST');});
  }else{
    if(!value.test||value.test.mode!=='training'||!value.test.id||!value.submissionId||!value.answers||typeof value.answers!=='object'||!Array.isArray(value.test.questions)||value.test.questions.length>200)fail_('Між ПК можна продовжувати лише тренування. Іспит завершується на початковому ПК.','BAD_REQUEST');
    requireAttemptNotDeleted_(user.id,value.test.id);
    var test;
    if(value.startPermit){test=getTestById_(String(value.test.id));if(!test||!test.published||isArchivedTest_(test)||!visibleTestForUser_(test,user))fail_('Тренування більше недоступне.','NOT_FOUND');verifyTrainingPermit_(user,test,value.submissionId,value.startPermit);}
    else test=getTestForUser_(String(value.test.id),user,1,2);
    if(!test||test.mode!=='training')fail_('Тренування більше недоступне.','NOT_FOUND');
  }
}
function pcStatePut_(user,body) {
  var key=pcStateKey_(user,body.key),expected=body.expectedRevision,request=String(body.requestId||'');
  if(!Number.isSafeInteger(expected)||expected<0||!/^[A-Za-z0-9_-]{8,100}$/.test(request)||!Object.prototype.hasOwnProperty.call(body,'value'))fail_('Некоректний запит синхронізації.','BAD_REQUEST');
  pcStateValidate_(user,key,body.value);
  return pcStateWrite_(user,key,body);
}
function pcStateWrite_(user,key,body) {
  var expected=body.expectedRevision,request=body.requestId;
  var raw=JSON.stringify(body.value);
  if(raw.length>MAX_PC_STATE_JSON_LENGTH)fail_('Чернетка завелика для синхронізації. Скоротіть її або експортуйте в JSON. Дані на цьому ПК збережено.','STATE_TOO_LARGE');
  var digest=sha256Hex_(raw),headers=pcStateHeaders_(user),old=pcStateLatest_(headers,key),props=PropertiesService.getScriptProperties();
  if(old&&String(old.row[7])===request){
    if(String(old.row[8])!==digest)fail_('Ключ синхронізації вже використано для інших даних.','REQUEST_CONFLICT');
    props.setProperty('LK_PC_STATE_'+user.id,Utilities.getUuid());
    return {accountSyncProtocol:1,userId:String(user.id),document:pcStateRead_(user,key,old)};
  }
  if(expected!==(old?Number(old.row[2]):0))fail_('На іншому ПК вже збережена нова версія. Оберіть, яку чернетку продовжити.','REVISION_CONFLICT');
  var keys=Object.create(null);headers.forEach(function(h){var k=String(h.row[1]);if(!keys[k]||Number(h.row[2])>Number(keys[k].row[2]))keys[k]=h;});
  if(!old&&body.value!==null&&Object.keys(keys).filter(function(k){return !pcStateIsNull_(keys[k].row[8]);}).length>=200)fail_('Забагато незавершених чернеток. Завершіть або видаліть непотрібні роботи.','STATE_LIMIT');
  if(!old&&Object.keys(keys).length>=10000)fail_('Досягнуто ліміту історії чернеток. Зверніться до головного інструктора.','STATE_LIMIT');
  var parts=[],start=0;
  while(start<raw.length){var end=Math.min(start+45000,raw.length);if(end<raw.length&&raw.charCodeAt(end-1)>=0xD800&&raw.charCodeAt(end-1)<=0xDBFF)end--;parts.push(raw.slice(start,end));start=end;}
  var generation=Utilities.getUuid(),revision=expected+1,updated=new Date().toISOString(),sheet=sheet_('pcState');
  var rows=parts.map(function(part,i){return [String(user.id),key,revision,generation,i,parts.length,updated,request,digest,'json:'+part];});
  var first=sheet.getLastRow()+1,needed=first+rows.length;
  if(sheet.getMaxRows()<needed)sheet.insertRowsAfter(sheet.getMaxRows(),needed-sheet.getMaxRows());
  sheet.getRange(first,1,rows.length,10).setValues(rows);
  // Commit only after every payload part was written successfully.
  sheet.appendRow([String(user.id),key,revision,generation,-1,parts.length,updated,request,digest,'']);
  props.setProperty('LK_PC_STATE_'+user.id,Utilities.getUuid());
  try{
    var keep=Object.create(null);pcStateHeaders_(user).filter(function(h){return String(h.row[1])===key;})
      .sort(function(a,b){return Number(b.row[2])-Number(a.row[2]);}).slice(0,3)
      .forEach(function(h){keep[String(h.row[3])]=true;});
    var count=sheet.getLastRow()-1,meta=sheet.getRange(2,1,count,9).getValues();
    for(var i=meta.length-1;i>=0;i--)if(String(meta[i][0])===String(user.id)&&String(meta[i][1])===key&&!keep[String(meta[i][3])])sheet.deleteRow(i+2);
  }catch(ignored){}
  var current=pcStateLatest_(pcStateHeaders_(user),key);
  return {accountSyncProtocol:1,userId:String(user.id),document:pcStateRead_(user,key,current)};
}

// Account-owned exam attempts. Only these endpoints can write the reserved document.
var EXAM_STATE_KEY_ = 'exam-attempt';
function examQuestionStorage_(source) {
  var raw=JSON.stringify(source.questions);
  if(raw.length>MAX_TEST_JSON_LENGTH&&source.rowNumber){
    // Existing chunk generations are immutable, including after a test is
    // archived or replaced. Reuse their identity instead of copying their bytes
    // into every cadet's attempt.
    var stored=String(sheet_('tests').getRange(source.rowNumber,8).getValue()||'');
    if(stored.indexOf(TEST_PARTS_PREFIX)===0){
      var marker;
      try{marker=JSON.parse(stored.slice(TEST_PARTS_PREFIX.length));}catch(ignored){}
      if(marker&&marker.testId===String(source.id)&&marker.length===raw.length&&marker.sha256===sha256Hex_(raw))return stored;
    }
  }
  return storeTestQuestions_(source.id,raw);
}
function examPack_(value) {
  if(!value||!value.sourceTest||!Array.isArray(value.sourceTest.questions))return value;
  var packed=Object.assign({},value);
  packed.sourceQuestions=value.sourceQuestions||examQuestionStorage_(value.sourceTest);
  packed.sourceTest=Object.assign({},value.sourceTest);delete packed.sourceTest.questions;
  packed.test=Object.assign({},value.test);delete packed.test.questions;
  packed.questionOrder=value.test.questions.map(function(q){return String(q.id);});
  packed.answerOrder=Object.create(null);
  value.test.questions.forEach(function(q){packed.answerOrder[String(q.id)]=(q.answers||[]).map(function(a){return String(a.id);});});
  return packed;
}
function examExpand_(doc) {
  var value=doc.value;
  // Full snapshots written by older servers remain valid and are compacted on
  // their next write. The private payload is never part of a cadet response.
  if(!value||value.sourceQuestions==null)return doc;
  if(typeof value.sourceQuestions!=='string'||!value.sourceTest||!value.test||!Array.isArray(value.questionOrder)||!value.answerOrder)fail_('Не вдалося прочитати питання збереженого іспиту.','STATE_BUSY');
  var source=Object.assign({},value.sourceTest),questions=parseQuestions_(value.sourceQuestions,source.id);
  if(!questions.length||questions.length>200)fail_('Не вдалося прочитати питання збереженого іспиту.','STATE_BUSY');
  source.questions=questions;
  var test=sanitizeTestForCadet_(source),byId=Object.create(null),seen=Object.create(null);
  test.questions.forEach(function(q){byId[String(q.id)]=q;});
  if(value.questionOrder.length!==test.questions.length)fail_('Порядок питань збереженого іспиту пошкоджено.','STATE_BUSY');
  test.questions=value.questionOrder.map(function(id){
    var q=byId[String(id)],order=value.answerOrder[String(id)];
    if(!q||seen[String(id)]||!Array.isArray(order)||order.length!==q.answers.length)fail_('Порядок питань збереженого іспиту пошкоджено.','STATE_BUSY');
    seen[String(id)]=true;
    var answers=Object.create(null),used=Object.create(null);
    q.answers.forEach(function(a){answers[String(a.id)]=a;});
    q.answers=order.map(function(answerId){var a=answers[String(answerId)];if(!a||used[String(answerId)])fail_('Порядок відповідей збереженого іспиту пошкоджено.','STATE_BUSY');used[String(answerId)]=true;return a;});
    return q;
  });
  value.sourceTest=source;value.test=test;
  return doc;
}
function examDocument_(user) {
  return examExpand_(pcStateRead_(user,EXAM_STATE_KEY_,pcStateLatest_(pcStateHeaders_(user),EXAM_STATE_KEY_)));
}
function examReply_(user,doc,completion) {
  var value=doc.value?JSON.parse(JSON.stringify(doc.value)):null;
  if(value){delete value.sourceTest;delete value.sourceQuestions;delete value.questionOrder;delete value.answerOrder;}
  var out={examProtocol:1,userId:String(user.id),serverNow:Date.now(),document:{revision:doc.revision,value:value}};
  if(completion)out.completion=completion;
  else if(value){var record=findResultRecord_(user.id,value.test.id);if(record)out.completion={result:record.result,review:safeResultReview_(user,record),alreadyAccepted:true};}
  return out;
}
function examIdentifier_(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(value))fail_('Некоректний ключ спроби.','BAD_REQUEST');
  return value;
}
function examWrite_(user,doc,value,request) {
  return examExpand_(pcStateWrite_(user,EXAM_STATE_KEY_,{expectedRevision:doc.revision,requestId:request||Utilities.getUuid(),value:examPack_(value)}).document);
}
function examCheckpoint_(attempt,checkpoint) {
  if(!checkpoint||!checkpoint.answers||typeof checkpoint.answers!=='object'||Array.isArray(checkpoint.answers))fail_('Некоректні відповіді спроби.','BAD_REQUEST');
  var answers={},questions=attempt.test.questions;
  if(Object.keys(checkpoint.answers).some(function(key){return !questions.some(function(q){return String(q.id)===key;});}))fail_('Невідоме питання спроби.','BAD_REQUEST');
  questions.forEach(function(q){
    var key=String(q.id),value=checkpoint.answers[key];
    if(value==null)return;
    if(isWritten_(q)){
      if(typeof value!=='string'||value.length>3000)fail_('Письмова відповідь перевищує 3000 символів.','ANSWER_TOO_LONG');
      answers[key]=value.replace(/\u0000/g,'');
    }else{
      answers[key]=choiceValue_(q,value,true);
    }
  });
  if(JSON.stringify(questions.reduce(function(all,q){all[String(q.id)]=answers[String(q.id)]||(isWritten_(q)?'':'0');return all;},{})).length>48000)fail_('Сумарний обсяг відповідей перевищує 48 000 символів.','ANSWERS_TOO_LARGE');
  if(!Number.isInteger(checkpoint.index)||checkpoint.index<0||checkpoint.index>=questions.length)fail_('Некоректний номер питання.','BAD_REQUEST');
  attempt.answers=answers;attempt.index=checkpoint.index;
  attempt.exitCount=Math.max(attempt.exitCount||0,clampNumber_(checkpoint.exitCount,0,10000,0));
}
function examFinalize_(user,doc) {
  var v=doc.value;
  if(v.status==='active'){v.status='finishing';v.finishedAt=Math.min(Date.now(),v.deadline);doc=examWrite_(user,doc,v);}
  var body={writtenProtocol:1,choiceProtocol:2,testId:v.test.id,submissionId:v.submissionId,durationSeconds:Math.max(1,Math.ceil((v.finishedAt-v.startedAt)/1000)),examExitCount:v.exitCount||0,answers:v.test.questions.map(function(q){return isWritten_(q)?{questionId:q.id,text:v.answers[String(q.id)]||''}:Array.isArray(v.answers[String(q.id)])?{questionId:q.id,answerIds:v.answers[String(q.id)]}:{questionId:q.id,answerId:v.answers[String(q.id)]||'0'};})};
  beginWorkspaceChange_(['results']);
  var completion=submitResult_(user,body,v.sourceTest);
  if(v.status!=='completed'){v.status='completed';doc=examWrite_(user,doc,v);}
  return examReply_(user,doc,completion);
}
function routeExam_(method,path,body,user,choiceProtocol) {
  if(path.indexOf('/api/exam-session')!==0)return null;
  requireRole_(user,ROLE_CADET);
  var doc=examDocument_(user),v=doc.value;
  if(v&&v.status!=='completed')requireSingleAttemptTest_(v.sourceTest||v.test);
  if(v&&v.status!=='completed')requireChoiceProtocol_(v.sourceTest||v.test,choiceProtocol);
  if(method==='GET'&&path==='/api/exam-session')return examReply_(user,doc);
  if(method!=='POST')fail_('Дію не знайдено.','NOT_FOUND');
  var device=examIdentifier_(body.deviceId),request=examIdentifier_(body.requestId);
  if(path==='/api/exam-session/start'){
    if(body.legacy)fail_('Збережений іспит потрібно передати інструктору на підтвердження.','EXAM_RECOVERY_REQUIRED');
    if(v&&v.status!=='completed'){
      if(v.status==='finishing'||Date.now()>=v.deadline)return examFinalize_(user,doc);
      return examReply_(user,doc);
    }
    var test=getTestById_(String(body.testId));
    if(!test||test.mode!=='exam'||!test.published||isArchivedTest_(test)||!visibleTestForUser_(test,user))fail_('Іспит недоступний.','TEST_NOT_FOUND');
    requireTestOpen_(test,user);
    requireChoiceProtocol_(test,choiceProtocol);
    if(findResultRecord_(user.id,test.id)||hasDeletedAttempt_(user.id,test.id))fail_('Цей іспит уже завершено.','ALREADY_COMPLETED');
    if(listExamRecoveries_(user,false).some(function(x){return String(x.testId)===String(test.id);}))fail_('Збережена робота чекає підтвердження інструктора.','EXAM_RECOVERY_PENDING');
    var now=Date.now(),elapsed=0;
    v={status:'active',test:sanitizeTestForCadet_(test),sourceTest:test,submissionId:'exam-'+Utilities.getUuid(),startedAt:now-elapsed,deadline:now-elapsed+test.durationMinutes*60000,ownerId:device,fence:1,claimId:request,answers:{},index:0,exitCount:0};
    // Shuffle once on the server; every PC receives exactly the same order.
    var random=String(test.description||'').match(/\[\[LK-RANDOM:([^\]]*)\]\]/),settings=random?random[1]:null;
    function shuffle(items){for(var i=items.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),item=items[i];items[i]=items[j];items[j]=item;}}
    if(settings===null||settings.indexOf('Q')>=0)shuffle(v.test.questions);
    if(settings===null||settings.indexOf('A')>=0)v.test.questions.forEach(function(q){shuffle(q.answers);});
    return examReply_(user,examWrite_(user,doc,v,request));
  }
  if(!v||String(body.submissionId)!==v.submissionId)fail_('Спробу вже змінено. Оновіть дані акаунта.','EXAM_REPLACED');
  if(v.status==='completed')return examReply_(user,doc);
  if(path==='/api/exam-session/claim'){
    if(v.status==='finishing'||Date.now()>=v.deadline)return examFinalize_(user,doc);
    if(v.ownerId===device&&v.claimId===request)return examReply_(user,doc);
    if(body.fence!==v.fence)fail_('Спробу вже продовжили на іншому ПК. Оновіть її перед передачею.','EXAM_TAKEN');
    v.ownerId=device;v.fence++;v.claimId=request;
    return examReply_(user,examWrite_(user,doc,v,request));
  }
  if(!['/api/exam-session/save','/api/exam-session/finish','/api/exam-session/release'].includes(path))fail_('Дію не знайдено.','NOT_FOUND');
  var requestDigest=sha256Hex_(JSON.stringify({action:path,checkpoint:body.checkpoint}));
  if(v.lastRequest===request&&v.lastDevice===device){if(v.lastRequestDigest!==requestDigest)fail_('Ключ запиту вже використано для інших відповідей.','REQUEST_CONFLICT');if(path==='/api/exam-session/finish')return examFinalize_(user,doc);return examReply_(user,doc);}
  if(v.ownerId!==device||body.fence!==v.fence)fail_('Іспит продовжено на іншому ПК. Тут редагування зупинено.','EXAM_TAKEN');
  if(v.status==='finishing'||Date.now()>=v.deadline)return examFinalize_(user,doc);
  if(body.expectedRevision!==doc.revision)fail_('На сервері вже є новіша версія спроби.','REVISION_CONFLICT');
  examCheckpoint_(v,body.checkpoint);v.lastRequest=request;v.lastRequestDigest=requestDigest;v.lastDevice=device;
  if(path==='/api/exam-session/release'){v.ownerId='';v.fence++;}
  if(path==='/api/exam-session/finish'){v.status='finishing';v.finishedAt=Date.now();}
  doc=examWrite_(user,doc,v,request);
  if(path==='/api/exam-session/finish')return examFinalize_(user,doc);
  return examReply_(user,doc);
}

// Selection is a legacy scalar for one answer, or a set of two IDs.
function choiceIds_(q,value,strict) {
  var array=Array.isArray(value),raw=array?value:value==null||value==='0'?[]:[value];
  if(raw.length>2||raw.some(function(v){return typeof v!=='string'&&typeof v!=='number';}))fail_('Можна вибрати максимум дві відповіді.','BAD_REQUEST');
  var ids=raw.map(String),seen=Object.create(null);
  if(ids.some(function(id){if(seen[id])return true;seen[id]=true;return false;}))fail_('Варіант відповіді повторюється.','BAD_REQUEST');
  if(ids.some(function(id){return !q.answers.some(function(a){return String(a.id)===id;});})){
    if(array||strict)fail_('Невідомий варіант відповіді.','BAD_REQUEST');return [];
  }
  return ids.sort();
}
function choiceValue_(q,value,strict){var ids=choiceIds_(q,value,strict);return ids.length>1?ids:ids[0]||'0';}
function choiceCorrect_(q,value){var ids=choiceIds_(q,value),right=q.answers.filter(function(a){return a.isCorrect===true;}).map(function(a){return String(a.id);}).sort();return right.length>0&&JSON.stringify(ids)===JSON.stringify(right);}
function hasMultipleChoice_(test){return (test.questions||[]).some(function(q){return !isWritten_(q)&&(q.answers||[]).filter(function(a){return a.isCorrect===true;}).length>1;});}
function requireChoiceProtocol_(test,protocol){if(hasMultipleChoice_(test)&&protocol!==2)fail_('Для питань із двома правильними відповідями оновіть застосунок до ПК 1.2.6.','UPDATE_REQUIRED');}
function legacyMultiChoiceResponse_(response){
  if(!response||typeof response!=='object')return response;
  if(Array.isArray(response.tests))response.tests=response.tests.filter(function(t){return String(t.description||'').indexOf('[[LK-PC-MULTICHOICE:1]]')<0;});
  if(Array.isArray(response.questions))response.questions=response.questions.filter(function(item){return !item.question||!hasMultipleChoice_({questions:[item.question]});});
  if(Array.isArray(response.review)&&response.review.some(function(q){return (q.correctAnswerIds&&q.correctAnswerIds.length>1)||(q.selectedAnswerIds&&q.selectedAnswerIds.length>1);}))fail_('Перегляд роботи з кількома відповідями потребує ПК 1.2.6.','UPDATE_REQUIRED');
  if(response.changes)legacyMultiChoiceResponse_(response.changes);
  if(response.completion)legacyMultiChoiceResponse_(response.completion);
  return response;
}

/** Report data contains visible learning results, never credentials or answer keys. */
function instructorReportData_(actor,body,options) {
  requireRole_(actor,ROLE_INSTRUCTOR);body=body||{};options=options||{};
  if(!options.allowIntake&&PropertiesService.getScriptProperties().getProperty('LK_INTAKE_ACTIVE'))fail_('Триває підготовка набору. Завантажте збережений архів або дочекайтеся завершення.','INTAKE_IN_PROGRESS');
  var revision=JSON.stringify(workspaceRevisions_(actor,true)),groups=listGroups_(),results=listResults_(null),cadets=listUsers_().filter(function(u){return u.role===ROLE_CADET&&!cadetDeletionPending_(u.id);}).map(publicUser_);
  var tests=listTests_(false).filter(function(t){return !isArchivedTest_(t)&&!isRetakeTest_(t);}).map(function(t){var assigned=assignedGroups_(t.description);return {id:String(t.id),title:t.title,published:t.published&&assigned!==null,assignedGroups:assigned||[]};});
  var groupId=cleanText_(body.groupId,100),testId=cleanText_(body.testId,100),query=normalize_(cleanText_(body.query,180)),scope=[];
  if(groupId){var group=groups.filter(function(g){return String(g.id)===groupId;})[0];if(!group)fail_('Групу більше не знайдено. Оновіть фільтри.','GROUP_NOT_FOUND');results=results.filter(function(r){return r.groupName===group.name;});cadets=cadets.filter(function(u){return u.groupName===group.name;});tests=tests.filter(function(t){return !t.assignedGroups.length||t.assignedGroups.indexOf(group.name)>=0||results.some(function(r){return String(r.testId)===t.id;});});scope.push(group.name);}
  if(testId){var test=tests.filter(function(t){return t.id===testId;})[0],historical=results.filter(function(r){return String(r.testId)===testId;})[0];if(!test&&!historical)fail_('Тест більше не знайдено. Оновіть фільтри.','TEST_NOT_FOUND');results=results.filter(function(r){return String(r.testId)===testId;});tests=test?[test]:[{id:testId,title:historical.testTitle,historical:true}];scope.push((test||historical).title||historical.testTitle);}
  if(query){
    results=results.filter(function(r){return normalize_([r.userName,r.groupName,r.testTitle].join(' ')).indexOf(query)>=0;});
    var present=Object.create(null);results.forEach(function(r){present[String(r.userId)]=true;});
    var namedTests=tests.filter(function(t){return normalize_(t.title).indexOf(query)>=0;});
    cadets=cadets.filter(function(u){return namedTests.length||present[String(u.id)]||normalize_([u.fullName,u.username,u.groupName].join(' ')).indexOf(query)>=0;});
    scope.push('Пошук: '+cleanText_(body.query,180));
  }
  if(JSON.stringify(workspaceRevisions_(actor,true))!==revision)fail_('Результати зараз змінюються. Повторіть експорт.','STATE_BUSY');
  return {reportProtocol:1,userId:String(actor.id),generatedAt:options.generatedAt||new Date().toISOString(),scope:options.name||scope.join(' · ')||'Усі групи та тести',results:results,cadets:cadets,tests:tests,groups:groups};
}
function archiveDigest_(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ('0'+(b<0?b+256:b).toString(16)).slice(-2);}).join('');}
function readIntakeArchiveBytes_(jobId,archive) {
  if(!Number.isSafeInteger(archive.parts)||archive.parts<1||archive.parts>2000||!Number.isSafeInteger(archive.size)||archive.size<1||archive.size>64*1024*1024)fail_('Пошкоджено опис архіву.','ARCHIVE_UNAVAILABLE');
  var parts=Array(archive.parts),seen=Object.create(null),file=SpreadsheetApp.openById(archive.id).getSheetByName('_Файл_Excel');if(!file)fail_('Архівний файл більше не доступний.','ARCHIVE_UNAVAILABLE');
  var rows=file.getLastRow()>1?file.getRange(2,1,file.getLastRow()-1,4).getValues():[];rows.forEach(function(row){if(String(row[0])!==jobId||String(row[1])!==archive.generation)return;var index=Number(row[2]);if(!Number.isSafeInteger(index)||index<0||index>=archive.parts||seen[index]||String(row[3]).indexOf('base64:')!==0)fail_('Пошкоджено частини архіву. Очищення призупинено.','ARCHIVE_UNAVAILABLE');seen[index]=true;parts[index]=String(row[3]).slice(7);});
  if(Object.keys(seen).length!==archive.parts)fail_('Архів збережено не повністю. Очищення призупинено.','ARCHIVE_UNAVAILABLE');
  var raw=Utilities.base64Decode(parts.join(''));if(raw.length!==archive.size||archiveDigest_(raw)!==archive.sha256)fail_('Архів не пройшов перевірку цілісності.','ARCHIVE_UNAVAILABLE');return raw;
}
function writeIntakeArchiveBook_(book,model) {
  model.sheets.forEach(function(item,index){
    var sheet=book.getSheetByName(item.name);if(!sheet){var initial=book.getSheets();sheet=index===0&&initial.length===1&&sheetIsEmpty_(initial[0])?initial[0].setName(item.name):book.insertSheet(item.name);}
    var width=item.columns.length,height=Math.max(4,item.rows.length+3);if(sheet.getMaxColumns()<width)sheet.insertColumnsAfter(sheet.getMaxColumns(),width-sheet.getMaxColumns());if(sheet.getMaxRows()<height)sheet.insertRowsAfter(sheet.getMaxRows(),height-sheet.getMaxRows());
    var data=[[model.title+' · '+item.name],[model.meta],item.columns.map(function(c){return c[0];})].concat(item.rows.map(function(row){return row.map(function(v){return v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,'v')?v.v:v;});}));
    data=data.map(function(row){return Array.from({length:width},function(_,i){var v=row[i];return v==null?'':typeof v==='string'?safeCellText_(v):v;});});sheet.getRange(1,1,data.length,width).setValues(data);
    sheet.setFrozenRows(3);sheet.setFrozenColumns(item.freezeColumns||1);sheet.getRange(1,1,data.length,width).setWrap(true).setVerticalAlignment('middle');sheet.getRange(3,1,1,width).setFontWeight('bold').setBackground('#17365d').setFontColor('#ffffff');sheet.setRowHeight(3,42);sheet.autoResizeRows(1,data.length);
    item.columns.forEach(function(c,i){sheet.setColumnWidth(i+1,Math.min(420,Math.round(c[1]*7)));if(c[2])sheet.hideColumns(i+1);});
    if(item.rows.length){var formats=item.rows.map(function(row){return row.map(function(cell){var style=cell&&typeof cell==='object'?cell.s:0;return [2,12,13,14].indexOf(style)>=0?'0%':style===3?'[m]:ss':style===4?'dd.mm.yyyy hh:mm':'General';});});sheet.getRange(4,1,item.rows.length,width).setNumberFormats(formats);var backgrounds=item.rows.map(function(row,index){return row.map(function(cell){var style=cell&&typeof cell==='object'?cell.s:0;return [5,12].indexOf(style)>=0?'#e8f5ec':[6,13].indexOf(style)>=0?'#fdecec':style===7?'#fff4d6':style===8?'#f1f5f9':index%2?'#f4f7fb':'#ffffff';});});sheet.getRange(4,1,item.rows.length,width).setBackgrounds(backgrounds);}
    if(!sheet.getFilter())sheet.getRange(3,1,Math.max(1,item.rows.length+1),width).createFilter();
  });
}
function ensureIntakeArchive_(actor,job) {
  if(!job.value.archiveRequired)return false;
  if(job.value.archive){if(job.value.phase===0)readIntakeArchiveBytes_(job.value.id,job.value.archive);return false;}
  var data=instructorReportData_(actor,{}, {allowIntake:true,generatedAt:job.value.startedAt,name:job.value.archiveName}),model=LKReport_.reportModel(data,{name:job.value.archiveName,timezoneOffsetMinutes:job.value.timezoneOffsetMinutes||0});
  var parts=LKReport_.xlsxParts(model),contentDigest=sha256Hex_(JSON.stringify(parts)),saved=[];
  dataRows_('intakeJobs').forEach(function(row){if(String(row[0])!==job.value.id||row[1]!=='archive-meta')return;var v;try{v=JSON.parse(String(row[3]));}catch(ignored){return;}if(v&&v.protocol===1&&v.contentDigest===contentDigest)saved.push(v);});
  var archive=saved.length?saved[saved.length-1]:null;
  if(archive)readIntakeArchiveBytes_(job.value.id,archive);
  else{
    // SpreadsheetApp already has the commission's existing consent. No new
    // Drive permission or public sharing is required for cohort archives.
    if(!job.value.archiveBookId){var created=SpreadsheetApp.create('FPV Комісія — Архів — '+job.value.archiveName+' — '+job.value.startedAt.slice(0,10));job.value.archiveBookId=created.getId();saveIntakeJob_(job);}
    var book=SpreadsheetApp.openById(job.value.archiveBookId);writeIntakeArchiveBook_(book,model);
    var name=LKReport_.reportFilename(job.value.archiveName.slice(0,30)+'_'+job.value.id,job.value.startedAt,job.value.timezoneOffsetMinutes||0),blobs=parts.map(function(p){return Utilities.newBlob(p.data,'application/xml',p.name);}),blob=Utilities.zip(blobs,name),raw=blob.getBytes();
    if(raw.length>64*1024*1024)fail_('Архів перевищує 64 МБ. Збережіть окремі групи перед підготовкою набору.','ARCHIVE_TOO_LARGE');
    var base64=Utilities.base64Encode(raw),generation=Utilities.getUuid(),chunks=[];for(var pos=0;pos<base64.length;pos+=48000)chunks.push(base64.slice(pos,pos+48000));
    archive={protocol:1,id:book.getId(),name:name,url:book.getUrl(),sha256:archiveDigest_(raw),size:raw.length,parts:chunks.length,generation:generation,contentDigest:contentDigest,createdAt:job.value.startedAt};
    var file=book.getSheetByName('_Файл_Excel')||book.insertSheet('_Файл_Excel'),rows=chunks.map(function(part,index){return [job.value.id,generation,index,'base64:'+part];});
    if(file.getMaxColumns()<4)file.insertColumnsAfter(file.getMaxColumns(),4-file.getMaxColumns());file.getRange(1,1,1,4).setValues([['Операція','Покоління','Частина','Файл Base64']]);
    var count=Math.max(rows.length,file.getLastRow()-1);while(rows.length<count)rows.push(['','','','']);if(file.getMaxRows()<count+1)file.insertRowsAfter(file.getMaxRows(),count+1-file.getMaxRows());file.getRange(2,1,count,4).setValues(rows);file.hideSheet();
    readIntakeArchiveBytes_(job.value.id,archive);
    sheet_('intakeJobs').appendRow([job.value.id,'archive-meta',generation,JSON.stringify(archive),new Date()]);
  }
  job.value.archive=archive;saveIntakeJob_(job);return true;
}
function listIntakeArchives_() {
  var archives=[];dataRows_('intakeJobs').forEach(function(row){if(row[1]!=='job')return;var value;try{value=JSON.parse(String(row[3]));}catch(ignored){return;}if(value&&value.archive)archives.push({jobId:value.id,name:value.archiveName||'Набір',startedAt:value.startedAt,cadets:value.cadets,results:value.results,archive:value.archive});});
  archives.sort(function(a,b){return String(b.startedAt).localeCompare(String(a.startedAt));});return {archiveProtocol:1,archives:archives.slice(0,50)};
}
function intakeArchiveContent_(body) {
  var id=cleanText_(body.jobId,100);if(!/^intake-[A-Za-z0-9_-]{16,100}$/.test(id))fail_('Некоректний архів.','BAD_REQUEST');
  var job=intakeJob_(id),archive=job.value.archive,part=body.part==null?0:body.part;if(!archive)fail_('Архів ще не збережено.','ARCHIVE_UNAVAILABLE');
  if(!Number.isSafeInteger(part)||part<0)fail_('Некоректна частина архіву.','BAD_REQUEST');
  var raw=readIntakeArchiveBytes_(id,archive);
  var base64=Utilities.base64Encode(raw),chunk=480000,total=Math.ceil(base64.length/chunk);if(part>=total)fail_('Некоректна частина архіву.','BAD_REQUEST');
  return {archiveProtocol:1,jobId:id,name:archive.name,size:archive.size,sha256:archive.sha256,part:part,totalParts:total,data:base64.slice(part*chunk,(part+1)*chunk)};
}


// BEGIN GENERATED EXCEL REPORT
var LKReport_=(function(){
// The same report model and XML run in the browser and in Apps Script.
// Values are written as numbers or explicit strings; cell text is never a formula.
const rptMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const rptId=value=>String(value??'');
const rptPending=r=>r.gradingStatus==='pending_review';
const rptScore=r=>!rptPending(r)&&typeof r.score==='number'&&Number.isFinite(r.score)?r.score/100:null;
const rptStatus=r=>rptPending(r)?'Очікує перевірки':r.passed?'Складено':'Не складено';
const rptText=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').slice(0,32767);
const rptXml=value=>rptText(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const rptNumber=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const rptCell=(v,s=0)=>({v:v??'',s});
const rptPercent=(v,s=2)=>rptCell(v,s);
function rptDate(value,offset){const ms=Date.parse(value);return Number.isFinite(ms)?(ms-offset*60000)/86400000+25569:'';}
function rptTime(value){return Number.isFinite(Number(value))?Math.max(0,Number(value))/86400:'';}
function rptTestLabel(t){return rptText(t.title||t.testTitle||'Тест')+' · #'+rptId(t.id||t.testId);}
function rptSort(a,b){return String(a).localeCompare(String(b),'uk');}
function rptChoice(r){return Number.isInteger(r.choiceTotal)?r.choiceTotal:Number(r.total)||0;}

function reportFilename(name='',now=new Date().toISOString(),offset=0){
 const ms=Date.parse(now),local=Number.isFinite(ms)?new Date(ms-offset*60000).toISOString():String(now);
 const stamp=local.replace(/[:.]/g,'-').replace('T','_').replace(/Z$/,'');
 const title=rptText(name).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').trim().replace(/[. ]+$/,'').slice(0,80)||'Результати';
 return 'FPV-Комісія_'+title+'_'+stamp+'.xlsx';
}

function reportModel(data,options={}){
 const results=(data.results||[]).filter(r=>r&&rptId(r.userId)&&rptId(r.testId)),cadets=data.cadets||[],tests=data.tests||[];
 const generatedAt=data.generatedAt||new Date().toISOString(),offset=Number.isFinite(options.timezoneOffsetMinutes)?options.timezoneOffsetMinutes:0;
 const scope=options.name||data.scope||'Усі групи та тести',stamp=new Date(generatedAt);
 const meta=scope+' · Сформовано '+(Number.isFinite(stamp.getTime())?new Date(stamp.getTime()-offset*60000).toISOString().slice(0,19).replace('T',' '):generatedAt)+' · UTC'+(offset<=0?'+':'−')+Math.abs(offset/60);
 const columns=[['ПІБ курсанта',34],['Група',20],['Тест',38],['Дата завершення',22],['Результат',24],['Підсумковий бал',20],['Набрано балів',17],['Максимум балів',18],['Час проходження',18],['Правильних',16,true],['Неправильних',17,true],['Правильних, %',19,true],['ID курсанта',18,true],['ID результату',18,true],['Підтвердження збереженої роботи',38]];
 const ordered=results.slice().sort((a,b)=>(Date.parse(b.completedAt)||0)-(Date.parse(a.completedAt)||0)||rptSort(a.userName,b.userName));
 const resultRows=ordered.map(r=>{const state=rptPending(r)?7:r.passed?5:6,choice=rptChoice(r);return [r.userName,r.groupName,r.testTitle,rptCell(rptDate(r.completedAt,offset),4),rptCell(rptStatus(r),state),rptPercent(rptScore(r),state===7?2:r.passed?12:13),rptNumber(r.earnedPoints)??r.correct,rptNumber(r.maxPoints)??r.total,rptCell(rptTime(r.durationSeconds),3),choice?r.correct:'',choice?Math.max(0,choice-r.correct):'',rptPercent(choice?(Number(r.correct)||0)/choice:null),rptId(r.userId),rptId(r.id),r.examRecovered?'Підтвердив: '+(r.recoveredBy||'інструктор')+'; час зі збереженої роботи':''];});
 const byTest=new Map(),members=new Map(),latest=new Map();
 for(const t of tests)if(t&&rptId(t.id))byTest.set(rptId(t.id),t);
 for(const u of cadets){if(u.role&&u.role!=='cadet')continue;const group=String(u.groupName||'');members.set(JSON.stringify([rptId(u.id),group]),{id:rptId(u.id),name:u.fullName||u.username||'',username:u.username||'',group});}
 for(const r of ordered){
  const tid=rptId(r.testId),person=JSON.stringify([rptId(r.userId),String(r.groupName||'')]);
  if(!byTest.has(tid))byTest.set(tid,{id:tid,title:r.testTitle,historical:true});
  if(!members.has(person))members.set(person,{id:rptId(r.userId),name:r.userName,group:String(r.groupName||''),historical:true});
  const key=JSON.stringify([person,tid]);if(!latest.has(key))latest.set(key,r);
 }
 const testList=[...byTest.values()].sort((a,b)=>rptSort(a.title,b.title)||rptSort(rptId(a.id),rptId(b.id)));
 const matrixColumns=[['ПІБ курсанта',34],['Група',20],['Логін / ID',20],...testList.map(t=>[rptTestLabel(t),25]),['Пройдено тестів',19],['Середній бал перевірених',27]];
 const matrixRows=[...members.entries()].sort((a,b)=>rptSort(a[1].group,b[1].group)||rptSort(a[1].name,b[1].name)||rptSort(a[1].id,b[1].id)).map(([person,u])=>{
  let completed=0;const scores=[];
  const cells=testList.map(t=>{const r=latest.get(JSON.stringify([person,rptId(t.id)]));if(r){completed++;const score=rptScore(r);if(score!==null)scores.push(score);return rptPending(r)?rptCell('Очікує перевірки',7):rptPercent(score,r.passed?12:13);}
   const assigned=Array.isArray(t.assignedGroups)?t.assignedGroups:[];
   const applicable=!t.historical&&t.published!==false&&(!assigned.length||assigned.includes(u.group));
   return rptCell(applicable?'Не проходив':'—',8);
  });
  return [u.name,u.group,u.username||'#'+u.id,...cells,completed,rptPercent(scores.length?scores.reduce((n,v)=>n+v,0)/scores.length:null)];
 });
 const groupNames=new Set([...cadets.map(u=>String(u.groupName||'')),...results.map(r=>String(r.groupName||''))]);
 const summaries=[...groupNames].sort(rptSort).map(group=>rptSummary(group,results.filter(r=>String(r.groupName||'')===group),cadets.filter(u=>String(u.groupName||'')===group)));
 const summaryColumns=[['Група',27],['Курсантів',16],['Робіт',14],['Перевірено',17],['Склали',14],['Не склали',16],['Очікують перевірки',24],['Середній бал перевірених',28],['Успішність перевірених',27]];
 summaries.push(rptSummary('Разом',results,cadets));
 return {title:'FPV Комісія',generatedAt,scope,meta,sheets:[
  {name:'Результати',columns,rows:resultRows,freezeColumns:2},
  {name:'Відомість групи',columns:matrixColumns,rows:matrixRows,freezeColumns:3},
  {name:'Зведення',columns:summaryColumns,rows:summaries,freezeColumns:1}
 ]};
}
function rptSummary(name,results,cadets){
 const graded=results.filter(r=>rptScore(r)!==null),scores=graded.map(rptScore),passed=graded.filter(r=>r.passed).length;
 const users=new Set([...cadets.map(u=>rptId(u.id)),...results.map(r=>rptId(r.userId))].filter(Boolean));
 return [name,users.size,results.length,graded.length,passed,graded.length-passed,results.filter(rptPending).length,rptPercent(scores.length?scores.reduce((n,v)=>n+v,0)/scores.length:null),rptPercent(graded.length?passed/graded.length:null)];
}
function rptColumn(index){let text='';for(let n=index+1;n;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text;}
function rptRowHeight(values,columns,minimum=32){let lines=1;values.forEach((cell,index)=>{const raw=cell&&typeof cell==='object'?cell.v:cell,width=Math.max(8,(columns[index]?.[1]||20)-2);lines=Math.max(lines,String(raw??'').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(s.length/width)),0));});return Math.min(409,Math.max(minimum,lines*14+12));}
function rptStyles(){
 const fonts='<font><sz val="11"/><name val="Calibri"/><color rgb="FF172B4D"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="17"/><name val="Calibri"/><color rgb="FF17365D"/></font><font><sz val="10"/><name val="Calibri"/><color rgb="FF64748B"/></font>';
 const fills=['<patternFill patternType="none"/>','<patternFill patternType="gray125"/>',...['17365D','E8F5EC','FDECEC','FFF4D6','F1F5F9'].map(c=>'<patternFill patternType="solid"><fgColor rgb="FF'+c+'"/><bgColor indexed="64"/></patternFill>')].map(x=>'<fill>'+x+'</fill>').join('');
 const xf=(num=0,fill=0,font=0)=>'<xf numFmtId="'+num+'" fontId="'+font+'" fillId="'+fill+'" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>';
 const formats=[xf(),xf(0,2,1),xf(164),xf(165),xf(166),xf(0,3),xf(0,4),xf(0,5),xf(0,6),xf(0,0,2),xf(0,0,3),xf(1),xf(164,3),xf(164,4),xf(164,6),xf(0,6),xf(164,6),xf(165,6),xf(166,6)];
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="0%"/><numFmt numFmtId="165" formatCode="[m]:ss"/><numFmt numFmtId="166" formatCode="dd.mm.yyyy hh:mm"/></numFmts><fonts count="4">'+fonts+'</fonts><fills count="7">'+fills+'</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1">'+xf()+'</cellStyleXfs><cellXfs count="'+formats.length+'">'+formats.join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}
function rptValue(value,index,row,banded=false){
 const cell=value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'v')?value:{v:value,s:0};
 let style=cell.s||0;if(banded)style=({0:15,2:16,3:17,4:18})[style]??style;
 const ref=rptColumn(index)+row,raw=cell.v;
 if(raw===null||raw===undefined||raw==='')return '<c r="'+ref+'" s="'+style+'"/>';
 return typeof raw==='number'&&Number.isFinite(raw)?'<c r="'+ref+'" s="'+style+'"><v>'+raw+'</v></c>':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+rptXml(raw)+'</t></is></c>';
}
function rptWorksheet(sheet,model){
 if(sheet.columns.length>16384||sheet.rows.length>1048573)throw Error('Забагато даних для одного аркуша Excel. Оберіть групу або тест.');
 const last=rptColumn(Math.max(0,sheet.columns.length-1)),lastRow=Math.max(3,sheet.rows.length+3),freeze=sheet.freezeColumns||1;
 const metaHeight=rptRowHeight([model.meta],[[null,sheet.columns.reduce((n,c)=>n+c[1],0)]],28),headerHeight=rptRowHeight(sheet.columns.map(c=>c[0]),sheet.columns,42);
 const rows='<row r="1" ht="28" customHeight="1">'+rptValue(rptCell(model.title+' · '+sheet.name,9),0,1)+'</row><row r="2" ht="'+metaHeight+'" customHeight="1">'+rptValue(rptCell(model.meta,10),0,2)+'</row><row r="3" ht="'+headerHeight+'" customHeight="1">'+sheet.columns.map((c,i)=>rptValue(rptCell(c[0],1),i,3)).join('')+'</row>'+sheet.rows.map((values,index)=>'<row r="'+(index+4)+'" ht="'+rptRowHeight(values,sheet.columns)+'" customHeight="1">'+values.map((v,i)=>rptValue(v,i,index+4,index%2===1)).join('')+'</row>').join('');
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:'+last+lastRow+'"/><sheetViews><sheetView workbookViewId="0" zoomScale="90"><pane xSplit="'+freeze+'" ySplit="3" topLeftCell="'+rptColumn(freeze)+'4" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>'+sheet.columns.map((c,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+c[1]+'" customWidth="1"'+(c[2]?' hidden="1"':'')+'/>').join('')+'</cols><sheetData>'+rows+'</sheetData><autoFilter ref="A3:'+last+lastRow+'"/><mergeCells count="2"><mergeCell ref="A1:'+last+'1"/><mergeCell ref="A2:'+last+'2"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}
function xlsxParts(model){
 const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships/',main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const parts=[{name:'[Content_Types].xml',data:xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+model.sheets.map((s,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'},
 {name:'_rels/.rels',data:xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+rel+'officeDocument" Target="xl/workbook.xml"/></Relationships>'},
 {name:'xl/workbook.xml',data:xml+'<workbook xmlns="'+main+'" xmlns:r="'+rel.slice(0,-1)+'"><bookViews><workbookView/></bookViews><sheets>'+model.sheets.map((s,i)=>'<sheet name="'+rptXml(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets><definedNames>'+model.sheets.map((s,i)=>'<definedName name="_xlnm.Print_Titles" localSheetId="'+i+'">'+rptXml("'"+s.name.replace(/'/g,"''")+"'!$1:$3")+'</definedName>').join('')+'</definedNames></workbook>'},
 {name:'xl/_rels/workbook.xml.rels',data:xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+model.sheets.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+rel+'worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(model.sheets.length+1)+'" Type="'+rel+'styles" Target="styles.xml"/></Relationships>'},
 {name:'xl/styles.xml',data:rptStyles()},...model.sheets.map((s,i)=>({name:'xl/worksheets/sheet'+(i+1)+'.xml',data:rptWorksheet(s,model)}))];
 return parts;
}
function rptCRC(bytes){let crc=0xffffffff;const table=rptCRC.table||(rptCRC.table=Array.from({length:256},(_,i)=>{let v=i;for(let n=0;n<8;n++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;}));for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function xlsxBytes(model){
 return zipReportParts(xlsxParts(model));
}
function zipReportParts(parts){
 const encoder=new TextEncoder(),entries=parts.map(p=>({name:encoder.encode(p.name),data:encoder.encode(p.data)}));
 const total=entries.reduce((n,e)=>n+30+e.name.length+e.data.length+46+e.name.length,22);if(total>64*1024*1024)throw Error('Файл Excel перевищує 64 МБ. Оберіть групу або тест.');
 const out=new Uint8Array(total),view=new DataView(out.buffer);let pos=0;
 const u16=(at,v)=>view.setUint16(at,v,true),u32=(at,v)=>view.setUint32(at,v,true);
 for(const e of entries){e.offset=pos;e.crc=rptCRC(e.data);u32(pos,0x04034b50);u16(pos+4,20);u16(pos+6,0x800);u16(pos+8,0);u16(pos+12,0x21);u32(pos+14,e.crc);u32(pos+18,e.data.length);u32(pos+22,e.data.length);u16(pos+26,e.name.length);out.set(e.name,pos+30);out.set(e.data,pos+30+e.name.length);pos+=30+e.name.length+e.data.length;}
 const start=pos;
 for(const e of entries){u32(pos,0x02014b50);u16(pos+4,20);u16(pos+6,20);u16(pos+8,0x800);u16(pos+14,0x21);u32(pos+16,e.crc);u32(pos+20,e.data.length);u32(pos+24,e.data.length);u16(pos+28,e.name.length);u32(pos+42,e.offset);out.set(e.name,pos+46);pos+=46+e.name.length;}
 u32(pos,0x06054b50);u16(pos+8,entries.length);u16(pos+10,entries.length);u32(pos+12,pos-start);u32(pos+16,start);return out;
}
const XLSX_MIME=rptMime;

return {reportModel:reportModel,xlsxParts:xlsxParts,reportFilename:reportFilename};
})();
// END GENERATED EXCEL REPORT
