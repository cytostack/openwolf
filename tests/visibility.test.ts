import { pathToFileURL } from "node:url";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const base=path.resolve(import.meta.dirname,'../dist');
const v=await import(pathToFileURL(path.join(base,'hooks/visibility.js')).href);
const h=await import(pathToFileURL(path.join(base,'hooks/handoff-state.js')).href);
const fixture=(t:any)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'ow-visibility-'));fs.mkdirSync(path.join(root,'.wolf'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root};
const config=(root:string,mode:string)=>fs.writeFileSync(path.join(root,'.wolf/config.json'),JSON.stringify({openwolf:{visibility:{mode},updates:{mode:'off'}}}));
const record=(root:string,evidence:string,operation='checkpoint-saved',at=1_000_000,session='test-session')=>v.recordReceipt(root,{operation,evidence,at,session,agent:'claude'});
const delivery=(session='test-session',turn='t1')=>({agent:'claude',session,turn,surface:'claude-statusline'});

test('records completed actions privately and deduplicates retries across sessions',t=>{
 const root=fixture(t);record(root,'secret/path and task title');record(root,'secret/path and task title');
 let s=v.activityState(root,undefined,1_000_000).state;assert.equal(s.counts['checkpoint-saved'],1);
 record(root,'secret/path and task title','checkpoint-saved',1_000_001,'other-session');s=v.activityState(root,undefined,1_000_001).state;
 assert.equal(s.counts['checkpoint-saved'],1);assert.doesNotMatch(JSON.stringify(s),/secret\/path|task title|test-session/);
});
test('preserves OMP attribution in activity receipts',t=>{
 const root=fixture(t);config(root,'verbose');assert.equal(v.recordReceipt(root,{operation:'read-denied',evidence:'omp-read',at:1_000_000,session:'omp-session',agent:'omp'}),true);
 const state=v.activityState(root,undefined,1_000_000).state;assert.equal(state.history[0].agent,'omp');
});
test('aggregates at boundaries, enforces five minutes and three receipts per turn including resume',t=>{
 const root=fixture(t);record(root,'one');record(root,'two');
 assert.match(v.activityState(root,delivery(),1_000_000).message,/2 context checkpoints/);
 record(root,'three','checkpoint-saved',1_000_001);assert.equal(v.activityState(root,delivery(),1_299_999).message,undefined);
 assert.ok(v.activityState(root,delivery(),1_300_000).message);
 record(root,'four','checkpoint-saved',1_300_001);assert.ok(v.activityState(root,delivery(),1_600_000).message);
 record(root,'five','checkpoint-saved',1_600_001);assert.equal(v.activityState(root,delivery(),1_900_000).message,undefined);
 assert.ok(v.activityState(root,delivery('test-session','t2'),1_900_000).message);
});
test('quiet hooks only show recovery, startup once and unsupported transports stay silent',t=>{
 const root=fixture(t);record(root,'routine');assert.equal(v.hookReceipt(root,'grok',{session_id:'test-session'}),undefined);
 assert.equal(v.activityState(root,{...delivery(),surface:'codex-hook'},1_000_000).message,undefined);
 record(root,'restored','context-restored');assert.ok(v.activityState(root,{...delivery(),surface:'claude-hook',startup:true},1_000_000).message);
 record(root,'restored-again','context-restored',1_500_000);assert.equal(v.activityState(root,{...delivery(),surface:'claude-hook',startup:true},1_600_000).message,undefined);
});
test('off and malformed config disable writes and displays; verbose preserves rate limits',t=>{
 const root=fixture(t);config(root,'off');assert.equal(record(root,'off'),false);assert.ok(!fs.existsSync(path.join(root,'.wolf/activity')));
 fs.writeFileSync(path.join(root,'.wolf/config.json'),'{bad');assert.equal(record(root,'malformed'),false);
 config(root,'verbose');record(root,'verbose');assert.ok(v.activityState(root,{...delivery(),surface:'claude-hook'},1_000_000).message);
});
test('a busy reducer never waits, claims nothing and preserves queued evidence',t=>{
 const root=fixture(t);record(root,'busy','checkpoint-saved',Date.now());const lock=path.join(root,'.wolf/activity/state.json.lock');
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid,hostname:os.hostname(),acquiredAt:Date.now(),nonce:'test'}));
 const start=performance.now();assert.equal(v.activityState(root,delivery()).message,undefined);assert.ok(performance.now()-start<50);
 fs.unlinkSync(lock);assert.ok(v.activityState(root,delivery()).message);
});
test('concurrent processes claim a receipt only once',async t=>{
 const root=fixture(t);record(root,'concurrent','context-restored',Date.now());
 const code=`import {activityState} from ${JSON.stringify(pathToFileURL(path.join(base,'hooks/visibility.js')).href)}; console.log(activityState(process.argv[1],${JSON.stringify(delivery())}).message??'')`;
 const results=await Promise.all(Array.from({length:8},()=>new Promise<string>((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',code,root]);let out='';p.stdout.on('data',b=>out+=b);p.on('error',reject);p.on('exit',c=>c?reject(Error(String(c))):resolve(out.trim()))})));
 assert.equal(results.filter(Boolean).length,1);
});
test('checkpoint receipts require materialized persistence, never a queued write',t=>{
 const root=fixture(t);const file=h.activeFile(root,'claude','test-session');fs.mkdirSync(path.dirname(file),{recursive:true});
 h.queueCheckpoint(root,'claude','test-session',{id:'checkpoint',kind:'semantic-checkpoint',at:new Date().toISOString(),patch:{objective:'private objective'}});
 assert.equal(v.activityState(root).state.history.length,0);
 fs.writeFileSync(file+'.lock',JSON.stringify({pid:process.pid,hostname:os.hostname(),acquiredAt:Date.now(),nonce:'test'}));
 h.reconcileActive(root,'claude','test-session');assert.equal(v.activityState(root).state.history.length,0);
 fs.unlinkSync(file+'.lock');h.reconcileActive(root,'claude','test-session');assert.equal(v.activityState(root).state.counts['checkpoint-saved'],1);
});
test('headless and rejecting toast SDKs stay silent without awaiting rendering',async()=>{
 assert.doesNotThrow(()=>v.showActivityToast({},'test'));
 assert.doesNotThrow(()=>v.showActivityToast({tui:{showToast(){throw Error('headless')}}},'test'));
 let calls=0;v.showActivityToast({tui:{showToast(){calls++;return Promise.reject(Error('headless'))}}},'test');await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});
test('history, spool and membership stay bounded with conservative lifetime deduplication',t=>{
 const root=fixture(t);for(let i=0;i<4200;i++){record(root,'event:'+i,'checkpoint-saved',1_000_000+i);if(i%100===0)v.activityState(root,undefined,2_000_000)}
 let s=v.activityState(root,undefined,2_000_000).state;assert.ok(s.history.length<=100);assert.ok(s.pending.length<=256);assert.ok(Object.keys(s.seen).length<=4096);assert.equal(Buffer.from(s.membership,'base64').length,131072);
 const before=s.counts['checkpoint-saved'];record(root,'event:0','checkpoint-saved',3_000_000);s=v.activityState(root,undefined,3_000_000).state;assert.equal(s.counts['checkpoint-saved'],before);
});
test('status line is session scoped and contains no model-context output',t=>{
 const root=fixture(t);record(root,'visible','checkpoint-saved',Date.now());
 const run=(session:string)=>execFileSync(process.execPath,[path.join(base,'hooks/visibility-statusline.js')],{input:JSON.stringify({cwd:root,session_id:session,prompt_id:'p'}),encoding:'utf8'});
 assert.match(run('test-session'),/^OpenWolf · Saved context/);assert.equal(run('other-session'),'');assert.doesNotMatch(run('test-session'),/additionalContext|\u001b/);
});
test('custom status lines survive installation; Grok adds no duplicate hooks',async t=>{
 const root=fixture(t);const {withVisibilityStatusline}=await import(pathToFileURL(path.join(base,'src/cli/visibility-settings.js')).href);
 const custom={statusLine:{type:'command',command:'my-custom-status'}};assert.deepEqual(withVisibilityStatusline(root,custom),custom);
 const {resolveAgents}=await import(pathToFileURL(path.join(base,'src/agents/index.js')).href);const [grok]=resolveAgents(['grok']);grok.install({projectRoot:root,wolfDir:path.join(root,'.wolf'),templatesDir:''});assert.ok(!fs.existsSync(path.join(root,'.grok')));
});
test('denial receipts never duplicate functional protection messages',t=>{
 const root=fixture(t);record(root,'denied','read-denied');assert.equal(v.activityState(root,delivery(),1_000_000).message,undefined);assert.equal(v.activityState(root,undefined,1_000_000).state.counts['read-denied'],1);
});
test('failed receipt state commits preserve the queue and produce no display',t=>{
 const root=fixture(t);record(root,'write-failure','context-restored',Date.now());fs.mkdirSync(path.join(root,'.wolf/activity/state.json'));
 assert.equal(v.activityState(root,delivery()).message,undefined);assert.equal(fs.readdirSync(path.join(root,'.wolf/activity/queue')).filter(n=>n.endsWith('.json')).length,1);
});
test('archival previews produce no receipts; committed archives produce real counts',async t=>{
 const root=fixture(t),wolf=path.join(root,'.wolf');const {archiveMemory}=await import(pathToFileURL(path.join(base,'hooks/memory-archive.js')).href);
 fs.writeFileSync(path.join(wolf,'memory.md'),'# Memory\n\n## Session: 2020-01-01\n\nold one\n\n## Session: 2020-02-01\n\nold two\n\n## Session: 2026-09-14\n\nlatest\n');
 archiveMemory(wolf,7,true);assert.equal(v.activityState(root).state.history.length,0);
 const result=archiveMemory(wolf,7,false);assert.equal(result.archived.length,2);assert.equal(v.activityState(root).state.counts['memory-archived'],2);
 archiveMemory(wolf,7,false);assert.equal(v.activityState(root).state.counts['memory-archived'],2);
});
test('actual hook processes deliver recovery only on supported harness surfaces',t=>{
 for(const agent of ['claude','codex','grok']){
  const root=fixture(t);config(root,'quiet');const at=new Date().toISOString();
  h.queueCheckpoint(root,agent,'test-session',{id:'semantic',kind:'semantic-checkpoint',at,patch:{objective:'Synthetic task'}});h.reconcileActive(root,agent,'test-session');
  const env={...process.env,OPENWOLF_NO_UPDATE:'1'};
  for(const key of ['CLAUDECODE','CLAUDE_CODE_ENTRYPOINT','CLAUDE_PROJECT_DIR','CODEX_PROJECT_ROOT','CODEX_SANDBOX','CODEX_THREAD_ID','GROK_HOOK_EVENT','GROK_SESSION_ID'])delete env[key];
  if(agent==='claude')env.CLAUDECODE='1';if(agent==='codex')env.CODEX_PROJECT_ROOT=root;if(agent==='grok'){env.GROK_HOOK_EVENT='user_prompt_submit';env.GROK_SESSION_ID='test-session'}
  const input={cwd:root,session_id:'test-session',prompt:'Synthetic task'};
  const text=execFileSync(process.execPath,[path.join(base,'hooks/user-prompt-submit.js')],{input:JSON.stringify(input),encoding:'utf8',env});
  const output=JSON.parse(text||'{}');
  if(agent==='grok')assert.equal(output.systemMessage,undefined);else assert.match(output.systemMessage,/OpenWolf · Restored saved task context/);
  assert.equal(output.continue,undefined);assert.equal(output.decision,undefined);
 }
});
