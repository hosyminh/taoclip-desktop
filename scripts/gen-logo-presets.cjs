// Tao bo logo mau (hinh hoc, khong chu, khong nhan hieu ben thu ba) bang sharp -> src/renderer/public/logos/presets/<hinh>-<mau>.png
// Moi hinh co hai mau: white (#ffffff) va blue (#3a7afe). Kich thuoc 512x512, nen trong suot.
// Chay lai khi sua hinh: node scripts/gen-logo-presets.cjs
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'src', 'renderer', 'public', 'logos', 'presets')
const COLORS = { white: '#ffffff', blue: '#3a7afe' }

// Moi hinh la mot phan tu SVG ben trong khung 512x512; {c} la mau to
const SHAPES = {
  circle: '<circle cx="256" cy="256" r="196" fill="{c}"/>',
  ring: '<circle cx="256" cy="256" r="174" fill="none" stroke="{c}" stroke-width="48"/>',
  play: '<polygon points="160,116 390,256 160,396" fill="{c}" stroke="{c}" stroke-width="44" stroke-linejoin="round"/>',
  wave: '<g fill="{c}"><rect x="66" y="206" width="52" height="100" rx="26"/><rect x="146" y="150" width="52" height="212" rx="26"/><rect x="226" y="86" width="52" height="340" rx="26"/><rect x="306" y="150" width="52" height="212" rx="26"/><rect x="386" y="206" width="52" height="100" rx="26"/></g>',
  star: '<polygon points="256,56 310,192 456,200 342,292 382,436 256,356 130,436 170,292 56,200 202,192" fill="{c}" stroke="{c}" stroke-width="28" stroke-linejoin="round"/>',
  diamond: '<polygon points="256,62 450,256 256,450 62,256" fill="{c}" stroke="{c}" stroke-width="28" stroke-linejoin="round"/>',
  hexagon: '<polygon points="256,60 436,158 436,354 256,452 76,354 76,158" fill="{c}" stroke="{c}" stroke-width="28" stroke-linejoin="round"/>',
  frame: '<rect x="76" y="76" width="360" height="360" rx="92" fill="none" stroke="{c}" stroke-width="48"/>',
  bolt: '<polygon points="300,46 128,290 248,290 212,466 386,214 262,214" fill="{c}" stroke="{c}" stroke-width="24" stroke-linejoin="round"/>',
  verified: '<circle cx="256" cy="256" r="180" fill="none" stroke="{c}" stroke-width="40"/><polyline points="168,262 230,324 350,194" fill="none" stroke="{c}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>',
  heart: '<path d="M256,438 C256,438 56,314 56,186 C56,118 108,68 170,68 C210,68 240,92 256,124 C272,92 302,68 342,68 C404,68 456,118 456,186 C456,314 256,438 256,438 Z" fill="{c}"/>',
  peak: '<polygon points="52,414 200,150 284,278 336,200 460,414" fill="{c}" stroke="{c}" stroke-width="24" stroke-linejoin="round"/>'
}

function svgFor(shape, color) {
  const body = SHAPES[shape].split('{c}').join(COLORS[color])
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${body}</svg>`
}

;(async () => {
  fs.mkdirSync(dir, { recursive: true })
  for (const shape of Object.keys(SHAPES)) {
    for (const color of Object.keys(COLORS)) {
      await sharp(Buffer.from(svgFor(shape, color)), { density: 72 })
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toFile(path.join(dir, `${shape}-${color}.png`))
    }
  }
  console.log(`Da tao ${Object.keys(SHAPES).length * Object.keys(COLORS).length} logo mau trong ${path.relative(process.cwd(), dir)}`)
})().catch((error) => { console.error('Loi tao logo mau:', error.message); process.exit(1) })
