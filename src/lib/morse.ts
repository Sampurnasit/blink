// Morse code dictionary and decoder utilities

export const MORSE_TO_CHAR: Record<string, string> = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E",
  "..-.": "F", "--.": "G", "....": "H", "..": "I", ".---": "J",
  "-.-": "K", ".-..": "L", "--": "M", "-.": "N", "---": "O",
  ".--.": "P", "--.-": "Q", ".-.": "R", "...": "S", "-": "T",
  "..-": "U", "...-": "V", ".--": "W", "-..-": "X", "-.--": "Y",
  "--..": "Z",
  ".----": "1", "..---": "2", "...--": "3", "....-": "4", ".....": "5",
  "-....": "6", "--...": "7", "---..": "8", "----.": "9", "-----": "0",
};

export function decodeMorse(symbols: string): string | null {
  return MORSE_TO_CHAR[symbols] ?? null;
}

// Lightweight context-aware predictions tuned for ICU/medical use
const PRIORITY_WORDS = [
  "PAIN", "WATER", "YES", "NO", "HELP", "NURSE", "DOCTOR",
  "FAMILY", "HOT", "COLD", "HUNGRY", "TIRED", "BATHROOM",
  "MEDICINE", "BREATHE", "PILLOW", "BLANKET", "LIGHT", "DARK",
  "THANK", "PLEASE", "OK", "OKAY", "MORE", "STOP", "WAIT",
  "MOM", "DAD", "WIFE", "HUSBAND", "SON", "DAUGHTER",
];

export function predictWords(prefix: string, max = 4): string[] {
  if (!prefix) return ["PAIN", "WATER", "YES", "NO"];
  const upper = prefix.toUpperCase();
  const matches = PRIORITY_WORDS.filter((w) => w.startsWith(upper));
  if (matches.length >= max) return matches.slice(0, max);
  // pad with priority defaults not already present
  const fillers = PRIORITY_WORDS.filter((w) => !matches.includes(w));
  return [...matches, ...fillers].slice(0, max);
}
