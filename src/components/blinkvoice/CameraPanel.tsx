import { Card } from "@/components/ui/card";
import { Eye, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CalibrationStatus } from "@/hooks/useBlinkDetector";

interface CameraPanelProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  cameraReady: boolean;
  status: CalibrationStatus;
  isClosed: boolean;
  ear: number;
  threshold: number;
  blinkFlash: boolean;
}

export const CameraPanel = ({
  videoRef,
  cameraReady,
  status,
  isClosed,
  ear,
  threshold,
  blinkFlash,
}: CameraPanelProps) => {
  return (
    <Card className="relative overflow-hidden border-border/50 bg-card/60 backdrop-blur p-3 flex items-center gap-4">
      <div className={cn(
        "relative w-32 h-24 sm:w-40 sm:h-28 rounded-xl overflow-hidden bg-secondary border-2",
        isClosed ? "border-warning" : "border-border",
        blinkFlash && "blink-flash"
      )}>
        <video
          ref={videoRef}
          className="w-full h-full object-cover scale-x-[-1]"
          playsInline
          muted
        />
        {!cameraReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-secondary">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <div className="absolute bottom-1 left-1 px-2 py-0.5 rounded-md bg-background/80 text-[10px] font-mono">
          EAR {ear.toFixed(2)}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <StatusChip
          ok={cameraReady}
          label={cameraReady ? "Camera Active" : "Camera Off"}
          icon={<Eye className="w-4 h-4" />}
        />
        <StatusChip
          ok={status === "ready"}
          label={
            status === "ready"
              ? "Calibrated"
              : status === "calibrating"
              ? "Calibrating…"
              : "Not Calibrated"
          }
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <StatusChip
          ok={!isClosed}
          warning={isClosed}
          label={isClosed ? "Eyes Closed" : "Eyes Open"}
          icon={<Circle className={cn("w-4 h-4", isClosed && "fill-current")} />}
        />
      </div>
    </Card>
  );
};

const StatusChip = ({
  ok,
  warning,
  label,
  icon,
}: {
  ok: boolean;
  warning?: boolean;
  label: string;
  icon: React.ReactNode;
}) => (
  <div
    className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs sm:text-sm font-medium",
      warning
        ? "border-warning/40 bg-warning/10 text-warning"
        : ok
        ? "border-accent/40 bg-accent/10 text-accent"
        : "border-border bg-muted/40 text-muted-foreground"
    )}
  >
    {icon}
    <span className="truncate">{label}</span>
  </div>
);
