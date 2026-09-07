/** HTML to markdown: what survives the conversion — headings, lists, code blocks, tables,
 *  links made absolute — and which part of the page is taken as its content in the first place.
 *  No network — every check runs on hand-made markup. Run with: node test/run.ts (or node test/unit/html-markdown.ts). */
import { check, done } from '../lib/check.ts'
import { selectContentRoot } from '../../src/web/html/content-root.ts'
import { discardIncompleteTrailingMarkup } from '../../src/web/html/incomplete-markup.ts'
import { htmlToMarkdown } from '../../src/web/html/markdown.ts'

const base = 'https://example.com/docs/guide.html'
const convert = (html: string): string => htmlToMarkdown(html, base)

// --- headings carry their level, and the text around them keeps its blocks apart
check('headings: level by tag', convert('<h1>One</h1><h3>Three</h3>'), '# One\n\n### Three')
check('headings: inline markup inside is flattened', convert('<h2>Two <span>words</span></h2>'), '## Two words')
check('headings: an empty one is dropped', convert('<h2> </h2><p>after</p>'), 'after')
check('paragraphs: one blank line apart', convert('<p>first</p><p>second</p>'), 'first\n\nsecond')
check('paragraphs: a line break is one newline', convert('<p>first<br>second</p>'), 'first\nsecond')
check('paragraphs: a rule is its own block', convert('<p>first</p><hr><p>second</p>'), 'first\n\n---\n\nsecond')

// --- lists keep their kind and their nesting
check('lists: bullets', convert('<ul><li>one</li><li>two</li></ul>'), '- one\n- two')
check('lists: numbers count from one', convert('<ol><li>one</li><li>two</li></ol>'), '1. one\n2. two')
check('lists: nesting is indented', convert('<ul><li>one<ul><li>deeper</li></ul></li><li>two</li></ul>'), '- one\n  - deeper\n- two')
check('lists: a paragraph inside an item stays on its line', convert('<ul><li><p>one</p></li><li><p>two</p></li></ul>'), '- one\n- two')
check('lists: an item without a closing tag still starts a line', convert('<ul><li>one<li>two</ul>'), '- one\n- two')

// --- code: fenced, with the language taken from the class of the block or of a wrapper
check('code: inline goes in backticks', convert('<p>call <code>fetch()</code> now</p>'), 'call `fetch()` now')
check('code: a block is fenced', convert('<pre>line one\nline two</pre>'), '```\nline one\nline two\n```')
check('code: the language comes from the code class', convert('<pre><code class="language-python">await x()</code></pre>'), '```python\nawait x()\n```')
check('code: a highlight wrapper names the language too', convert('<div class="highlight-python3 notranslate"><pre>await x()</pre></div>'), '```python3\nawait x()\n```')
check('code: entities and indentation are kept', convert('<pre>if (a &lt; b) {\n    call();\n}</pre>'), '```\nif (a < b) {\n    call();\n}\n```')
check('code: an empty block is dropped', convert('<p>text</p><pre>   </pre>'), 'text')
check('code: a block quoting a fence gets a longer one', convert('<pre>```js\ncall()\n```</pre>'), '````\n```js\ncall()\n```\n````')
check('code: the fence outgrows the longest run inside', convert('<pre>a ````` b</pre>'), '``````\na ````` b\n``````')
check('code: tildes inside need no wider fence', convert('<pre>~~~\nx' + '</pre>'), '```\n~~~\nx\n```')

