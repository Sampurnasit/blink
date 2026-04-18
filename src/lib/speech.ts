// Speech synthesis helpers (Web Speech API)

let voices: SpeechSynthesisVoice[] = [];

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  const load = () => {
    voices = window.speechSynthesis.getVoices();
  };
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

export function speak(text: string, opts: { rate?: number; volume?: number; lang?: string } = {}) {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = opts.rate ?? 1;
    utter.volume = opts.volume ?? 1;
    utter.lang = opts.lang ?? "en-US";
    const preferred = voices.find((v) => v.lang === utter.lang) ?? voices[0];
    if (preferred) utter.voice = preferred;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.error("Speech failed", e);
  }
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
