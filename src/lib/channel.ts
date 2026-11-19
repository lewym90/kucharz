import { db, setSetting } from './db'

// Pobieranie całych kanałów zostało wyłączone (decyzja właściciela, v0.11.1) – przepisy dodaje się pojedynczymi linkami.
// Zostaje: rozpoznawanie linków do kanałów (żeby podpowiedzieć, że trzeba wkleić link do jednego filmu)
// i usuwanie starych zakładek z przepisami pobranymi wcześniej z kanałów.
setSetting('channelJob', null).catch(() => {})

export const isChannelUrl = (u: string) => {
  const s = u.trim()
  return /youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)(\/(videos|shorts|streams|featured))?\/?(\?.*)?$/i.test(s)
    || (/youtube\.com\/playlist\?/i.test(s) && /list=/.test(s))
    || /tiktok\.com\/@[^/?#]+\/?(\?.*)?$/i.test(s)
    || /instagram\.com\/(?!p\/|reel\/|reels\/|tv\/|stories\/|explore\/)[\w.]+\/?(\?.*)?$/i.test(s)
}

const SOCIAL = /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.com|fb\.watch)/i
export const isFacebookProfile = (u: string) => /facebook\.com\/(?!share|watch|reel|groups\/[^/]+\/(posts|permalink)|[^/]+\/(posts|videos|photos)\/|story\.php|permalink\.php|photo)[\w.-]+\/?(\?.*)?$/i.test(u.trim())
export const isSocialSource = (url: string) => SOCIAL.test(url)

/** Usuwa zakładkę kanału: wszystkie jej przepisy, zdjęcia, oceny i wpisy w planie. */
export async function deleteChannel(key: string) {
  const ids = (await db.mine.filter(m => m.ch === key).toArray()).map(m => m.id)
  await db.transaction('rw', [db.mine, db.photos, db.thumbs, db.favs, db.ratings, db.hist, db.plan, db.colls], async () => {
    await db.mine.bulkDelete(ids); await db.photos.bulkDelete(ids); await db.thumbs.bulkDelete(ids)
    await db.favs.bulkDelete(ids); await db.ratings.bulkDelete(ids); await db.hist.bulkDelete(ids)
    await db.plan.filter(p => ids.includes(p.rid)).delete(); await db.colls.delete('ch:' + key)
  })
}
