/**
 * Minimal server-sent-events reader over a fetch `Response` body. Yields one
 * event per blank-line-terminated block; `data:` lines are joined with "\n"
 * as the spec requires. Used by the cloud providers' streaming paths.
 */
export interface SseEvent {
  event?: string;
  data: string;
}

export async function* readSseEvents(
  body: ReadableStream<Uint8Array> | null,
  abortSignal?: AbortSignal
): AsyncGenerator<SseEvent> {
  if (!body) {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  abortSignal?.addEventListener('abort', abort, { once: true });

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = findEventSeparator(buffer);

      while (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex.index);
        buffer = buffer.slice(separatorIndex.index + separatorIndex.length);
        const parsed = parseSseBlock(block);
        if (parsed) {
          yield parsed;
        }
        separatorIndex = findEventSeparator(buffer);
      }
    }

    const trailing = parseSseBlock(buffer);
    if (trailing) {
      yield trailing;
    }
  } finally {
    abortSignal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

function findEventSeparator(text: string): { index: number; length: number } | -1 {
  const lf = text.indexOf('\n\n');
  const crlf = text.indexOf('\r\n\r\n');

  if (lf === -1 && crlf === -1) {
    return -1;
  }
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, length: 4 };
  }
  return { index: lf, length: 2 };
}

export function parseSseBlock(block: string): SseEvent | null {
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];
  let event: string | undefined;

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'data') {
      dataLines.push(value);
    } else if (field === 'event') {
      event = value;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return { event, data: dataLines.join('\n') };
}
