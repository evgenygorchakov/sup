// Reads an HTTP response body as a stream of text lines.
//
// Both providers receive their streamed reply as newline-delimited text
// (Ollama: one JSON object per line; llama.cpp: Server-Sent Events). The fiddly
// part — decoding bytes and splitting on newlines across chunk boundaries —
// lives here once, so each provider only has to interpret whole lines. The
// `onActivity` callback fires on every received chunk to keep the idle timeout
// alive.

export async function* readResponseLines(response: Response, onActivity: () => void): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error('response stream has no body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { value: bytes, done } = await reader.read()
      if (done) {
        break
      }

      onActivity()
      buffer += decoder.decode(bytes, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        yield buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
      }
    }

    // A trailing line with no closing newline (Ollama can end a stream this way).
    if (buffer.length > 0) {
      yield buffer
    }
  }
  finally {
    reader.cancel().catch(() => {})
  }
}
