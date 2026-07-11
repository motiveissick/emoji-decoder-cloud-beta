(()=>{
  const DURATION=45, scenes=[['hook',0,5],['game',5,15],['jackpot',15,22],['results',22,29],['setup',29,38],['finale',38,45]];
  const all=[...document.querySelectorAll('.scene')],progress=document.querySelector('#progress'),clock=document.querySelector('#clock'),pause=document.querySelector('#pause');
  let started=performance.now(),offset=0,paused=false,pauseAt=0,raf;
  const format=s=>`0:${String(Math.min(45,Math.floor(s))).padStart(2,'0')} / 0:45`;
  function render(t){
    const elapsed=Math.min(DURATION,paused?pauseAt:offset+(t-started)/1000),name=(scenes.find(([,a,b])=>elapsed>=a&&elapsed<b)||scenes.at(-1))[0];
    all.forEach(el=>el.classList.toggle('active',el.dataset.scene===name));
    progress.style.width=`${elapsed/DURATION*100}%`;clock.textContent=format(elapsed);
    document.querySelector('#timer').textContent=Math.max(50,60-Math.max(0,Math.floor(elapsed-5)));
    if(elapsed>=DURATION){paused=true;pauseAt=DURATION;pause.textContent='Replay'}
    if(!paused)raf=requestAnimationFrame(render);
  }
  function restart(){cancelAnimationFrame(raf);offset=0;pauseAt=0;started=performance.now();paused=false;pause.textContent='Pause';raf=requestAnimationFrame(render)}
  pause.addEventListener('click',()=>{if(pauseAt>=DURATION)return restart();if(paused){offset=pauseAt;started=performance.now();paused=false;pause.textContent='Pause';raf=requestAnimationFrame(render)}else{pauseAt=Math.min(DURATION,offset+(performance.now()-started)/1000);paused=true;pause.textContent='Play';cancelAnimationFrame(raf)}});
  document.querySelector('#restart').addEventListener('click',restart);
  document.querySelector('#fullscreen').addEventListener('click',()=>document.querySelector('#stage').requestFullscreen?.());
  window.trailer={seek(seconds){offset=Math.max(0,Math.min(DURATION,Number(seconds)||0));started=performance.now();pauseAt=offset;if(paused)render(performance.now())},restart};
  raf=requestAnimationFrame(render);
})();
