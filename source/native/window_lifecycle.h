/* Browser timer throttling is not evidence that the application was closed.
 * Only the active window's pagehide event starts the shutdown grace period.
 * Call these functions while holding store_lock. */
#ifndef LK_WINDOW_LIFECYCLE_H
#define LK_WINDOW_LIFECYCLE_H
#define WINDOW_STARTUP_MS 240000u
#define WINDOW_CLOSE_MS 15000u
static char active_window[37];
static QWORD window_started,window_closed_at;
static int window_closed;
static void window_touch(QWORD now){
 if(!active_window[0])window_started=now;
}
static int window_id_valid(const char*id){
 if(slen(id)!=36)return 0;
 for(UINT i=0;i<36;i++){
  if(i==8||i==13||i==18||i==23){if(id[i]!='-')return 0;}
  else if(!((id[i]>='0'&&id[i]<='9')||(id[i]>='a'&&id[i]<='f')))return 0;
 }return 1;
}
static int window_event(const char*id,int opened,QWORD now){
 if(!window_id_valid(id))return 0;
 if(opened){copy(active_window,id,37);window_closed=0;}
 else if(same(active_window,id)){window_closed=1;window_closed_at=now;}
 return 1;
}
static int window_should_exit(QWORD now){
 if(!active_window[0])return now-window_started>=WINDOW_STARTUP_MS;
 return window_closed&&now-window_closed_at>=WINDOW_CLOSE_MS;
}
#endif
