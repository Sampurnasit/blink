import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface InputDisplayProps {
  morse: string;
  text: string;
  blinkFlash: boolean;
}

export const InputDisplay = ({ morse, text, blinkFlash }: InputDisplayProps) => {
  return (
    <Card
      className={cn(
        "relative overflow-hidden p-6 sm:p-8 border-border/50 bg-card/60 backdrop-blur",
        blinkFlash && "blink-flash"
      )}
    >
      <div className="space-y-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Current input
          </div>
          <div className="min-h-[3rem] flex items-center">
            {morse ? (
              <div className="flex gap-2 flex-wrap text-display">
                {morse.split("").map((s, i) => (
                  <span
                    key={i}
                    className="morse-symbol inline-flex items-center justify-center min-w-[2rem] h-12 text-4xl sm:text-5xl font-bold text-primary"
                  >
                    {s === "." ? "•" : "—"}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-2xl text-muted-foreground italic">Waiting for blink…</span>
            )}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Decoded message
          </div>
          <div className="min-h-[5rem] sm:min-h-[6rem] flex items-center">
            <p className="text-4xl sm:text-6xl font-bold text-display break-words leading-tight">
              {text || <span className="text-muted-foreground/50 italic font-normal text-3xl sm:text-4xl">Your words will appear here</span>}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
};

interface FallbackInputProps {
  onDot: () => void;
  onDash: () => void;
  onConfirm: () => void;
  onSpace: () => void;
}

export const FallbackInput = ({ onDot, onDash, onConfirm, onSpace }: FallbackInputProps) => {
  return (
    <div className="grid grid-cols-4 gap-2">
      <Button onClick={onDot} variant="secondary" size="lg" className="h-14 text-2xl font-bold">
        •
      </Button>
      <Button onClick={onDash} variant="secondary" size="lg" className="h-14 text-2xl font-bold">
        —
      </Button>
      <Button onClick={onConfirm} variant="secondary" size="lg" className="h-14 text-sm font-semibold">
        Confirm
      </Button>
      <Button onClick={onSpace} variant="secondary" size="lg" className="h-14 text-sm font-semibold">
        Space
      </Button>
    </div>
  );
};
