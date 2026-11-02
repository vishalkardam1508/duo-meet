export const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export function parseMeetingCode(value) {
  const normalized = value.trim().toLowerCase();
  const formatted = normalized.match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/);
  if (formatted) {
    return formatted[0];
  }
  if (/^[a-z]{10}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 7)}-${normalized.slice(7)}`;
  }
  return null;
}

export function meetingCodeFromPath(pathname) {
  const match = pathname.match(/^\/m\/([a-z-]+)\/?$/);
  return match && CODE_RE.test(match[1]) ? match[1] : null;
}

export function tuneOpus(sdp) {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!match) {
    return sdp;
  }
  const payloadType = match[1];
  const desired = {
    useinbandfec: "1",
    stereo: "0",
    maxaveragebitrate: "32000",
  };
  const fmtp = new RegExp(`a=fmtp:${payloadType} ([^\\r\\n]*)`);
  if (fmtp.test(sdp)) {
    return sdp.replace(fmtp, (_, parameters) => {
      const entries = parameters.split(";").filter(Boolean).map((parameter) => {
        const [key, ...value] = parameter.trim().split("=");
        return [key, value.join("=")];
      });
      const values = new Map(entries);
      for (const [key, value] of Object.entries(desired)) {
        values.set(key, value);
      }
      return `a=fmtp:${payloadType} ${[...values].map(([key, value]) => `${key}=${value}`).join(";")}`;
    });
  }
  return sdp.replace(
    match[0],
    `${match[0]}\r\na=fmtp:${payloadType} useinbandfec=1;stereo=0;maxaveragebitrate=32000`,
  );
}
