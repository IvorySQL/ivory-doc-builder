'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')

const sourceRoot = path.resolve(process.env.DOC_COPY_SOURCE_ROOT || path.join(__dirname, '..'))
const toolRoot = path.resolve(process.env.DOC_TOOL_MODULE_ROOT || sourceRoot)
const templateRoot = path.resolve(process.env.DOC_TEMPLATE_ROOT || toolRoot)
const dependencies = createRequire(path.join(toolRoot, 'package.json'))
const domDependencies = createRequire(path.join(process.env.DOC_DOM_MODULE_ROOT || toolRoot, 'package.json'))
const asciidoctor = dependencies('@asciidoctor/core')()
const Handlebars = dependencies('handlebars')
const { JSDOM } = domDependencies('jsdom')

const formattedLiteral = '[subs="+quotes"]\n....\n$ echo *hello*\n$ echo done\n....\n'
const plainLiteral = '....\n$ echo hello\n$ echo done\n....\n'
const sourceConsole = '[source,console]\n----\n$ echo hello\n$ echo done\n----\n'
const expectedText = '$ echo hello\n$ echo done'
const expectedCommand = 'echo hello && echo done'

function renderPage(language, input) {
  const contents = asciidoctor.convert(input, { safe: 'safe' })
  const handlebars = Handlebars.create()
  for (const helper of ['and', 'eq', 'increment', 'ne', 'not', 'or', 'relativize']) {
    handlebars.registerHelper(helper, require(path.join(templateRoot, language, 'helpers', helper + '.js')))
  }
  for (const partial of [
    'body', 'nav', 'nav-menu', 'nav-tree', 'nav-explore', 'main', 'toolbar',
    'nav-toggle', 'breadcrumbs', 'toc', 'article', 'pagination', 'footer-scripts',
  ]) {
    handlebars.registerPartial(partial, fs.readFileSync(path.join(templateRoot, language, 'partials', partial + '.hbs'), 'utf8'))
  }
  return handlebars.compile('{{> body}}{{> footer-scripts}}')({
    env: { CI: true },
    site: { components: {} },
    uiRootPath: '/_',
    page: { layout: 'default', title: 'Console copy', contents, attributes: {} },
  })
}

async function initialize(language, input, clipboardMode = 'resolve', formatted = false) {
  const dom = new JSDOM(renderPage(language, input), {
    url: 'https://example.test/docs/page.html',
    runScripts: 'outside-only',
  })
  const { window } = dom
  const errors = []
  const writes = []
  const pre = window.document.querySelector('article.doc pre')
  try {
    assert.ok(pre, 'FIXTURE: actual converter/templates must create the code display')
    assert.equal(pre.textContent, expectedText, 'FIXTURE: converted command text')
    if (formatted) {
      assert.ok(pre.closest('.literalblock'), 'FIXTURE: a supported literal block, not a hand-built pre')
      assert.equal(pre.querySelector('strong').textContent, 'hello', 'FIXTURE: real quote substitution')
      assert.ok(pre.childNodes.length > 1, 'FIXTURE: real converter produces multiple child nodes')
    }
    // JSDOM 11 has no layout/innerText. These fixtures contain only visible text
    // and inline strong markup; textContent supplies that narrow DOM boundary.
    // Structural assertions below use the real DOM independently of this shim.
    if (!('innerText' in window.HTMLElement.prototype)) {
      Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return this.textContent },
      })
    }
    // Clipboard is the external OS boundary, not a simulated product handler.
    // No real clipboard write, browser permission or layout is tested here.
    if (clipboardMode !== 'absent') {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText(text) {
            writes.push(text)
            return clipboardMode === 'reject'
              ? Promise.reject(new Error('clipboard denied by test boundary'))
              : Promise.resolve()
          },
        },
      })
    }
    window.scrollTo = () => {}
    window.addEventListener('error', (event) => {
      errors.push(event.error || event.message)
      event.preventDefault()
    })
    const originalNodes = Array.from(pre.childNodes)
    const originalStrong = pre.querySelector('strong')
    const script = fs.readFileSync(path.join(sourceRoot, language, 'js/site.js'), 'utf8')
    window.eval(script) // complete six-IIFE production script, never extracted code
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(errors, [], 'complete production initialization must not throw')
    return { window, pre, writes, errors, originalNodes, originalStrong }
  } catch (error) {
    window.close()
    throw error
  }
}

for (const language of ['cntemplates', 'entemplates']) {
  test(language + ': formatted literal console retains all nodes and copies complete commands', async () => {
    const page = await initialize(language, formattedLiteral, 'resolve', true)
    try {
      const code = page.pre.querySelector('code.language-console')
      assert.ok(code, 'production must wrap literal console content')
      assert.equal(code.textContent, expectedText, 'PRODUCT: code wrapper must include the complete displayed commands')
      assert.deepEqual(Array.from(code.childNodes), page.originalNodes, 'all original nodes must move in their original order')
      assert.equal(code.querySelector('strong'), page.originalStrong, 'preserve original inline markup/node identity')
      assert.equal(page.pre.childNodes.length, 1, 'no command suffix may remain outside the code wrapper')
      const button = page.pre.parentNode.querySelector('.copy-button')
      assert.ok(button)
      button.click()
      await Promise.resolve()
      assert.deepEqual(page.writes, [expectedCommand], 'copy complete console commands, retaining existing prompt stripping')
      assert.deepEqual(page.errors, [])
    } finally {
      page.window.close()
    }
  })

  for (const scenario of [
    { name: 'plain single-text literal', input: plainLiteral },
    { name: 'existing source console', input: sourceConsole },
  ]) {
    test(language + ': control ' + scenario.name, async () => {
      const page = await initialize(language, scenario.input)
      try {
        const code = page.pre.querySelector('code')
        assert.equal(code.textContent, expectedText)
        page.pre.parentNode.querySelector('.copy-button').click()
        await Promise.resolve()
        assert.deepEqual(page.writes, [expectedCommand])
        assert.deepEqual(page.errors, [])
      } finally {
        page.window.close()
      }
    })
  }

  test(language + ': control absent Clipboard API retains displayed command text', async () => {
    const page = await initialize(language, plainLiteral, 'absent')
    try {
      assert.equal(page.pre.parentNode.querySelector('.copy-button'), null)
      assert.equal(page.pre.textContent, expectedText)
      assert.deepEqual(page.writes, [])
    } finally {
      page.window.close()
    }
  })

  test(language + ': control rejected clipboard does not signal success', async () => {
    const page = await initialize(language, plainLiteral, 'reject')
    try {
      const button = page.pre.parentNode.querySelector('.copy-button')
      button.click()
      await Promise.resolve()
      assert.deepEqual(page.writes, [expectedCommand])
      assert.equal(button.className, 'copy-button')
      assert.deepEqual(page.errors, [])
    } finally {
      page.window.close()
    }
  })
}
