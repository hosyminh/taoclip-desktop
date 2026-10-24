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

// 1a) Khong dung bien chua khai bao (vd sot lai ten sau khi xoa state): chi cho phep cac global cua trinh duyet / ES
const KNOWN_GLOBALS = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'ResizeObserver', 'Audio', 'Image', 'console', 'Math', 'JSON', 'Number', 'String', 'Array',
  'Object', 'Set', 'Map', 'WeakMap', 'Promise', 'Date', 'Error', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Infinity', 'NaN', 'undefined', 'Boolean',
  'globalThis', 'Intl', 'URL', 'Event', 'KeyboardEvent', 'MouseEvent', 'DataTransfer', 'File', 'FileReader', 'Blob', 'encodeURI', 'decodeURI',
  'encodeURIComponent', 'decodeURIComponent', 'Symbol', 'RegExp', 'Function', 'crypto', 'fetch', 'AbortController', 'structuredClone', 'queueMicrotask', 'CSS', 'getComputedStyle',
  'WeakSet', 'Uint8Array', 'Float32Array', 'ArrayBuffer', 'TextEncoder', 'TextDecoder', 'Reflect', 'Proxy', 'BigInt'])
const undeclared = []
for (const [file, ast] of asts) {
  babel.traverse(ast, {
    Program(programPath) {
      for (const name of Object.keys(programPath.scope.globals)) {
        if (!KNOWN_GLOBALS.has(name)) undeclared.push(`${path.relative(__dirname, file)}: '${name}' chua duoc khai bao`)
      }
    }
  })
}
check('renderer khong dung bien chua khai bao', undeclared.length === 0, undeclared)

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

// 3) Kieu chuyen canh: danh sach ben renderer phai khop allowlist XFADE_STYLES o main (ten duoc ghep vao filtergraph), va moi nhan deu co trong i18n
const styleSource = fs.readFileSync(path.join(rendererDir, 'transition-styles.js'), 'utf8')
const rendererStyles = [...styleSource.matchAll(/\{ id: '([a-z]+)', key: '([a-z_]+)' \}/g)].map((m) => ({ id: m[1], key: m[2] }))
const mainSetMatch = /XFADE_STYLES = new Set\(\[([^\]]*)\]\)/.exec(fs.readFileSync(path.join(__dirname, 'electron', 'ffmpeg-ops.cjs'), 'utf8'))
const mainStyleIds = mainSetMatch ? [...mainSetMatch[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]) : []
const sortedRenderer = rendererStyles.map((s) => s.id).sort()
const sortedMain = [...mainStyleIds].sort()
check('kieu chuyen canh o renderer khop XFADE_STYLES o electron/ffmpeg-ops.cjs', rendererStyles.length > 0 && JSON.stringify(sortedRenderer) === JSON.stringify(sortedMain),
  [`renderer: ${sortedRenderer.join(', ')}`, `main: ${sortedMain.join(', ')}`])
const styleKeysMissing = rendererStyles.flatMap(({ key }) => ['vi', 'en'].filter((lang) => !dictionaries[lang].has(key)).map((lang) => `${key} (${lang})`))
check(`moi nhan kieu chuyen canh (${rendererStyles.length} kieu) deu co trong i18n vi va en`, styleKeysMissing.length === 0, styleKeysMissing)

// 4) Sticker: moi id trong sticker-catalog.js co anh PNG, va moi nhom sticker co nhan trong i18n
const catalogSource = fs.readFileSync(path.join(rendererDir, 'sticker-catalog.js'), 'utf8')
const stickerIds = [...catalogSource.matchAll(/\{ id: 'twemoji\/([0-9a-f]+)', char: '[^']*' \}/g)].map((m) => m[1])
const missingPng = stickerIds.filter((hex) => !fs.existsSync(path.join(rendererDir, 'public', 'stickers', 'twemoji', `${hex}.png`)))
check(`moi sticker (${stickerIds.length}) co anh PNG trong public/stickers`, stickerIds.length > 0 && missingPng.length === 0, missingPng)
const groupKeys = [...catalogSource.matchAll(/key: '(sticker_group_[a-z]+)'/g)].map((m) => m[1])
const groupKeysMissing = groupKeys.flatMap((key) => ['vi', 'en'].filter((lang) => !dictionaries[lang].has(key)).map((lang) => `${key} (${lang})`))
check(`moi nhom sticker (${groupKeys.length}) co nhan trong i18n vi va en`, groupKeys.length > 0 && groupKeysMissing.length === 0, groupKeysMissing)

// 5) Logo mau: moi mau co anh PNG; moi hinh va mau co nhan trong i18n (LogoTab goi t('logo_shape_<hinh>') theo mau dong)
const presetSource = fs.readFileSync(path.join(rendererDir, 'logo-presets.js'), 'utf8')
const presetList = (name) => [...presetSource.matchAll(new RegExp(name + ' = \\[([^\\]]*)\\]', 'g'))].flatMap((m) => [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]))
const presetShapes = presetList('LOGO_PRESET_SHAPES')
const presetColors = presetList('LOGO_PRESET_COLORS')
const presetFiles = presetShapes.flatMap((shape) => presetColors.map((color) => `${shape}-${color}`))
const missingPresetPng = presetFiles.filter((id) => !fs.existsSync(path.join(rendererDir, 'public', 'logos', 'presets', `${id}.png`)))
check(`moi logo mau (${presetFiles.length}) co anh PNG trong public/logos/presets`, presetFiles.length > 0 && missingPresetPng.length === 0, missingPresetPng)
const presetKeys = [...presetShapes.map((shape) => `logo_shape_${shape}`), ...presetColors.map((color) => `logo_color_${color}`)]
const presetKeysMissing = presetKeys.flatMap((key) => ['vi', 'en'].filter((lang) => !dictionaries[lang].has(key)).map((lang) => `${key} (${lang})`))
check(`moi nhan logo mau (${presetKeys.length}) co trong i18n vi va en`, presetKeys.length > 0 && presetKeysMissing.length === 0, presetKeysMissing)

// Xuat: moi thuoc tinh cua lop hinh phai duoc map tu state sang payload gui bo ghep (de quen thi xoay / lat / mo chi co o xem truoc)
const appSource = fs.readFileSync(path.join(rendererDir, 'App.jsx'), 'utf8')
const overlayProps = ['rotation', 'flipH', 'flipV', 'fadeIn', 'fadeOut', 'opacity', 'width', 'height', 'sticker']
const exportMap = /videoOverlays: withLayerZIndex\(videoOverlays, tracks\)[^\n]*\.map\(\(\{([^}]*)\}\) => \(\{\s*([^}]*)\}\)\)/.exec(appSource)
const hasProp = (text, prop) => new RegExp('\\b' + prop + '\\b').test(text)
check('xuat truyen du thuoc tinh lop hinh (xoay, lat, mo vao / ra, trong suot, kich thuoc, sticker) cho bo ghep',
  !!exportMap && overlayProps.every((prop) => hasProp(exportMap[1], prop) && hasProp(exportMap[2], prop)),
  exportMap ? overlayProps.filter((prop) => !hasProp(exportMap[2], prop)) : ['khong tim thay doan map videoOverlays khi xuat'])

console.log(`\n================  ${pass} PASS / ${fail} FAIL  ================`)
process.exit(fail ? 1 : 0)
