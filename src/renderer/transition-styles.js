// Kieu chuyen canh "cross" (filter xfade cua FFmpeg). Id phai khop danh sach XFADE_STYLES o electron/ffmpeg-ops.cjs,
// vi main process chi ghep ten nay vao filtergraph khi no nam trong danh sach (test-static kiem tra hai ben khop nhau).
export const DEFAULT_TRANSITION_STYLE = 'fade'

export const TRANSITION_STYLES = Object.freeze([
  { id: 'fade', key: 'trans_style_fade' },
  { id: 'dissolve', key: 'trans_style_dissolve' },
  { id: 'wipeleft', key: 'trans_style_wipeleft' },
  { id: 'wiperight', key: 'trans_style_wiperight' },
  { id: 'wipeup', key: 'trans_style_wipeup' },
  { id: 'wipedown', key: 'trans_style_wipedown' },
  { id: 'slideleft', key: 'trans_style_slideleft' },
  { id: 'slideright', key: 'trans_style_slideright' },
  { id: 'slideup', key: 'trans_style_slideup' },
  { id: 'slidedown', key: 'trans_style_slidedown' },
  { id: 'circleopen', key: 'trans_style_circleopen' },
  { id: 'circleclose', key: 'trans_style_circleclose' },
  { id: 'radial', key: 'trans_style_radial' },
  { id: 'pixelize', key: 'trans_style_pixelize' },
  { id: 'zoomin', key: 'trans_style_zoomin' }
])