// --- tables: a separator after the header row, and closing tags that HTML lets you omit
check('tables: header row gets a separator', convert('<table><tr><th>Name</th><th>Type</th></tr><tr><td>mode</td><td>int</td></tr></table>'), '| Name | Type |\n| --- | --- |\n| mode | int |')
check('tables: omitted cell and row tags still make rows', convert('<table><thead><tr><th>Version<th>Changes<tbody><tr><td>v14<td>added</table>'), '| Version | Changes |\n| --- | --- |\n| v14 | added |')
check('tables: a cell keeps its links', convert('<table><tr><td>call</td></tr><tr><td><a href="/api">api</a></td></tr></table>'), '| call |\n| --- |\n| [api](https://example.com/api) |')
check('tables: a one-row layout table is not a table', convert('<table><tr><td><a href="/a">one</a></td><td><a href="/b">two</a></td></tr></table>'), '[one](https://example.com/a)\n[two](https://example.com/b)')
check('tables: a layout table with blocks stays blocks', convert('<table><tr><td><p>left</p></td><td><p>right</p></td></tr><tr><td><p>below</p></td></tr></table>'), 'left\n\nright\n\nbelow')

// --- links: the point of the whole conversion, so relative addresses become absolute
check('links: relative becomes absolute', convert('<a href="../ref.html">ref</a>'), '[ref](https://example.com/ref.html)')
check('links: root relative becomes absolute', convert('<a href="/api/fs">fs</a>'), '[fs](https://example.com/api/fs)')
check('links: absolute is kept', convert('<a href="https://nodejs.org/api">node</a>'), '[node](https://nodejs.org/api)')
check('links: brackets around a url with parentheses', convert('<a href="/wiki/Transformer_(model)">t</a>'), '[t](<https://example.com/wiki/Transformer_(model)>)')
check('links: an in-page anchor keeps only its text', convert('<a href="#section">Section</a>'), 'Section')
check('links: a bare permalink anchor goes', convert('<h2>Title<a class="headerlink" href="#title">¶</a></h2>'), '## Title')
check('links: javascript keeps only its text', convert('<a href="javascript:void(0)">toggle</a>'), 'toggle')
check('links: mail stays text', convert('<a href="mailto:a@example.com">write</a>'), 'write')
check('links: an empty text drops the link', convert('<p>before<a href="/x"><span> </span></a>after</p>'), 'beforeafter')
check('links: no base url leaves the text alone', htmlToMarkdown('<a href="../ref.html">ref</a>'), 'ref')

// --- images are worth their tokens only when the alt text says something
check('images: alt and absolute src', convert('<img src="/img/a.png" alt="A picture">'), '![A picture](https://example.com/img/a.png)')
check('images: no alt, no image', convert('<p>text</p><img src="/img/a.png">'), 'text')
check('images: an inline data source is dropped', convert('<p>text</p><img src="data:image/png;base64,iVBOR" alt="pixel">'), 'text')

// --- entities and stray markup
check('entities: named and numeric', convert('<p>a &amp; b &lt; c &#8212; d &#x2014; e &nbsp;f</p>'), 'a & b < c — d — e f')
check('entities: an unknown one is left alone', convert('<p>&unknownentity; stays</p>'), '&unknownentity; stays')
check('markup: script and style go with their content', convert('<p>kept</p><script>var a = 1</script><style>p{}</style>'), 'kept')
check('markup: a comment goes', convert('<p>kept</p><!-- <p>hidden</p> -->'), 'kept')
check('markup: a doctype is not text', convert('<!doctype html><p>kept</p>'), 'kept')
check('markup: a lone angle bracket stays text', convert('<p>2 < 3</p>'), '2 < 3')

// --- the content root: the tag that says where the page proper starts
const withSidebar = (root: string): string => `<html><body><nav><a href="/a">nav</a></nav><div class="sidebar">${'menu item '.repeat(40)}</div>${root}<footer>footer text</footer></body></html>`
const article = `<h1>Title</h1><p>${'real sentence about the subject. '.repeat(20)}</p>`

