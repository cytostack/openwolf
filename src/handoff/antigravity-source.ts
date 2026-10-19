import * as fs from 'node:fs';
import * as path from 'node:path';
import {reconcileActive, activeFile} from '../hooks/handoff-state.js';
import type {EventKind,EvidenceEvent,SessionMeta,SessionRead,SessionSource} from './types.js';

// Antigravity has no decodable session transcript (its native conversation
// storage isn't a stable, documented format), so unlike LocalSessions this
// reader never touches a transcript file. It replays the same hook-captured
// checkpoint state that already accumulates in .wolf/handoff/active/ during
// a normal session — the same evidence source OpenWolf already trusts for
// live context injection — instead of pretending to recover a full history.

const activeDir=(root:string)=>path.join(root,'.wolf','handoff','active');

function toEventKind(kind:string):EventKind {
  if(kind==='request')return 'user';
  if(kind==='compaction')return 'compaction';
  if(kind==='semantic-checkpoint'||kind==='handover-import')return 'assistant';
  if(kind==='turn-end'||kind==='session-end')return 'boundary';
  return 'tool-result';
}

export class AntigravitySessions implements SessionSource {
  constructor(private root:string){}
  async list():Promise<{sessions:SessionMeta[];gaps:string[]}> {
    // A session's identity can exist only as an unreconciled <hash>.json.events/
    // dir (queueCheckpoint never writes the plain <hash>.json itself) until
    // something reconciles it, so a first session must be discovered from
    // either form — mirrors service.ts's listActive().
    const dir=activeDir(this.root);let names:string[]=[];
    try{names=fs.readdirSync(dir)}catch{}
    const identities=new Map<string,{agent:string;session:string}>();
    for(const n of names){
      try{
        if(n.endsWith('.json.events')){
          const first=fs.readdirSync(path.join(dir,n)).find(f=>f.endsWith('.json'));
          if(!first)continue;
          const e=JSON.parse(fs.readFileSync(path.join(dir,n,first),'utf8'));
          if(e.agent&&e.session)identities.set(e.agent+':'+e.session,{agent:e.agent,session:e.session});
        }else if(n.endsWith('.json')){
          const state=JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
          if(state.agent&&state.session)identities.set(state.agent+':'+state.session,{agent:state.agent,session:state.session});
        }
      }catch{}
    }
    const sessions:SessionMeta[]=[];
    for(const {agent,session} of identities.values()){
      if(agent!=='antigravity')continue;
      const state=reconcileActive(this.root,agent,session);
      if(!state.updated_at)continue;
      sessions.push({agent:'antigravity',id:session,title:(state.objective||'(no objective captured)').slice(0,120),cwd:this.root,file:activeFile(this.root,agent,session),updated_at:state.updated_at,sidechain:false});
    }
    const gaps=sessions.length?[]:['No antigravity checkpoint state found; Antigravity conversation text is not decoded, so evidence exists only after hooks have captured a session'];
    return {sessions:sessions.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)),gaps};
  }
  async read(id:string,cursor=0,limit=200):Promise<SessionRead> {
    if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>5000)throw Error('Invalid event page');
    const state=reconcileActive(this.root,'antigravity',id);
    if(!state.updated_at)throw Error('Session is unavailable in this worktree');
    const events:EvidenceEvent[]=state.recent.map(e=>({id:e.id,at:e.at,kind:toEventKind(e.kind),text:e.text,paths:[],source:{file:'hook-capture',line:0,sha256:''}}));
    const session:SessionMeta={agent:'antigravity',id,title:(state.objective||'(no objective captured)').slice(0,120),cwd:this.root,file:'hook-capture',updated_at:state.updated_at,sidechain:false};
    const gaps=['Antigravity conversation text is not decoded; events are derived from hook-captured checkpoints only, not a full transcript'];
    return {schema:1,session,events:events.slice(cursor,cursor+limit),sources:[],gaps,next_cursor:cursor+limit<events.length?cursor+limit:null,total_events:events.length};
  }
}
