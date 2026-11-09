// Installation is armed only by the user's check button. Background checks can
// stage a release, but cannot interrupt a test or discard unsaved work.
export function createUpdater({local,canApply,save,freeze,info,reload,now=()=>Date.now(),pause=ms=>new Promise(r=>setTimeout(r,ms)),restartTimeout=120000}){
 let requested=false,applying=false,polling=false,timer,last={message:'Оновлення перевіряються й завантажуються автоматично.'};
 const publish=value=>{last=value;info(value);};
 function schedule(){clearTimeout(timer);if(requested&&!applying)timer=setTimeout(()=>status(),1000);}
 async function install(release){
  const reason=canApply();if(reason){publish({...release,message:reason});return;}
  applying=true;freeze(true,'Зберігаємо дані перед оновленням…');
  try{
   await save(release);
   freeze(true,'Установлюємо оновлення. Застосунок перезапуститься автоматично…');
   const reply=await local('/updates/apply',{});if(!reply.ok||!reply.restarting)throw Error(reply.error||'Не вдалося розпочати встановлення.');
   const deadline=now()+restartTimeout;
   while(now()<deadline){
    await pause(700);let current;try{current=await local('/updates/status');}catch{continue;}
    if(current.ok&&Number.isInteger(current.currentCode)&&current.currentCode>=release.code){requested=false;reload();return;}
    if(current.state===5)throw Error(current.message||'Оновлення не встановлено. Продовжуйте роботу в попередній версії.');
   }
   throw Error('Не вдалося підтвердити запуск нової версії. Запустіть програму знову. Дані збережено.');
  }catch(x){requested=false;applying=false;freeze(false);publish({...release,message:x.message,error:true});}
 }
 async function status(){
  if(polling||applying)return;polling=true;
  try{
   const value=await local('/updates/status');if(!value.ok)throw Error(value.error||'Не вдалося перевірити оновлення.');publish(value);
   if(requested){
    if(value.state===3){if(!Number.isInteger(value.code)||value.code<=value.currentCode)throw Error('Не вдалося перевірити номер оновлення. Повторіть перевірку.');await install(value);}
    else if([2,4,5].includes(value.state))requested=false;
   }
  }catch(x){if(requested){requested=false;publish({...last,message:x.message,error:true});}}
  finally{polling=false;info(last);schedule();}
 }
 async function check(){
  if(requested||applying)return;requested=true;publish({...last,message:'Перевіряємо й завантажуємо оновлення…'});
  try{const value=await local('/updates/check',{});if(!value.ok)throw Error(value.error||'Не вдалося перевірити оновлення.');await status();}
  catch(x){requested=false;publish({...last,message:x.message,error:true});}finally{info(last);schedule();}
 }
 return {check,status,dispose(){requested=false;clearTimeout(timer);},get applying(){return applying;},get requested(){return requested;}};
}
