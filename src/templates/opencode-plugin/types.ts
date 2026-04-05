export interface FileRead {
  count: number
  tokens: number
  first_read: string
}

export interface FileWrite {
  file: string
  action: string
  tokens: number
  at: string
}

export interface SessionState {
  session_id: string
  started: string
  files_read: Record<string, FileRead>
  files_written: FileWrite[]
  edit_counts: Record<string, number>
  anatomy_hits: number
  anatomy_misses: number
  repeated_reads_warned: number
  cerebrum_warnings: number
  stop_count: number
}

export type PartialSessionState = Partial<SessionState>

export interface FixDetection {
  category: string
  summary: string
  rootCause: string
  fix: string
  context?: string
}

export interface AnatomyEntry {
  file: string
  description: string
  tokens: number
}