/* Local copies of the room photos (public/images), used when a room has no photo in Spacebring
   or when its Spacebring photo cannot be loaded (for example, Spacebring is unreachable).
   Meeting rooms and the podcast and main TikTok studios are keyed as before; the other TikTok
   rooms are keyed by zone id. */

export const ROOM_PHOTOS: Record<string, string> = {
  MR_1: "/images/meeting_room_1.PNG",
  MR_2: "/images/meeting_room_2.PNG",
  podcast_studio: "/images/podcast_studio.PNG",
  tiktok_studio: "/images/tiktok_studio.PNG",
  TTS_2: "/images/tiktok_beauty_room.jpg",
  TTS_3: "/images/tiktok_music_room.jpg",
  TTS_4: "/images/tiktok_battle_room_1.jpg",
  TTS_5: "/images/tiktok_battle_room_2.jpg",
};

/** The built-in photo for a room: its own if it has one, else its service's. */
export function localRoomPhoto(zoneId: string, service: string): string {
  return ROOM_PHOTOS[zoneId] ?? ROOM_PHOTOS[service] ?? ROOM_PHOTOS.MR_1;
}

const isRemote = (src: string) => /^https?:\/\//i.test(src);

/** Places to try for a photo, in order: the photo itself, then the built-in copy. A remote
 *  photo has no variants of its own; a built-in one is tried under both folders and extensions. */
export function photoCandidates(src: string, fallbackSrc?: string): string[] {
  const own = isRemote(src) ? [src] : localVariants(src);
  if (!fallbackSrc || fallbackSrc === src) return own;
  const fallback = isRemote(fallbackSrc) ? [fallbackSrc] : localVariants(fallbackSrc);
  return [...own, ...fallback.filter((candidate) => !own.includes(candidate))];
}

function localVariants(src: string): string[] {
  const file = src.split("/").pop() ?? src;
  if (!/\.png$/i.test(file)) return [src]; // a .jpg and so on: exactly where it is
  const base = file.replace(/\.png$/i, "");
  const out: string[] = [];
  for (const folder of ["/images/", "/brand/images/"]) {
    for (const ext of [".PNG", ".png"]) out.push(`${folder}${base}${ext}`);
  }
  return [src, ...out.filter((candidate) => candidate !== src)];
}
