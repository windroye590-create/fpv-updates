/* Last-account sign-in, protected by the current Windows user's DPAPI.
 * This cache contains a vault key, never a password or a bearer token.
 * An explicit logout atomically replaces it with a disabled marker. */
#ifndef LK_STORAGE_SESSION_H
#define LK_STORAGE_SESSION_H
static void ss_path(WCHAR*out){wcopy(out,directory);wcat(out,L"\\remembered-v1.bin");}
static int ss_write(const BYTE*data,DWORD length){
 WCHAR*path=allocate(1250u*2u);if(!path)return 0;ss_path(path);
 DWORD n=0,reason=0;BYTE*old=sf_read_once(path,0,&n,&reason);int sameBytes=old&&n==length;
 if(sameBytes)for(DWORD i=0;i<n;i++)if(old[i]!=data[i]){sameBytes=0;break;}
 if(old)zero(old,n);
 release(old);int ok=sameBytes?1:sf_write(path,data,length,0,0);release(path);return ok;
}
static int ss_forget(void){const char*disabled="{\"rememberedAccountProtocol\":1,\"remembered\":false}";return ss_write((BYTE*)disabled,(DWORD)slen(disabled));}
static int ss_remember(void){
 if(!vault_key||!sc_owner(vault_owner))return 0;
 DWORD n=0,reason=0;BYTE*profile=sf_read(state_path,0,&n,&reason,1);SJ_VALUE root,accounts,own,fields;
 int durable=profile&&sj_valid(profile,n,&root)&&sj_member(profile,n,root,"accounts",&accounts)==1&&sj_member(profile,n,accounts,vault_owner,&own)==1&&sj_member(profile,n,own,"fields",&fields)==1&&fields.type=='{';
 release(profile);if(!durable)return 0;
 char data[320];char*p=append(data,"{\"rememberedAccountProtocol\":1,\"remembered\":true,\"owner\":\"");p=append(p,vault_owner);p=append(p,"\",\"key\":\"");
 const char*hex="0123456789abcdef";for(UINT i=0;i<32;i++){*p++=hex[vault_secret[i]>>4];*p++=hex[vault_secret[i]&15];}p=append(p,"\"}");
 int ok=ss_write((BYTE*)data,(DWORD)(p-data));zero(data,sizeof(data));return ok;
}
static void ss_reply(SOCKET s){
 WCHAR*path=allocate(1250u*2u);if(!path){json(s,"{\"ok\":false,\"code\":\"REMEMBERED_READ\"}");return;}ss_path(path);
 DWORD n=0,reason=0;BYTE*data=sf_read_once(path,0,&n,&reason);release(path);
 if(!data){if(reason==2||reason==3)json(s,"{\"rememberedAccountProtocol\":1,\"remembered\":false}");else json(s,"{\"ok\":false,\"code\":\"REMEMBERED_READ\"}");return;}
 SJ_VALUE root,value;QWORD protocol=0;char owner[81],key[65];
 int valid=n<=1024&&sj_valid(data,n,&root)&&sj_member(data,n,root,"rememberedAccountProtocol",&value)==1&&sj_integer(data,value,&protocol)&&protocol==1&&sj_member(data,n,root,"remembered",&value)==1;
 if(valid&&value.type=='f')json(s,"{\"rememberedAccountProtocol\":1,\"remembered\":false}");
 else if(valid&&value.type=='t'&&sj_member(data,n,root,"owner",&value)==1&&sj_text(data,value,owner,sizeof(owner))&&sc_owner(owner)&&sj_member(data,n,root,"key",&value)==1&&sj_text(data,value,key,sizeof(key))&&sc_hex(key,64))response(s,200,"application/json; charset=utf-8",data,n);
 else json(s,"{\"ok\":false,\"code\":\"REMEMBERED_READ\"}");
 zero(key,sizeof(key));zero(data,n);release(data);
}
#endif
