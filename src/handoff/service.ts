import {recordReceipt} from '../hooks/visibility.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {LocalSessions,readAll,verifyPacketClaims,type SourceOptions} from './sources.js';
import {CodexReader,CodexServerSessions} from './codex-server.js';
import {AntigravitySessions} from './antigravity-source.js';
import {repoSnapshot} from './repository.js';
import {hashText,redact,queueCheckpoint,reconcileActive,activeFile,type ActiveState} from '../hooks/handoff-state.js';
import type {Agent,Packet,SessionSource,SourceSnapshot} from './types.js';
export function agentName(s:unknown):Agent {if(s!=='claude'&&s!=='codex'&&s!=='antigravity')throw Error('Agent must be claude, codex or antigravity');return s}
export function sessionName(s:unknown):string {if(typeof s!=='string'||!s.trim()||s.length>200)throw Error('An explicit session id is required');return s}
export function sourceOptions(root:string):SourceOptions {try{const c=JSON.parse(fs.readFileSync(path.join(root,'.wolf/config.json'),'utf8')).openwolf?.handoff;return {claudeDir:typeof c?.claude_projects_dir==='string'?c.claude_projects_dir:undefined,codexDir:typeof c?.codex_sessions_dir==='string'?c.codex_sessions_dir:undefined}}catch{return {}}}
async function withSource<T>(root:string,agent:Agent,mode:string,fn:(source:SessionSource)=>Promise<T>,options?:SourceOptions):Promise<T>{
  if(agent==='antigravity')return fn(new AntigravitySessions(root));
  if(agent==='codex'&&mode!=='local'){
    const reader=new CodexReader(root);try{await reader.open();return await fn(new CodexServerSessions(root,reader))}catch(error){if(mode==='app-server')throw error}finally{reader.close()}
  }
  return fn(new LocalSessions(root,agent,options??sourceOptions(root)));
}
export async function listSessions(root:string,agent?:Agent,mode='auto',options?:SourceOptions){
  const results=[];for(const a of agent?[agent]:['claude','codex','antigravity'] as Agent[])results.push(await withSource(root,a,mode,s=>s.list(),options));return {sessions:results.flatMap(r=>r.sessions),gaps:results.flatMap(r=>r.gaps)};
}
export async function readSession(root:string,agent:Agent,id:string,cursor=0,limit=200,mode='auto',options?:SourceOptions){return withSource(root,agent,mode,s=>s.read(sessionName(id),cursor,limit),options)}
const packetDir=(root:string)=>path.join(root,'.wolf/handoff/packets');
const validId=(id:string)=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid packet id');return id};
export function packetHash(packet:Packet):string{return hashText(JSON.stringify(packet))}
export async function exportPacket(root:string,from:Agent,session:string,to:Agent,options:{preview?:boolean;budget?:number;source?:string;paths?:SourceOptions}={}){
  const read=await withSource(root,from,options.source??'local',s=>readAll(s,sessionName(session)),options.paths);
  const budget=options.budget??4000;if(!Number.isSafeInteger(budget)||budget<256||budget>16000)throw Error('Packet budget must be 256–16000 estimated tokens');
  const objective=read.events.find(e=>e.kind==='user');let active:ActiveState|undefined;
  try{active=JSON.parse(fs.readFileSync(activeFile(root,from,session),'utf8'))}catch{}
  const events=read.events.slice(-80);const repo=repoSnapshot(root);
  const packet:Packet={schema:1,created_at:new Date().toISOString(),from,to,session:read.session,repo,sources:read.sources,events,objective:objective?{text:objective.text.slice(0,3000),event_id:objective.id,provenance:'user-message'}:undefined,
    active:active?{objective:active.objective,constraints:active.constraints,next_action:active.next_action,unresolved:active.unresolved,completed:active.completed.slice(-10),provenance:'sender-authored checkpoint; not independently verified'}:undefined,
    omitted_events:read.total_events-events.length,gaps:[...read.gaps,...repo.gaps],estimated_tokens:0,trust:'untrusted-evidence',validation:'Historical observations; rerun validation against the receiving worktree'};
  // Keep recent evidence within an estimated UTF-8 budget; never call a model to summarize.
  const estimate=()=>Math.ceil(Buffer.byteLength(JSON.stringify(packet))/4);
  while(packet.events.length&&estimate()>budget){packet.events.shift();packet.omitted_events++}
  if(estimate()>budget){packet.active=undefined;if(packet.objective)packet.objective.text=packet.objective.text.slice(0,400);packet.gaps.push('Semantic checkpoint omitted to fit the selected budget')}
  if(estimate()>budget)throw Error('Packet metadata exceeds this budget; select a larger budget');
  packet.estimated_tokens=estimate();const id=packetHash(packet);
  if(!options.preview){indexEvidence(root,read);fs.mkdirSync(packetDir(root),{recursive:true});const file=path.join(packetDir(root),id+'.json');try{const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(packet));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}}
  if(!options.preview&&packetHash(loadPacket(root,id))===id)recordReceipt(root,{agent:from,session,operation:'checkpoint-saved',evidence:'packet:'+id});
  return {id,packet};
}
export function loadPacket(root:string,id:string):Packet {
  const file=path.join(packetDir(root),validId(id)+'.json');if(fs.statSync(file).size>2*1024*1024)throw Error('Packet exceeds size limit');
  const p=JSON.parse(fs.readFileSync(file,'utf8')) as Packet;
  if(p.schema!==1||p.trust!=='untrusted-evidence'||packetHash(p)!==id||!Array.isArray(p.events)||!Array.isArray(p.sources)||!p.repo||!p.session)throw Error('Packet integrity/schema check failed');
  agentName(p.from);agentName(p.to);sessionName(p.session.id);if(p.session.agent!==p.from)throw Error('Packet source agent mismatch');return p;
}
export function sourceFreshness(s:SourceSnapshot):'unchanged'|'advanced'|'changed'|'unavailable'{
  if(!Number.isSafeInteger(s.bytes)||s.bytes<0||s.bytes>64*1024*1024)return 'unavailable';
  try{const fd=fs.openSync(s.file,'r');try{const stat=fs.fstatSync(fd);if(stat.size<s.bytes)return 'changed';const b=Buffer.alloc(s.bytes);const n=fs.readSync(fd,b,0,b.length,0);if(n!==s.bytes||crypto.createHash('sha256').update(b).digest('hex')!==s.sha256)return 'changed';return stat.size>s.bytes?'advanced':'unchanged'}finally{fs.closeSync(fd)}}catch{return 'unavailable'}
}
export function inspectPacket(root:string,id:string){
  const packet=loadPacket(root,id),now=repoSnapshot(root);
  const same_worktree=packet.repo.worktree_id===now.worktree_id&&packet.repo.repository_id===now.repository_id;
  const drift=(packet.session.branch!==undefined&&packet.session.branch!==now.branch)||packet.repo.head!==now.head||packet.repo.branch!==now.branch||packet.repo.diff_hash!==now.diff_hash||!packet.repo.diff_hash||now.gaps.length>0||packet.repo.gaps.length>0;
  const sources=packet.sources.map(s=>({...s,status:sourceFreshness(s)}));
  const source_verifiable=sources.length>0&&sources.every(s=>s.status==='unchanged');
  return {id,packet,same_worktree,drift,sources,source_verifiable,claims_verified:source_verifiable&&verifyPacketClaims(root,packet),current:now};
}
export function importPacket(root:string,id:string,to:Agent,session:string,allowDrift=false){
  sessionName(session);const inspection=inspectPacket(root,id),p=inspection.packet;
  if(!inspection.same_worktree)throw Error('Packet belongs to another repository/worktree');
  if(p.to!==to)throw Error('Packet destination does not match the receiving agent');
  if(!inspection.source_verifiable)throw Error('Source changed, advanced, unavailable or unverifiable; export a fresh local-source packet');
  if(!inspection.claims_verified)throw Error('Packet claims do not match the saved source evidence');
  if(inspection.drift&&!allowDrift)throw Error('Repository drift detected; review the packet before importing historical evidence');
  const state=reconcileActive(root,to,session),sender=p.active as Partial<ActiveState>|undefined;
  queueCheckpoint(root,to,session,{id:'import:'+id,kind:'handover-import',at:new Date().toISOString(),text:`Imported historical evidence ${id}; current validation must be rerun`,patch:{imported_packet:id,
    objective:state.objective||redact(p.objective?.text??sender?.objective??''),next_action:state.next_action||redact(sender?.next_action??''),unresolved:[...new Set([...state.unresolved,...(Array.isArray(sender?.unresolved)?sender.unresolved:[])])]}});
  return {id,session,agent:to,drift:inspection.drift,active:reconcileActive(root,to,session),approval:'none; evidence only'};
}
export function listPackets(root:string){let names:string[]=[];try{names=fs.readdirSync(packetDir(root)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))}catch{}return names.map(n=>{try{const p=loadPacket(root,n.slice(0,-5));return {id:n.slice(0,-5),from:p.from,to:p.to,session:p.session.id,created_at:p.created_at,branch:p.repo.branch,estimated_tokens:p.estimated_tokens,gaps:p.gaps.length}}catch{return null}}).filter(Boolean).sort((a,b)=>b!.created_at.localeCompare(a!.created_at))}
export function listActive(root:string){const dir=path.join(root,'.wolf/handoff/active');let names:string[]=[];try{names=fs.readdirSync(dir)}catch{}
  const identities=new Map<string,{agent:string;session:string}>();
  for(const n of names){try{if(n.endsWith('.json')){const s=JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));identities.set(s.agent+':'+s.session,s)}else if(n.endsWith('.json.events')){const first=fs.readdirSync(path.join(dir,n)).find(f=>f.endsWith('.json'));if(first){const e=JSON.parse(fs.readFileSync(path.join(dir,n,first),'utf8'));identities.set(e.agent+':'+e.session,e)}}}catch{}}
  return [...identities.values()].slice(0,200).map(s=>reconcileActive(root,s.agent,s.session)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
}
export function checkpoint(root:string,agent:Agent,session:string,patch:Record<string,unknown>){
  sessionName(session);for(const key of Object.keys(patch))if(!['objective','constraints','next_action','unresolved','completed'].includes(key))throw Error('Unsupported checkpoint field');
  queueCheckpoint(root,agent,session,{id:crypto.randomUUID(),kind:'semantic-checkpoint',at:new Date().toISOString(),patch,text:'Agent-authored checkpoint; claims require evidence'});return reconcileActive(root,agent,session);
}
export function retrieve(root:string,query:string,limit=8){
  if(typeof query!=='string'||query.length>300)throw Error('Query must be at most 300 characters');
  const terms=query.toLowerCase().split(/[^a-z0-9_./-]+/).filter(Boolean);if(!terms.length)return [];
  const candidates:Array<{id:string;packet?:string;data:any}>=[];
  const dir=path.join(root,'.wolf/handoff/evidence');
  try{for(const n of fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(-100))try{const file=path.join(dir,n);if(fs.statSync(file).size>12*1024*1024)continue;const data=JSON.parse(fs.readFileSync(file,'utf8'));if(hashText(JSON.stringify(data))===n.slice(0,-5))candidates.push({id:n.slice(0,-5),data})}catch{}}catch{}
  for(const brief of listPackets(root).slice(0,100))candidates.push({id:brief!.id,packet:brief!.id,data:loadPacket(root,brief!.id)});
  const found=new Map<string,any>();
  for(const {id,packet,data} of candidates){if((data.worktree_id??data.repo?.worktree_id)!==repoSnapshotIdentity(root))continue;
    const freshness=data.sources.length?data.sources.map(sourceFreshness).join(','):'unverifiable';
    const matchedCalls=new Set(data.events.filter((e:any)=>terms.some(t=>(e.text+' '+e.paths.join(' ')).toLowerCase().includes(t))).map((e:any)=>e.call_id).filter(Boolean));
    for(const e of data.events){const text=e.text.toLowerCase(),paths=e.paths.join(' ').toLowerCase();const score=terms.reduce((n,t)=>n+(text.includes(t)?1:0)+(paths.includes(t)?3:0),0)+(e.call_id&&matchedCalls.has(e.call_id)?1:0);if(!score)continue;
      const item={packet,index:id,event:e.id,excerpt:e.text.slice(0,500),score:score+(freshness==='unchanged'?1:0),source:`${e.source.file}:${e.source.line}`,freshness,kind:e.kind,session:data.session.id};
      const key=data.session.agent+':'+data.session.id+':'+e.id;const previous=found.get(key);if(!previous||packet)found.set(key,item);
    }
  }
  const results=[...found.values()].sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(30,limit)));
  const positive=results.some(r=>/\b(pass(?:ed)?|fixed|succeed(?:ed)?)\b/i.test(r.excerpt));const negative=results.some(r=>/\b(fail(?:ed|ure)?|broken|regression)\b/i.test(r.excerpt));
  return results.map(r=>({...r,potential_conflict:positive&&negative,validation:'Historical evidence; verify against current files'}));
}

