/* ============ helpers & elements ============ */
const $=s=>document.querySelector(s);
const p2=n=>String(n).padStart(2,'0');
const video=$('#video'),work=$('#work'),flashEl=$('#flash'),vf=$('#viewfinder');
const offTitle=$('#offTitle'),offSub=$('#offSub'),offErr=$('#offErr'),btnPower=$('#btnPower');
const btnCapture=$('#btnCapture'),btnRecord=$('#btnRecord'),btnStop=$('#btnStop');
const chip=$('#statusChip'),statusText=$('#statusText');
const modeLabel=$('#modeLabel'),tcEl=$('#timecode'),metaEl=$('#metaLabel'),clockEl=$('#clock');
const strip=$('#rollStrip'),emptyEl=$('#rollEmpty'),countEl=$('#rollCount');
const pol=$('#polaroid'),polImg=$('#polImg'),gridFx=$('#gridFx');
const lb=$('#lightbox'),lbMedia=$('#lbMedia'),lbCap=$('#lbCaption');
const tglGrid=$('#tglGrid'),tglMirror=$('#tglMirror');

const ICON={
  dl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 7V5h4v2"/><path d="M6 7l1 13h10l1-13"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

let state='off',stream=null,recorder=null,chunks=[],mime='',ext='webm',clipDur=0;
let mirror=true,gridOn=true,busy=false,lbId=null;
let sessionStart=0,recStartMs=0,vfTimer=null;
const shots=new Map();let shotN=0;

/* ============ tiny sound engine (synthesized, no assets) ============ */
let AC=null;
function ac(){if(!AC)AC=new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();return AC}
function beep(f=1200,dur=.06,vol=.05,delay=0){
  try{const c=ac(),t=c.currentTime+delay,o=c.createOscillator(),g=c.createGain();
  o.type='sine';o.frequency.value=f;
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g).connect(c.destination);o.start(t);o.stop(t+dur+.02);}catch(e){}
}
function shutterSound(){
  try{const c=ac();
    const click=(t,f)=>{const len=c.sampleRate*.05,buf=c.createBuffer(1,len,c.sampleRate),d=buf.getChannelData(0);
      for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);
      const s=c.createBufferSource();s.buffer=buf;
      const bp=c.createBiquadFilter();bp.type='bandpass';bp.frequency.value=f;bp.Q.value=.8;
      const g=c.createGain();g.gain.value=.4;
      s.connect(bp).connect(g).connect(c.destination);s.start(t);};
    const t=c.currentTime;click(t,3200);click(t+.07,1800);}catch(e){}
}
const beepRecStart=()=>{beep(1350,.07);beep(1350,.07,.05,.13)};
const beepRecStop =()=>{beep(900,.08);beep(600,.1,.05,.13)};

/* ============ toasts ============ */
function toast(msg,tone){
  const t=document.createElement('div');
  t.className='toast'+(tone==='red'?' red':'');t.textContent=msg;
  $('#toasts').appendChild(t);
  setTimeout(()=>{t.classList.add('bye');setTimeout(()=>t.remove(),320)},2400);
}

/* ============ state machine ============ */
function setState(s){
  state=s;
  vf.classList.toggle('is-off',s==='off');
  vf.classList.toggle('is-rec',s==='rec');
  chip.className='status'+(s==='live'?' live':s==='rec'?' rec':'');
  statusText.textContent=s==='off'?'OFFLINE':s==='rec'?'REC':'LIVE';
  modeLabel.textContent=s==='rec'?'REC':'STBY';
  btnCapture.disabled=s!=='live'||busy;
  btnRecord.disabled=s!=='live';
  btnStop.disabled=s==='off';
  btnStop.classList.toggle('recording',s==='rec');
}

function startVfTimer(){
  stopVfTimer();
  vfTimer=setInterval(()=>{
    tcEl.textContent=fmtTC(performance.now()-sessionStart);
  },1000/24);
}
function stopVfTimer(){if(vfTimer){clearInterval(vfTimer);vfTimer=null}}

