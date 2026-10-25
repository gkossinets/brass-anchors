// Rules for noticing clips that fail to load, for the one audio player in shared.js.
// Pure (no DOM), so it runs under `node --test`.

// HTMLMediaElement error codes. 1 (MEDIA_ERR_ABORTED) means loading was stopped on
// purpose, e.g. the player switched clips, so it isn't a failure.
const MEDIA_ERRORS = { 2: "network", 3: "decode", 4: "unsupported" };

/** The failure an <audio> element's error code stands for, or null if it isn't one. */
export function mediaErrorName(code) {
  return MEDIA_ERRORS[code] ?? null;
}

/**
 * What a rejected audio.play() means: "failure" when the source can't be loaded,
 * "ignore" when a newer play() or a stop interrupted it, "blocked" when the browser
 * refused to play (autoplay rules), which no retry fixes.
 */
export function playRejection(err) {
  if (err?.name === "NotSupportedError") return "failure";
  if (err?.name === "AbortError") return "ignore";
  return "blocked";
}

/** The clip id and version (trombone, hum, original) in an audio path, or null. */
export function clipOfSrc(src) {
  const m = /audio\/([a-z]+)\/([a-z0-9_]+)\.mp3$/.exec(src);
  return m ? { clip_id: m[2], version: m[1] } : null;
}

/**
 * One press of Play: the first failure earns one retry, a second gives up. The element's
 * error event and play()'s rejection often report the same failure, so each attempt
 * fails at most once. A report names the attempt it belongs to: the first attempt's
 * play() can reject after the retry has begun, and that is not the retry failing.
 */
export function createLoadTracker() {
  let attempt = 0;
  let failedOn = -1;
  let firstError = null;
  let reported = false;
  return {
    /** The attempt under way, to pass back with its failure. */
    attempt: () => attempt,
    /** @returns {"retry" | "give-up" | "ignore"} */
    failed(error, onAttempt = attempt) {
      if (onAttempt !== attempt || failedOn === attempt) return "ignore";
      failedOn = attempt;
      if (attempt === 0) {
        firstError = error;
        return "retry";
      }
      return "give-up";
    },
    retrying() {
      attempt = 1;
    },
    /** The first error, once, when sound starts after a retry; otherwise null. */
    started() {
      if (attempt !== 1 || failedOn === 1 || reported) return null;
      reported = true;
      return firstError;
    },
  };
}
