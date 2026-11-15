/* The browser renders the UI, but Windows must relaunch and group this EXE.
 * Touch only FPV app windows; regular browser windows and Litakova are excluded. */
typedef struct {DWORD a;WORD b,c;BYTE d[8];} FPV_GUID;
typedef struct {FPV_GUID format;DWORD id;} FPV_PROPERTY_KEY;
typedef struct {WORD type,reserved[3];QWORD value[2];} FPV_PROPERTY_VALUE;
typedef struct {
 void*query;void*addref;UINT (*release)(void*);void*count;void*at;void*get;
 LONG (*set)(void*,const FPV_PROPERTY_KEY*,const FPV_PROPERTY_VALUE*);
 LONG (*commit)(void*);
} FPV_PROPERTY_VTABLE;
typedef struct {FPV_PROPERTY_VTABLE*methods;} FPV_PROPERTY_STORE;
typedef struct {WCHAR command[1280],icon_path[1280];HANDLE small,big;} FPV_WINDOW_IDENTITY;
_Static_assert(sizeof(FPV_GUID)==16&&sizeof(FPV_PROPERTY_KEY)==20&&sizeof(FPV_PROPERTY_VALUE)==24,"Windows property layouts");
static HANDLE browser_identity_thread;
static const WCHAR browser_identity_marker[]=L"FPVKomisiiaPC.WindowIdentity";
static const FPV_GUID browser_store_iid={0x886d8eeb,0x8cf2,0x4446,{0x8d,0x02,0xcd,0xba,0x1d,0xbd,0xcf,0x99}};
static const FPV_GUID browser_property_format={0x9f4c2855,0x9f79,0x4b39,{0xa8,0xd0,0xe1,0xd4,0x2d,0xe1,0xd5,0xf3}};
static int browser_set_property(FPV_PROPERTY_STORE*store,DWORD id,const WCHAR*text){
 FPV_PROPERTY_KEY key={browser_property_format,id};FPV_PROPERTY_VALUE value={0};value.type=31u;value.value[0]=(QWORD)text;
 return store->methods->set(store,&key,&value)>=0;
}
static BOOL browser_identity_window(HANDLE window,QWORD argument){
 FPV_WINDOW_IDENTITY*identity=(FPV_WINDOW_IDENTITY*)argument;WCHAR text[96],kind[48];
 if(!GetWindowTextW(window,text,96)||!GetClassNameW(window,kind,48)||!update_wsame(text,L"FPV Комісія | ПК")||!update_wsame(kind,L"Chrome_WidgetWin_1"))return 1;
 QWORD result=0;
 SendMessageTimeoutW(window,0x007fu,0,0,2u,500u,&result);
 if(result!=(QWORD)identity->small)SendMessageTimeoutW(window,0x0080u,0,(QWORD)identity->small,2u,500u,&result);
 SendMessageTimeoutW(window,0x007fu,1,0,2u,500u,&result);
 if(result!=(QWORD)identity->big)SendMessageTimeoutW(window,0x0080u,1,(QWORD)identity->big,2u,500u,&result);
 if((QWORD)GetPropW(window,browser_identity_marker)==GetCurrentProcessId())return 1;
 FPV_PROPERTY_STORE*store=0;
 if(SHGetPropertyStoreForWindow(window,&browser_store_iid,(void**)&store)>=0&&store){
  /* Relaunch properties precede the ID, as required by the Windows Shell. */
  int ok=browser_set_property(store,2u,identity->command)&&browser_set_property(store,3u,identity->icon_path)&&browser_set_property(store,4u,L"FPV Комісія")&&browser_set_property(store,5u,L"FPVKomisiiaPC")&&store->methods->commit(store)>=0;
  store->methods->release(store);
  if(ok)SetPropW(window,browser_identity_marker,(HANDLE)(QWORD)GetCurrentProcessId());
 }
 return 1;
}
static DWORD browser_identity_worker(void*unused){
 (void)unused;FPV_WINDOW_IDENTITY*identity=allocate(sizeof(*identity));WCHAR*path=allocate(1250u*2u);
 LONG initialized=CoInitializeEx(0,2u);
 if(identity&&path){
  DWORD n=GetModuleFileNameW(0,path,1250);
  HANDLE module=GetModuleHandleW(0);
  identity->small=LoadImageW(module,(const WCHAR*)1,1u,32,32,0x8000u);
  identity->big=LoadImageW(module,(const WCHAR*)1,1u,64,64,0x8000u);
  if(n&&n<1200&&identity->small&&identity->big){
   wcopy(identity->command,L"\"");wcat(identity->command,path);wcat(identity->command,L"\"");wcopy(identity->icon_path,path);wcat(identity->icon_path,L",0");
   while(!__atomic_load_n(&update_closing,__ATOMIC_SEQ_CST)){EnumWindows(browser_identity_window,(QWORD)identity);Sleep(750);}
  }
 }
 if(initialized>=0)CoUninitialize();
 release(path);release(identity);return 0;
}
static void browser_identity_start(void){browser_identity_thread=CreateThread(0,0,browser_identity_worker,0,0,0);}
static void browser_identity_stop(void){if(browser_identity_thread){WaitForSingleObject(browser_identity_thread,5000);CloseHandle(browser_identity_thread);browser_identity_thread=0;}}
