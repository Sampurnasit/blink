import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, MessageSquare } from "lucide-react";

export type TranscriptEntry = {
  id: string;
  text: string;
  timestamp: number;
};

interface TranscriptProps {
  entries: TranscriptEntry[];
  onClear: () => void;
}

export const Transcript = ({ entries, onClear }: TranscriptProps) => {
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider">Transcript</h2>
        </div>
        <Button onClick={onClear} variant="ghost" size="sm" disabled={entries.length === 0}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 -mx-2 px-2">
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm italic text-center py-8">
            No messages yet
          </p>
        ) : (
          <ul className="space-y-2">
            {entries
              .slice()
              .reverse()
              .map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-border/60 bg-secondary/40 p-3"
                >
                  <p className="text-base font-medium leading-snug">{e.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                    {new Date(e.timestamp).toLocaleTimeString()}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </ScrollArea>
    </Card>
  );
};
