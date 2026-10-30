'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
// Reuse a real existing dependency tree; do not substitute parser/renderer shims.
const dependencies = createRequire(path.join(process.env.DOC_TOOL_MODULE_ROOT || root, 'package.json'))
const asciidoctor = dependencies('@asciidoctor/core')()
const handlebars = dependencies('handlebars')

for (const language of ['cn', 'en']) {
  const ui = path.join(process.env.DOC_UI_ROOT || root, `${language}templates`)
  const hbs = handlebars.create()
  hbs.registerHelper('detag', require(path.join(ui, 'helpers/detag.js')))
  hbs.registerHelper('or', require(path.join(ui, 'helpers/or.js')))
  const template = hbs.compile(fs.readFileSync(path.join(ui, 'partials/head-title.hbs'), 'utf8'))

  for (const [label, markup] of [
    ['double quoted attribute', '<span data-meaning="left > right">Quoted</span>'],
    ['single quoted attribute', "<span data-meaning='left > right'>Quoted</span>"],
  ]) {
    test(`${language}: generated title strips tags with ${label}`, () => {
      // Inline passthrough is an existing AsciiDoc input form, not a mocked
      // Antora title producer. Preserve and inspect its actual converted title.
      const document = asciidoctor.load(`= pass:[${markup}]\n\nBody.`, { safe: 'safe' })
      const title = document.getDocumentTitle()
      assert.equal(typeof title, 'string')
      assert.ok(title.includes('left > right'), `producer did not preserve the trigger: ${title}`)
      const html = template({ page: { title }, site: { title: 'IvorySQL' } }).trim()
      assert.equal(html, '<title>Quoted :: IvorySQL</title>')
    })
  }

  test(`${language}: ordinary converted title and fallback stay unchanged`, () => {
    const title = asciidoctor.load('= Plain *bold* title\n\nBody.').getDocumentTitle()
    assert.equal(
      template({ page: { title }, site: { title: 'IvorySQL' } }).trim(),
      '<title>Plain bold title :: IvorySQL</title>'
    )
    assert.equal(
      template({ page: {}, defaultPageTitle: 'Fallback' }).trim(),
      '<title>Fallback</title>'
    )
  })
}
