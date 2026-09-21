/** Local activity receipts. Never add model context or change a tool decision. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mutateJSON} from './anatomy-lock.js';

export type VisibilityMode = 'off'|'quiet'|'verbose';
export type Operation = 'checkpoint-saved'|'context-restored'|'memory-archived'|'map-preserved'|'fix-retrieved'|'rule-verified'|'read-denied'|'runtime-ready';
export interface Receipt {schema:1;id:string;session:string;agent:string;operation:Operation;outcome:'completed';at:number;evidence:string;count:number;category:'routine'|'recovery';}
interface State {schema:1;membership?:string;seen:Record<string,number>;watermark:number;history:Receipt[];pending:Receipt[];counts:Partial<Record<Operation,number>>;lastAt:number;turns:Record<string,number>;startup:Record<string,boolean>;last?:{text:string;at:number;session:string;agent:string;transport:string};}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const dir=(root:string)=>path.join(root,'.wolf/activity');
const empty=():State=>({schema:1,seen:{},watermark:0,history:[],pending:[],counts:{},lastAt:0,turns:{},startup:{}});
const operations:Operation[]=['checkpoint-saved','context-restored','memory-archived','map-preserved','fix-retrieved','rule-verified','read-denied','runtime-ready'];
export function visibilityMode(root:string):VisibilityMode {
  if(process.env.OPENWOLF_VISIBILITY==='off')return 'off';
  try {const file=path.join(root,'.wolf/config.json');if(!fs.existsSync(file))return 'quiet';const mode=JSON.parse(fs.readFileSync(file,'utf8')).openwolf?.visibility?.mode;return mode===undefined?'quiet':mode==='quiet'||mode==='verbose'?mode:'off'}catch{return 'off'}
}
/** Caller supplies completed-operation evidence, never a pending write. Identity is hashed for privacy. */
export function recordReceipt(root:string,input:{operation:Operation;agent?:string;session?:string;evidence:string;count?:number;at?:number}):boolean {
  try {
    if(visibilityMode(root)==='off'||!fs.existsSync(path.join(root,'.wolf'))||!operations.includes(input.operation)||!input.evidence)return false;
    const evidence=hash(input.evidence),id=hash(input.operation+':'+evidence);
    const at=input.at??Date.now(),count=input.count??1;
    if(!Number.isSafeInteger(count)||count<1||!Number.isFinite(at))return false;
    const receipt:Receipt={schema:1,id,session:input.session?hash(input.session):'',agent:['claude','codex','opencode','grok','omp'].includes(input.agent??'')?input.agent!:'project',operation:input.operation,outcome:'completed',at,evidence,count,category:input.operation==='context-restored'?'recovery':'routine'};
    const queue=path.join(dir(root),'queue');fs.mkdirSync(queue,{recursive:true});
    // Fixed 4096-slot spool: no directory scan, lock, sleep or unbounded backlog on tool paths.
    // An occupied slot may drop a receipt, never an operational write. Counters are recorded actions only.
    const file=path.join(queue,id.slice(0,3)+'.json'),tmp=file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(tmp,JSON.stringify(receipt),{flag:'wx',mode:0o600});try{fs.linkSync(tmp,file);return true}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;return false}}finally{try{fs.unlinkSync(tmp)}catch{}}
  }catch{return false}
}
function readState(root:string):State {try{return JSON.parse(fs.readFileSync(path.join(dir(root),'state.json'),'utf8'))}catch{return empty()}}
function valid(r:Receipt):boolean{return r.schema===1&&/^[a-f0-9]{64}$/.test(r.id)&&/^[a-f0-9]{64}$/.test(r.evidence)&&operations.includes(r.operation)&&r.outcome==='completed'&&Number.isSafeInteger(r.count)&&r.count>0&&Number.isFinite(r.at)&&['claude','codex','opencode','grok','omp','project'].includes(r.agent)&&(r.session===''||/^[a-f0-9]{64}$/.test(r.session))}
export function receiptText(r:Pick<Receipt,'operation'|'count'>):string {
  const n=r.count;
  const messages:Record<Operation,string>={
    'checkpoint-saved':n===1?'Saved context for handover':`Saved ${n} context checkpoints`,
    'context-restored':'Restored saved task context',
    'memory-archived':`Archived ${n} old session${n===1?'':'s'} · restorable`,
    'map-preserved':'Kept existing project map entries after a partial scan',
    'fix-retrieved':n===1?'Found a relevant previous fix':`Found ${n} relevant previous fixes`,
    'rule-verified':'Loaded reviewed project memory',
    'read-denied':n===1?'Declined an unchanged file read':`Declined ${n} unchanged file reads`,
    'runtime-ready':'Verified an update for new sessions',
  };
  return 'OpenWolf · '+messages[r.operation];
}
export type Surface='claude-statusline'|'claude-hook'|'codex-hook'|'opencode-toast'|'dashboard';
/** Boundaries/dashboard only. Zero lock waiting; failed delivery claims remain retryable. */
export function activityState(root:string,delivery?:{agent:string;session:string;turn:string;surface:Surface;startup?:boolean},now=Date.now()):{state:State;message?:string} {
  const mode=visibilityMode(root);if(mode==='off'||!fs.existsSync(path.join(root,'.wolf')))return {state:readState(root)};
  const queue=path.join(dir(root),'queue'),consumed:Array<{file:string;id:string}>=[];
  let message:string|undefined;
  try {
    const state=mutateJSON<State>(path.join(dir(root),'state.json'),empty(),0,s=>{
      const membership=Buffer.from(s.membership??Buffer.alloc(131072).toString('base64'),'base64');
      if(membership.length!==131072)throw Error('Invalid receipt membership');
      let names:string[]=[];try{names=fs.readdirSync(queue).filter(n=>/^[a-f0-9]{3}\.json$/.test(n)).slice(0,delivery?32:4096)}catch{}
      for(const name of names){const file=path.join(queue,name);try {
        if(fs.statSync(file).size>2048)continue;const r=JSON.parse(fs.readFileSync(file,'utf8')) as Receipt;if(!valid(r))continue;
        const bits=[0,8,16,24].map(i=>parseInt(r.id.slice(i,i+8),16)%(131072*8));
        const known=bits.every(bit=>(membership[bit>>3]&(1<<(bit&7)))!==0);
        if(!known&&r.at<=now+60_000){for(const bit of bits)membership[bit>>3]|=1<<(bit&7);s.seen[r.id]=r.at;s.history.push(r);s.pending.push(r);s.counts[r.operation]=(s.counts[r.operation]??0)+r.count}
        consumed.push({file,id:r.id});
      }catch{}}
      s.membership=membership.toString('base64');
      s.history=s.history.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)).slice(-100);
      s.pending=s.pending.filter(r=>now-r.at<86400_000).slice(-256);
      const seen=Object.entries(s.seen).sort((a,b)=>b[1]-a[1]);
      if(seen.length>4096){s.watermark=Math.max(s.watermark,seen[4096][1]);s.seen=Object.fromEntries(seen.filter(([,at])=>at>s.watermark).slice(0,4096))}
      if(!delivery||delivery.surface==='dashboard'||!delivery.session)return;
      const d=delivery,key=hash(d.agent+':'+d.session),turn=hash(key+':'+d.turn);
      if(s.lastAt&&now-s.lastAt<300_000||(s.turns[turn]??0)>=3||d.startup&&s.startup[key])return;
      const candidates=s.pending.filter(r=>r.operation!=='read-denied'&&r.operation!=='runtime-ready'&&(!r.session||r.session===hash(d.session)&&r.agent===d.agent)&&(!d.startup||r.category==='recovery')&&
        (d.surface!=='claude-hook'&&d.surface!=='codex-hook'||r.category==='recovery'||mode==='verbose'));
      const first=candidates.find(r=>r.category==='recovery')??candidates[0];if(!first)return;
      const batch=candidates.filter(r=>r.operation===first.operation);message=receiptText({...first,count:batch.reduce((n,r)=>n+r.count,0)});
      const ids=new Set(batch.map(r=>r.id));s.pending=s.pending.filter(r=>!ids.has(r.id));s.lastAt=now;s.turns[turn]=(s.turns[turn]??0)+1;
      s.turns=Object.fromEntries(Object.entries(s.turns).slice(-256));if(d.startup)s.startup[key]=true;s.startup=Object.fromEntries(Object.entries(s.startup).slice(-256));
      s.last={text:message,at:now,session:hash(d.session),agent:d.agent,transport:d.surface};
    });
    if(!state)return {state:readState(root)};
    for(const {file,id} of consumed)try{if(JSON.parse(fs.readFileSync(file,'utf8')).id===id)fs.unlinkSync(file)}catch{}
    return {state,message};
  }catch{return {state:readState(root)}}
}
export function hookReceipt(root:string,agent:string,input:{session_id?:string;prompt_id?:string},startup=false):string|undefined {
  if(agent!=='claude'&&agent!=='codex')return;
  return activityState(root,{agent,session:input.session_id??'',turn:input.prompt_id??'session',surface:agent==='claude'?'claude-hook':'codex-hook',startup}).message;
}
/** Missing/headless SDKs are silent; never await rendering or start a model turn. */
export function showActivityToast(client:any,message:string):void {
  try{const result=client?.tui?.showToast?.({body:{title:'OpenWolf',message,variant:'info',duration:4000}});void Promise.resolve(result).catch(()=>{})}catch{}
}
