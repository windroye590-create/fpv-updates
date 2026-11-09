#ifndef LK_STORAGE_CRYPTO_H
#define LK_STORAGE_CRYPTO_H
static HANDLE vault_algorithm,vault_key;
static BYTE vault_secret[32];
static char vault_owner[81],vault_capability[65];
static QWORD vault_journal_serial;
static int sc_hex(const char*s,UINT n){for(UINT i=0;i<n;i++)if(!s[i]||!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return 0;return s[n]==0;}
static int sc_owner(const char*s){SIZE_T n=slen(s);if(!n||n>80)return 0;for(SIZE_T i=0;i<n;i++)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='z')||(s[i]>='A'&&s[i]<='Z')||s[i]=='_'||s[i]=='-'))return 0;return 1;}
static int sc_equal(const char*a,const char*b){SIZE_T n=slen(a),m=slen(b);UINT difference=(UINT)(n^m);if(n!=m)return 0;for(SIZE_T i=0;i<n;i++)difference|=(BYTE)a[i]^(BYTE)b[i];return difference==0;}
static void sc_close(void){if(vault_key)BCryptDestroyKey(vault_key);if(vault_algorithm)BCryptCloseAlgorithmProvider(vault_algorithm,0);vault_key=0;vault_algorithm=0;zero(vault_secret,sizeof(vault_secret));zero(vault_owner,sizeof(vault_owner));zero(vault_capability,sizeof(vault_capability));vault_journal_serial=0;}
static int sc_open(const char*owner,const char*hex,const char*capability){
 if(!sc_owner(owner)||!sc_hex(hex,64)||!sc_hex(capability,64))return 0;
 BYTE key[32];for(UINT i=0;i<32;i++)key[i]=(BYTE)(sj_hex((BYTE)hex[i*2])*16+sj_hex((BYTE)hex[i*2+1]));
 sc_close();int ok=BCryptOpenAlgorithmProvider(&vault_algorithm,L"AES",0,0)>=0&&BCryptSetProperty(vault_algorithm,L"ChainingMode",(BYTE*)L"ChainingModeGCM",32,0)>=0&&BCryptGenerateSymmetricKey(vault_algorithm,&vault_key,0,0,key,32,0)>=0;
 if(ok)copy(vault_secret,key,sizeof(key));
 zero(key,sizeof(key));if(!ok){sc_close();return 0;}copy(vault_owner,owner,slen(owner)+1);copy(vault_capability,capability,65);return 1;
}
static int sc_allowed(const char*capability){return vault_key&&sc_hex(capability,64)&&sc_equal(capability,vault_capability);}
static BYTE*sc_crypt(const char*identity,const BYTE*input,DWORD length,int encrypt,DWORD*resultLength){
 if(!vault_key||(!encrypt&&length<36))return 0;
 DWORD plainLength=encrypt?length:length-36;
 BYTE*out=allocate((SIZE_T)plainLength+(encrypt?36:0)+1);if(!out)return 0;
 BYTE nonce[12],tag[16];if(encrypt){if(BCryptGenRandom(0,nonce,12,2)<0){release(out);return 0;}copy(out,"LKVAULT1",8);copy(out+8,nonce,12);zero(tag,16);}else{for(UINT i=0;i<8;i++)if(input[i]!=(BYTE)"LKVAULT1"[i]){release(out);return 0;}copy(nonce,input+8,12);copy(tag,input+20,16);}
 char aad[256];char*p=append(aad,"LK-PC-VAULT:1\n");p=append(p,vault_owner);p=append(p,"\n");append(p,identity);
 LK_AUTH_CIPHER info;zero(&info,sizeof(info));info.size=sizeof(info);info.version=1;info.nonce=nonce;info.nonceLength=12;info.aad=(BYTE*)aad;info.aadLength=(DWORD)slen(aad);info.tag=tag;info.tagLength=16;
 DWORD done=0;LONG status=encrypt?BCryptEncrypt(vault_key,(BYTE*)input,length,&info,0,0,out+36,plainLength,&done,0):BCryptDecrypt(vault_key,(BYTE*)input+36,plainLength,&info,0,0,out,plainLength,&done,0);
 if(encrypt&&status>=0)copy(out+20,tag,16);
 zero(tag,sizeof(tag));
 if(status<0||done!=plainLength){zero(out,(SIZE_T)plainLength+(encrypt?36:0));release(out);return 0;}
 *resultLength=plainLength+(encrypt?36:0);out[*resultLength]=0;return out;
}
static int sc_random_hex(char*out,UINT bytes){BYTE random[32];if(bytes>32||BCryptGenRandom(0,random,bytes,2)<0)return 0;const char*hex="0123456789abcdef";for(UINT i=0;i<bytes;i++){out[i*2]=hex[random[i]>>4];out[i*2+1]=hex[random[i]&15];}out[bytes*2]=0;zero(random,sizeof(random));return 1;}
#endif
