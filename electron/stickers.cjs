// Sticker tinh (anh Twemoji) tren track V2. Khong co path trong project; main doc file tu thu muc sticker.
// Anh co the nam trong app.asar (ban dong goi) ma ffmpeg khong doc duoc file trong asar,
// nen copy ra thu muc tam truoc khi ghep V2.
const fs = require('fs')
const path = require('path')

const STICKER_ID = /^twemoji\/[0-9a-f]+$/

function stickerSource(id, baseDir) {
  if (typeof id !== 'string' || !STICKER_ID.test(id)) throw new Error('Sticker khong hop le.')
  return path.join(baseDir, 'stickers', `${id}.png`)
}

// Tra ve danh sach item V2: item sticker duoc gan path la file PNG da copy vao dir
function materializeStickers(items, dir, baseDir) {
  return (items || []).map((item) => {
    if (!item || !item.sticker) return item
    const target = path.join(dir, `${item.sticker.replace('/', '-')}.png`)
    if (!fs.existsSync(target)) fs.writeFileSync(target, fs.readFileSync(stickerSource(item.sticker, baseDir)))
    return { ...item, path: target }
  })
}

module.exports = { STICKER_ID, stickerSource, materializeStickers }
