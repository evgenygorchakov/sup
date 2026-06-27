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

    if (buffer.length > 0) {
      yield buffer
    }
  }
  finally {
    reader.cancel().catch(() => {})
  }
}
