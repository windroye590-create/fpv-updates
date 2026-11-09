/* Strict signed release catalog format. No URLs or paths from JSON. */
#define UPDATE_MAX_SIZE (64u*1024u*1024u)
#define PC_VERSION_CODE 1u
#define PC_VERSION_NAME "1.0.0"
#define UPDATE_HOST L"github.com"
#define UPDATE_PATH_PREFIX L"/windroye590-create/fpv-updates/releases/latest/download/"
typedef struct {DWORD code,size;char name[32],file[128],sha256[65];} UPDATE_RELEASE;
static int update_verify_signature(const BYTE*,DWORD,const BYTE*,DWORD);
static int update_b64(char c){if(c>='A'&&c<='Z')return c-'A';if(c>='a'&&c<='z')return c-'a'+26;if(c>='0'&&c<='9')return c-'0'+52;if(c=='+')return 62;if(c=='/')return 63;return -1;}
static int update_field(const BYTE**p,const BYTE*end,const char*key,char*out,UINT capacity){
 while(*key){if(*p>=end||*(*p)++!=(BYTE)*key++)return 0;}
 if(*p>=end||*(*p)++!='=')return 0;
 UINT n=0;while(*p<end&&**p!='\n'){BYTE c=*(*p)++;if(c<32||c>126||n+1>=capacity)return 0;out[n++]=(char)c;}
 if(*p>=end||!n)return 0;
 (*p)++;out[n]=0;return 1;
}
static DWORD update_number(const char*s,DWORD limit){DWORD n=0;if(!*s)return 0;while(*s){if(*s<'0'||*s>'9'||n>limit/10)return 0;n=n*10+(DWORD)(*s++-'0');if(n>limit)return 0;}return n;}
static int update_name(const char*s){UINT dots=0,digits=0;while(*s){if(*s=='.'){if(!digits)return 0;dots++;digits=0;}else if(*s>='0'&&*s<='9')digits++;else return 0;s++;}return dots==2&&digits;}
static int update_file_name(const char*s,const char*ext){
 const char*prefix="FPV-Komisiia-";while(*prefix){if(*s++!=*prefix++)return 0;}
 SIZE_T n=slen(s),en=slen(ext);if(n<=en||n>=110||!same(s+n-en,ext))return 0;
 for(SIZE_T i=0;i<n;i++){char c=s[i];if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'||c=='.'))return 0;if(c=='.'&&i&&s[i-1]=='.')return 0;}
 return 1;
}
static int update_release_fields(const BYTE**p,const BYTE*end,const char*platform,UPDATE_RELEASE*r,const char*ext){
 char key[64],number[32];
 append(append(key,platform),".code");if(!update_field(p,end,key,number,32)||(r->code=update_number(number,10000000u))==0)return 0;
 append(append(key,platform),".name");if(!update_field(p,end,key,r->name,32)||!update_name(r->name))return 0;
 append(append(key,platform),".file");if(!update_field(p,end,key,r->file,128)||!update_file_name(r->file,ext))return 0;
 append(append(key,platform),".size");if(!update_field(p,end,key,number,32)||(r->size=update_number(number,UPDATE_MAX_SIZE))==0)return 0;
 append(append(key,platform),".sha256");if(!update_field(p,end,key,r->sha256,65)||slen(r->sha256)!=64)return 0;
 for(UINT i=0;i<64;i++)if(!((r->sha256[i]>='0'&&r->sha256[i]<='9')||(r->sha256[i]>='a'&&r->sha256[i]<='f')))return 0;
 return 1;
}
static int update_parse(const BYTE*bytes,DWORD n,UPDATE_RELEASE*out){
 if(n<=523||n>16384)return 0;
 const char*magic="LKUPDATE1\n";for(UINT i=0;i<10;i++)if(bytes[i]!=(BYTE)magic[i])return 0;
 BYTE signature[384];
 for(UINT i=0,j=10;i<384;i+=3,j+=4){int a=update_b64((char)bytes[j]),b=update_b64((char)bytes[j+1]),c=update_b64((char)bytes[j+2]),d=update_b64((char)bytes[j+3]);if(a<0||b<0||c<0||d<0)return 0;signature[i]=(BYTE)((a<<2)|(b>>4));signature[i+1]=(BYTE)((b<<4)|(c>>2));signature[i+2]=(BYTE)((c<<6)|d);}
 if(bytes[522]!='\n'||!update_verify_signature(bytes+523,n-523,signature,384))return 0;
 const BYTE*p=bytes+523,*end=bytes+n;char schema[8];UPDATE_RELEASE android;
 if(!update_field(&p,end,"schema",schema,8)||!same(schema,"1"))return 0;
 return update_release_fields(&p,end,"android",&android,".apk")&&update_release_fields(&p,end,"windows",out,".exe")&&p==end;
}
