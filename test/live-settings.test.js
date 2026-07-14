const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const{test}=require('node:test');

const root=path.resolve(__dirname,'..');
const clone=value=>JSON.parse(JSON.stringify(value));
const theme=primary=>({preset:'kick',primary,secondary:'#00c96b',background:'#07120b',text:'#ffffff',position:'center',scale:100,opacity:94,radius:24,glow:35,font:'system',customCss:''});
const game={preset:'custom',automatic:true,frequencyMinutes:15,roundSeconds:60,minDifficulty:'easy',maxDifficulty:'expert',categories:['Film'],jackpotChance:20,progressiveReveals:true,communityEnabled:true,communityTarget:25,communityRewardMinutes:5};

function loadServer(query){
  const routes=new Map(),app={use(){},get(route,handler){routes.set(`GET ${route}`,handler)},post(route,handler){routes.set(`POST ${route}`,handler)},delete(route,handler){routes.set(`DELETE ${route}`,handler)}};
  function express(){return app}
  express.json=express.raw=express.static=express.urlencoded=()=>()=>{};
  class Pool{query(sql,params){return query(sql,params)}connect(){return{query:(sql,params)=>query(sql,params),release(){}}}}
  const source=fs.readFileSync(path.join(root,'server.js'),'utf8');
  const bootstrap=source.lastIndexOf('\npool.query(fs.readFileSync');
  assert.notEqual(bootstrap,-1,'server bootstrap marker should exist');
  const instrumented=`${source.slice(0,bootstrap)}\nglobalThis.__server={push,pushGuest,saveGuest,syncActiveGuestSettings,queuedGuestMutation,queuedTenantSettings,runGuestAutomaticRounds,streams,guestStreams,pushQueues,guestPushQueues,guestMessageQueues,tenantSettingsQueues};`;
  const context=vm.createContext({
    require:id=>id==='express'?express:id==='pg'?{Pool}:id==='./puzzles.json'?require(path.join(root,'puzzles.json')):require(id),
    __dirname:root,
    Buffer,
    URLSearchParams,
    Intl,
    Date,
    Math,
    process,
    console,
    fetch:async()=>{throw new Error('Not used in this test')},
    setTimeout:()=>0,
    setInterval:()=>0
  });
  vm.runInContext(instrumented,context,{filename:'server.js'});
  return{...context.__server,routes};
}

function packetCollector(){
  const packets=[];
  return{packets,response:{write(value){packets.push(JSON.parse(value.slice(6)))}}};
}

test('tenant broadcasts are ordered and always hydrate the latest saved settings',async()=>{
  let current={id:'tenant-1',channel_name:'channel',display_name:'Channel',settings:{theme:theme('#53fc18'),game},jackpot:250,next_round_at:0,community_progress:4,community_completions:1,double_points_until:0};
  let tenantReads=0,releaseFirst;
  const firstGate=new Promise(resolve=>{releaseFirst=resolve});
  const server=loadServer(async sql=>{
    if(sql.startsWith('SELECT * FROM tenants WHERE id=')){
      const snapshot=clone(current),read=++tenantReads;
      if(read===1)await firstGate;
      return{rows:[snapshot]};
    }
    if(sql.includes('FROM score_events')||sql.includes('FROM scores'))return{rows:[]};
    throw new Error(`Unexpected query: ${sql}`);
  });
  const{packets,response}=packetCollector();
  server.streams.set(current.id,new Set([response]));

  const first=server.push({id:current.id,settings:{theme:theme('#111111')}});
  await new Promise(resolve=>setImmediate(resolve));
  current={...current,settings:{...current.settings,theme:theme('#c45cff')}};
  const second=server.push({id:current.id,settings:{theme:theme('#222222')}});
  assert.equal(tenantReads,1,'the second broadcast waits for the first');
  releaseFirst();
  await Promise.all([first,second]);

  assert.deepEqual(packets.map(packet=>packet.theme.primary),['#53fc18','#c45cff']);
  assert.ok(packets.at(-1).version);
  assert.equal(packets.at(-1).challenge.configured,true);
  assert.equal(server.pushQueues.size,0);
});

