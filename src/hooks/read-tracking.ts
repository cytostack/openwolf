export interface FileReadEntry {
  count: number;
  tokens: number;
  first_read: string;
  read_mtime?: number;
}

interface ReadTransition {
  entry: FileReadEntry;
  repeated: boolean;
}

export function trackRead(
  previous: FileReadEntry | undefined,
  currentMtime: number | undefined,
  readAt: string
): ReadTransition {
  const changed =
    previous?.read_mtime !== undefined &&
    currentMtime !== undefined &&
    previous.read_mtime !== currentMtime;

  if (previous && !changed) {
    return {
      repeated: true,
      entry: {
        ...previous,
        count: previous.count + 1,
        read_mtime: previous.read_mtime ?? currentMtime,
      },
    };
  }

  return {
    repeated: false,
    entry: {
      count: 1,
      tokens: 0,
      first_read: readAt,
      read_mtime: currentMtime,
    },
  };
}
