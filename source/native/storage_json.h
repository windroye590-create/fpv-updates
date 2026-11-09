/* Bounded JSON validation and direct-member lookup. No allocation or coercion. */
#ifndef LK_STORAGE_JSON_H
#define LK_STORAGE_JSON_H
typedef struct {DWORD start,end;char type;} SJ_VALUE;
static void sj_space(const BYTE*s,DWORD n,DWORD*p){while(*p<n&&(s[*p]==' '||s[*p]=='\t'||s[*p]=='\r'||s[*p]=='\n'))(*p)++;}
static int sj_hex(BYTE c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;}
static int sj_string_end(const BYTE*s,DWORD n,DWORD*p){
 if(*p>=n||s[(*p)++]!='"')return 0;
 while(*p<n){BYTE c=s[(*p)++];if(c=='"')return 1;if(c<32)return 0;
  if(c=='\\'){if(*p>=n)return 0;c=s[(*p)++];if(c=='u'){for(UINT k=0;k<4;k++){if(*p>=n||sj_hex(s[(*p)++])<0)return 0;}}else if(c!='"'&&c!='\\'&&c!='/'&&c!='b'&&c!='f'&&c!='n'&&c!='r'&&c!='t')return 0;}
 }return 0;
}
static int sj_value(const BYTE*s,DWORD n,DWORD*p,UINT depth,SJ_VALUE*out){
 sj_space(s,n,p);if(*p>=n||depth>64)return 0;DWORD first=*p;BYTE c=s[*p];
 if(c=='"'){if(!sj_string_end(s,n,p))return 0;}
 else if(c=='{'||c=='['){BYTE end=c=='{'?'}':']';(*p)++;sj_space(s,n,p);
  if(*p<n&&s[*p]==end)(*p)++;
  else for(;;){if(c=='{'){if(!sj_string_end(s,n,p))return 0;sj_space(s,n,p);if(*p>=n||s[(*p)++]!=':')return 0;}
   if(!sj_value(s,n,p,depth+1,0))return 0;
   sj_space(s,n,p);if(*p>=n)return 0;
   BYTE separator=s[(*p)++];if(separator==end)break;if(separator!=',')return 0;sj_space(s,n,p);
  }
 }else if(c=='t'||c=='f'||c=='n'){const char*word=c=='t'?"true":c=='f'?"false":"null";while(*word){if(*p>=n||s[(*p)++]!=(BYTE)*word++)return 0;}}
 else {if(c=='-'){(*p)++;if(*p>=n)return 0;}if(s[*p]=='0')(*p)++;else{if(s[*p]<'1'||s[*p]>'9')return 0;do{(*p)++;}while(*p<n&&s[*p]>='0'&&s[*p]<='9');}
  if(*p<n&&s[*p]=='.'){(*p)++;DWORD digits=*p;while(*p<n&&s[*p]>='0'&&s[*p]<='9')(*p)++;if(digits==*p)return 0;}
  if(*p<n&&(s[*p]=='e'||s[*p]=='E')){(*p)++;if(*p<n&&(s[*p]=='+'||s[*p]=='-'))(*p)++;DWORD digits=*p;while(*p<n&&s[*p]>='0'&&s[*p]<='9')(*p)++;if(digits==*p)return 0;}
 }
 if(out){out->start=first;out->end=*p;out->type=(char)c;}return 1;
}
static int sj_valid(const BYTE*s,DWORD n,SJ_VALUE*out){DWORD p=0;if(!sj_value(s,n,&p,0,out))return 0;sj_space(s,n,&p);return p==n;}
static int sj_text(const BYTE*s,SJ_VALUE v,char*out,DWORD capacity){
 if(v.type!='"'||!capacity)return 0;
 DWORD p=v.start+1,j=0;
 while(p+1<v.end){BYTE c=s[p++];if(c=='\\'){c=s[p++];if(c=='u'){UINT value=0;for(UINT k=0;k<4;k++)value=value*16+(UINT)sj_hex(s[p++]);if(value>127)return 0;c=(BYTE)value;}else if(c=='b')c=8;else if(c=='f')c=12;else if(c=='n')c=10;else if(c=='r')c=13;else if(c=='t')c=9;}
  if(!c||c>127||j+1>=capacity)return 0;
  out[j++]=(char)c;
 }out[j]=0;return 1;
}
static int sj_key(const BYTE*s,SJ_VALUE v,const char*key){char text[128];return sj_text(s,v,text,sizeof(text))&&same(text,key);}
/* -1 means duplicate/invalid; callers must never select an ambiguous owner. */
static int sj_member(const BYTE*s,DWORD n,SJ_VALUE object,const char*key,SJ_VALUE*out){
 if(object.type!='{')return -1;
 DWORD p=object.start+1;int found=0;sj_space(s,n,&p);
 while(p<object.end-1){SJ_VALUE name,value;if(!sj_value(s,n,&p,1,&name)||name.type!='"')return -1;sj_space(s,n,&p);if(p>=n||s[p++]!=':')return -1;if(!sj_value(s,n,&p,1,&value))return -1;
  if(sj_key(s,name,key)){if(found)return -1;found=1;if(out)*out=value;}sj_space(s,n,&p);if(p==object.end-1)break;if(p>=n||s[p++]!=',')return -1;sj_space(s,n,&p);
 }return found;
}
static int sj_integer(const BYTE*s,SJ_VALUE v,QWORD*out){
 QWORD value=0;if(v.type<'0'||v.type>'9')return 0;
 for(DWORD i=v.start;i<v.end;i++){if(s[i]<'0'||s[i]>'9'||value>900719925474099u)return 0;value=value*10+s[i]-'0';}if(value>9007199254740991u)return 0;*out=value;return 1;
}
#endif
