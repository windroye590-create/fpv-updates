#ifndef LK_STORAGE_H
#define LK_STORAGE_H
#include "storage_json.h"
#include "storage_crypto.h"
#include "storage_files.h"
#include "storage_session.h"
#include "storage_legacy.h"
static const char*storage_tail(const char*path,const char*prefix){while(*prefix){if(*path++!=*prefix++)return 0;}return path;}
static void storage_failure(SOCKET s,const char*code){if(same(code,"FORBIDDEN"))json(s,"{\"ok\":false,\"code\":\"FORBIDDEN\",\"error\":\"Розблокуйте локальну копію своїм паролем.\"}");else if(same(code,"STORAGE_CONFLICT"))json(s,"{\"ok\":false,\"code\":\"STORAGE_CONFLICT\",\"error\":\"Локальний профіль оновлено в іншому вікні. Перезапустіть програму; збережені файли залишилися на ПК.\"}");else json(s,"{\"ok\":false,\"code\":\"STORAGE_WRITE\",\"error\":\"Не вдалося підтвердити збереження локальних даних та резервної копії.\"}");}
typedef struct {char id[65];} STORAGE_ID;
static UINT storage_hash(const char*id){UINT value=2166136261u;for(UINT i=0;i<64;i++)value=(value^(BYTE)id[i])*16777619u;return value&65535u;}
static int storage_reference(STORAGE_ID*table,const char*id,int add,UINT*count){UINT at=storage_hash(id);for(UINT i=0;i<65536;i++,at=(at+1)&65535u){if(!table[at].id[0]){if(add){if(*count>=32768)return -1;copy(table[at].id,id,65);(*count)++;}return 0;}if(same(table[at].id,id))return 1;}return -1;}
static int storage_collect_refs(STORAGE_ID*table,const BYTE*root,DWORD n,UINT*count){
 for(DWORD i=0;i+66<=n;i++)if(root[i]=='"'&&root[i+65]=='"'){char id[65];copy(id,root+i+1,64);id[64]=0;if(sc_hex(id,64)&&storage_reference(table,id,1,count)<0)return 0;}
 return 1;
}
static UINT storage_gc(void){
 STORAGE_ID*table=allocate(sizeof(STORAGE_ID)*65536u);WCHAR*paths=allocate(2500u*2u);LK_FIND_DATA*entry=allocate(sizeof(LK_FIND_DATA));if(!table||!paths||!entry){release(table);release(paths);release(entry);return 0;}
 UINT count=0,removed=0;int ready=1;for(UINT i=0;i<=3;i++){sf_backup(paths,state_path,i);DWORD n=0,reason=0;BYTE*root=sf_read_once(paths,0,&n,&reason);QWORD rev=0;if(root){ready=sf_profile_version(root,n,&rev)&&storage_collect_refs(table,root,n,&count);release(root);}else if(reason!=2&&reason!=3)ready=0;if(!ready)break;}
 if(ready){wcopy(paths,object_directory);wcat(paths,L"\\*.bin");HANDLE find=FindFirstFileW(paths,entry);if(find!=INVALID_HANDLE){do{if(entry->attributes&16)continue;char id[69];UINT i=0;for(;i<68&&entry->name[i]&&entry->name[i]<128;i++)id[i]=(char)entry->name[i];if(i!=68||entry->name[i])continue;id[68]=0;if(!same(id+64,".bin"))continue;id[64]=0;if(!sc_hex(id,64)||storage_reference(table,id,0,&count))continue;sf_object_path(paths+1250,id);if(DeleteFileW(paths+1250))removed++;}while(FindNextFileW(find,entry));FindClose(find);}}
 release(table);release(paths);release(entry);return removed;
}
static int storage_route(SOCKET s,const char*method,const char*path,const BYTE*body,DWORD length,const char*capability){
 const char*object=storage_tail(path,"/vault/objects/");const char*legacy=storage_tail(path,"/legacy/");const char*backup=storage_tail(path,"/storage/profile/backup/");
 int recognized=storage_tail(path,"/storage/")||storage_tail(path,"/vault/")||legacy;if(!recognized)return 0;
 if(!storage_ready){json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\",\"error\":\"Не вдалося підготувати перенесення старих даних. Файли збережено без змін. Перезапустіть програму.\"}");return 1;}
 if(same(method,"POST")&&legacy&&!same(legacy,"list")){
  char id[33],owner[81];if(slen(legacy)<32){storage_failure(s,"FORBIDDEN");return 1;}copy(id,legacy,32);id[32]=0;
  if(!sc_hex(id,32)||(!same(legacy+32,"/account")&&!same(legacy+32,"/complete"))||!sl_authorized(body,length,owner)){storage_failure(s,"FORBIDDEN");return 1;}
  EnterCriticalSection(&store_lock);if(same(legacy+32,"/account"))sl_read(s,id,owner);else if(sc_allowed(capability)&&sl_complete(id,owner))json(s,"{\"ok\":true}");else storage_failure(s,"STORAGE_WRITE");LeaveCriticalSection(&store_lock);return 1;
 }
 EnterCriticalSection(&store_lock);
 if(same(method,"GET")&&same(path,"/storage/status")){char out[256];char*p=append(out,"{\"ok\":true,\"storageProtocol\":2,\"recoveredCopies\":");p=decimal(p,storage_recoveries);append(p,",\"privateObjects\":true,\"accountJournals\":true,\"rememberedSessions\":true}");json(s,out);}
 else if(same(method,"GET")&&same(path,"/vault/remembered"))ss_reply(s);
 else if(same(method,"POST")&&same(path,"/vault/forget")){if(ss_forget())json(s,"{\"ok\":true}");else storage_failure(s,"STORAGE_WRITE");}
 else if(same(method,"GET")&&same(path,"/legacy/list"))sl_list(s);
 else if(same(method,"GET")&&same(path,"/storage/profile"))sf_reply_read(s,state_path,0,1);
 else if(same(method,"POST")&&same(path,"/storage/profile")){int result=sf_profile_write(body,length);if(result==1)json(s,"{\"ok\":true}");else storage_failure(s,result<0?"STORAGE_CONFLICT":"STORAGE_WRITE");}
 else if(same(method,"GET")&&backup&&backup[0]>='1'&&backup[0]<='3'&&!backup[1]){WCHAR*name=allocate(1250u*2u);if(name){sf_backup(name,state_path,(UINT)(backup[0]-'0'));DWORD n=0,reason=0;BYTE*p=sf_read_once(name,0,&n,&reason);QWORD revision=0;if(p&&sf_profile_version(p,n,&revision))response(s,200,"application/json; charset=utf-8",p,n);else json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\"}");release(p);release(name);}else storage_failure(s,"STORAGE_WRITE");}
 else if(same(method,"POST")&&same(path,"/vault/open")){SJ_VALUE root,value;char owner[81],hex[65],cap[65];int ok=sj_valid(body,length,&root)&&sj_member(body,length,root,"owner",&value)==1&&sj_text(body,value,owner,sizeof(owner))&&sj_member(body,length,root,"key",&value)==1&&sj_text(body,value,hex,sizeof(hex))&&sj_member(body,length,root,"capability",&value)==1&&sj_text(body,value,cap,sizeof(cap))&&sc_open(owner,hex,cap);zero(hex,sizeof(hex));if(ok)json(s,"{\"ok\":true}");else storage_failure(s,"FORBIDDEN");}
 else if(!sc_allowed(capability))storage_failure(s,"FORBIDDEN");
 else if(same(method,"POST")&&same(path,"/vault/remember")){if(ss_remember())json(s,"{\"ok\":true}");else storage_failure(s,"STORAGE_WRITE");}
 else if(same(method,"POST")&&same(path,"/vault/close")){sc_close();json(s,"{\"ok\":true}");}
 else if(same(method,"POST")&&same(path,"/storage/gc")){UINT removed=storage_gc();char out[96];char*p=append(out,"{\"ok\":true,\"removed\":");p=decimal(p,removed);append(p,"}");json(s,out);}
 else if(object&&sc_hex(object,64)){WCHAR*name=allocate(1250u*2u);if(name){sf_object_path(name,object);if(same(method,"GET"))sf_reply_read(s,name,object,0);else if(same(method,"POST")){if(GetFileAttributesW(name)!=0xffffffffu){DWORD savedLength=0,reason=0;BYTE*saved=sf_read_once(name,object,&savedLength,&reason);DWORD different=savedLength^length;if(saved&&savedLength==length)for(DWORD i=0;i<length;i++)different|=saved[i]^body[i];if(saved&&!different)json(s,"{\"ok\":true}");else storage_failure(s,"STORAGE_WRITE");if(saved)zero(saved,savedLength);release(saved);}else if(sf_write(name,body,length,object,0))json(s,"{\"ok\":true}");else storage_failure(s,"STORAGE_WRITE");}else storage_failure(s,"FORBIDDEN");release(name);}else storage_failure(s,"STORAGE_WRITE");}
 else if(same(path,"/vault/journal")){WCHAR*name=allocate(1250u*2u);if(name){sf_journal_path(name);if(same(method,"GET"))sf_reply_read(s,name,"journal",1);else if(same(method,"POST")&&sf_vault_journal_write(body,length))json(s,"{\"ok\":true}");else storage_failure(s,"STORAGE_WRITE");release(name);}else storage_failure(s,"STORAGE_WRITE");}
 else storage_failure(s,"FORBIDDEN");
 LeaveCriticalSection(&store_lock);return 1;
}
#endif
