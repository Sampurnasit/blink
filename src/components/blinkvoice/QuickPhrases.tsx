import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

const PHRASES = [
  { text: "I am in pain", emoji: "😣" },
  { text: "Help me", emoji: "🆘" },
  { text: "Call the nurse", emoji: "🔔" },
  { text: "Water please", emoji: "💧" },
  { text: "I can't breathe", emoji: "🫁" },
  { text: "I'm cold", emoji: "🥶" },
];

interface QuickPhrasesProps {
  onSpeak: (text: string) => void;
}

export const QuickPhrases = ({ onSpeak }: QuickPhrasesProps) => {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-destructive" />
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
          Quick phrases — tap to speak
        </h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {PHRASES.map((p) => (
          <Button
            key={p.text}
            onClick={() => onSpeak(p.text)}
            className="h-20 sm:h-24 text-base sm:text-lg font-bold gradient-emergency text-destructive-foreground hover:opacity-90 hover:scale-[1.02] transition-all shadow-lg flex flex-col gap-1"
          >
            <span className="text-2xl">{p.emoji}</span>
            <span>{p.text}</span>
          </Button>
        ))}
      </div>
    </div>
  );
};

interface PredictionsProps {
  words: string[];
  onPick: (word: string) => void;
}

export const Predictions = ({ words, onPick }: PredictionsProps) => {
  return (
    <div>
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-3">
        Suggestions
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {words.map((w) => (
          <Button
            key={w}
            onClick={() => onPick(w)}
            variant="outline"
            className="h-16 text-xl font-bold border-2 border-primary/40 hover:border-primary hover:bg-primary/10 hover:text-primary transition-all"
          >
            {w}
          </Button>
        ))}
      </div>
    </div>
  );
};
