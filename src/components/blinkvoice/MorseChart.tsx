import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BookOpen, Search } from "lucide-react";
import { MORSE_TO_CHAR } from "@/lib/morse";
import { cn } from "@/lib/utils";

// Invert dictionary to char -> morse
const CHAR_TO_MORSE: Record<string, string> = Object.entries(MORSE_TO_CHAR).reduce(
  (acc, [code, ch]) => {
    acc[ch] = code;
    return acc;
  },
  {} as Record<string, string>
);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");

const renderSymbols = (code: string, dim?: boolean) => (
  <div className="flex gap-1 items-center justify-center">
    {code.split("").map((s, i) => (
      <span
        key={i}
        className={cn(
          s === "."
            ? "inline-block w-2 h-2 rounded-full"
            : "inline-block w-4 h-2 rounded-full",
          dim ? "bg-muted-foreground/60" : "bg-primary"
        )}
      />
    ))}
  </div>
);

interface MorseChartCardProps {
  /** The current morse symbols the user has entered — used to highlight the matching letter. */
  currentMorse?: string;
  /** Optional: insert a letter when tapped (fallback input). */
  onPickLetter?: (letter: string) => void;
}

/**
 * Inline Morse code chart shown next to the blink input.
 * Highlights the letter that currently matches the in-progress morse input.
 */
export const MorseChartCard = ({ currentMorse = "", onPickLetter }: MorseChartCardProps) => {
  const [query, setQuery] = useState("");
  const q = query.trim().toUpperCase();

  const matchedLetter = useMemo(() => {
    if (!currentMorse) return null;
    return MORSE_TO_CHAR[currentMorse] ?? null;
  }, [currentMorse]);

  const filter = (chars: string[]) =>
    !q
      ? chars
      : chars.filter((c) => c.includes(q) || (CHAR_TO_MORSE[c] ?? "").includes(query.trim()));

  const renderGrid = (chars: string[]) => {
    const filtered = filter(chars);
    if (filtered.length === 0) {
      return (
        <p className="text-center text-muted-foreground italic py-6 text-sm">
          No matches for “{query}”
        </p>
      );
    }
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
        {filtered.map((ch) => {
          const code = CHAR_TO_MORSE[ch];
          if (!code) return null;
          const isMatch = matchedLetter === ch;
          // Letters whose code STARTS with current morse (potential next step)
          const isPartial =
            !isMatch && currentMorse && code.startsWith(currentMorse);

          const Btn = onPickLetter ? "button" : "div";

          return (
            <Btn
              key={ch}
              onClick={onPickLetter ? () => onPickLetter(ch) : undefined}
              className={cn(
                "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-center",
                onPickLetter && "cursor-pointer hover:scale-105 active:scale-95",
                isMatch
                  ? "border-accent bg-accent/20 glow-primary"
                  : isPartial
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/50 bg-secondary/30 hover:bg-secondary/60"
              )}
            >
              <span
                className={cn(
                  "text-lg font-black leading-none",
                  isMatch ? "text-accent" : isPartial ? "text-primary" : "text-foreground"
                )}
              >
                {ch}
              </span>
              {renderSymbols(code, !isMatch && !isPartial)}
            </Btn>
          );
        })}
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur p-4 flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold uppercase tracking-wider truncate">
            Morse Chart
          </h2>
        </div>
        {matchedLetter && (
          <span className="text-xs px-2 py-1 rounded-md bg-accent/20 text-accent font-bold">
            → {matchedLetter}
          </span>
        )}
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="pl-8 h-9 text-sm"
        />
      </div>

      <Tabs defaultValue="letters" className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid grid-cols-2 w-full h-9">
          <TabsTrigger value="letters" className="text-xs">A–Z</TabsTrigger>
          <TabsTrigger value="numbers" className="text-xs">0–9</TabsTrigger>
        </TabsList>
        <ScrollArea className="flex-1 mt-2 -mx-1 px-1">
          <TabsContent value="letters" className="mt-0">
            {renderGrid(LETTERS)}
          </TabsContent>
          <TabsContent value="numbers" className="mt-0">
            {renderGrid(DIGITS)}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <p className="text-[10px] text-muted-foreground mt-2 text-center">
        <span className="text-primary font-semibold">•</span> dot ·{" "}
        <span className="text-primary font-semibold">—</span> dash
      </p>
    </div>
  );
};

/**
 * Dialog version — kept for compatibility with header buttons.
 */
interface MorseChartProps {
  trigger?: React.ReactNode;
  variant?: "button" | "compact";
}

export const MorseChart = ({ trigger, variant = "button" }: MorseChartProps) => {
  const defaultTrigger =
    variant === "compact" ? (
      <Button variant="outline" size="sm" className="gap-2">
        <BookOpen className="w-4 h-4" />
        Morse Chart
      </Button>
    ) : (
      <Button variant="outline" size="lg" className="h-14 text-base font-semibold gap-2 border-2">
        <BookOpen className="w-5 h-5" />
        Morse Code Chart
      </Button>
    );

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl font-black flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            Morse Code Reference
          </DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-6 flex-1 min-h-0">
          <MorseChartCard />
        </div>
      </DialogContent>
    </Dialog>
  );
};
