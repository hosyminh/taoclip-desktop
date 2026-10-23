// ============================================================
//  Kiem tra tinh cho renderer (khong can mo app):
//    node test-static.cjs
//  1) Khong co bien const/let nao duoc dung luc render truoc khi khai bao (loi TDZ lam trang trang
//     ngay khi mo app, vi du mang phu thuoc cua useEffect/useCallback tham chieu hook khai bao sau).
//  2) Moi khoa t('...') trong code deu co trong i18n (vi), va ban en khong thieu khoa nao cua vi.
// ============================================================
const fs = require('fs')
const path = require('path')
const babel = require('@babel/core')

const rendererDir = path.join(__dirname, 'src', 'renderer')
const parse = (file) => babel.parseSync(fs.readFileSync(file, 'utf8'), {
  filename: file, sourceType: 'module', configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] }
})
function listSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSources(full)
    return /\.(jsx?|mjs)$/.test(entry.name) ? [full] : []
  })
}

let pass = 0, fail = 0
function check(name, ok, detail = []) {
  if (ok) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name) } else {
    fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name)
    for (const line of detail.slice(0, 25)) console.log('       ' + line)
    if (detail.length > 25) console.log(`       ... va ${detail.length - 25} muc nua`)
  }
}

const sources = listSources(rendererDir)
const asts = new Map(sources.map((file) => [file, parse(file)]))

// 1) TDZ luc render
const tdz = []
for (const [file, ast] of asts) {
  babel.traverse(ast, {
    Function(fnPath) {
      for (const [name, binding] of Object.entries(fnPath.scope.bindings)) {
        if (binding.kind !== 'const' && binding.kind !== 'let') continue
        for (const ref of binding.referencePaths) {
          if (ref.node.start >= binding.path.node.start) continue
          const enclosing = ref.getFunctionParent()
          if (enclosing && enclosing.node === fnPath.node) {
            tdz.push(`${path.relative(__dirname, file)}: ${name} dung o dong ${ref.node.loc.start.line} nhung khai bao o dong ${binding.path.node.loc.start.line}`)
          }
        }
      }
    }
  })
}
check('renderer khong dung const/let truoc khi khai bao luc render (TDZ)', tdz.length === 0, tdz)

// 1b) Media cuc bo phai di qua fileUrl() (taoclip-media://); file:// bi chan khi chay dev (http://localhost)
const rawFileUrls = []
for (const file of sources) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/['"`]file:\/\//.test(line)) rawFileUrls.push(`${path.relative(__dirname, file)}:${index + 1}: ${line.trim().slice(0, 100)}`)
  })
}
check('renderer khong tu dung URL file:// (dung fileUrl() -> taoclip-media://)', rawFileUrls.length === 0, rawFileUrls)

// 2) Khoa i18n
const i18nFile = path.join(rendererDir, 'i18n.jsx')
const dictionaries = {}
babel.traverse(asts.get(i18nFile), {
  VariableDeclarator(p) {
    if (p.node.id.name !== 'STR' || p.node.init?.type !== 'ObjectExpression') return
    for (const lang of p.node.init.properties) {
      const code = lang.key.name || lang.key.value
      dictionaries[code] = new Set(lang.value.properties.map((prop) => prop.key.name || prop.key.value))
    }
  }
})
check('i18n co du lieu vi va en', !!dictionaries.vi?.size && !!dictionaries.en?.size)
const used = new Map()
for (const [file, ast] of asts) {
  if (file === i18nFile) continue
  babel.traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee
      const arg = p.node.arguments[0]
      if (callee.type === 'Identifier' && callee.name === 't' && arg?.type === 'StringLiteral') {
        if (!used.has(arg.value)) used.set(arg.value, `${path.relative(__dirname, file)}:${arg.loc.start.line}`)
      }
    }
  })
}
const undefinedKeys = [...used].filter(([key]) => !dictionaries.vi.has(key)).map(([key, where]) => `${key} (${where})`)
check(`moi khoa t('...') (${used.size} khoa) deu co trong ban vi`, undefinedKeys.length === 0, undefinedKeys)
const missingEn = [...dictionaries.vi].filter((key) => !dictionaries.en.has(key))
check('ban en khong thieu khoa nao cua ban vi', missingEn.length === 0, missingEn)

console.log(`\n================  ${pass} PASS / ${fail} FAIL  ================`)
process.exit(fail ? 1 : 0)
