import {
  ActivityType,
  type ClientUser,
} from "discord.js";

const cortis_tracks = [
  { title: "GO!", artists: "CORTIS", duration_ms: 170_000 },
  { title: "What You Want", artists: "CORTIS", duration_ms: 194_000 },
  { title: "FaSHioN", artists: "CORTIS", duration_ms: 174_000 },
  { title: "JoyRide", artists: "CORTIS", duration_ms: 157_000 },
  { title: "Lullaby", artists: "CORTIS", duration_ms: 164_000 },
  {
    title: "What You Want (feat. Teezo Touchdown)",
    artists: "CORTIS, Teezo Touchdown",
    duration_ms: 194_000,
  },
  { title: "Mention Me (From The Movie \"GOAT\")", artists: "CORTIS", duration_ms: 180_000 },
  { title: "TNT", artists: "CORTIS", duration_ms: 122_000 },
  { title: "REDRED", artists: "CORTIS", duration_ms: 163_000 },
  { title: "ACAI", artists: "CORTIS", duration_ms: 173_000 },
  { title: "YOUNGCREATORCREW", artists: "CORTIS", duration_ms: 176_000 },
  { title: "Wassup", artists: "CORTIS", duration_ms: 184_000 },
  { title: "Blue Lips", artists: "CORTIS", duration_ms: 141_000 },
  { title: "MOTION (feat. Juicy J)", artists: "CORTIS, Juicy J", duration_ms: 157_000 },
  { title: "PACK IT UP", artists: "CORTIS", duration_ms: 112_000 },
  { title: "MONEYMONEYMONEY", artists: "CORTIS", duration_ms: 139_000 },
] as const;

let active_user: ClientUser | undefined;
let track_index = 0;
let track_timer: ReturnType<typeof setTimeout> | undefined;

export function start(client_user: ClientUser): void {

  stop();
  active_user = client_user;
  track_index = 0;
  show_current_track();

}

export function stop(): void {

  if (track_timer) {
    clearTimeout(track_timer);
    track_timer = undefined;
  }

  active_user = undefined;

}

function show_current_track(): void {

  const client_user = active_user;
  const track = cortis_tracks[track_index];

  if (!client_user || !track) {
    return;
  }

  client_user.setActivity(`Spotify • ${track.title}`, {
    state: track.artists,
    type: ActivityType.Listening,
  });

  track_timer = setTimeout(() => {
    track_index = (track_index + 1) % cortis_tracks.length;
    show_current_track();
  }, track.duration_ms);
  track_timer.unref();

}
