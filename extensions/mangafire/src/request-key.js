// Public protocol constants adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
const tables={
        1: 'yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==',
        2: 'IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==',
        3: 'NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==',
    };
const keys={
        1: '0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=',
        2: 'AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==',
        3: 'DELOJgPsVaCcblDtTGMdHzM=',
    };
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decode(value){const out=[];let bits=0,n=0;for(const c of value){if(c==='=')break;const i=alphabet.indexOf(c);if(i<0)throw Error("Invalid protocol table.");n=(n<<6)|i;bits+=6;if(bits>=8){bits-=8;out.push((n>>bits)&255);}}return out;}
function encode(data){let out='',bits=0,n=0;for(const b of data){n=(n<<8)|b;bits+=8;while(bits>=6){bits-=6;out+=alphabet[(n>>bits)&63];}}if(bits)out+=alphabet[(n<<(6-bits))&63];return out.replace(/\+/g,'-').replace(/\//g,'_');}
const stages=[1,2,3].map((n,i)=>[decode(tables[n]),decode(keys[n]),[0x5a,0x35,0xba][i]]);
export function sign(value){let data=[];for(const c of encodeURIComponent(value).match(/%[0-9a-f]{2}|[^%]/gi)??[])data.push(c[0]==='%'?parseInt(c.slice(1),16):c.charCodeAt(0));for(const [table,key,iv]of stages){let prev=iv;data=data.map((byte,i)=>prev=table[(byte^key[i%key.length]^prev)&255]);}return encode(data);}
function form(value){return encodeURIComponent(value).replace(/[!'()~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');}
export function signedPath(path,pairs=[]){if(!/^\/api\/[a-z0-9/_-]+$/i.test(path))throw Error("Invalid MangaFire API path.");const sorted=pairs.map(p=>[...p]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);let last='',index=0;const canonical=path.slice(4)+(sorted.length?'?'+sorted.map(([k,v])=>{let name=k;if(k.endsWith('[]')){if(last!==k)index=0;last=k;name=k.slice(0,-2)+'['+(index++)+']';}return name+'='+v;}).join('&'):'');return path+'?'+[...sorted,['vrf',sign(canonical)]].map(([k,v])=>form(k)+'='+form(String(v))).join('&');}