check('root: main wins over the rest of the page', convert(selectContentRoot(withSidebar(`<main>${article}</main>`))).startsWith('# Title'), true)
check('root: main leaves the sidebar out', convert(selectContentRoot(withSidebar(`<main>${article}</main>`))).includes('menu item'), false)
check('root: role="main" is a root too', convert(selectContentRoot(withSidebar(`<div role="main">${article}</div>`))).startsWith('# Title'), true)
check('root: article is a root too', convert(selectContentRoot(withSidebar(`<article>${article}</article>`))).startsWith('# Title'), true)
check('root: a content id is a root too', convert(selectContentRoot(withSidebar(`<div id="content">${article}</div>`))).startsWith('# Title'), true)
check('root: a nav inside the root goes as well', convert(selectContentRoot(`<body><main><nav><a href="/a">skip</a></nav>${article}</main></body>`)).includes('skip'), false)
check('root: a header holding the title stays', convert(selectContentRoot(`<body><main><header><h1>Title</h1></header><p>${'text '.repeat(60)}</p></main></body>`)).startsWith('# Title'), true)

// --- no such tag anywhere: the densest block of text wins over the menus around it
const noTags = `<html><body><div class="wrapper"><div class="related"><a href="/a">${'link text '.repeat(30)}</a></div><div class="deep"><div>${article}</div></div></div></body></html>`
check('root: the heuristic finds the text', convert(selectContentRoot(noTags)).startsWith('# Title'), true)
check('root: the heuristic drops the link block', convert(selectContentRoot(noTags)).includes('link text'), false)
check('root: a page of one paragraph survives', convert(selectContentRoot('<body><p>short page</p></body>')), 'short page')

// --- a junk name on the wrapper that holds the whole page must not take the page with it
const inWrapper = (attributes: string): string => `<body><div ${attributes}><div class="sidebar">${'menu item '.repeat(40)}</div><div>${article}</div></div></body>`
check('root: a wrapper named after a sidebar keeps its text', convert(selectContentRoot(inWrapper('class="page-with-sidebar"'))).startsWith('# Title'), true)
check('root: that wrapper still loses the real sidebar', convert(selectContentRoot(inWrapper('class="page-with-sidebar"'))).includes('menu item'), false)
check('root: an id naming a menu is no reason to drop the text', convert(selectContentRoot(inWrapper('id="layout-menu"'))).startsWith('# Title'), true)
check('root: a junk block of its own still goes', convert(selectContentRoot(`<body><div class="banner">${'ad copy '.repeat(40)}</div><div>${article}</div></body>`)).includes('ad copy'), false)
check('root: an unclosed sidebar before the text does not eat it', convert(selectContentRoot(`<body><div class="sidebar"><a href="/a">menu</a><div>${article}`)).includes('# Title'), true)

// --- junk names live on blocks: a word inside a heading or a sentence is not a block
const backref = `<body><div class="doc"><h1>Title</h1><h2><a class="toc-backref" href="#id2">Coroutines</a></h2><p>${'real sentence about the subject. '.repeat(20)}</p></div></body>`
check('root: a heading linking back to the toc keeps its title', convert(selectContentRoot(backref)).includes('## Coroutines'), true)
check('root: an inline span named like a menu stays', convert(selectContentRoot(`<body><div class="doc"><h1>Title</h1><p><span class="menu-label">File</span> ${'real sentence about the subject. '.repeat(20)}</p></div></body>`)).includes('File'), true)
check('root: a toc block of its own still goes', convert(selectContentRoot(`<body><div class="toctree">${'contents entry '.repeat(30)}</div><div>${article}</div></body>`)).includes('contents entry'), false)

// --- markup cut mid-tag: the leftovers must not swallow the readable text
check('cut markup: an unclosed script tail goes', discardIncompleteTrailingMarkup('<p>kept</p><script>var a = "<p>lost</p>'), '<p>kept</p>')
check('cut markup: a closed script stays', discardIncompleteTrailingMarkup('<p>kept</p><script>var a</script><p>also</p>'), '<p>kept</p><script>var a</script><p>also</p>')
check('cut markup: an unclosed pre tail goes', discardIncompleteTrailingMarkup('<p>kept</p><pre>code'), '<p>kept</p>')
check('cut markup: a dangling tag start goes', discardIncompleteTrailingMarkup('<p>kept</p><div clas'), '<p>kept</p>')
check('cut markup: complete html is untouched', discardIncompleteTrailingMarkup('<p>kept</p>'), '<p>kept</p>')

done()
