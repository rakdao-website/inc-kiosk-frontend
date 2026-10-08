import { describe, expect, it } from "vitest";

import { localRoomPhoto, photoCandidates, ROOM_PHOTOS } from "./room-photos";

describe("localRoomPhoto", () => {
  it("gives each TikTok room its own photo and falls back to the service photo", () => {
    expect(localRoomPhoto("TTS_2", "tiktok_studio")).toBe("/images/tiktok_beauty_room.jpg");
    expect(localRoomPhoto("TTS_5", "tiktok_studio")).toBe("/images/tiktok_battle_room_2.jpg");
    expect(localRoomPhoto("TTS_1", "tiktok_studio")).toBe(ROOM_PHOTOS.tiktok_studio); // the Main Studio uses the studio photo
    expect(localRoomPhoto("POD_1", "podcast_studio")).toBe(ROOM_PHOTOS.podcast_studio);
    expect(localRoomPhoto("TTS_9", "unknown")).toBe(ROOM_PHOTOS.MR_1);
  });
});

describe("photoCandidates", () => {
  it("tries the Spacebring photo first, then the built-in copy", () => {
    expect(photoCandidates("https://cdn.test/a", "/images/tiktok_music_room.jpg")).toEqual([
      "https://cdn.test/a",
      "/images/tiktok_music_room.jpg",
    ]);
  });

  it("keeps a built-in .jpg exactly where it is, and tries the PNG variants for .PNG files", () => {
    expect(photoCandidates("/images/tiktok_music_room.jpg")).toEqual(["/images/tiktok_music_room.jpg"]);
    expect(photoCandidates("/images/tiktok_studio.PNG")).toContain("/brand/images/tiktok_studio.png");
  });

  it("does not repeat the photo as its own fallback", () => {
    expect(photoCandidates("/images/tiktok_music_room.jpg", "/images/tiktok_music_room.jpg")).toEqual(["/images/tiktok_music_room.jpg"]);
  });
});
