'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const test = require('node:test')

// Run against the complete production asset, never an extracted decoder.
const sourceRoot = process.env.FRAGMENT_SOURCE_ROOT || path.resolve(__dirname, '..')
const dependencyRoot = process.env.FRAGMENT_DEPENDENCY_ROOT || sourceRoot
const domDependencyRoot = process.env.FRAGMENT_DOM_DEPENDENCY_ROOT || dependencyRoot
const requireConverter = createRequire(path.join(dependencyRoot, 'package.json'))
const requireDom = createRequire(path.join(domDependencyRoot, 'package.json'))
const asciidoctor = requireConverter('@asciidoctor/core')()
const { JSDOM } = requireDom('jsdom')
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

function render(id) {
  // A supported named ID, NOT [[rate%]] and NOT a hand-authored href.
  const input = `= Fragment contract\n\n[id="${id}"]\n== Rate\n\nSee <<${id},target>>.\n`
  const html = asciidoctor.convert(input, { safe: 'safe' })
  const producer = new JSDOM(html, { url: 'https://example.test/page.html' })
  try {
    const heading = producer.window.document.getElementById(id)
    const link = producer.window.document.querySelector('a[href]')
    assert.ok(heading, 'real converter must produce the requested target')
    assert.equal(heading.tagName, 'H2')
    assert.equal(link.getAttribute('href'), '#' + id)
    return { html, href: link.getAttribute('href'), hash: link.hash }
  } finally {
    producer.window.close()
  }
}

for (const bundle of ['entemplates', 'cntemplates']) {
  const script = fs.readFileSync(path.join(sourceRoot, bundle, 'js/site.js'), 'utf8')
  for (const id of ['rate%', 'plain', '中文']) {
    for (const scenario of ['click', 'initial hash', 'hashchange']) {
      test(`${bundle}: ${id}: ${scenario}`, async () => {
        const produced = render(id)
        const dom = new JSDOM(
          '<div class="toolbar"><button class="nav-toggle"></button></div>' +
          '<div class="nav-container"><div class="nav">' +
          '<div class="nav-panel-menu is-active" data-panel="menu">' +
          '<nav class="nav-menu"><ul class="nav-list">' +
          '<li class="nav-item"><a class="nav-link">Rate</a></li>' +
          '</ul></nav></div></div></div>' +
          `<article class="doc">${produced.html}</article>`,
          {
            url: 'https://example.test/page.html' + (scenario === 'initial hash' ? produced.hash : ''),
            runScripts: 'outside-only'
          }
        )
        const { window } = dom
        const errors = []
        const scrolls = []
        try {
          const document = window.document
          const article = document.querySelector('article.doc')
          const heading = document.getElementById(id)
          const navLink = document.querySelector('.nav-link')
          // Navigation uses the converter's href; no independently invented URL.
          navLink.setAttribute('href', produced.href)
          window.addEventListener('error', (event) => {
            errors.push(event.error || event.message)
            event.preventDefault()
          })
          // JSDOM has no layout/scroll engine. These are geometry boundaries only.
          Object.defineProperties(heading, {
            offsetParent: { value: article },
            offsetTop: { value: 160 }
          })
          Object.defineProperties(article, {
            offsetParent: { value: document.body },
            offsetTop: { value: 0 }
          })
          document.querySelector('.toolbar').getBoundingClientRect = () => ({ bottom: 24 })
          window.scrollTo = (x, y) => scrolls.push([x, y])
          window.eval(script)
          await settle() // actual JSDOM load, including production delayed scroll

          if (scenario === 'click') {
            const link = article.querySelector('a[href]')
            const event = new window.MouseEvent('click', { bubbles: true, cancelable: true })
            link.dispatchEvent(event)
            assert.equal(event.defaultPrevented, true, 'production anchor click listener must run')
            await settle()
          } else if (scenario === 'hashchange') {
            window.location.hash = produced.hash
            await settle() // actual location-triggered hashchange, not a mocked handler
          }

          assert.deepEqual(errors, [], 'the whole asset must not emit URIError')
          assert.ok(navLink.parentNode.classList.contains('is-current-page'), 'navigation must select the real target')
          if (scenario !== 'hashchange') {
            assert.ok(scrolls.some(([x, y]) => x === 0 && y === 136), 'production scroll must use target geometry and toolbar offset')
          }
        } finally {
          window.close()
        }
      })
    }
  }
}
