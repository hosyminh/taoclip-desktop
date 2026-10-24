// Thu vien logo cua nguoi dung: file PNG luu trong userData/logos, danh sach trong index.json.
// Renderer chi nhan duong dan cua file da luu; SVG duoc rasterize o renderer truoc khi luu thanh PNG.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_BYTES = 8 * 1024 * 1024
const MAX_SIDE = 8000
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let root = null
let presetDir = null
function configure(userDataDir, presetsPath) {
  root = path.join(userDataDir, 'logos')
  presetDir = presetsPath || null
}

function indexFile() { return path.join(root, 'index.json') }
function readIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')) } catch { return [] }
}
function writeIndex(items) {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(indexFile(), JSON.stringify(items, null, 2), 'utf8')
}

// Doc kich thuoc tu IHDR cua PNG (byte 16-23); tra ve null neu khong phai PNG hop le
function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function toEntry(item) {
  return { id: item.id, name: item.name, path: path.join(root, item.file), width: item.width, height: item.height }
}

function list() {
  return readIndex().filter((item) => fs.existsSync(path.join(root, item.file))).map(toEntry)
}

function save({ name, pngBase64, source }) {
  if (typeof pngBase64 !== 'string' || !pngBase64) throw new Error('Logo không hợp lệ.')
  const buf = Buffer.from(pngBase64, 'base64')
  if (buf.length > MAX_BYTES) throw new Error('Logo quá lớn (tối đa 8 MB).')
  const size = pngSize(buf)
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_SIDE || size.height > MAX_SIDE) {
    throw new Error('Logo phải là ảnh PNG hợp lệ.')
  }
  const id = crypto.randomUUID()
  const file = `${id}.png`
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, file), buf)
  const cleanName = String(name || 'logo').trim().slice(0, 80) || 'logo'
  const item = { id, name: cleanName, file, width: size.width, height: size.height, ...(typeof source === 'string' ? { source } : {}) }
  writeIndex([...readIndex(), item])
  return toEntry(item)
}

// Mau co san (scripts/gen-logo-presets.cjs): sao chep vao thu vien, moi mau chi mot ban (nhan biet qua source = preset:<id>)
function usePreset(id) {
  if (!presetDir || typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('Mẫu logo không hợp lệ.')
  const source = `preset:${id}`
  const existing = readIndex().find((item) => item.source === source && fs.existsSync(path.join(root, item.file)))
  if (existing) return toEntry(existing)
  const file = path.join(presetDir, `${id}.png`)
  if (!fs.existsSync(file)) throw new Error('Không tìm thấy mẫu logo.')
  return save({ name: id, pngBase64: fs.readFileSync(file).toString('base64'), source })
}

function remove(id) {
  const items = readIndex()
  const item = items.find((candidate) => candidate.id === id)
  if (!item) return false
  try { fs.rmSync(path.join(root, item.file), { force: true }) } catch {}
  writeIndex(items.filter((candidate) => candidate.id !== id))
  return true
}

module.exports = { configure, list, save, remove, usePreset, pngSize, MAX_BYTES }
