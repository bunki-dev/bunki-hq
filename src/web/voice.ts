// Voice in and out with the browser's own speech APIs: no audio leaves the device except
// through the browser's recogniser (Chrome sends it to Google; Safari uses Apple's).

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

const RecognitionCtor: (new () => Rec) | undefined =
  (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;

export const canListen = !!RecognitionCtor;
export const canSpeak = typeof speechSynthesis !== "undefined";

export interface Listening {
  stop(): void;
}

/** Listens for one utterance. `onPartial` streams what's heard so far. */
export function listen(handlers: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onLevel?: (level: number) => void;
  onEnd: () => void;
}): Listening {
  if (!RecognitionCtor) {
    handlers.onError("Voice input isn't supported in this browser. Type instead.");
    handlers.onEnd();
    return { stop() {} };
  }
  const rec = new RecognitionCtor();
  rec.lang = "en-AU";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    handlers.onPartial((finalText + interim).trim());
  };
  rec.onerror = (e: any) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    handlers.onError(
      e.error === "not-allowed" ? "Microphone access is off. Allow it for this site to talk to Bunki." : `Voice error: ${e.error}`,
    );
  };
  let meter: { stop(): void } | null = null;
  rec.onend = () => {
    meter?.stop();
    if (finalText.trim()) handlers.onFinal(finalText.trim());
    handlers.onEnd();
  };
  rec.start();
  if (handlers.onLevel) meter = micLevel(handlers.onLevel);
  return { stop: () => rec.stop() };
}

/** Mic loudness for the orb while listening. Best effort: silently does nothing if unavailable. */
function micLevel(onLevel: (l: number) => void): { stop(): void } {
  let stopped = false;
  let cleanup = () => {};
  navigator.mediaDevices
    ?.getUserMedia({ audio: true })
    .then((stream) => {
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf = requestAnimationFrame(tick);
      };
      tick();
      cleanup = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      };
    })
    .catch(() => {});
  return {
    stop() {
      stopped = true;
      cleanup();
      onLevel(0);
    },
  };
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "en-AU" && /natural|neural|premium|enhanced/i.test(v.name)) ??
    voices.find((v) => v.lang === "en-AU") ??
    voices.find((v) => v.lang.startsWith("en-GB")) ??
    voices.find((v) => v.lang.startsWith("en"))
  );
}

/** Speaks `text`; `onLevel` gets a rough envelope so the orb moves with the words. */
export function speak(text: string, onLevel: (l: number) => void, onEnd: () => void): () => void {
  if (!canSpeak || !text) {
    onEnd();
    return () => {};
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, "the link"));
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.03;
  let raf = 0;
  let pulse = 0;
  const tick = () => {
    pulse *= 0.9;
    onLevel(0.25 + pulse * 0.6 + Math.random() * 0.1);
    raf = requestAnimationFrame(tick);
  };
  u.onboundary = () => {
    pulse = 1;
  };
  u.onstart = () => tick();
  const finish = () => {
    cancelAnimationFrame(raf);
    onLevel(0);
    onEnd();
  };
  u.onend = finish;
  u.onerror = finish;
  speechSynthesis.speak(u);
  return () => {
    speechSynthesis.cancel();
    finish();
  };
}
