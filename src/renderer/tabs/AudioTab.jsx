import React, { useState } from 'react'
import { X, ChevronDown, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { SLIDE_DURS } from '../utils.js'

// Muc gap/mo cho tab Am thanh (tab dai, chia section de de quet)
function Sec({ id, title, acc, setAcc, children }) {
  const on = !!acc[id]
  return (
    <div className={`acc ${on ? 'open' : ''}`}>
      <button className="acc-head" onClick={() => setAcc((a) => ({ ...a, [id]: !a[id] }))}>
        {on ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>{title}</span>
      </button>
      {on && <div className="acc-body">{children}</div>}
    </div>
  )
}

// Tab Am thanh: nhac nen + long tieng AI (2 track DOC LAP, tron cung luc khi xuat)
export default function AudioTab({
  hasClips, anyAudio, imageCount,
  // slideshow sync
  syncMode, setSyncMode, setSlideDur, setAllSlideDur, fitSlideDuration = 0, fitMusicDuration = 0, hasFitMusic = false, timelineDuration = 0,
  // 2 track
  origVolume, setOrigVolume, ducking, setDucking, importMusic,
  audioItems = [], addAudioItems, updateAudioItem, removeAudioItem,
  // TTS
  ttsText, setTtsText, ttsBusy, ttsStatus, ttsEngine, setTtsEngine,
  ttsVoice, setTtsVoice, ttsVoices, ttsRate, setTtsRate, ttsPitch, setTtsPitch,
  apiKeyInput, setApiKeyInput, hasKey, apiKeyStatus = {}, removeApiKey = () => {}, voicesLoading,
  localTtsModel, refreshLocalTtsModel = () => {},
  saveApiKey, loadVoices, previewVoice, genTTS, ttsPreviewRef,
  // doi giong video (re-dub)
  redubBusy, redubStatus, redubVideo, redubSegments = [], setRedubSegments = () => {}, generateRedubSegment = () => {},
  applyRedub = () => {}, previewRedubSegment = () => {}, redubKeepOriginal = false, setRedubKeepOriginal = () => {}, beginEdit = () => {}, endEdit = () => {}, pushHistory = () => {}
}) {
  const { t } = useI18n()
  const [acc, setAcc] = useState({ music: true, tts: true, redub: false, slide: true })
  const hasMusicTrack = audioItems.some((item) => item.track === 'music')
  const hasVoiceTrack = audioItems.some((item) => item.track === 'voice')
  const selectedVoice = ttsVoices.find((v) => v.name === ttsVoice)
  return (
    <div className="cc-cap">
      <small className="cap-hint">{t('audio_hint')}</small>

      {imageCount > 0 && (
        <Sec id="slide" title={t('slide_sync')} acc={acc} setAcc={setAcc}>
          <div className="seg">
            <button className={syncMode === 'fit' ? 'on' : ''} onClick={() => setSyncMode('fit')} disabled={!hasFitMusic || !fitMusicDuration}>{t('sync_fit')}</button>
            <button className={syncMode === 'fixed' ? 'on' : ''} onClick={() => setSyncMode('fixed')}>{t('sync_fixed')}</button>
          </div>
          {syncMode === 'fit'
            ? <><small className="cap-hint">{hasFitMusic && fitMusicDuration ? t('sync_fit_info', { d: fitMusicDuration.toFixed(1), n: imageCount, p: fitSlideDuration.toFixed(1) }) : t('sync_need_music')}</small>
                {hasFitMusic && fitMusicDuration > 0 && <small className="cap-hint">{t('audio_canvas_target', { c: timelineDuration.toFixed(1), m: fitMusicDuration.toFixed(1) })}</small>}</>
            : <><label className="vlbl" style={{ marginTop: 6 }}>{t('slide_dur')}</label>
              <div className="seg wrap">{SLIDE_DURS.map((s) => <button key={s} onClick={() => setSlideDur(s)}>{s}s</button>)}</div></>}
        </Sec>
      )}

      <Sec id="music" title={t('audio_music_title')} acc={acc} setAcc={setAcc}>
        <button className="cc-import" onClick={importMusic} disabled={!hasClips}>{t('music_import')}</button>
      </Sec>

      <Sec id="audio-items" title={t('audio_items_title')} acc={acc} setAcc={setAcc}>
        <div className="cc-import-row">
          <button className="cc-import" onClick={() => addAudioItems('music')} disabled={!hasClips}>{t('audio_add_music_items')}</button>
          <button className="cc-import alt" onClick={() => addAudioItems('voice')} disabled={!hasClips}>{t('audio_add_voice_items')}</button>
        </div>
        {!audioItems.length && <small className="cap-hint">{t('audio_items_hint')}</small>}
      </Sec>

      <Sec id="tts" title={t('tts_label')} acc={acc} setAcc={setAcc}>
        <label className="vlbl">{t('tts_engine')}</label>
        <select className="cc-select" value={ttsEngine} onChange={(e) => setTtsEngine(e.target.value)} disabled={ttsBusy}>
          <option value="local">{t('tts_eng_local')}</option>
          <option value="google">{t('tts_eng_google')}</option>
        </select>
        {ttsEngine === 'google' && (
          <div className="bg-box">
            <label className="vlbl">{t('tts_key_label')} — <b>{hasKey ? t('tts_key_saved') : t('tts_key_none')}</b></label>
            <div className="key-row">
              <input type="password" className="cc-key" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} placeholder={t('tts_key_ph')} disabled={ttsBusy} />
              <button className="cc-mini" onClick={saveApiKey} disabled={!apiKeyInput.trim() || ttsBusy}>{hasKey ? t('tts_key_change') : t('tts_key_save')}</button>
              {hasKey && <button className="cc-mini" onClick={removeApiKey} disabled={ttsBusy}>{t('key_remove')}</button>}
            </div>
            {hasKey && <small className="cap-hint">{apiKeyStatus.persistent ? t('key_persistent') : t('key_session')}</small>}
            {apiKeyStatus.needsReentry && <small className="cap-hint">{t('key_reenter')}</small>}
            {hasKey && <>
              <label className="vlbl" style={{ marginTop: 6 }}>{t('tts_voice')}</label>
              <div className="key-row">
                <select className="cc-select" value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} disabled={ttsBusy || !ttsVoices.length}>
                  {!ttsVoices.length && <option value="">{voicesLoading ? t('tts_voices_loading') : t('tts_no_voices')}</option>}
                  {ttsVoices.map((v) => <option key={v.name} value={v.name}>{v.name.replace('vi-VN-', '')} · {v.gender === 'FEMALE' ? '♀' : v.gender === 'MALE' ? '♂' : '·'} · {v.type}</option>)}
                </select>
                <button className="cc-mini" onClick={loadVoices} disabled={voicesLoading} title={t('tts_load_voices')}>↻</button>
              </div>
              <label className="vlbl">{t('tts_rate')} <b>{ttsRate.toFixed(2)}×</b></label>
              <input type="range" min={0.25} max={2} step={0.05} value={ttsRate} disabled={selectedVoice?.capabilities?.speakingRate === false} onMouseDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => setTtsRate(Number(e.target.value))} />
              <label className="vlbl">{t('tts_pitch')} <b>{ttsPitch > 0 ? '+' : ''}{ttsPitch}</b></label>
              <input type="range" min={-20} max={20} step={1} value={ttsPitch} disabled={selectedVoice?.capabilities?.pitch === false} onMouseDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => setTtsPitch(Number(e.target.value))} />
              {selectedVoice?.capabilities?.speakingRate === false && <small className="cap-hint">{t('tts_google_rate_unsupported')}</small>}
            </>}
            <small className="cap-hint">{t('tts_google_hint')}</small>
          </div>
        )}
        <textarea className="cc-tts" value={ttsText} onChange={(e) => setTtsText(e.target.value)} placeholder={t('tts_ph')} rows={3} disabled={ttsBusy} />
        <div className="key-row">
          <button className="cc-auto" onClick={genTTS} disabled={!ttsText.trim() || ttsBusy}>{ttsBusy ? (ttsStatus || '...') : t('tts_generate')}</button>
          <button className="cc-mini" onClick={previewVoice} disabled={ttsBusy || (ttsEngine === 'google' && !ttsVoice)}>{t('tts_preview')}</button>
        </div>
        {ttsEngine !== 'google' && <div className="bg-box">
          <div className="key-row"><small className="cap-hint">{t('tts_local_model')}: {localTtsModel?.cached ? t('tts_model_cached') : localTtsModel?.state === 'check-failed' ? t('tts_model_check_failed') : t('tts_model_missing')} </small>
            <button className="cc-mini" onClick={refreshLocalTtsModel} disabled={ttsBusy}>{t('check')}</button></div>
          <small className="cap-hint">{t('tts_hint')}</small>
        </div>}
      </Sec>

      <Sec id="redub" title={t('redub_title')} acc={acc} setAcc={setAcc}>
        <small className="cap-hint">{t('redub_hint')}</small>
        <button className="cc-auto" onClick={redubVideo}
          disabled={!hasClips || !anyAudio || redubBusy || ttsBusy || (ttsEngine === 'google' && !ttsVoice)}>
          {redubBusy ? (redubStatus || '...') : redubSegments.length ? t('redub_regen') : t('redub_prepare')}
        </button>
        {!!redubSegments.length && <>
          <small className="cap-hint">{t('redub_review_hint')}</small>
          {redubSegments.map((segment, index) => {
            const slot = Math.max(0.3, (redubSegments[index + 1]?.start ?? timelineDuration) - segment.start)
            const over = segment.audioDuration > slot + 0.05
            return <div className="bg-box" key={segment.id}>
              <div className="key-row"><strong>{t('redub_sentence', { n: index + 1 })}</strong><small>{Number(segment.start).toFixed(2)}–{Number(segment.end).toFixed(2)}s · slot {slot.toFixed(2)}s</small></div>
              <div className="key-row">
                <label>{t('t_in_short')} <input type="number" min="0" step="0.05" value={segment.start} disabled={redubBusy} onChange={(event) => { const start = Math.max(0, Number(event.target.value) || 0); setRedubSegments((items) => items.map((item, i) => i === index ? { ...item, start } : item)) }} /></label>
                <label>{t('t_out_short')} <input type="number" min="0.05" step="0.05" value={segment.end} disabled={redubBusy} onChange={(event) => { const end = Math.max(segment.start + 0.05, Number(event.target.value) || segment.start + 0.05); setRedubSegments((items) => items.map((item, i) => i === index ? { ...item, end } : item)) }} /></label>
              </div>
              <textarea className="cc-tts" rows={2} value={segment.text} disabled={redubBusy}
                onChange={(event) => { const text = event.target.value; setRedubSegments((items) => items.map((item, i) => i === index ? { ...item, text, audioPath: '', audioDuration: 0 } : item)) }} />
              {segment.audioDuration > 0 && <small className="cap-hint">{t('redub_voice_len', { s: segment.audioDuration.toFixed(2) })}{over ? ` · ${t('redub_over_slot', { slot: slot.toFixed(2), x: Math.min(4, segment.audioDuration / slot).toFixed(2) })}` : ''}</small>}
              <div className="key-row">
                <button className="cc-mini" disabled={redubBusy || !segment.text.trim()} onClick={() => generateRedubSegment(index)}>{segment.audioPath ? t('redub_regen_sentence') : t('redub_make_sentence')}</button>
                <button className="cc-mini" disabled={!segment.audioPath} onClick={() => previewRedubSegment(segment.audioPath)}>{t('redub_listen')}</button>
              </div>
            </div>
          })}
          <label className="chk"><input type="checkbox" checked={redubKeepOriginal} onChange={(event) => setRedubKeepOriginal(event.target.checked)} /> {t('redub_keep_original')}</label>
          <button className="cc-auto" disabled={redubBusy || redubSegments.some((segment) => !segment.audioPath)} onClick={applyRedub}>{t('redub_apply')}</button>
        </>}
        {!anyAudio && hasClips && <small className="cap-hint">{t('cap_no_audio')}</small>}
        {!redubBusy && redubStatus && <small className="cap-hint">{redubStatus}</small>}
      </Sec>

      <audio ref={ttsPreviewRef} style={{ display: 'none' }} />

      {hasMusicTrack && hasVoiceTrack && (
        <label className="chk"><input type="checkbox" checked={ducking} onChange={(e) => { pushHistory(); setDucking(e.target.checked) }} /> {t('ducking')}</label>
      )}
      {anyAudio && (
        <div className="bg-box">
          <label className="vlbl">{t('vol_video')} <b>{Math.round(origVolume * 100)}%</b></label>
          <input type="range" min={0} max={1} step={0.05} value={origVolume} onMouseDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => setOrigVolume(Number(e.target.value))} />
          <small className="cap-hint">{t('audio_orig_volume_hint')}</small>
        </div>
      )}
    </div>
  )
}
