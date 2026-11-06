(function(){var el=document.getElementById('intro');if(!el)return;var v=document.getElementById('ivid'),done=false;
if(sessionStorage.getItem('cp_skip_intro')){sessionStorage.removeItem('cp_skip_intro');el.remove();document.body.dataset.introDone='1';return}
function finish(){if(done)return;done=true;el.classList.add('out');v.pause();document.body.dataset.introDone='1';window.dispatchEvent(new Event('cp-intro-done'));setTimeout(function(){el.remove()},700)}
['keydown','pointerdown'].forEach(function(e){addEventListener(e,finish,{once:true})});
v.onended=finish;v.onerror=finish;
v.play().catch(function(){v.muted=true;v.play().catch(finish)});
setTimeout(finish,9000);})();