test('new SSE connections join the ordered hydrated broadcast before their first packet',async()=>{
  let current={id:'tenant-sse',overlay_token:'overlay',channel_name:'channel',display_name:'Channel',settings:{theme:theme('#53fc18'),game},jackpot:250,next_round_at:0,community_progress:0,community_completions:0,double_points_until:0};
  const old=clone(current);let tenantReads=0,releaseRead,close;
  const readGate=new Promise(resolve=>{releaseRead=resolve});
  const server=loadServer(async sql=>{
    if(sql.startsWith('SELECT * FROM tenants WHERE overlay_token='))return{rows:[clone(old)]};
    if(sql.startsWith('SELECT * FROM tenants WHERE id=')){const snapshot=clone(current),read=++tenantReads;if(read===1)await readGate;return{rows:[snapshot]}}
    if(sql.includes('FROM score_events')||sql.includes('FROM scores'))return{rows:[]};
    throw new Error(`Unexpected query: ${sql}`);
  });
  const{packets,response}=packetCollector(),handler=server.routes.get('GET /o/:token/events');
  const request={params:{token:'overlay'},on(event,listener){if(event==='close')close=listener}},res={...response,set(){},sendStatus(status){throw new Error(`Unexpected status ${status}`)}};

  const olderBroadcast=server.push({id:old.id});
  await new Promise(resolve=>setImmediate(resolve));
  current={...current,settings:{...current.settings,theme:theme('#ff5a36')}};
  const connected=handler(request,res);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof close,'function','close cleanup is registered before the queued state read completes');
  releaseRead();
  await Promise.all([olderBroadcast,connected]);
  assert.equal(packets.length,1,'the connection is not exposed to the older in-flight broadcast');
  assert.equal(packets[0].theme.primary,'#ff5a36');
  close();
  assert.equal(server.streams.get(old.id).has(res),false);
});

test('tenant setting mutations are serialized and rehydrate between saves',async()=>{
  const tenant={id:'tenant-settings'},reads=[];
  let releaseFirst;
  const gate=new Promise(resolve=>{releaseFirst=resolve});
  const server=loadServer(async sql=>{
    if(sql.startsWith('SELECT * FROM tenants WHERE id=')){reads.push(reads.length+1);return{rows:[tenant]}}
    throw new Error(`Unexpected query: ${sql}`);
  });
  const first=server.queuedTenantSettings(tenant,async()=>{await gate;return'game'});
  await new Promise(resolve=>setImmediate(resolve));
  const second=server.queuedTenantSettings(tenant,async()=> 'community');
  assert.equal(reads.length,1);
  releaseFirst();
  assert.deepEqual(await Promise.all([first,second]),['game','community']);
  assert.equal(reads.length,2);
  assert.equal(server.tenantSettingsQueues.size,0);
});

test('dashboard settings sync to active guests without replacing guest-owned state',async()=>{
  let session={id:'guest-1',tenant_id:'tenant-1',access_token:'token',expires_at:new Date(Date.now()+60000).toISOString(),revoked_at:null,settings:{theme:theme('#53fc18'),game,automatic:false,nextAutoAt:1234,communityState:{progress:7,completions:2,doublePointsUntil:0},rotation:{recentIds:['p1']}},scores:{viewer:{username:'Viewer',points:50,wins:1}}};
  const server=loadServer(async(sql,params)=>{
    if(sql.startsWith('SELECT id,access_token FROM guest_sessions'))return{rows:[{id:session.id,access_token:session.access_token}]};
    if(sql.startsWith('SELECT * FROM guest_sessions WHERE access_token='))return{rows:[clone(session)]};
    if(sql.startsWith('UPDATE guest_sessions SET settings=')){
      const patch=JSON.parse(params[1]),target=params[2];
      session={...session,settings:{...session.settings,...patch}};
      if(target!==null&&target!==undefined)session.settings.communityState={...session.settings.communityState,progress:Math.min(session.settings.communityState.progress,Math.max(0,target-1))};
      return{rows:[clone(session)],rowCount:1};
    }
    if(sql.startsWith('SELECT * FROM guest_sessions WHERE id='))return{rows:[clone(session)]};
    throw new Error(`Unexpected query: ${sql}`);
  });
  const{packets,response}=packetCollector();
  server.guestStreams.set(session.id,new Set([response]));

  await server.syncActiveGuestSettings('tenant-1',{theme:theme('#4de8ff')});

  assert.equal(session.settings.theme.primary,'#4de8ff');
  assert.equal(session.settings.automatic,false);
  assert.equal(session.settings.nextAutoAt,1234);
  assert.deepEqual(session.settings.communityState,{progress:7,completions:2,doublePointsUntil:0});
  assert.deepEqual(session.settings.rotation,{recentIds:['p1']});
  assert.equal(session.scores.viewer.points,50);
  assert.equal(packets.at(-1).theme.primary,'#4de8ff');
  assert.ok(packets.at(-1).version);
  assert.equal(packets.at(-1).challenge.configured,true);
  assert.equal(server.guestPushQueues.size,0);

  await server.syncActiveGuestSettings('tenant-1',{game:{...game,communityTarget:5}});
  assert.equal(session.settings.communityState.progress,4);
  assert.equal(session.settings.communityState.completions,2);
  assert.equal(session.settings.communityState.doublePointsUntil,0);
});

