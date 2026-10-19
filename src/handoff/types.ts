export type Agent = 'claude'|'codex'|'antigravity';
export type EventKind = 'user'|'assistant'|'tool-call'|'tool-result'|'compaction'|'boundary';
export interface EvidenceEvent {
  id:string; parent?:string; at:string; kind:EventKind; text:string;
  call_id?:string; tool?:string; status?:string; paths:string[];
  source:{file:string;line:number;sha256:string};
}
export interface SessionMeta {
  agent:Agent; id:string; thread_id?:string; session_id?:string; title:string; cwd:string;
  file:string; updated_at:string; version?:string; branch?:string; parent_session?:string; sidechain:boolean;
}
export interface SourceSnapshot {file:string;bytes:number;sha256:string}
export interface SessionRead {
  schema:1; session:SessionMeta; events:EvidenceEvent[]; sources:SourceSnapshot[];
  gaps:string[]; next_cursor:number|null; total_events:number;
}
export interface SessionSource {
  list():Promise<{sessions:SessionMeta[];gaps:string[]}>;
  read(id:string,cursor?:number,limit?:number):Promise<SessionRead>;
}
export interface RepoSnapshot {
  root:string;repository_id:string;worktree_id:string;branch:string|null;
  head:string|null;dirty_paths:string[];diff_hash:string;gaps:string[];
}
export interface Packet {
  schema:1;created_at:string;from:Agent;to:Agent;session:SessionMeta;repo:RepoSnapshot;
  sources:SourceSnapshot[];events:EvidenceEvent[];
  objective?:{text:string;event_id:string;provenance:'user-message'};
  active?:unknown;omitted_events:number;gaps:string[];estimated_tokens:number;
  trust:'untrusted-evidence';validation:'Historical observations; rerun validation against the receiving worktree';
}
