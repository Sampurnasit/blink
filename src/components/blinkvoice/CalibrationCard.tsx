import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, Sparkles } from "lucide-react";
import { CalibrationStatus } from "@/hooks/useBlinkDetector";

interface CalibrationCardProps {
  status: CalibrationStatus;
  count: number;
  onStart: () => void;
  cameraReady: boolean;
}

export const CalibrationCard = ({ status, count, onStart, cameraReady }: CalibrationCardProps) => {
  if (status === "ready") return null;

  return (
    <Card className="p-6 sm:p-8 border-primary/40 bg-card/80 backdrop-blur glow-primary">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center shrink-0">
          <Eye className="w-6 h-6 text-primary-foreground" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold mb-1">
            {status === "calibrating" ? "Calibrating…" : "Welcome to BLINK"}
          </h2>
          <p className="text-muted-foreground mb-4">
            {status === "calibrating"
              ? `Please blink naturally ${3 - count} more time${3 - count === 1 ? "" : "s"}.`
              : "We'll calibrate the blink detector to your eyes. Sit comfortably and look at the screen."}
          </p>

          {status === "calibrating" && (
            <div className="flex gap-2 mb-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`h-3 flex-1 rounded-full transition-all ${
                    i < count ? "bg-primary glow-primary" : "bg-secondary"
                  }`}
                />
              ))}
            </div>
          )}

          {status === "idle" && (
            <Button
              size="lg"
              onClick={onStart}
              disabled={!cameraReady}
              className="gradient-primary text-primary-foreground font-bold text-lg h-14 px-8 hover:opacity-90"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              {cameraReady ? "Start Calibration" : "Waiting for camera…"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};
