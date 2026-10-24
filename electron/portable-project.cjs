const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const projectStore = require('./project-store.cjs')

function cloneProject(project) { return JSON.parse(JSON.stringify(project)) }

function forEachAsset(project, visit) {
  for (const scope of [project, ...(Array.isArray(project.timelines) ? project.timelines : [])]) {
    for (const clip of scope.clips || []) visit(clip, 'clip')
    for (const item of scope.videoOverlays || []) if (!item?.sticker) visit(item, 'video overlay')
    for (const item of scope.audioItems || []) visit(item, 'audio item')
  }
  for (const asset of project.assets || []) visit(asset, 'library asset')
  if (project.music?.path) visit(project.music, 'music')
  if (project.voice?.path) visit(project.voice, 'voice')
}

function resolveProjectPaths(project, baseDirectory) {
  const resolved = cloneProject(project)
  forEachAsset(resolved, (asset) => {
    if (typeof asset.path === 'string' && asset.path && !path.isAbsolute(asset.path)) {
      asset.path = path.resolve(baseDirectory, asset.path)
    }
  })
  return resolved
}

function projectAssetEntries(project) {
  const entries = []
  const seen = new Set()
  forEachAsset(project, (asset, kind) => {
    if (typeof asset.path !== 'string' || !asset.path.trim()) throw new Error(`Thiếu đường dẫn media (${kind}).`)
    const absolutePath = path.resolve(asset.path)
    const key = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ source: absolutePath, key, name: asset.name || path.basename(absolutePath) })
  })
  return entries
}

function safeFilename(value) {
  const base = path.basename(String(value || 'media')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '')
  if (!base) return 'media'
  if (base.length <= 160) return base
  const extension = path.extname(base).slice(0, 24)
  return `${base.slice(0, Math.max(1, 160 - extension.length))}${extension}`
}

function collectProject(project, targetProjectPath) {
  const target = path.resolve(targetProjectPath)
  const base = path.dirname(target)
  const name = path.basename(target, path.extname(target)) || 'TaoClip'
  const entries = projectAssetEntries(project)
  for (const entry of entries) {
    let stat
    try { stat = fs.statSync(entry.source) } catch { throw new Error(`Không tìm thấy media để thu thập: ${entry.name}`) }
    if (!stat.isFile()) throw new Error(`Media không phải file thường: ${entry.name}`)
    entry.size = stat.size
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
  fs.mkdirSync(base, { recursive: true })
  if (typeof fs.statfsSync === 'function') {
    const { bavail, bsize } = fs.statfsSync(base)
    const freeBytes = Number(bavail) * Number(bsize)
    if (Number.isFinite(freeBytes) && totalBytes > freeBytes) throw new Error(`Không đủ dung lượng: cần ${totalBytes} byte, còn ${Math.floor(freeBytes)} byte.`)
  }

  const token = crypto.randomUUID()
  const stagingDirectory = path.join(base, `.taoclip-collect-${token}`)
  const assetDirectoryName = `${safeFilename(name)}_assets_${token.slice(0, 8)}`
  const assetDirectory = path.join(base, assetDirectoryName)
  const pathMap = new Map()
  let published = false
  fs.mkdirSync(stagingDirectory, { recursive: false })
  try {
    entries.forEach((entry, index) => {
      const filename = `${String(index + 1).padStart(4, '0')}-${safeFilename(entry.name)}`
      const staged = path.join(stagingDirectory, filename)
      fs.copyFileSync(entry.source, staged, fs.constants.COPYFILE_EXCL)
      const copied = fs.statSync(staged)
      if (copied.size !== entry.size) throw new Error(`Bản sao media không đầy đủ: ${entry.name}`)
      pathMap.set(entry.key, path.join(assetDirectory, filename))
    })

    const collected = cloneProject(project)
    forEachAsset(collected, (asset) => {
      const absolutePath = path.resolve(asset.path)
      const key = process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
      asset.path = pathMap.get(key)
    })
    fs.renameSync(stagingDirectory, assetDirectory)
    const storedPath = projectStore.writeProject(target, collected)
    published = true
    return { filePath: storedPath, project: resolveProjectPaths(projectStore.readProject(storedPath), base), assetDirectory }
  } catch (error) {
    try { fs.rmSync(stagingDirectory, { recursive: true, force: true }) } catch {}
    // The collection folder is unique to this operation. Remove it only when
    // publishing the project failed; user files and earlier collections stay untouched.
    if (!published && fs.existsSync(assetDirectory)) {
      try { fs.rmSync(assetDirectory, { recursive: true, force: true }) } catch {}
    }
    throw error
  }
}

module.exports = { collectProject, resolveProjectPaths }
