// R36 website pop-up chime: two short soft notes made with WebAudio (no audio file, nothing for the CSP to allow).
// Browsers only start audio after a user gesture, so `unlockChime` runs on the first pointer/key press; until then (or
// without WebAudio) `chime` stays silent. Client-only.
let ctx: AudioContext | null = null

/** Creates / resumes the AudioContext — call from a user gesture. Returns true once audio can play. */
export function unlockChime(): boolean {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return false
    ctx ??= new AC()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx.state === 'running'
  } catch {
    return false
  }
}

/** Plays the chime when audio is unlocked; silently does nothing otherwise. */
export function chime() {
  try {
    const ac = ctx
    if (ac?.state !== 'running') return
    const start = ac.currentTime + 0.01
    for (const [i, freq] of [880, 1318.5].entries()) {
      const at = start + i * 0.14
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.38)
      osc.connect(gain).connect(ac.destination)
      osc.start(at)
      osc.stop(at + 0.4)
    }
  } catch {
    // Audio blocked or unavailable: the pop-up still shows.
  }
}
