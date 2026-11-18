export type Detected = { label: string; sec: number }
// wykrywa czasy w tekście kroku: "5 minut", "2–3 minuty", "1 godzinę", "30 sekund"
export function detectTimers(step: string): Detected[] {
  const out: Detected[] = []
  const re = /(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?\s*(sekund\w*|minut\w*|min\b|godzin\w*|godz\b)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(step))) {
    const v = parseFloat((m[2] ?? m[1]).replace(',', '.'))
    const u = m[3].toLowerCase()
    const mult = u.startsWith('sek') ? 1 : u.startsWith('godz') ? 3600 : 60
    const sec = Math.round(v * mult)
    if (sec >= 20 && sec <= 12 * 3600) out.push({ label: m[0], sec })
  }
  return out
}
