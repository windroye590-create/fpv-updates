#ifndef LK_STORAGE_LEGACY_H
#define LK_STORAGE_LEGACY_H
static int storage_ready;
static void sl_path(WCHAR*out,const char*id,int journal){wcopy(out,legacy_directory);wcat(out,L"\\");WCHAR name[33];widen(name,id);wcat(out,name);wcat(out,journal?L".journal":L".profile");}
static int sl_initialize(void){
 wcopy(object_directory,directory);wcat(object_directory,L"\\objects-v2");if(GetFileAttributesW(object_directory)==0xffffffffu&&!CreateDirectoryW(object_directory,0))return 0;
 wcopy(legacy_directory,directory);wcat(legacy_directory,L"\\legacy-v1");if(GetFileAttributesW(legacy_directory)==0xffffffffu&&!CreateDirectoryW(legacy_directory,0))return 0;
 WCHAR*paths=allocate(2500u*2u);if(!paths)return 0;WCHAR*old=paths,*target=paths+1250;wcopy(old,directory);wcat(old,L"\\state.bin");
 int hasState=GetFileAttributesW(old)!=0xffffffffu;wcopy(target,directory);wcat(target,L"\\journal.bin");int hasJournal=GetFileAttributesW(target)!=0xffffffffu;
 int ok=1;if(hasState||hasJournal){char id[33];ok=sc_random_hex(id,16);if(ok){sl_path(target,id,0);if(hasState)ok=MoveFileExW(old,target,8);else ok=sf_write(target,(BYTE*)"{\"accounts\":{}}",15,0,0);}
  if(ok&&hasJournal){wcopy(old,directory);wcat(old,L"\\journal.bin");sl_path(target,id,1);ok=MoveFileExW(old,target,8);}
 }release(paths);return ok;
}
static int sl_file_id(const WCHAR*name,char*id){UINT n=0;while(name[n]&&n<40){if(name[n]>127)return 0;id[n]=(char)name[n];n++;}if(n!=40||name[n]||!same(id+32,".profile"))return 0;id[32]=0;return sc_hex(id,32);}
static void sl_list(SOCKET s){
 WCHAR*pattern=allocate(1250u*2u);LK_FIND_DATA*found=allocate(sizeof(LK_FIND_DATA));char*out=allocate(32768);
 if(!pattern||!found||!out){release(pattern);release(found);release(out);json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\"}");return;}
 wcopy(pattern,legacy_directory);wcat(pattern,L"\\*.profile");HANDLE find=FindFirstFileW(pattern,found);char*p=append(out,"{\"ok\":true,\"snapshots\":[");UINT count=0;
 if(find!=INVALID_HANDLE){do{char id[64]={0};if(!(found->attributes&16)&&sl_file_id(found->name,id)){if(count>=128){count=129;break;}if(count++)p=append(p,",");p=append(p,"{\"id\":\"");p=append(p,id);p=append(p,"\",\"changedAt\":");p=decimal(p,((QWORD)found->times[5]<<32)|found->times[4]);p=append(p,"}");}}while(FindNextFileW(find,found));FindClose(find);}
 if(count>128)json(s,"{\"ok\":false,\"code\":\"MIGRATION_LIMIT\",\"error\":\"Забагато старих локальних копій. Файли залишилися без змін.\"}");else{append(p,"]}");json(s,out);}release(pattern);release(found);release(out);
}
static int sl_authorized(const BYTE*body,DWORD n,char*owner){
 SJ_VALUE root,value;char*token=allocate(4097);if(!token)return 0;
 int ok=sj_valid(body,n,&root)&&sj_member(body,n,root,"userId",&value)==1&&sj_text(body,value,owner,81)&&sc_owner(owner)&&sj_member(body,n,root,"token",&value)==1&&sj_text(body,value,token,4097);
 if(ok){SIZE_T length=slen(token);if(!length||length>4096)ok=0;for(SIZE_T i=0;ok&&i<length;i++)if(!((token[i]>='A'&&token[i]<='Z')||(token[i]>='a'&&token[i]<='z')||(token[i]>='0'&&token[i]<='9')||token[i]=='_'||token[i]=='-'||token[i]=='.'))ok=0;}
 char nonce[65];if(ok)ok=sc_random_hex(nonce,32);
 if(ok){char*request=allocate(slen(token)+400);if(!request)ok=0;else{char*p=append(request,"{\"action\":\"local-storage-authorize\",\"token\":\"");p=append(p,token);p=append(p,"\",\"userId\":\"");p=append(p,owner);p=append(p,"\",\"nonce\":\"");p=append(p,nonce);append(p,"\"}");DWORD length=0,status=0;BYTE*reply=commission_request(request,(DWORD)slen(request),&length,&status);zero(request,slen(request));release(request);
    char expected[160];p=append(expected,"{\"ok\":true,\"localStorageAuthorization\":\"");p=append(p,nonce);append(p,"\"}");ok=reply&&length==slen(expected)&&same((char*)reply,expected);release(reply);
  }}zero(token,4097);release(token);return ok;
}
static int sl_journal_owner(const BYTE*p,DWORD n,const char*owner){SJ_VALUE root,v;char text[81];return sj_valid(p,n,&root)&&sj_member(p,n,root,"userId",&v)==1&&sj_text(p,v,text,sizeof(text))&&same(text,owner);}
static void sl_read(SOCKET s,const char*id,const char*owner){
 WCHAR*path=allocate(1250u*2u);if(!path){json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\"}");return;}sl_path(path,id,0);DWORD n=0,reason=0;BYTE*profile=sf_read_once(path,0,&n,&reason);SJ_VALUE root,accounts,account;int found=0;
 if(profile&&sj_valid(profile,n,&root)&&sj_member(profile,n,root,"accounts",&accounts)==1)found=sj_member(profile,n,accounts,owner,&account);else found=-1;
 if(found<0||(found&&account.type!='{')){release(profile);release(path);json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\",\"error\":\"Стару локальну копію не вдалося прочитати. Файл збережено.\"}");return;}
 sl_path(path,id,1);DWORD jn=0;BYTE*journal=sf_read_once(path,0,&jn,&reason);if(!journal&&reason!=2&&reason!=3){if(profile)zero(profile,n);release(profile);release(path);json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\",\"error\":\"Не вдалося прочитати старий журнал відповідей. Старі файли залишилися без змін.\"}");return;}if(journal&&!sl_journal_owner(journal,jn,owner)){zero(journal,jn);release(journal);journal=0;jn=0;}
 DWORD size=(found?account.end-account.start:4)+jn+80;char*out=allocate(size);if(out){char*p=append(out,"{\"ok\":true,\"account\":");if(found){copy(p,profile+account.start,account.end-account.start);p+=account.end-account.start;*p=0;}else p=append(p,"null");p=append(p,",\"journal\":");if(journal){copy(p,journal,jn);p+=jn;*p=0;}else p=append(p,"null");append(p,"}");json(s,out);zero(out,size);release(out);}else json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\"}");
 if(profile)zero(profile,n);
 if(journal)zero(journal,jn);
 release(profile);release(journal);release(path);
}
static int sl_complete(const char*id,const char*owner){
 if(!same(owner,vault_owner))return 0;
 DWORD n=0,reason=0;BYTE*rootBytes=sf_read(state_path,0,&n,&reason,1);SJ_VALUE root,accounts,own,fields;
 int saved=rootBytes&&sj_valid(rootBytes,n,&root)&&sj_member(rootBytes,n,root,"accounts",&accounts)==1&&sj_member(rootBytes,n,accounts,owner,&own)==1&&sj_member(rootBytes,n,own,"fields",&fields)==1&&fields.type=='{';release(rootBytes);if(!saved)return 0;
 WCHAR*path=allocate(1250u*2u);if(!path)return 0;sl_path(path,id,0);BYTE*old=sf_read_once(path,0,&n,&reason);if(!old){release(path);return reason==2||reason==3;}
 if(!sj_valid(old,n,&root)||sj_member(old,n,root,"accounts",&accounts)!=1||accounts.type!='{'){release(old);release(path);return 0;}
 char*out=allocate((SIZE_T)n+32);if(!out){release(old);release(path);return 0;}char*at=append(out,"{\"accounts\":{");DWORD p=accounts.start+1;UINT remaining=0;sj_space(old,n,&p);
 while(p<accounts.end-1){SJ_VALUE name,value;if(!sj_value(old,n,&p,1,&name)){remaining=0xffffffffu;break;}sj_space(old,n,&p);p++;if(!sj_value(old,n,&p,1,&value)){remaining=0xffffffffu;break;}
  if(!sj_key(old,name,owner)){if(remaining++)at=append(at,",");copy(at,old+name.start,name.end-name.start);at+=name.end-name.start;*at++=':';copy(at,old+value.start,value.end-value.start);at+=value.end-value.start;*at=0;}sj_space(old,n,&p);if(p==accounts.end-1)break;p++;sj_space(old,n,&p);
 }append(at,"}}");int ok=remaining!=0xffffffffu&&sf_write(path,(BYTE*)out,(DWORD)slen(out),0,0);zero(old,n);zero(out,n+32);release(old);release(out);
 if(ok){sl_path(path,id,1);DWORD jn=0;BYTE*j=sf_read_once(path,0,&jn,&reason);if(j&&sl_journal_owner(j,jn,owner)){DeleteFileW(path);zero(j,jn);release(j);j=0;}if(j){zero(j,jn);release(j);}if(!remaining&&GetFileAttributesW(path)==0xffffffffu){sl_path(path,id,0);DeleteFileW(path);}}
 release(path);return ok;
}
#endif
