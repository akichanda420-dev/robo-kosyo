// ロボ工廠 デスクトップ版のLAN対戦（Hamachi など）
// ホストは同じフォルダの robo-relay(.exe) を起動し、ゲストはホストのアドレスへつなぐ。
// robo-relay と WebSocket で話し、claude.ai の room / user と同じ形のオブジェクトをゲームへ渡す。
(()=>{
'use strict';
const PORT=48800;
const ls={get:(k,d)=>{try{const v=localStorage.getItem(k);return v==null?d:v}catch(_){return d}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}}};
const rid=()=>Math.random().toString(36).slice(2,10);
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let myBy=ls.get('robo_lan_id',null);if(!myBy){myBy='u_'+rid()+rid();ls.set('robo_lan_id',myBy)}
const myPeer='p_'+rid()+rid();
const VER=window.ROBO_BUILD||'dev';
// デスクトップ版（Neutralino が 127.0.0.1:48731 で配信）かどうか
const IS_APP=/^(127\.0\.0\.1|localhost)$/.test(location.hostname)&&location.port==='48731';
// neutralino.js（Neutralino が起動情報と1回きりの鍵を先頭に入れて返す）は、ページ先頭の小さなスクリプトが読み込む（window.__nlg）
const nlReady=(window.__nlg||Promise.resolve(false)).then(ok=>ok&&!!window.NL_PORT&&!!window.Neutralino).catch(()=>false);

let ws=null,state='idle',url='',role=null,addrs=[],hostLabel='',myName='',relayProc=null,retryT=null,wantOpen=false;
const names={};const rooms=new Map();

function tx(m){if(ws&&ws.readyState===1&&state==='open')ws.send(JSON.stringify(m))}
function fire(st){const ev={peers:st.snap,joined:[],left:[],updated:[]};setTimeout(()=>st.hs.forEach(h=>{try{h(ev)}catch(e){console.error(e)}}),0)}
function rebuild(st){
  const me={peer:myPeer,by:myBy,isMe:true,sameTab:true,kind:'viewer',guest:false,presence:Object.freeze(clone(st.mine)),updatedAt:Date.now()};
  const others=state==='open'?st.list.filter(p=>p.peer!==myPeer).map(p=>Object.freeze({peer:p.peer,by:p.by,isMe:p.by===myBy,sameTab:false,kind:'viewer',guest:false,presence:Object.freeze(p.presence||{}),updatedAt:Date.now()})):[];
  st.snap=Object.freeze([Object.freeze(me),...others]);fire(st);
}
function roomApi(r){
  let st=rooms.get(r);
  if(!st){
    st={r,mine:{},list:[],hs:new Set(),snap:[]};
    st.api={name:r,
      presence:async patch=>{for(const k in patch){if(patch[k]===null||patch[k]===undefined)delete st.mine[k];else st.mine[k]=clone(patch[k])}tx({t:'pres',r,p:st.mine});rebuild(st)},
      peers:()=>st.snap,
      onPeers:(h)=>{st.hs.add(h);setTimeout(()=>{try{h({peers:st.snap,joined:st.snap,left:[],updated:[]})}catch(e){console.error(e)}},0);return()=>st.hs.delete(h)},
      connected:()=>state==='open',
      join:async n=>roomApi(String(n)),
      leave:async()=>{tx({t:'leave',r});rooms.delete(r);st.hs.clear()}};
    rooms.set(r,st);
  }
  tx({t:'join',r,p:st.mine});rebuild(st);
  return st.api;
}
const userApi={
  id:async()=>myBy,
  me:async()=>({id:myBy,name:myName}),
  profiles:async ids=>Object.fromEntries([].concat(ids).map(i=>[i,{id:i,name:names[i]||'プレイヤー'}])),
};

// 1回つなぐ。welcome で成功、reject・失敗・時間切れで失敗。
function openOnce(u,timeout){
  return new Promise((ok,ng)=>{
    let done=false,s;
    const fin=(e,v)=>{if(done)return;done=true;clearTimeout(t);e?ng(e):ok(v)};
    const t=setTimeout(()=>{try{s.close()}catch(_){}fin(new Error('timeout'))},timeout);
    try{s=new WebSocket(u)}catch(e){fin(e);return}
    s.onopen=()=>s.send(JSON.stringify({t:'hello',peer:myPeer,by:myBy,name:myName,ver:VER}));
    s.onmessage=e=>{
      let m;try{m=JSON.parse(e.data)}catch(_){return}
      if(!done){
        if(m.t==='welcome'){fin(null,{s,m})}
        else if(m.t==='reject'){const er=new Error('ver');er.hostVer=m.hostVer;fin(er);try{s.close()}catch(_){}}
        return;
      }
      onMsg(m);
    };
    s.onerror=()=>{};
    s.onclose=()=>{if(!done)fin(new Error('closed'));else if(ws===s)onDrop()};
  });
}
function onMsg(m){
  if(m.t==='room'){
    const st=rooms.get(m.r);if(!st)return;
    st.list=(m.peers||[]).map(p=>({peer:p.peer,by:p.by,presence:p.presence||{}}));
    (m.peers||[]).forEach(p=>{if(p.by&&p.name)names[p.by]=p.name});
    rebuild(st);
  }
}
function adopt(s,m){
  ws=s;state='open';addrs=m.addrs||addrs;
  rooms.forEach(st=>{tx({t:'join',r:st.r,p:st.mine});rebuild(st)});
}
function onDrop(){
  ws=null;if(!wantOpen){state='idle';return}
  state='retry';rooms.forEach(rebuild);
  clearTimeout(retryT);
  const again=async()=>{
    if(!wantOpen)return;
    try{const {s,m}=await openOnce(url,5000);if(!wantOpen){s.close();return}adopt(s,m)}
    catch(e){if(e.message==='ver'){wantOpen=false;state='idle';rooms.forEach(rebuild);return}retryT=setTimeout(again,2000)}
  };
  retryT=setTimeout(again,1000);
}

let nlInit=false;
// アプリ本体（robo-kosho.exe）のあるフォルダ
function appDir(){
  const win=window.NL_OS==='Windows',sep=win?'\\':'/';
  const isAbs=p=>win?/^[a-zA-Z]:[\\/]|^\\\\/.test(p):p.startsWith('/');
  const strip=p=>String(p).replace(/[\\/]+$/,'');
  const a0=(window.NL_ARGS&&NL_ARGS[0])||'';
  const cut=a0.replace(/[\\/][^\\/]*$/,'');
  let d=a0&&cut!==a0?cut:(window.NL_PATH||'.');
  if(!isAbs(d)&&window.NL_CWD)d=strip(NL_CWD)+sep+(d==='.'?'':d);
  return {dir:strip(d),sep,exe:win?'robo-relay.exe':'robo-relay'};
}
async function startRelay(){
  if(!(await nlReady))throw new Error('norelay');
  // 起動直後の1回だけ使える鍵。ないとき（再読み込みした後など）に init すると画面が消えるので使わない
  if(!nlInit){let tk='';try{tk=window.NL_TOKEN||sessionStorage.getItem('NL_TOKEN')||''}catch(_){tk=window.NL_TOKEN||''}if(!tk)throw new Error('token');Neutralino.init();nlInit=true}
  const {dir,sep,exe}=appDir();
  try{relayProc=await Neutralino.os.spawnProcess(`"${dir}${sep}${exe}" -port ${PORT}`,{cwd:dir})}
  catch(e){console.warn('relay spawn',e);relayProc=null}
}
async function connectHost(){
  role='host';url=`ws://127.0.0.1:${PORT}/ws`;
  // すでに中継が動いていればそれを使う。なければ起動して、立ち上がるのを待つ
  try{return await openOnce(url,1200)}catch(e){if(e.message==='ver')throw e}
  await startRelay();
  const t0=Date.now();let last;
  while(Date.now()-t0<6000){
    await new Promise(r=>setTimeout(r,400));
    try{return await openOnce(url,1500)}catch(e){last=e;if(e.message==='ver')throw e}
  }
  const er=new Error('relay');er.cause=last;throw er;
}
function parseAddr(a){
  a=String(a||'').trim().replace(/^wss?:\/\//,'').replace(/\/.*$/,'');
  if(!a)return null;
  if(/^\[.*\]/.test(a))return a.includes(']:')?a:a+':'+PORT;
  return /:\d+$/.test(a)?a:a+':'+PORT;
}
async function connectGuest(addr){
  const hp=parseAddr(addr);if(!hp)throw new Error('noaddr');
  role='guest';hostLabel=hp.replace(new RegExp(':'+PORT+'$'),'');url=`ws://${hp}/ws`;
  return await openOnce(url,6000);
}
function disconnect(){
  wantOpen=false;clearTimeout(retryT);
  try{ws&&ws.close()}catch(_){}
  ws=null;state='idle';rooms.clear();role=null;
  if(relayProc&&nlInit){Neutralino.os.updateSpawnedProcess(relayProc.id,'exit').catch(()=>{});relayProc=null}
}

const ERR={
  ver:e=>`ホストとゲームのバージョンが違います（ホスト ${esc(e.hostVer||'?')} / あなた ${esc(VER)}）。同じ版の robo-kosho.exe を使ってください。`,
  relay:()=>'中継プログラムを起動できませんでした。robo-relay.exe が robo-kosho.exe と同じフォルダにあるか、ほかのアプリがポート 48800 を使っていないか確認してください。',
  token:()=>'このウィンドウからは中継を起動できません。ゲームをいったん閉じて、開き直してから「ホストになる」を押してください。',
  norelay:()=>'このページでは中継プログラムを起動できません。デスクトップ版の robo-kosho.exe から開いてください。',
  noaddr:()=>'ホストのアドレスを入力してください（例：25.12.34.56）。',
  guest:()=>`ホスト ${esc(hostLabel)} につながりません。次を確認してください：<br>・ホストが「ホストになる」を押して待っている<br>・二人とも同じ Hamachi ネットワークに入っていて、Hamachi の表示が緑（接続中）<br>・アドレスが Hamachi に表示されているホストの IPv4（25.で始まる数字）と同じ<br>・ホストのPCの Windows ファイアウォールで robo-relay が「パブリック」ネットワークでも許可されている`,
};

function dialog(modal,onOk,onCancel){
  myName=ls.get('robo_lan_name','')||('プレイヤー'+Math.floor(Math.random()*900+100));
  const lastHost=ls.get('robo_lan_host','');
  modal.innerHTML=`<div><div class="eyebrow">オンライン対戦 ・ LAN（Hamachi など）</div><h2>つなぎ方を選んでください</h2>
    <p>同じ Hamachi ネットワーク（または同じLAN）にいる相手と対戦できます。どちらか1人が「ホスト」になり、もう1人はホストのアドレスを入力して参加します。</p></div>
    <section class="lobby-box"><h3>あなたの名前</h3><input id="lanName" class="lan-in" maxlength="24" value="${esc(myName)}"></section>
    <div class="lan-grid">
      <section class="lobby-box"><h3>ホストになる</h3><p>このPCで中継を始めます。つないだあとに表示されるアドレスを相手に伝えてください。</p><button class="btn on" type="button" id="lanHost">ホストになる</button></section>
      <section class="lobby-box"><h3>ゲストで参加</h3><p>ホストから聞いたアドレス（Hamachi の 25.で始まる数字）を入力します。</p>
        <div class="lan-row"><input id="lanAddr" class="lan-in" placeholder="25.12.34.56" value="${esc(lastHost)}" inputmode="decimal"><button class="btn on" type="button" id="lanJoin">参加する</button></div></section>
    </div>
    <p id="lanMsg" class="clock-label" role="status"></p>
    <div class="mfoot"><span class="clock-label">ポート ${PORT}（TCP）を使います</span><button class="btn" type="button" id="lanClose">閉じる</button></div>`;
  const $=id=>modal.querySelector('#'+id);
  const msg=(h,bad)=>{$('lanMsg').innerHTML=h;$('lanMsg').className=bad?'bad':'clock-label'};
  const busy=b=>{['lanHost','lanJoin','lanName','lanAddr'].forEach(i=>$(i).disabled=b)};
  const go=async(kind)=>{
    myName=($('lanName').value||'').trim().slice(0,24)||myName;ls.set('robo_lan_name',myName);
    busy(true);msg(kind==='host'?'中継を起動しています…':'ホストにつないでいます…');
    try{
      const r=kind==='host'?await connectHost():await connectGuest($('lanAddr').value);
      if(kind==='guest')ls.set('robo_lan_host',$('lanAddr').value.trim());
      wantOpen=true;adopt(r.s,r.m);
      if(role==='host')hostLabel=(addrs[0]||'');
      onOk(roomApi('lobby'),userApi);
    }catch(e){
      busy(false);const k=ERR[e.message]&&e.message!=='guest'?e.message:'guest';
      msg(ERR[k](e),true);role=null;
    }
  };
  $('lanHost').onclick=()=>go('host');
  $('lanJoin').onclick=()=>go('guest');
  $('lanAddr').onkeydown=e=>{if(e.key==='Enter')go('guest')};
  $('lanClose').onclick=onCancel;
}

// ロビーに出す案内
function lobbyNote(){
  if(role==='host'){
    const ham=addrs.filter(a=>/^(25|5)\./.test(a)),oth=addrs.filter(a=>!/^(25|5)\./.test(a));
    const show=ham.length?ham:oth;
    return `<section class="lobby-box hot"><h3>あなたがホストです</h3><p>相手に伝えるアドレス：${show.length?show.map(a=>`<b class="lan-ip">${esc(a)}</b>`).join(' / '):'（見つかりません）'}${ham.length?'（Hamachi）':''}</p>${!ham.length?'<p class="clock-label">Hamachi のアドレス（25.で始まる数字）が見つかりません。Hamachi が起動してネットワークに入っているか確認してください。</p>':''}<p class="clock-label">相手は「オンライン対戦」→「ゲストで参加」にこのアドレスを入れます。このウィンドウを閉じると、相手の接続も切れます。</p></section>`;
  }
  return `<section class="lobby-box"><h3>ホスト ${esc(hostLabel)} に接続しています</h3><p class="clock-label">${state==='open'?'接続中':'接続が切れました。つなぎ直しています…'}</p></section>`;
}

window.ROBO_LAN={
  active:()=>role!==null,
  dialog,disconnect,lobbyNote,
  role:()=>role,
};
const mark=()=>{if(IS_APP)document.documentElement.classList.add('lan')};
mark();document.addEventListener('DOMContentLoaded',mark);
window.addEventListener('beforeunload',()=>{if(relayProc&&nlInit)Neutralino.os.updateSpawnedProcess(relayProc.id,'exit').catch(()=>{})});
})();