test('dashboard guest sync waits for an in-flight answer mutation',async()=>{
  let session={id:'guest-sync-queue',tenant_id:'tenant-1',access_token:'token',expires_at:new Date(Date.now()+60000).toISOString(),settings:{theme:theme('#53fc18'),game,communityState:{progress:4,completions:0,doublePointsUntil:0}},scores:{}};
  let updates=0,releaseAnswer;
  const gate=new Promise(resolve=>{releaseAnswer=resolve});
  const server=loadServer(async(sql,params)=>{
    if(sql.startsWith('SELECT id,access_token FROM guest_sessions'))return{rows:[{id:session.id,access_token:session.access_token}]};
    if(sql.startsWith('SELECT * FROM guest_sessions WHERE access_token='))return{rows:[clone(session)]};
    if(sql.startsWith('UPDATE guest_sessions SET settings=')){updates++;session={...session,settings:{...session.settings,...JSON.parse(params[1])}};return{rows:[clone(session)],rowCount:1}}
    if(sql.startsWith('SELECT * FROM guest_sessions WHERE id='))return{rows:[clone(session)]};
    throw new Error(`Unexpected query: ${sql}`);
  });
  const answer=server.queuedGuestMutation(session,async()=>{await gate;return{ok:true}});
  await new Promise(resolve=>setImmediate(resolve));
  const sync=server.syncActiveGuestSettings('tenant-1',{game:{...game,communityTarget:50}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updates,0);
  releaseAnswer();
  await Promise.all([answer,sync]);
  assert.equal(updates,1);
  assert.equal(server.guestMessageQueues.size,0);
});

test('guest score saves clamp progress against the game target locked in the database',async()=>{
  const stored={theme:theme('#53fc18'),game:{...game,communityTarget:5},communityState:{progress:4,completions:2,doublePointsUntil:0}};
  const session={id:'guest-save',settings:clone(stored),scores:{viewer:{username:'Viewer',points:100,wins:1}}};
  const server=loadServer(async(sql,params)=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
    if(sql.startsWith('SELECT settings FROM guest_sessions'))return{rows:[{settings:clone(stored)}]};
    if(sql.startsWith('UPDATE guest_sessions SET settings=')){
      const patch=JSON.parse(params[1]);
      assert.equal(patch.communityState.progress,4);
      return{rows:[{settings:{...stored,...patch},scores:clone(session.scores)}]};
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await server.saveGuest(session,{communityState:{progress:20,completions:2,doublePointsUntil:0}});
  assert.equal(session.settings.communityState.progress,4);
});

test('guest mutations run in order so a reset cannot be overtaken by an answer',async()=>{
  let reads=0,releaseAnswer;
  const gate=new Promise(resolve=>{releaseAnswer=resolve});
  const session={id:'guest-queue',access_token:'token',expires_at:new Date(Date.now()+60000).toISOString(),settings:{},scores:{}};
  const server=loadServer(async sql=>{
    if(sql.startsWith('SELECT * FROM guest_sessions WHERE access_token=')){reads++;return{rows:[clone(session)]}}
    throw new Error(`Unexpected query: ${sql}`);
  });
  const answer=server.queuedGuestMutation(session,async()=>{await gate;return'answer'});
  await new Promise(resolve=>setImmediate(resolve));
  const reset=server.queuedGuestMutation(session,async()=> 'reset');
  assert.equal(reads,1);
  releaseAnswer();
  assert.deepEqual(await Promise.all([answer,reset]),['answer','reset']);
  assert.equal(reads,2);
  assert.equal(server.guestMessageQueues.size,0);
});

test('automatic guest claims require the session to still be enabled and due',async()=>{
  let claimSql='';
  const server=loadServer(async sql=>{
    if(sql.startsWith('UPDATE guest_sessions SET settings=jsonb_set')){claimSql=sql;return{rows:[]}}
    throw new Error(`Unexpected query: ${sql}`);
  });
  await server.runGuestAutomaticRounds();
  assert.match(claimSql,/settings->>'automatic'='true'/);
  assert.match(claimSql,/nextAutoAt/);
});

function classList(){
  const values=new Set();
  return{add:value=>values.add(value),remove:value=>values.delete(value),contains:value=>values.has(value),toggle(value,force){const enabled=force===undefined?!values.has(value):Boolean(force);if(enabled)values.add(value);else values.delete(value);return enabled}};
}

function element(){return{classList:classList(),style:{setProperty(name,value){this[name]=value}},textContent:'',innerHTML:''}}

function loadClient(file,selectors,pathname,nowRef){
  const elements=Object.fromEntries(selectors.map(selector=>[selector,element()])),intervals=[],sources=[];let reloads=0;
  class EventSource{constructor(url){this.url=url;sources.push(this)}}
  const context=vm.createContext({
    location:{pathname,reload(){reloads++}},
    document:{querySelector:selector=>elements[selector]},
    window:{applyWidgetTheme(){}},
    EventSource,
    Date:{now:()=>nowRef.value},
    setInterval:callback=>{intervals.push(callback);return intervals.length}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'public',file),'utf8'),context,{filename:file});
  return{elements,intervals,source:sources[0],reloads:()=>reloads};
}

test('community goal renders while configured and hides cleanly after a boost expires',()=>{
  const now={value:1000},selectors=['#stage','#community','#category','#emojis','#label','#prompt','#winner','#highscores','#board','#timer','#community-label','#community-value','#community-fill'];
  const client=loadClient('cloud-overlay.js',selectors,'/o/token/overlay.html',now);
  const round={status:'open',category:'Film',difficulty:'easy',emojis:'🎬',correctAnswers:[],clueCount:1,totalClues:1,nextRevealAt:null,clueMultiplier:1,isJackpot:false,endsAt:10000};
  const base={version:'build-1',theme:theme('#53fc18'),round,scores:[],jackpot:{points:250}};

  client.source.onmessage({data:JSON.stringify({...base,challenge:{configured:true,enabled:true,progress:7,target:25,doublePointsUntil:0}})});
  assert.equal(client.elements['#community'].classList.contains('off'),false);
  assert.equal(client.elements['#community-value'].textContent,'7 / 25');

  client.source.onmessage({data:JSON.stringify({...base,challenge:{configured:false,enabled:true,progress:0,target:25,doublePointsUntil:1500}})});
  assert.equal(client.elements['#community'].classList.contains('boost'),true);
  now.value=1600;
  client.intervals[0]();
  assert.equal(client.elements['#community'].classList.contains('off'),true);
  assert.equal(client.elements['#community'].classList.contains('boost'),false);
  client.source.onmessage({data:JSON.stringify({...base,version:'build-2',challenge:{configured:true,progress:0,target:25,doublePointsUntil:0}})});
  assert.equal(client.reloads(),1);
});

test('scoreboard hides locally at zero and can reopen on the next server event',()=>{
  const now={value:1000},selectors=['#scoreboard','#title','#caller','#rows','#timer'];
  const client=loadClient('cloud-scoreboard.js',selectors,'/o/token/scoreboard.html',now);
  const state={version:'build-1',theme:theme('#53fc18'),round:null,scoreboard:{visible:true,period:'weekly',shownBy:'Viewer',hideAt:1500},scoreboardScores:[]};

  client.source.onmessage({data:JSON.stringify(state)});
  assert.equal(client.elements['#scoreboard'].classList.contains('hidden'),false);
  now.value=1600;
  client.intervals[0]();
  assert.equal(client.elements['#timer'].textContent,0);
  assert.equal(client.elements['#scoreboard'].classList.contains('hidden'),true);

  client.source.onmessage({data:JSON.stringify({...state,scoreboard:{...state.scoreboard,hideAt:3000}})});
  assert.equal(client.elements['#scoreboard'].classList.contains('hidden'),false);
  client.source.onmessage({data:JSON.stringify({...state,version:'build-2'})});
  assert.equal(client.reloads(),1);
});
