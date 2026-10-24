// Logo mau co san: PNG tao boi scripts/gen-logo-presets.cjs trong src/renderer/public/logos/presets/<hinh>-<mau>.png.
// Chon mot mau se sao chep file vao thu vien logo cua nguoi dung (main: logos:usePreset) roi dung nhu logo thuong.
export const LOGO_PRESET_SHAPES = ['circle', 'ring', 'play', 'wave', 'star', 'diamond', 'hexagon', 'frame', 'bolt', 'verified', 'heart', 'peak']
export const LOGO_PRESET_COLORS = ['white', 'blue']

export const LOGO_PRESETS = LOGO_PRESET_SHAPES.flatMap((shape) => LOGO_PRESET_COLORS.map((color) => ({ id: `${shape}-${color}`, shape, color })))

// URL tuong doi voi trang hien tai (dev: http://localhost, build: file:// -> dist)
export function logoPresetUrl(id) { return new URL(`logos/presets/${id}.png`, document.baseURI).href }
