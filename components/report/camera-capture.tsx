"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, ImageUp, RefreshCw, SwitchCamera, X } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { EVIDENCE } from "@/lib/report-evidence";

/**
 * Direct camera capture for incident evidence.
 *
 * The live preview uses getUserMedia and prefers the rear camera. A photograph
 * is only handed to the parent after "Use photo", so nothing uploads until the
 * reporter confirms it. When a live preview is impossible (insecure context, no
 * camera, or a denied permission) the same dialog offers the native camera
 * input instead, and the file picker in the form keeps working regardless.
 */

type Phase = "starting" | "live" | "review" | "fallback";

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotUrl = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [capturing, setCapturing] = useState(false);

  const releaseShot = useCallback(() => {
    if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
    shotUrl.current = null;
    setShot(null);
  }, []);

  const stopCamera = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(
    async (constraints: MediaStreamConstraints) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Live camera access is not supported in this browser. Use your device camera below instead.");
        setPhase("fallback");
        return;
      }
      stopCamera();
      setPhase("starting");
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {
            /* Some browsers require a gesture before autoplay; the preview still renders. */
          });
        }
        // Closed while the permission prompt was open.
        if (!streamRef.current) return;
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          setDevices(all.filter((device) => device.kind === "videoinput"));
        } catch {
          setDevices([]);
        }
        setPhase("live");
      } catch (problem) {
        const name = problem instanceof DOMException ? problem.name : "";
        stopCamera();
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "Camera permission was denied. Allow camera access in your browser settings, or use your device camera below."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No usable camera was found on this device. You can still use your device camera or upload a file."
              : "The camera could not be started. You can still use your device camera or upload a file.",
        );
        setPhase("fallback");
      }
    },
    [stopCamera],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setError(
        !window.isSecureContext
          ? "Live camera access needs a secure connection (HTTPS or localhost). Use your device camera below instead."
          : "Live camera access is not supported in this browser. Use your device camera below instead.",
      );
      setPhase("fallback");
      return;
    }
    void startCamera({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    return () => {
      stopCamera();
      if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
      shotUrl.current = null;
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const scale = Math.min(1, 2048 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("Capture failed");
      if (blob.size > EVIDENCE.imageMaxBytes) {
        setError("The captured photograph is larger than the 8 MB limit. Try again, or choose a file instead.");
        return;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const file = new File([blob], `incident-photo-${stamp}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      // Turn the camera off while the photograph is being reviewed.
      stopCamera();
      releaseShot();
      const url = URL.createObjectURL(file);
      shotUrl.current = url;
      setShot({ file, url });
      setPhase("review");
    } catch {
      setError("The photograph could not be captured. Try again, or choose a file instead.");
    } finally {
      setCapturing(false);
    }
  }

  function switchCamera() {
    if (devices.length > 1) {
      const current = devices.findIndex((device) => device.deviceId === streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId);
      const next = (current + 1) % devices.length;
      void startCamera({ video: { deviceId: { exact: devices[next].deviceId } }, audio: false });
      return;
    }
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void startCamera({ video: { facingMode: { ideal: next } }, audio: false });
  }

  function retake() {
    releaseShot();
    setError(null);
    void startCamera({ video: { facingMode: { ideal: facing } }, audio: false });
  }

  function usePhoto() {
    if (!shot) return;
    const file = shot.file;
    stopCamera();
    releaseShot();
    onCapture(file);
  }

  function close() {
    stopCamera();
    releaseShot();
    onClose();
  }

  const live = phase === "starting" || phase === "live";

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Take a photo"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <Camera size={16} className="text-accent" aria-hidden />
            Take photo
          </p>
          <button
            type="button"
            onClick={close}
            className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-white/5 hover:text-fg"
            aria-label="Close camera"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="relative aspect-[4/3] w-full bg-black">
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            aria-label="Live camera preview"
            className={live ? "h-full w-full object-cover" : "hidden"}
          />
          {phase === "starting" && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 text-white/85">
              <span className="flex items-center gap-2 text-[12px]">
                <Spinner /> Starting camera…
              </span>
            </div>
          )}
          {phase === "review" && shot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.url} alt="Photograph ready to attach" className="h-full w-full object-contain" />
          )}
          {phase === "fallback" && (
            <div className="absolute inset-0 grid place-items-center p-5 text-center">
              <div>
                <span className="mx-auto grid size-11 place-items-center rounded-full border border-white/15 bg-white/5 text-muted">
                  <Camera size={20} aria-hidden />
                </span>
                <p className="mt-3 text-[12px] leading-relaxed text-muted">{error}</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 p-4">
          {error && phase !== "fallback" && (
            <p role="alert" className="text-[11px] leading-relaxed text-crit">
              {error}
            </p>
          )}

          {phase === "live" && (
            <>
              <Button type="button" className="w-full" onClick={() => void capture()} disabled={capturing}>
                <Camera size={16} aria-hidden /> {capturing ? "Capturing…" : "Capture photo"}
              </Button>
              <div className="flex gap-2">
                {devices.length > 1 && (
                  <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={switchCamera}>
                    <SwitchCamera size={15} aria-hidden /> Switch camera
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          {phase === "review" && (
            <>
              <div className="flex gap-2">
                <Button type="button" className="flex-1" onClick={usePhoto} disabled={capturing}>
                  <Check size={15} aria-hidden /> Use photo
                </Button>
                <Button type="button" variant="secondary" className="flex-1" onClick={retake}>
                  <RefreshCw size={15} aria-hidden /> Retake
                </Button>
              </div>
              <Button type="button" variant="ghost" className="w-full" onClick={close}>
                Cancel
              </Button>
            </>
          )}

          {phase === "fallback" && (
            <>
              <label className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-accent/35 bg-accent/[0.08] px-4 text-[13px] font-semibold text-fg transition-colors hover:bg-accent/[0.14]">
                <ImageUp size={16} aria-hidden />
                Use device camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    stopCamera();
                    onCapture(file);
                  }}
                />
              </label>
              <Button type="button" variant="ghost" className="w-full" onClick={close}>
                Cancel
              </Button>
            </>
          )}

          <p className="text-center text-[10px] leading-relaxed text-muted">
            The photograph is added only after you choose “Use photo”. Camera access needs a secure connection and
            your permission; uploading files always works without it.
          </p>
        </div>
      </div>
    </div>
  );
}
