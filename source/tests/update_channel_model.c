/* Exercise the production HTTP transport with controllable WinHTTP API doubles.
 * This checks configured policy and error handling, not a Windows network run. */
#define main replacement_suite_main
#include "update_native_model.c"
#undef main

static WCHAR requested_host[128],requested_path[1300];
static DWORD option_mask,request_flags,network_status,failed_option;
static int sent_requests,read_calls,read_failure,expire_before_read;
static const char*network_body;
static DWORD network_position;

HINTERNET WinHttpOpen(const WCHAR*a,DWORD b,const WCHAR*c,const WCHAR*d,DWORD e){return (HINTERNET)1;}
BOOL WinHttpSetTimeouts(HINTERNET h,int a,int b,int c,int d){return 1;}
HINTERNET WinHttpConnect(HINTERNET h,const WCHAR*host,WORD port,DWORD flags){assert(port==443);wcopy(requested_host,host);return (HINTERNET)2;}
HINTERNET WinHttpOpenRequest(HINTERNET h,const WCHAR*method,const WCHAR*path,const WCHAR*v,const WCHAR*r,const WCHAR**types,DWORD flags){assert(weq(method,L"GET"));wcopy(requested_path,path);request_flags=flags;return (HINTERNET)3;}
BOOL WinHttpSetOption(HINTERNET h,DWORD option,void*value,DWORD bytes){
 assert(bytes==4);
 if(option==failed_option)return 0;
 DWORD n=*(DWORD*)value;
 if(option==88){assert(n==1);option_mask|=1;}
 else if(option==89){assert(n==5);option_mask|=2;}
 else if(option==63){assert(n==5);option_mask|=4;}
 else assert(0);
 return 1;
}
BOOL WinHttpSendRequest(HINTERNET h,const WCHAR*headers,DWORD n,void*body,DWORD size,DWORD total,QWORD context){assert(!body&&!size&&!total);sent_requests++;return 1;}
BOOL WinHttpReceiveResponse(HINTERNET h,void*r){return 1;}
BOOL WinHttpQueryHeaders(HINTERNET h,DWORD level,const WCHAR*name,void*out,DWORD*bytes,DWORD*index){*(DWORD*)out=network_status;if(expire_before_read)ticks+=180001;return 1;}
BOOL WinHttpReadData(HINTERNET h,void*out,DWORD n,DWORD*got){
 read_calls++;if(read_failure)return 0;
 DWORD left=(DWORD)strlen(network_body)-network_position;
 *got=left<n?left:n;if(*got)memcpy(out,network_body+network_position,*got);network_position+=*got;return 1;
}
BOOL WinHttpCloseHandle(HINTERNET h){return 1;}

static void network_reset(void){
 reset(PC_VERSION_CODE);requested_host[0]=requested_path[0]=0;
 option_mask=request_flags=failed_option=0;sent_requests=read_calls=read_failure=expire_before_read=0;
 network_status=200;network_body="PAYLOAD";network_position=0;update_closing=0;
}
static int fetch(BYTE*out,DWORD maximum,DWORD*length){return update_fetch(UPDATE_PATH_PREFIX L"updates.txt",out,maximum,0,length);}

int main(void){
 BYTE body[64];DWORD length=0;WCHAR path[1300];
 network_reset();check(fetch(body,sizeof(body),&length)&&weq(requested_host,L"github.com")&&weq(requested_path,L"/windroye590-create/fpv-updates/releases/latest/download/updates.txt"),"Manifest request uses the fixed GitHub HTTPS endpoint");
 check(option_mask==7&&request_flags==0x00800000&&sent_requests==1,"Transport requires HTTPS redirects, five-hop cap, no cookies or automatic credentials");
 check(length==7&&!memcmp(body,"PAYLOAD",7),"Transport returns the exact downloaded bytes");
 update_release_path(path,"FPV-Komisiia-PC.exe");check(weq(path,L"/windroye590-create/fpv-updates/releases/latest/download/FPV-Komisiia-PC.exe"),"Executable path uses the same fixed release prefix");
 network_reset();network_status=302;check(!fetch(body,sizeof(body),&length)&&!read_calls,"An unresolved redirect is never accepted as update data");
 network_reset();network_status=404;check(!fetch(body,sizeof(body),&length)&&!read_calls,"A missing unpublished release is reported as unavailable");
 network_reset();network_status=401;check(!fetch(body,sizeof(body),&length)&&!read_calls,"A private release or authentication wall is rejected");
 network_reset();memset(body,0xa5,sizeof(body));check(!fetch(body,3,&length)&&body[0]==0xa5,"An oversized response cannot overflow the destination");
 network_reset();network_body="";check(!fetch(body,sizeof(body),&length),"Empty content cannot become an update");
 network_reset();read_failure=1;check(!fetch(body,sizeof(body),&length),"A transport read failure is rejected");
 network_reset();expire_before_read=1;check(!fetch(body,sizeof(body),&length)&&!read_calls,"The download deadline stops reading");
 network_reset();update_closing=1;check(!fetch(body,sizeof(body),&length)&&!read_calls,"Application shutdown cancels reading");
 network_reset();failed_option=89;check(!fetch(body,sizeof(body),&length)&&!sent_requests,"Requests fail closed when a required transport policy cannot be set");
 network_reset();HANDLE file=CreateFileW(L"C:\\Data\\update.part",0,0,0,2,0,0);check(update_fetch(UPDATE_PATH_PREFIX L"FPV-Komisiia-PC.exe",0,7,file,&length)&&length==7&&find(L"C:\\Data\\update.part",0)->size==7,"Executable bytes can be streamed to the staged file");
 return 0;
}
