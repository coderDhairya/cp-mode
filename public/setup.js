(function(){
var $=function(i){return document.getElementById(i)};
var st=document.createElement('style');st.textContent='#sg{position:fixed;left:14px;bottom:14px;z-index:50;background:#0b1220;color:#8fb7c9;border:1px solid #17617f;border-radius:6px;padding:6px 12px;font:12px ui-monospace,monospace;letter-spacing:.1em;cursor:pointer}#sg:hover{color:#38e8ff}#so{position:fixed;inset:0;z-index:300;background:rgba(2,7,13,.92);display:none;align-items:center;justify-content:center;padding:16px;overflow:auto}#so.on{display:flex}#sp{width:min(520px,100%);background:#06141f;border:1px solid #17617f;border-radius:6px;padding:22px;color:#e6edf7;box-shadow:0 0 40px rgba(56,232,255,.15)}#sp h2{margin:0 0 4px;color:#38e8ff;letter-spacing:.2em;text-transform:uppercase;font-size:18px}#sp p{color:#7f98a8;margin:0 0 14px;font-size:13px}#sp label{display:block;margin:12px 0 4px;color:#8fb7c9;font-size:12px;letter-spacing:.08em;text-transform:uppercase}#sp input{width:100%;background:#0e1626;color:inherit;border:1px solid #223049;border-radius:6px;padding:9px 11px;font:inherit}#sp small{color:#5b7a8c}#sp .row{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}#sp button{background:#0e1626;color:#e6edf7;border:1px solid #17617f;border-radius:6px;padding:9px 14px;cursor:pointer;font:inherit}#sp button.p{background:#38e8ff;color:#02222b;border:0;font-weight:700}#sm{margin-top:12px;font-size:13px;min-height:18px}#sm.e{color:#ff7b8b}#sm.g{color:#7dffb2}';document.head.appendChild(st);
var o=document.createElement('div');o.id='so';o.innerHTML='<div id="sp"><h2 id="sh">Set up CP Mode</h2><p>Enter your handles once. They stay on this computer.</p>'+
'<label>Codeforces handle (required)</label><input id="s1" autocomplete="off" placeholder="e.g. tourist">'+
'<label>AtCoder handle (optional)</label><input id="s2" autocomplete="off">'+
'<label>CodeChef handle (optional)</label><input id="s3" autocomplete="off">'+
'<div class="row"><button class="p" id="ssave">Save and start</button><button id="scx" style="display:none">Cancel</button></div><div id="sm"></div></div>';document.body.appendChild(o);
var g=document.createElement('button');g.id='sg';g.textContent='⚙ SETUP';document.body.appendChild(g);
var first=false;
function msg(t,c){var m=$('sm');m.textContent=t;m.className=c||''}
function load(){return fetch('/api/setup').then(function(r){return r.json()}).then(function(s){first=!s.configured;$('s1').value=s.codeforces;$('s2').value=s.atcoder;$('s3').value=s.codechef;$('sh').textContent=first?'Set up CP Mode':'Setup';$('scx').style.display=first?'none':'';return s})}
function show(){load().then(function(){msg('');o.classList.add('on')})}
g.onclick=show;$('scx').onclick=function(){o.classList.remove('on')};
$('ssave').onclick=function(){msg('Saving…');var b={codeforces:$('s1').value,atcoder:$('s2').value,codechef:$('s3').value};
fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){if(!x.ok)return msg(x.j.error||'Could not save','e');
var done=function(){sessionStorage.setItem('cp_skip_intro','1');location.reload()};
if(x.j.needsSync){msg('Saved. Pulling your history, about a minute…','g');fetch('/api/sync',{method:'POST'}).then(done,done)}else done()}).catch(function(){msg('Could not save.','e')})};
function boot(){fetch('/api/setup').then(function(r){return r.json()}).then(function(s){if(!s.configured)show()})}
if(document.body.dataset.introDone)boot();else addEventListener('cp-intro-done',boot,{once:true});
})();
