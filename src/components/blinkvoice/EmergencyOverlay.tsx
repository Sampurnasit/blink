import { useEffect } from "react";
import { AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmergencyOverlayProps {
  active: boolean;
  onDismiss: () => void;
}

export const EmergencyOverlay = ({ active, onDismiss }: EmergencyOverlayProps) => {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onDismiss]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 emergency-flash flex flex-col items-center justify-center p-8 text-center">
      <AlertOctagon className="w-32 h-32 text-destructive-foreground mb-6 animate-pulse" />
      <h1 className="text-6xl sm:text-8xl font-black text-destructive-foreground mb-4 tracking-tight">
        EMERGENCY
      </h1>
      <p className="text-2xl sm:text-3xl text-destructive-foreground/95 font-semibold mb-10 max-w-2xl">
        Patient needs immediate assistance
      </p>
      <Button
        onClick={onDismiss}
        size="lg"
        variant="secondary"
        className="h-16 px-10 text-xl font-bold"
      >
        Dismiss Alert
      </Button>
    </div>
  );
};