function fmtTC(ms){
  const t=Math.floor(ms/1000),f=Math.floor((ms%1000)*24/1000);
  return `TC ${p2(Math.floor(t/3600))}:${p2(Math.floor(t/60)%60)}:${p2(t%60)}:${p2(f)}`;
}
const fmtMS=s=>`${p2(Math.floor(s/60))}:${p2(Math.floor(s%60))}`;
function fileStamp(){const d=new Date();
  return `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;}

/* device clock in the HUD */
function tickClock(){const d=new Date();
  clockEl.textContent=`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}  ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`}
setInterval(tickClock,1000);tickClock();

/* ============ power ============ */
function mapErr(e){
  if(e&&e.name==='NotAllowedError')return 'CAMERA PERMISSION DENIED — ALLOW ACCESS FROM THE BROWSER BAR.';
  if(e&&e.name==='NotFoundError')return 'NO CAMERA DEVICE FOUND ON THIS MACHINE.';
  if(e&&e.name==='NotReadableError')return 'CAMERA IS IN USE BY ANOTHER APPLICATION.';
  return (e&&e.name?e.name:'UNKNOWN ERROR')+' — COULD NOT OPEN THE CAMERA.';
}
async function powerOn(){
  if(state!=='off')return;
  offErr.textContent='';offSub.textContent='REQUESTING CAMERA ACCESS…';btnPower.disabled=true;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    offSub.textContent='PRESS POWER TO REQUEST CAMERA ACCESS';btnPower.disabled=false;
    offErr.textContent='CAMERA API UNAVAILABLE — OPEN THIS PAGE OVER HTTPS OR LOCALHOST.';return;
  }
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:true});
  }catch(e1){
    try{stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false})}
    catch(e2){
      offSub.textContent='PRESS POWER TO TRY AGAIN';btnPower.disabled=false;
      offTitle.textContent='CAMERA UNAVAILABLE';offErr.textContent=mapErr(e2);return;
    }
  }
  btnPower.disabled=false;offSub.textContent='PRESS POWER TO REQUEST CAMERA ACCESS';
  video.srcObject=stream;video.play().catch(()=>{});
  sessionStart=performance.now();
  try{const st=stream.getVideoTracks()[0].getSettings();
    metaEl.textContent=`${st.width||'?'}×${st.height||'?'} · ${Math.round(st.frameRate)||30}FPS`;}catch(e){}
  setState('live');startVfTimer();
  toast('SIGNAL LIVE — VIEWFINDER ACTIVE');
}
function powerOff(){
  if(state==='rec')stopRecording(true);
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
  video.srcObject=null;stopVfTimer();
  tcEl.textContent='TC 00:00:00:00';metaEl.textContent='NO SIGNAL';
  setState('off');
}

/* ============ capture ============ */
function capture(){
  if(state!=='live'||busy)return;
  const w=video.videoWidth,h=video.videoHeight;
  if(!w){toast('SIGNAL NOT READY','red');return}
  busy=true;btnCapture.disabled=true;
  flashEl.classList.remove('on');void flashEl.offsetWidth;flashEl.classList.add('on');
  shutterSound();
  work.width=w;work.height=h;
  const ctx=work.getContext('2d');
  if(mirror){ctx.translate(w,0);ctx.scale(-1,1)}
  ctx.drawImage(video,0,0,w,h);
  const src=work.toDataURL('image/jpeg',0.92);
  // eject a polaroid from under the viewfinder
  polImg.src=src;
  pol.classList.remove('show','developed');
  pol.style.transition='';pol.style.transform='';pol.style.opacity='';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    pol.classList.add('show');
    setTimeout(()=>pol.classList.add('developed'),120);
  }));
  setTimeout(()=>flyToRoll(src),1450);
}
function flyToRoll(src){
  const r=pol.getBoundingClientRect(),s=strip.getBoundingClientRect();
  const tx=(s.right-90)-(r.left+r.width/2);
  const ty=(s.top+s.height/2)-(r.top+r.height/2);
  pol.style.transition='transform .6s cubic-bezier(.5,0,.15,1),opacity .45s ease .2s';
  pol.style.transform=`translate(-50%,104px) translate(${tx}px,${ty}px) scale(.3) rotate(-8deg)`;
  pol.style.opacity='0';
  setTimeout(()=>{
    pol.classList.remove('show','developed');
    pol.style.transition='';pol.style.transform='';pol.style.opacity='';
    addShot({kind:'photo',src});
    busy=false;btnCapture.disabled=state!=='live';
  },620);
}

/* ============ record ============ */
function pickMime(){
  const list=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus',
              'video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
  for(const m of list){try{if(MediaRecorder.isTypeSupported(m))return m}catch(e){}}
  return '';
}
function startRecording(){
  if(state!=='live')return;
  if(typeof MediaRecorder==='undefined'){toast('RECORDING NOT SUPPORTED IN THIS BROWSER','red');return}
  mime=pickMime();
  try{recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)}
  catch(e){toast('RECORDER FAILED TO START','red');return}
  ext=mime&&mime.includes('mp4')?'mp4':'webm';
  chunks=[];
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  recorder.onstop=onRecStop;
  recorder.start();
  recStartMs=performance.now();
  beepRecStart();setState('rec');
  toast('RECORDING STARTED','red');
}
function stopRecording(silent){
  if(state!=='rec')return;
  clipDur=(performance.now()-recStartMs)/1000;
  try{recorder.stop()}catch(e){}
  beepRecStop();setState('live');
  if(!silent)toast('RECORDING STOPPED','red');
}
async function onRecStop(){
  const blob=new Blob(chunks,{type:mime||'video/webm'});chunks=[];
  const url=URL.createObjectURL(blob);
  const poster=await getVideoPoster(url);
  addShot({kind:'clip',src:url,poster,dur:clipDur});
  toast('CLIP SAVED TO ROLL — '+fmtMS(clipDur));
}
function stopAction(){
  if(state==='rec')stopRecording(false);
  else if(state==='live'){powerOff();toast('CAMERA POWERED OFF')}
}

/* poster frame from a recorded blob (handles the Infinity-duration quirk) */
function getVideoPoster(url){
  return new Promise(res=>{
    const v=document.createElement('video');
    v.muted=true;v.playsInline=true;v.preload='metadata';
    let settled=false;
    const done=()=>{
      if(settled)return;settled=true;
      try{
        const c=document.createElement('canvas'),w=v.videoWidth||320,sc=320/w;
        c.width=320;c.height=Math.round((v.videoHeight||180)*sc);
        c.getContext('2d').drawImage(v,0,0,c.width,c.height);
        res(c.toDataURL('image/jpeg',0.78));
      }catch(e){res(null)}
      v.removeAttribute('src');v.load();
    };
    v.addEventListener('error',()=>{if(!settled){settled=true;res(null)}});
    v.addEventListener('loadedmetadata',()=>{
      const seek=t=>{v.addEventListener('seeked',done,{once:true});v.currentTime=t};
      if(v.duration===Infinity||isNaN(v.duration)){
        v.addEventListener('timeupdate',()=>seek(0.2),{once:true});
        v.currentTime=1e7;
      }else seek(Math.min(0.2,v.duration/2));
    });
    v.src=url;
  });
}

/* ============ polaroid print compositor ============
   Bakes the photo onto paper — grain, caption, frame number —
   so the downloaded JPG IS the polaroid.                    */
const grainCv=document.createElement('canvas');grainCv.width=grainCv.height=90;
(()=>{const g=grainCv.getContext('2d'),d=g.createImageData(90,90);
  for(let i=0;i<d.data.length;i+=4){const v=Math.random()*255|0;
    d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=255}
  g.putImageData(d,0,0)})();

function composePolaroid(it){
  if(it.pol)return Promise.resolve(it.pol);   // printed once, cached forever
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      const w=img.naturalWidth,h=img.naturalHeight;
      const pad=Math.round(w*0.052);                    // paper border
      const capH=Math.max(54,Math.round(h*0.16));       // caption strip
      const cw=w+pad*2,ch=h+pad+capH;
      const c=document.createElement('canvas');c.width=cw;c.height=ch;
      const x=c.getContext('2d');
      // paper
      x.fillStyle='#f2efe6';x.fillRect(0,0,cw,ch);
      // paper grain (very subtle tile)
      x.globalAlpha=.05;x.fillStyle=x.createPattern(grainCv,'repeat');
      x.fillRect(0,0,cw,ch);x.globalAlpha=1;
      // the exposure + hairline edge
      x.drawImage(img,pad,pad);
      x.strokeStyle='rgba(0,0,0,.08)';x.lineWidth=1;
      x.strokeRect(pad+.5,pad+.5,w-1,h-1);
      // printed caption
      const fs=Math.max(11,Math.round(w*0.022));
      x.textBaseline='middle';
      x.textAlign='left';
      x.fillStyle='#6b675c';
      x.font=`600 ${fs}px "IBM Plex Mono",monospace`;
      x.fillText('OPTIC—01',pad,pad+h+capH*.38);
      x.fillStyle='#9a958a';
      x.font=`${Math.round(fs*.72)}px "IBM Plex Mono",monospace`;
      x.fillText(it.date,pad,pad+h+capH*.70);
      x.textAlign='right';
      x.fillStyle='#6b675c';
      x.font=`500 ${fs}px "IBM Plex Mono",monospace`;
      x.fillText(`NO.${p2v3(it.n)} · ${it.clock}`,cw-pad,pad+h+capH*.52);
      it.pol=c.toDataURL('image/jpeg',0.92);
      res(it.pol);
    };
    img.src=it.src;
  });
}

/* ============ film roll ============ */
function addShot(item){
  shotN++;const id='s'+shotN;
  const d=new Date();
  const clock=`${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  const date=`${d.getFullYear()}.${p2(d.getMonth()+1)}.${p2(d.getDate())}`;
  item.id=id;item.n=shotN;item.clock=clock;item.date=date;
  item.name=item.kind==='photo'?`OPTIC01_${fileStamp()}.jpg`:`OPTIC01_${fileStamp()}.${ext}`;
  item.label=(item.kind==='photo'?'IMG_':'CLP_')+p2v3(shotN)+' · '+clock;
  shots.set(id,item);
  emptyEl.style.display='none';
  const el=document.createElement('figure');
  el.className='card '+item.kind;
  const mediaInner=item.kind==='photo'
    ?`<img class="main" src="${item.src}" alt="Captured photo">`
    :`${item.poster?`<img class="main" src="${item.poster}" alt="Clip frame">`:''}<span class="play-badge">${ICON.play}</span>`;
  el.innerHTML=`
    <div class="media">${mediaInner}
      <div class="acts">
        <button class="abtn dl" title="Download">${ICON.dl}</button>
        <button class="abtn danger del" title="Delete">${ICON.trash}</button>
      </div>
    </div>
    <figcaption>${item.kind==='clip'
      ?`<span>${item.label}</span><span class="dur">${fmtMS(item.dur)}</span>`
      :item.label}</figcaption>`;
  el.querySelector('.media').addEventListener('click',()=>openLB(id));
  el.querySelector('.dl').addEventListener('click',e=>{e.stopPropagation();downloadShot(id)});
  el.querySelector('.del').addEventListener('click',e=>{e.stopPropagation();deleteShot(id)});
  item.el=el;
  strip.appendChild(el);
  strip.scrollTo({left:strip.scrollWidth,behavior:'smooth'});
  updateCount();
}
const p2v3=n=>String(n).padStart(3,'0');
function updateCount(){countEl.textContent='EXPOSURES '+String(shots.size).padStart(2,'0')}
async function downloadShot(id){
  const it=shots.get(id);if(!it)return;
  let href=it.src;
  if(it.kind==='photo'){
    toast('PRINTING POLAROID…');
    href=await composePolaroid(it);       // the download IS the print
    toast('POLAROID SAVED — '+it.name);
  }else{
    toast('DOWNLOADING '+it.name);
  }
  const a=document.createElement('a');a.href=href;a.download=it.name;
  document.body.appendChild(a);a.click();a.remove();
}
function deleteShot(id){
  const it=shots.get(id);if(!it)return;
  if(it.kind==='clip')URL.revokeObjectURL(it.src);
  it.el.remove();shots.delete(id);
  if(lbId===id)closeLB();
  if(!shots.size)emptyEl.style.display='';
  updateCount();toast('EXPOSURE REMOVED');
}

