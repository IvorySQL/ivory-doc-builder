'use strict'

// Exercise the actual Antora producer and original pagination partial.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const test = require('node:test')

const sourceRoot = path.resolve(process.env.RELATIVIZE_SOURCE_ROOT || path.join(__dirname, '..'))
const dependencyRoot = path.resolve(process.env.RELATIVIZE_DEPENDENCY_ROOT || sourceRoot)
const dependencyRequire = createRequire(path.join(dependencyRoot, 'package.json'))
const ContentCatalog = dependencyRequire('@antora/content-classifier/content-catalog')
const loadAsciiDoc = dependencyRequire('@antora/asciidoc-loader')
const buildNavigation = dependencyRequire('@antora/navigation-builder')
const { buildBaseUiModel, buildUiModel } = dependencyRequire('@antora/page-composer/build-ui-model')
const Handlebars = dependencyRequire('handlebars')

function produceUiModel (style, fromRelative, toRelative, fragment) {
  const playbook = {
    site: { title: 'Template fixture', url: 'https://example.test' },
    urls: { htmlExtensionStyle: style },
    ui: { outputDir: '_', defaultLayout: 'default' },
    env: {},
  }
  const catalog = new ContentCatalog(playbook)
  const componentVersion = catalog.registerComponentVersion('docs', '1.0')
  const pages = new Map()
  for (const relative of ['index.adoc', 'guide.adoc', 'guide/index.adoc', 'other.adoc']) {
    const file = catalog.addFile({
      path: 'modules/ROOT/pages/' + relative,
      src: { component: 'docs', version: '1.0', module: 'ROOT', family: 'page', relative },
      contents: Buffer.from('= ' + relative + '\n:page-pagination:\n\n== Section\n\nBody.\n'),
    })
    file.asciidoc = loadAsciiDoc.extractAsciiDocMetadata(loadAsciiDoc(file, catalog))
    pages.set(relative, file)
  }
  catalog.registerComponentVersionStartPage('docs', componentVersion)
  const navFile = catalog.addFile({
    path: 'modules/ROOT/nav.adoc',
    src: { component: 'docs', version: '1.0', module: 'ROOT', family: 'nav', relative: 'nav.adoc' },
    contents: Buffer.from('* xref:' + fromRelative + '[Current]\n* xref:' + toRelative + fragment + '[Target]\n'),
    nav: { index: 0 },
  })
  assert.equal(navFile.src.family, 'nav')
  const navigation = buildNavigation(catalog)
  const from = pages.get(fromRelative)
  const to = pages.get(toRelative)
  const model = buildUiModel(buildBaseUiModel(playbook, catalog), from, catalog, navigation)
  // Producer prerequisites, distinct from the product-link assertion below.
  assert.equal(model.page.url, from.pub.url)
  assert.ok(model.page.next, 'real navigation must produce a next-page entry')
  assert.equal(model.page.next.urlType, 'internal')
  assert.equal(model.page.next.url, to.pub.url + fragment)
  assert.equal(model.page.attributes.pagination, '')
  return { model, target: to.pub.url + fragment }
}

function renderPagination (language, model) {
  const handlebars = Handlebars.create()
  for (const helper of ['relativize', 'eq', 'or']) {
    handlebars.registerHelper(helper, require(path.join(sourceRoot, language, 'helpers', helper + '.js')))
  }
  const template = fs.readFileSync(path.join(sourceRoot, language, 'partials', 'pagination.hbs'), 'utf8')
  return handlebars.compile(template)(model)
}

for (const language of ['entemplates', 'cntemplates']) {
  for (const fragment of ['', '#section']) {
    test(language + ': drop directory index links to extensionless sibling ' + (fragment || '(no fragment)'), () => {
      const { model, target } = produceUiModel('drop', 'guide/index.adoc', 'guide.adoc', fragment)
      assert.equal(model.page.url, '/docs/1.0/guide/')
      assert.equal(target, '/docs/1.0/guide' + fragment)
      const rendered = renderPagination(language, model)
      const href = rendered.match(/class="next"><a href="([^"]+)"/)
      assert.ok(href, rendered)
      assert.equal(href[1], '../guide' + fragment)
      assert.equal(new URL(href[1], 'https://example.test' + model.page.url).href,
        'https://example.test' + target)
    })
  }

  for (const control of [
    { style: 'default', from: 'guide/index.adoc', to: 'guide.adoc' },
    { style: 'drop', from: 'guide.adoc', to: 'guide/index.adoc' },
    { style: 'drop', from: 'guide/index.adoc', to: 'other.adoc' },
  ]) {
    test(language + ': control ' + control.style + ' ' + control.from + ' -> ' + control.to, () => {
      const { model, target } = produceUiModel(control.style, control.from, control.to, '')
      const rendered = renderPagination(language, model)
      const href = rendered.match(/class="next"><a href="([^"]+)"/)
      assert.ok(href, rendered)
      assert.equal(new URL(href[1], 'https://example.test' + model.page.url).href,
        'https://example.test' + target)
    })
  }
}
