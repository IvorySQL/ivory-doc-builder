'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')

const sourceRoot = path.resolve(__dirname, '..')
const dependencies = createRequire(path.join(process.env.DOC_TOOL_MODULE_ROOT || sourceRoot, 'package.json'))
const domDependencies = createRequire(path.join(process.env.DOC_DOM_MODULE_ROOT || process.env.DOC_TOOL_MODULE_ROOT || sourceRoot, 'package.json'))
const asciidoctor = dependencies('@asciidoctor/core')()
const { JSDOM } = domDependencies('jsdom')

const cases = [
  { label: 'new window', target: '_blank', intercepted: false },
  { label: 'named window', target: 'documentation', intercepted: false },
  { label: 'default current window', target: '', intercepted: true },
  { label: 'explicit current window', target: '_self', intercepted: true },
]

function renderLink(target) {
  const windowAttribute = target ? `,window=${target}` : ''
  const input = '= Link target contract\n\n[id="destination"]\n== Destination\n\n' +
    `link:#destination[Open destination${windowAttribute}]\n`
  const html = asciidoctor.convert(input, { safe: 'safe' })
  const dom = new JSDOM(html, { url: 'https://example.test/page.html' })
  try {
    const link = dom.window.document.querySelector('a[href]')
    assert.ok(dom.window.document.getElementById('destination'), 'real converter must create the target')
    assert.ok(link, 'real converter must create the link')
    assert.equal(link.getAttribute('href'), '#destination')
    assert.equal(link.getAttribute('target') || '', target, 'real converter must preserve the window attribute')
    return html
  } finally {
    dom.window.close()
  }
}

for (const language of ['cn', 'en']) {
  const script = fs.readFileSync(path.join(sourceRoot, `${language}templates/js/site.js`), 'utf8')
  for (const scenario of cases) {
    test(`${language}: generated fragment link respects ${scenario.label}`, async () => {
      const html = renderLink(scenario.target)
      const dom = new JSDOM(
        '<div class="toolbar"><button class="nav-toggle"></button></div>' +
        '<div class="nav-container"><div class="nav">' +
        '<div data-panel="menu"><nav class="nav-menu"></nav></div></div></div>' +
        `<article class="doc">${html}</article>`,
        { url: 'https://example.test/page.html', runScripts: 'outside-only' }
      )
      const { window } = dom
      const errors = []
      const scrolls = []
      try {
        const article = window.document.querySelector('article.doc')
        const heading = window.document.getElementById('destination')
        const link = article.querySelector('a[href]')
        window.addEventListener('error', (event) => {
          errors.push(event.error || event.message)
          event.preventDefault()
        })
        // JSDOM has no layout engine: supply geometry only, not navigation logic.
        Object.defineProperties(heading, {
          offsetParent: { value: article },
          offsetTop: { value: 160 }
        })
        Object.defineProperties(article, {
          offsetParent: { value: window.document.body },
          offsetTop: { value: 0 }
        })
        window.document.querySelector('.toolbar').getBoundingClientRect = () => ({ bottom: 24 })
        window.scrollTo = (x, y) => scrolls.push([x, y])
        window.eval(script) // complete actual production asset, no extracted handler
        await new Promise((resolve) => setTimeout(resolve, 20))
        assert.deepEqual(errors, [], 'production initialization must succeed')
        assert.equal(window.location.hash, '')
        assert.deepEqual(scrolls, [])

        const event = new window.MouseEvent('click', { bubbles: true, cancelable: true })
        link.dispatchEvent(event)
        assert.deepEqual(errors, [], 'production click must not throw')
        assert.equal(event.defaultPrevented, scenario.intercepted)
        if (scenario.intercepted) {
          assert.equal(window.location.hash, '#destination')
          assert.deepEqual(scrolls, [[0, 136]])
        } else {
          assert.equal(window.location.hash, '', 'scroll enhancement must not navigate the current context')
          assert.deepEqual(scrolls, [], 'scroll enhancement must leave target navigation to the browser')
        }
      } finally {
        // Close before JSDOM's pending default hyperlink-navigation task.
        // New tabs/windows themselves require a real browser integration check.
        window.close()
      }
    })
  }
}
