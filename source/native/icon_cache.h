/* Refresh only this executable's cached Shell image; never delete icon databases
 * or restart Explorer. The executable has one icon group at file index zero. */
typedef struct {HANDLE icon;int index;DWORD attributes;WCHAR display[260],type[80];} LK_SHFILEINFO;
_Static_assert(sizeof(LK_SHFILEINFO)==696,"Windows x64 SHFILEINFOW layout");
static void icon_refresh_path(const WCHAR*path){
 if(!path)return;
 UINT n=0;while(path[n]&&n<260)n++;if(!n||n>=260)return;
 LK_SHFILEINFO*info=allocate(sizeof(*info));
 if(info){
  if(SHGetFileInfoW(path,0,info,sizeof(*info),0x4000u))SHUpdateImageW(path,0,0,info->index);
  release(info);
 }
 SHChangeNotify(0x2000,0x3005u,path,0); /* UPDATEITEM, PATHW, FLUSHNOWAIT */
}
static DWORD icon_refresh_worker(void*unused){
 (void)unused;WCHAR*path=allocate(1250u*2u);
 if(path){DWORD n=GetModuleFileNameW(0,path,1250);if(n&&n<1250)icon_refresh_path(path);release(path);}
 __atomic_sub_fetch(&workers,1,__ATOMIC_SEQ_CST);return 0;
}
static void icon_refresh_start(void){
 __atomic_add_fetch(&workers,1,__ATOMIC_SEQ_CST);
 HANDLE thread=CreateThread(0,0,icon_refresh_worker,0,0,0);
 if(thread)CloseHandle(thread);else __atomic_sub_fetch(&workers,1,__ATOMIC_SEQ_CST);
}