/* ============ lightbox ============ */
function openLB(id){
  const it=shots.get(id);if(!it)return;lbId=id;
  if(it.kind==='photo'){
    // show the raw frame instantly, then swap in the finished print
    lbMedia.innerHTML=`<img class="pol" alt="Polaroid print" src="${it.src}">`;
    const imgEl=lbMedia.querySelector('img');
    composePolaroid(it).then(u=>{if(lbId===id&&imgEl.isConnected)imgEl.src=u});
    lbCap.textContent=`POLAROID · ${it.name}`;
  }else{
    lbMedia.innerHTML=`<video src="${it.src}" controls autoplay playsinline></video>`;
    lbCap.textContent=`CLIP · ${fmtMS(it.dur)} · ${it.name}`;
  }
  lb.classList.add('open');
}
function closeLB(){lb.classList.remove('open');lbMedia.innerHTML='';lbId=null}
lb.addEventListener('click',e=>{if(e.target===lb)closeLB()});
 $('#lbClose').innerHTML=ICON.x+'CLOSE';
 $('#lbDl').innerHTML=ICON.dl+'DOWNLOAD';
 $('#lbDel').innerHTML=ICON.trash;
 $('#lbClose').addEventListener('click',closeLB);
 $('#lbDl').addEventListener('click',()=>lbId&&downloadShot(lbId));
 $('#lbDel').addEventListener('click',()=>lbId&&deleteShot(lbId));

/* ============ toggles & wiring ============ */
tglMirror.addEventListener('click',()=>{
  mirror=!mirror;
  tglMirror.classList.toggle('on',mirror);
  tglMirror.querySelector('b').textContent=mirror?'ON':'OFF';
  vf.classList.toggle('mirrored',mirror);
});
tglGrid.addEventListener('click',()=>{
  gridOn=!gridOn;
  tglGrid.classList.toggle('on',gridOn);
  tglGrid.querySelector('b').textContent=gridOn?'ON':'OFF';
  gridFx.classList.toggle('off',!gridOn);
});
btnPower.addEventListener('click',powerOn);
btnCapture.addEventListener('click',capture);
btnRecord.addEventListener('click',startRecording);
btnStop.addEventListener('click',stopAction);

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(lb.classList.contains('open'))closeLB();return}
  if(lb.classList.contains('open'))return;
  if(e.code==='Space'){e.preventDefault();capture()}
  else if(e.key==='r'||e.key==='R')startRecording();
  else if(e.key==='s'||e.key==='S')stopAction();
  else if(e.key==='p'||e.key==='P')powerOn();
});

setState('off');updateCount();