function repoSnapshotIdentity(root:string){return hashText(fs.realpathSync(root)).slice(0,16)}

export async function recoverSession(root:string,agent:Agent,session:string,options?:SourceOptions){
  const source=agent==='antigravity'?new AntigravitySessions(root):new LocalSessions(root,agent,options??sourceOptions(root));
  const read=await readAll(source,sessionName(session));
  indexEvidence(root,read);
  const before=reconcileActive(root,agent,session);
  for(const e of read.events)queueCheckpoint(root,agent,session,{id:'source:'+e.id,kind:e.kind==='compaction'?'compaction':'recovered-'+e.kind,at:e.at||read.session.updated_at,text:e.text.slice(0,1200)});
  const first=read.events.find(e=>e.kind==='user');
  if(!before.objective&&first)queueCheckpoint(root,agent,session,{id:'objective:'+first.id,kind:'recovered-objective',at:first.at||read.session.updated_at,patch:{objective:first.text},text:'First saved user message; may need refinement for the current subtask'});
  return {active:reconcileActive(root,agent,session),gaps:read.gaps,evidence_events:read.events.length};
}
function indexEvidence(root:string,read:import('./types.js').SessionRead){
  const dir=path.join(root,'.wolf/handoff/evidence');fs.mkdirSync(dir,{recursive:true});
  const evidence={schema:1,worktree_id:repoSnapshotIdentity(root),session:read.session,sources:read.sources,gaps:read.gaps,events:read.events.map(e=>({...e,text:e.text.slice(0,1000)}))};
  const file=path.join(dir,hashText(JSON.stringify(evidence))+'.json');
  try{fs.writeFileSync(file,JSON.stringify(evidence),{flag:'wx',mode:0o600})}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}
}
