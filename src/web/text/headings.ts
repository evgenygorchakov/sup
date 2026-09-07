export interface Heading {
  level: number
  title: string
  offset: number
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const HEADING_LINE = /^(#{1,6}) +(\S.*?)\s*$/

function closesFence(marker: string, rest: string, openMarker: string): boolean {
  return marker[0] === openMarker[0] && marker.length >= openMarker.length && rest.trim() === ''
}

export function collectHeadings(markdown: string): Heading[] {
  const headings: Heading[] = []
  let offset = 0
  let openMarker = ''

  for (const line of markdown.split('\n')) {
    const fence = FENCE_LINE.exec(line)

    if (fence && openMarker === '') {
      openMarker = fence[1]!
    }
    else if (fence && closesFence(fence[1]!, fence[2]!, openMarker)) {
      openMarker = ''
    }
    else if (openMarker === '') {
      const match = HEADING_LINE.exec(line)
      if (match) {
        headings.push({ level: match[1]!.length, title: match[2]!, offset })
      }
    }

    offset += line.length + 1
  }

  return headings
}
