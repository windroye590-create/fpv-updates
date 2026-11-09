import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function registerInstructor_('),source.indexOf('\nfunction createUser_('));
const secret='ABCD1234'.repeat(4),digest=crypto.createHash('sha256').update(secret).digest('hex'),checks=[];
function fixture(options={}){
 const users=options.existing?[{id:'first',role:'instructor'}]:[],props=new Map(),calls=[];
 const box={OWNER_SETUP_INVITE_HASH:digest,OWNER_SETUP_INVITE_UNTIL:options.expired?1:Date.now()+60000,OWNER_SETUP_LOGIN:'WindRoy',ROLE_INSTRUCTOR:'instructor',Date,
  normalizeCode_:v=>String(v||'').trim().toUpperCase(),secureEquals_:(a,b)=>a===b,sha256Hex_:v=>crypto.createHash('sha256').update(v).digest('hex'),
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
  listUsers_:()=>users,createUser_:v=>{calls.push(v);const user={id:'fpv-owner',...v};users.push(user);return user;},issueToken_:()=> 'synthetic-session',publicUser_:v=>v,
  fail_:(message,code)=>{throw Object.assign(Error(message),{code});}};
 vm.createContext(box);vm.runInContext(code,box);return {box,users,props,calls};
}
function check(name,run){run();checks.push(name);console.log('PASS '+name);}
const body=(more={})=>({username:'WindRoy',fullName:'Requested private name',inviteCode:secret,passwordHash:'synthetic-hash',passwordSalt:'synthetic-salt',...more});
check('The owner code creates the first instructor with the requested Developer display name',()=>{const f=fixture(),r=f.box.registerInstructor_(body());assert.equal(r.user.fullName,'Розробник');assert.equal(r.user.role,'instructor');assert.equal(f.props.get('PRIMARY_INSTRUCTOR_ID'),'fpv-owner');});
for(const [name,options,change] of [['An expired code is rejected',{expired:true},{}],['A wrong code is rejected',{}, {inviteCode:'BAD'}],['The owner code cannot register another login',{}, {username:'OtherInstructor'}],['The initial owner code is disabled after an instructor exists',{existing:true},{}]])check(name,()=>{const f=fixture(options);assert.throws(()=>f.box.registerInstructor_(body(change)),e=>e.code==='INVALID_INVITE');assert.equal(f.calls.length,0);});
check('The initial verifier cannot be reused for a second instructor',()=>{const f=fixture();f.box.registerInstructor_(body());assert.throws(()=>f.box.registerInstructor_(body()),e=>e.code==='INVALID_INVITE');assert.equal(f.calls.length,1);});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/commission-owner.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0},null,2));
