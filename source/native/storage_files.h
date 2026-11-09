#ifndef LK_STORAGE_FILES_H
#define LK_STORAGE_FILES_H
#define SF_MISSING 2u
#define SF_CORRUPT 100001u
static WCHAR object_directory[1100],legacy_directory[1100];
static DWORD storage_recoveries;
static void sf_suffix(WCHAR*out,const WCHAR*path,const WCHAR*suffix){wcopy(out,path);wcat(out,suffix);}
static void sf_backup(WCHAR*out,const WCHAR*path,UINT number){wcopy(out,path);if(number){wcat(out,L".bak0");SIZE_T n=0;while(out[n])n++;out[n-1]=(WCHAR)('0'+number);}}
static BYTE*sf_read_packet(const WCHAR*path,DWORD*length,DWORD*failure){
 HANDLE f=CreateFileW(path,0x80000000u,1,0,3,0x80,0);if(f==INVALID_HANDLE){*failure=GetLastError();return 0;}QWORD size=0;DWORD done=0;BYTE*bytes=0;*failure=SF_CORRUPT;
 if(GetFileSizeEx(f,&size)&&size>0&&size<MAX_BODY+4096u){bytes=allocate(size+1);if(!bytes||!ReadFile(f,bytes,(DWORD)size,&done,0)||done!=size){release(bytes);bytes=0;}else{bytes[size]=0;*length=(DWORD)size;*failure=0;}}
 CloseHandle(f);return bytes;
}
static BYTE*sf_unpack(const BYTE*packet,DWORD length,const char*identity,DWORD*outLength){
 DATA_BLOB in={length,(BYTE*)packet},plain={0,0};if(!CryptUnprotectData(&in,0,0,0,0,1,&plain))return 0;
 BYTE*result=0;if(identity)result=sc_crypt(identity,plain.pbData,plain.cbData,0,outLength);else{*outLength=plain.cbData;result=allocate((SIZE_T)plain.cbData+1);if(result){copy(result,plain.pbData,plain.cbData);result[plain.cbData]=0;}}
 LocalFree(plain.pbData);SJ_VALUE value;if(result&&(!sj_valid(result,*outLength,&value)||value.type!='{')){zero(result,*outLength);release(result);result=0;}return result;
}
static BYTE*sf_read_once(const WCHAR*path,const char*identity,DWORD*length,DWORD*failure){
 DWORD n=0;BYTE*packet=sf_read_packet(path,&n,failure);if(!packet)return 0;BYTE*plain=sf_unpack(packet,n,identity,length);release(packet);if(!plain)*failure=SF_CORRUPT;return plain;
}
static BYTE*sf_read(const WCHAR*path,const char*identity,DWORD*length,DWORD*failure,int backups){
 BYTE*plain=sf_read_once(path,identity,length,failure);if(plain)return plain;
 if(*failure!=2&&*failure!=3&&*failure!=SF_CORRUPT)return 0;
 int exists=*failure==SF_CORRUPT;
 WCHAR*name=allocate(1250u*2u);if(!name)return 0;
 for(UINT i=1;backups&&i<=3;i++){sf_backup(name,path,i);DWORD reason=0;plain=sf_read_once(name,identity,length,&reason);if(plain){storage_recoveries++;*failure=0;break;}if(reason!=2&&reason!=3)exists=1;}
 release(name);if(!plain)*failure=exists?SF_CORRUPT:SF_MISSING;return plain;
}
static int sf_write_packet(const WCHAR*path,const BYTE*packet,DWORD length){
 WCHAR*temporary=allocate(1250u*2u);if(!temporary)return 0;sf_suffix(temporary,path,L".tmp");
 HANDLE f=CreateFileW(temporary,0x40000000u,0,0,2,0x80,0);int ok=0;
 if(f!=INVALID_HANDLE){DWORD done=0;ok=WriteFile(f,packet,length,&done,0)&&done==length;ok=FlushFileBuffers(f)&&ok;CloseHandle(f);if(ok)ok=MoveFileExW(temporary,path,9);}
 if(!ok)DeleteFileW(temporary);
 release(temporary);return ok;
}
static int sf_copy_packet(const WCHAR*from,const WCHAR*to){DWORD n=0,reason=0;BYTE*p=sf_read_packet(from,&n,&reason);if(!p)return reason==2||reason==3;int ok=sf_write_packet(to,p,n);release(p);return ok;}
static int sf_rotate(const WCHAR*path,const char*identity){
 WCHAR*memory=allocate(2500u*2u);if(!memory)return 0;WCHAR*from=memory,*to=memory+1250;int ok=1;
 for(UINT i=3;i>0;i--){sf_backup(from,path,i-1);sf_backup(to,path,i);DWORD n=0,reason=0;BYTE*p=sf_read_once(from,identity,&n,&reason);if(p){zero(p,n);release(p);if(!sf_copy_packet(from,to)){ok=0;break;}}else if(reason!=2&&reason!=3&&reason!=SF_CORRUPT){ok=0;break;}}
 release(memory);return ok;
}
static int sf_write(const WCHAR*path,const BYTE*plain,DWORD length,const char*identity,int backups){
 SJ_VALUE value;if(!sj_valid(plain,length,&value)||value.type!='{')return 0;DWORD protectedLength=length;BYTE*encrypted=identity?sc_crypt(identity,plain,length,1,&protectedLength):0;if(identity&&!encrypted)return 0;
 DATA_BLOB in={protectedLength,identity?encrypted:(BYTE*)plain},out={0,0};int ok=CryptProtectData(&in,TITLE,0,0,0,1,&out);if(encrypted){zero(encrypted,protectedLength);release(encrypted);}if(!ok)return 0;
 if(backups&&!sf_rotate(path,identity))ok=0;
 if(ok)ok=sf_write_packet(path,out.pbData,out.cbData);
 LocalFree(out.pbData);return ok;
}
static void sf_reply_read(SOCKET s,const WCHAR*path,const char*identity,int backups){
 DWORD n=0,reason=0;BYTE*p=sf_read(path,identity,&n,&reason,backups);
 if(p){response(s,200,"application/json; charset=utf-8",p,n);zero(p,n);release(p);}else if(reason==SF_MISSING)json(s,"{}");else json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\",\"error\":\"Не вдалося прочитати локальні дані або їх резервні копії. Файли збережено без змін.\"}");
}
static int sf_profile_version(const BYTE*p,DWORD n,QWORD*revision){SJ_VALUE root,v;QWORD version=0;return sj_valid(p,n,&root)&&sj_member(p,n,root,"storageProtocol",&v)==1&&sj_integer(p,v,&version)&&version==2&&sj_member(p,n,root,"revision",&v)==1&&sj_integer(p,v,revision);}
static int sf_profile_write(const BYTE*p,DWORD n){
 SJ_VALUE root,v;QWORD revision=0,expected=0;if(!sf_profile_version(p,n,&revision)||!revision||!sj_valid(p,n,&root)||sj_member(p,n,root,"expectedRevision",&v)!=1||!sj_integer(p,v,&expected)||revision!=expected+1)return -1;
 DWORD oldLength=0,reason=0;BYTE*old=sf_read(state_path,0,&oldLength,&reason,1);QWORD current=0;if(old&&!sf_profile_version(old,oldLength,&current)){release(old);return -1;}if(!old&&reason!=SF_MISSING)return 0;
 if(old&&oldLength==n){DWORD difference=0;for(DWORD i=0;i<n;i++)difference|=old[i]^p[i];if(!difference){release(old);return 1;}}
 release(old);if(current!=expected)return -1;return sf_write(state_path,p,n,0,1);
}
static void sf_object_path(WCHAR*out,const char*id){wcopy(out,object_directory);wcat(out,L"\\");WCHAR name[70];widen(name,id);wcat(out,name);wcat(out,L".bin");}
static void sf_journal_path(WCHAR*out){wcopy(out,object_directory);wcat(out,L"\\journal-");WCHAR owner[81];widen(owner,vault_owner);wcat(out,owner);wcat(out,L".bin");}
static int sf_vault_journal_write(const BYTE*p,DWORD n){
 SJ_VALUE root,v;char owner[81];QWORD serial=serial_from(p,n);if(!serial||n>MAX_JOURNAL_BODY||!sj_valid(p,n,&root)||sj_member(p,n,root,"userId",&v)!=1||!sj_text(p,v,owner,sizeof(owner))||!same(owner,vault_owner))return 0;
 WCHAR*path=allocate(1250u*2u);if(!path)return 0;sf_journal_path(path);
 {DWORD oldLength=0,reason=0;BYTE*old=sf_read(path,"journal",&oldLength,&reason,1);if(old){vault_journal_serial=serial_from(old,oldLength);zero(old,oldLength);release(old);}else if(reason!=SF_MISSING){release(path);return 0;}else vault_journal_serial=0;}
 int ok=serial<=vault_journal_serial?1:sf_write(path,p,n,"journal",1);if(ok&&serial>vault_journal_serial)vault_journal_serial=serial;release(path);return ok;
}
#endif
