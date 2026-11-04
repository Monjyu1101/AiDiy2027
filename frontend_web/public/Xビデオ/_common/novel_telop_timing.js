(() => {
  "use strict";

  let timings = {};
  fetch("telop_timing.json", { cache: "no-cache" })
    .then(response => response.ok ? response.json() : {})
    .then(data => { timings = data && typeof data === "object" ? data : {}; })
    .catch(() => {});

  function groups(narration) {
    // One spoken sentence per caption: never advance while it is being read.
    return (String(narration || "").replace(/""/g, "").trim().match(/[^。！？!?]+[。！？!?]?/g) || [])
      .map(sentence => [sentence.trim()])
      .filter(group => group[0]);
  }

  function weightedChunk(chunks, progress) {
    const total = chunks.reduce((sum, chunk) => sum + Array.from(chunk).length, 0);
    let consumed = 0;
    for (const chunk of chunks) {
      consumed += Array.from(chunk).length;
      if (progress * total < consumed) return chunk;
    }
    return chunks[chunks.length - 1] || "";
  }

  function select(scene, mode, audio, grouped, elapsed, duration) {
    if (!grouped.length || duration <= 0) return "";
    const expected = scene[`${mode}_audio`] || "";
    const source = audio?.currentSrc || audio?.src || "";
    const matchesFile = expected && !source.startsWith("blob:")
      && decodeURI(new URL(source, location.href).pathname).endsWith(`/${expected}`);
    const anchors = matchesFile ? timings[scene.id]?.[mode] : null;
    if (Array.isArray(anchors) && anchors.length === grouped.length) {
      for (let i = 0; i < anchors.length; i++) {
        const [start, end] = anchors[i];
        const spokenStart = i === 0 ? Math.max(start, 0.18) : start;
        if (elapsed < spokenStart) return "";
        if (elapsed < end) {
          return grouped[i][0] || "";
        }
      }
      return "";
    }
    const pauseSec = scene.pause_after_speech_text === ""
      ? Math.max(0, Number(scene.pause_after_sec) || 0) : 0;
    const speechDuration = Math.max(0, duration - pauseSec);
    if (!speechDuration || elapsed >= speechDuration) return "";
    return weightedChunk(grouped.flat(), Math.min(0.999999, elapsed / speechDuration));
  }

  window.NovelTelopTiming = { groups, select };
})();
