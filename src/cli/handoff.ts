import {activeFile, emptyActive} from "../hooks/handoff-state.js";
import type {Command} from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {findProjectRoot} from '../scanner/project-root.js';
import {listSessions,readSession,exportPacket,inspectPacket,importPacket,checkpoint,retrieve,recoverSession,agentName} from '../handoff/service.js';
import {operationStatus,prepareOperations} from './operations.js';
const root=()=>findProjectRoot(process.cwd());const print=(v:unknown)=>console.log(JSON.stringify(v,null,2));
export function addHandoffCommands(program:Command){
 const handoff=program.command('handoff').description('Inspect and transfer saved Claude/Codex/Antigravity task evidence');
 handoff.command('list').option('--from <agent>').option('--source <source>','auto, local or app-server','auto').action(async o=>print(await listSessions(root(),o.from?agentName(o.from):undefined,o.source)));
 handoff.command('read').requiredOption('--from <agent>').requiredOption('--session <id>').option('--cursor <number>','Event offset','0').option('--limit <number>','Page size','200').option('--source <source>','auto, local or app-server','auto').action(async o=>print(await readSession(root(),agentName(o.from),o.session,Number(o.cursor),Number(o.limit),o.source)));
 handoff.command('export').requiredOption('--from <agent>').requiredOption('--session <id>').requiredOption('--to <agent>').option('--preview','Read-only packet preview').option('--budget <number>','Estimated token budget','4000').option('--source <source>','local or app-server','local').action(async o=>print(await exportPacket(root(),agentName(o.from),o.session,agentName(o.to),{preview:o.preview,budget:Number(o.budget),source:o.source})));
 handoff.command('inspect <id>').action(id=>print(inspectPacket(root(),id)));
 handoff.command('observations').requiredOption('--agent <agent>').requiredOption('--session <id>').action(o=>{
   const file=activeFile(root(),agentName(o.agent),o.session);
   const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):emptyActive(o.agent,o.session);
   print({agent:o.agent,session:o.session,observations:state.recent,claims_verified:false,limitation:'Historical hook observations, not verified current test results. Packet IDs belong to handoff inspect.'});
 });
 handoff.command('import <id>').requiredOption('--to <agent>').requiredOption('--session <id>','Explicit receiving session').option('--allow-drift','Import reviewed historical evidence after repository drift').action((id,o)=>print(importPacket(root(),id,agentName(o.to),o.session,o.allowDrift)));
 handoff.command('checkpoint').requiredOption('--agent <agent>').requiredOption('--session <id>').requiredOption('--file <json>','Semantic fields: objective, constraints, next_action, unresolved, completed').action(o=>{if(fs.statSync(o.file).size>64000)throw Error('Checkpoint input exceeds 64 KB');print(checkpoint(root(),agentName(o.agent),o.session,JSON.parse(fs.readFileSync(o.file,'utf8'))))});
 handoff.command('recover').requiredOption('--from <agent>').requiredOption('--session <id>').action(async o=>print(await recoverSession(root(),agentName(o.from),o.session)));
 handoff.command('search <query>').action(q=>print(retrieve(root(),q)));
 const operations=program.command('operations').description('Check operational readiness and prepare protected deployment review');
 operations.command('doctor').action(()=>print(operationStatus(root())));
 operations.command('prepare').requiredOption('--output <directory>').action(o=>print(prepareOperations(root(),path.resolve(o.output))));
}
