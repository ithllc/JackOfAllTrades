import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Flashlight,
  FlashlightOff,
  Mic,
  ScanSearch,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import {
  buildHotspotFromDiagnosis,
  type HighlightHotspot,
  type ScanPhase,
} from '../lib/makerLensState';
import {
  formatRecordingDuration,
  pickBestRecorderMimeType,
} from '../lib/audioUtils';
import {
  resolveScaleCalibration,
  WHY_SCALE_MATTERS_SPOKEN,
} from '../lib/scaleCalibration';
import { ScanningOverlay } from './ScanningOverlay';
import { InstructionSheet } from './InstructionSheet';
import { BrandMark } from './BrandMark';

interface LiveCameraViewProps {
  flashlightOn: boolean;
  scanPhase: ScanPhase;
  activeHotspot: HighlightHotspot | null;
  errorMessage: string | null;
  onToggleFlashlight: () => void;
  onStartScan: () => void;
  onScanSucceeded: (hotspot: HighlightHotspot) => void;
  onScanFailed: (message: string) => void;
  onResetScan: () => void;
  onOpenAdmin?: () => void;
}

type VoicePhase = 'idle' | 'recording' | 'thinking' | 'speaking';

interface BufferedFrame {
  timestampMs: number;
  dataUrl: string;
}

/**
 * Helper: Encodes a browser MediaRecorder audio Blob into a Base64 data URL
 * ("data:audio/webm;codecs=opus;base64,...") so it can be transmitted cleanly
 * alongside the JPEG video frame buffer to the Express backend.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not encode recorded audio.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType || 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * The "Magic Window" Live Camera Screen with Native Two-Way Audio & Scale Enforcement:
 * Full-screen camera feed with zero technical clutter.
 * Both "Scan Problem" AND "Hold to Explain" enforce Scale Anchoring (quarter, credit card,
 * or thumb), confirm when scale is calibrated, allow opting out with a written + spoken
 * summary of why scaling matters, and display the complete AI Fix sheet.
 */
export const LiveCameraView: React.FC<LiveCameraViewProps> = ({
  flashlightOn,
  scanPhase,
  activeHotspot,
  errorMessage,
  onToggleFlashlight,
  onStartScan,
  onScanSucceeded,
  onScanFailed,
  onResetScan,
  onOpenAdmin,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Rolling buffer of recent visual frames packaged with push-to-talk audio
  const frameBufferRef = useRef<BufferedFrame[]>([]);

  // MediaRecorder & microphone stream refs for Push-to-Talk ("Hold to Explain")
  const micStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const recordStartMsRef = useRef<number>(0);
  const recordTimerRef = useRef<number | null>(null);
  const isHoldingRef = useRef<boolean>(false);

  // Hidden <audio> element + object URL ref for automatic binary WAV playback
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const responseAudioUrlRef = useRef<string | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [motionVideoUrl, setMotionVideoUrl] = useState<string | null>(null);
  const [loadingMotionVideo, setLoadingMotionVideo] = useState(false);

  // Scale Anchor opt-out preference (user can tap Continue Without Scaling or say it aloud)
  const [scaleOptOut, setScaleOptOut] = useState(false);

  // Native two-way voice & spoken guidance state
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [recordingMs, setRecordingMs] = useState(0);
  const [spokenReply, setSpokenReply] = useState<string | null>(null);
  const [spokenLanguage, setSpokenLanguage] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [hasReplyAudio, setHasReplyAudio] = useState(false);

  // Initialize live rear-facing camera via MediaDevices API on mount
  useEffect(() => {
    let active = true;

    const initCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraReady(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        if (caps?.torch) {
          setTorchSupported(true);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
      } catch {
        if (active) setCameraReady(false);
      }
    };

    void initCamera();

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      if (recordTimerRef.current !== null) {
        window.clearInterval(recordTimerRef.current);
      }
      if (responseAudioUrlRef.current) {
        URL.revokeObjectURL(responseAudioUrlRef.current);
        responseAudioUrlRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore browser speech synthesis cleanup quirks
        }
      }
    };
  }, []);

  // Apply real hardware torch constraint whenever flashlightOn changes
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || !torchSupported) return;

    track
      .applyConstraints({
        advanced: [{ torch: flashlightOn } as MediaTrackConstraintSet],
      })
      .catch(() => {
        // Silently rely on screen-fill light if device refuses torch constraint
      });
  }, [flashlightOn, torchSupported]);

  // Smooth preview viewfinder backdrop when device camera is unavailable (desktop/headless)
  useEffect(() => {
    if (cameraReady) return undefined;
    const canvas = fallbackCanvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let rafId = 0;
    let lastDraw = 0;
    const startTime = performance.now();

    const renderViewfinder = (now: number) => {
      if (now - lastDraw >= 66 || lastDraw === 0) {
        lastDraw = now;
        const t = (now - startTime) / 1000;
        const w = canvas.clientWidth || 1280;
        const h = canvas.clientHeight || 720;

        if (canvas.width !== Math.floor(w) || canvas.height !== Math.floor(h)) {
          canvas.width = Math.floor(w);
          canvas.height = Math.floor(h);
        }

        ctx.save();

        const lightBoost = flashlightOn ? 1.38 : 1.0;
        const grad = ctx.createRadialGradient(
          w * 0.5,
          h * 0.45,
          30,
          w * 0.5,
          h * 0.5,
          Math.max(w, h) * 0.72
        );
        grad.addColorStop(0, flashlightOn ? '#47433c' : '#25272b');
        grad.addColorStop(0.55, flashlightOn ? '#272521' : '#15171a');
        grad.addColorStop(1, '#090a0c');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        const driftX = Math.sin(t * 0.8) * 3;
        const driftY = Math.cos(t * 0.6) * 2;
        const cx = w * 0.5 + driftX;
        const cy = h * 0.46 + driftY;

        ctx.fillStyle = `rgba(${Math.round(58 * lightBoost)}, ${Math.round(62 * lightBoost)}, ${Math.round(70 * lightBoost)}, 1)`;
        ctx.beginPath();
        ctx.roundRect(cx - 110, cy - 72, 220, 144, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const plateGrad = ctx.createLinearGradient(cx - 80, cy - 35, cx + 80, cy + 35);
        plateGrad.addColorStop(0, flashlightOn ? '#b9c0ca' : '#7f8794');
        plateGrad.addColorStop(0.5, flashlightOn ? '#e2e7ee' : '#a7b0be');
        plateGrad.addColorStop(1, flashlightOn ? '#8b93a0' : '#5e6673');
        ctx.fillStyle = plateGrad;
        ctx.beginPath();
        ctx.roundRect(cx - 82, cy - 38, 164, 76, 10);
        ctx.fill();

        ctx.fillStyle = flashlightOn ? '#f3f5f8' : '#cfd6e0';
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3b424d';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy);
        ctx.lineTo(cx + 9, cy);
        ctx.moveTo(cx, cy - 9);
        ctx.lineTo(cx, cy + 9);
        ctx.stroke();

        if (flashlightOn) {
          const beam = ctx.createRadialGradient(
            w * 0.5,
            h * 0.45,
            20,
            w * 0.5,
            h * 0.45,
            Math.min(w, h) * 0.55
          );
          beam.addColorStop(0, 'rgba(255, 250, 232, 0.22)');
          beam.addColorStop(1, 'rgba(255, 250, 232, 0)');
          ctx.fillStyle = beam;
          ctx.fillRect(0, 0, w, h);
        }

        ctx.restore();
      }

      if (scanPhase !== 'scanning' && voicePhase !== 'thinking' && !sheetOpen) {
        rafId = window.requestAnimationFrame(renderViewfinder);
      }
    };

    rafId = window.requestAnimationFrame(renderViewfinder);
    return () => window.cancelAnimationFrame(rafId);
  }, [cameraReady, flashlightOn, scanPhase, voicePhase, sheetOpen]);

  // Capture a snapshot frame from live camera or preview canvas
  const captureFrameDataUrl = useCallback((): string | null => {
    let canvas = captureCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      captureCanvasRef.current = canvas;
    }
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (cameraReady && videoRef.current && videoRef.current.readyState >= 2) {
      ctx.drawImage(videoRef.current, 0, 0, 640, 360);
    } else if (fallbackCanvasRef.current) {
      ctx.drawImage(fallbackCanvasRef.current, 0, 0, 640, 360);
    } else {
      return null;
    }
    return canvas.toDataURL('image/jpeg', 0.8);
  }, [cameraReady]);

  // Maintain a lightweight rolling buffer of up to 4 recent frames (every 2.5s)
  useEffect(() => {
    const sampleFrame = () => {
      if (scanPhase === 'scanning' || voicePhase === 'thinking' || sheetOpen) return;
      const dataUrl = captureFrameDataUrl();
      if (!dataUrl) return;
      const next = [...frameBufferRef.current, { timestampMs: Date.now(), dataUrl }];
      frameBufferRef.current = next.slice(-4);
    };

    const timer = window.setInterval(sampleFrame, 2500);
    return () => window.clearInterval(timer);
  }, [captureFrameDataUrl, scanPhase, voicePhase, sheetOpen]);

  // Stop any currently playing AI voice reply (HTMLAudioElement or SpeechSynthesis)
  const stopAudioPlayback = useCallback(() => {
    const player = audioPlayerRef.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser quirks
      }
    }
    setVoicePhase((prev) => (prev === 'speaking' ? 'idle' : prev));
  }, []);

  // Play an Object URL WAV via the hidden <audio> element
  const playAudioObjectUrl = useCallback(async (objectUrl: string) => {
    if (responseAudioUrlRef.current) {
      URL.revokeObjectURL(responseAudioUrlRef.current);
    }
    responseAudioUrlRef.current = objectUrl;
    setHasReplyAudio(true);

    const player = audioPlayerRef.current;
    if (!player) {
      setVoicePhase('idle');
      return;
    }

    player.src = objectUrl;
    setVoicePhase('speaking');
    await player.play().catch(() => {
      // If browser autoplay blocks playback, user can tap the Replay button
      setVoicePhase('idle');
    });
  }, []);

  // Fallback browser speech synthesis when neural WAV is unavailable
  const speakFallbackBrowserVoice = useCallback((text: string, lang?: string) => {
    if (!text.trim() || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang || navigator.language || 'en-US';
      utterance.rate = 0.98;
      utterance.onstart = () => setVoicePhase('speaking');
      utterance.onend = () => setVoicePhase('idle');
      utterance.onerror = () => setVoicePhase('idle');
      window.speechSynthesis.speak(utterance);
    } catch {
      setVoicePhase('idle');
    }
  }, []);

  // Speak a short notice (e.g., why scaling matters after opting out) via neural TTS + fallback
  const speakNoticeText = useCallback(
    async (text: string, lang?: string) => {
      stopAudioPlayback();
      setSpokenReply(text);
      try {
        const resp = await fetch('/api/speak-notice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            language: lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US'),
          }),
        });
        if (resp.ok && (resp.headers.get('content-type') || '').includes('audio/')) {
          const wavBlob = await resp.blob();
          const url = URL.createObjectURL(wavBlob);
          await playAudioObjectUrl(url);
          return;
        }
      } catch {
        // Fall through to browser voice synthesis
      }
      speakFallbackBrowserVoice(text, lang);
    },
    [playAudioObjectUrl, speakFallbackBrowserVoice, stopAudioPlayback]
  );

  // Replay the last spoken mechanic response from the cached binary WAV Blob URL
  const handleReplayAudio = useCallback(async () => {
    const player = audioPlayerRef.current;
    if (player && responseAudioUrlRef.current) {
      try {
        player.currentTime = 0;
        setVoicePhase('speaking');
        await player.play();
        return;
      } catch {
        setVoicePhase('idle');
      }
    }
    if (spokenReply) {
      speakFallbackBrowserVoice(spokenReply);
    }
  }, [speakFallbackBrowserVoice, spokenReply]);

  // Package recorded audio Blob + rolling visual buffer -> POST /api/voice-assist
  // Shows BOTH the spoken multilingual reply AND the complete structured AI Fix sheet!
  const sendVoiceExplainPayload = useCallback(
    async (audioBlob: Blob) => {
      setVoicePhase('thinking');
      setVoiceNotice(null);
      setMotionVideoUrl(null);

      try {
        // 1. Encode recorded MediaRecorder Blob into a Base64 data URL
        const audioDataUrl = await blobToDataUrl(audioBlob);

        // 2. Capture one fresh frame on release and merge with the rolling frame buffer
        const latestFrame = captureFrameDataUrl();
        const frames: BufferedFrame[] = [...frameBufferRef.current];
        if (latestFrame) {
          frames.push({ timestampMs: Date.now(), dataUrl: latestFrame });
        }

        // 3. Send audio + visual frames + scaleOptOut and request structured JSON + Base64 WAV
        const resp = await fetch('/api/voice-assist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            frames: frames.slice(-4),
            preferredLanguage: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
            scaleAnchor: 'none',
            hasWebXRDepth: false,
            scaleOptOut,
            audio: {
              data: audioDataUrl,
              mimeType: audioBlob.type || 'audio/webm',
            },
          }),
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(
            typeof data?.error === 'string'
              ? data.error
              : "Couldn't hear that clearly. Hold the button a moment longer and try again."
          );
        }

        const transcriptText = typeof data.spokenText === 'string' ? data.spokenText : '';
        const detectedLangName =
          typeof data.detectedLanguageName === 'string' ? data.detectedLanguageName : null;

        if (transcriptText) {
          setSpokenReply(transcriptText);
        }
        setSpokenLanguage(detectedLangName);

        // If user verbally declined scaling (e.g., "I don't want to scale"), persist opt-out for session
        if (data.scaleCalibration?.optedOut) {
          setScaleOptOut(true);
        }

        // Surface the full AI Fix overlay + InstructionSheet just like Scan Problem!
        if (data.speechDetected !== false && data.diagnosis) {
          const hotspot = buildHotspotFromDiagnosis({
            diagnosis: data.diagnosis,
            scaleCalibration: data.scaleCalibration ?? null,
            spokenText: transcriptText,
            sourceMode: 'voice',
            spokenLanguage: detectedLangName,
            userTranscript: typeof data.userTranscript === 'string' ? data.userTranscript : null,
          });
          onScanSucceeded(hotspot);
          setSheetOpen(true);
        }

        // 4. Automatically play the generated WAV speech in the user's detected language
        if (typeof data.audioBase64 === 'string' && data.audioBase64.length > 32) {
          const audioUrl = base64ToBlobUrl(data.audioBase64, data.audioMimeType || 'audio/wav');
          await playAudioObjectUrl(audioUrl);
        } else if (transcriptText) {
          speakFallbackBrowserVoice(transcriptText, data.detectedLanguageCode);
        } else {
          setVoicePhase('idle');
        }
      } catch (err) {
        setVoicePhase('idle');
        setVoiceNotice(
          err instanceof Error
            ? err.message
            : "We couldn't hear you clearly. Hold the button while speaking and try again."
        );
      }
    },
    [
      captureFrameDataUrl,
      onScanSucceeded,
      playAudioObjectUrl,
      scaleOptOut,
      speakFallbackBrowserVoice,
    ]
  );

  // Push-to-Talk PRESS: start capturing microphone via MediaRecorder API
  const handleStartTalking = useCallback(async () => {
    if (isHoldingRef.current || scanPhase === 'scanning' || voicePhase === 'thinking') return;
    isHoldingRef.current = true;
    setVoiceNotice(null);
    stopAudioPlayback();

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      isHoldingRef.current = false;
      setVoiceNotice('Voice recording is not supported in this browser.');
      return;
    }

    try {
      let micStream = micStreamRef.current;
      const hasLiveTrack = micStream?.getAudioTracks().some((t) => t.readyState === 'live');
      if (!micStream || !hasLiveTrack) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        micStreamRef.current = micStream;
      }

      if (!isHoldingRef.current) return;

      const mimeType = pickBestRecorderMimeType((m) => MediaRecorder.isTypeSupported(m));
      const recorder = mimeType
        ? new MediaRecorder(micStream, { mimeType })
        : new MediaRecorder(micStream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (recordTimerRef.current !== null) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        const elapsed = Date.now() - recordStartMsRef.current;
        setRecordingMs(0);

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        });
        audioChunksRef.current = [];

        if (elapsed < 350 || blob.size < 256) {
          setVoicePhase('idle');
          setVoiceNotice('Hold the button down while you explain the problem, then release.');
          return;
        }

        void sendVoiceExplainPayload(blob);
      };

      mediaRecorderRef.current = recorder;
      recordStartMsRef.current = Date.now();
      setRecordingMs(0);
      setVoicePhase('recording');
      recorder.start(150);

      recordTimerRef.current = window.setInterval(() => {
        setRecordingMs(Date.now() - recordStartMsRef.current);
      }, 200);
    } catch {
      isHoldingRef.current = false;
      setVoicePhase('idle');
      setVoiceNotice(
        'Please allow microphone access so you can hold the button and explain the problem.'
      );
    }
  }, [scanPhase, sendVoiceExplainPayload, stopAudioPlayback, voicePhase]);

  // Push-to-Talk RELEASE: stop MediaRecorder (triggers onstop -> upload -> AI Fix + spoken reply)
  const handleStopTalking = useCallback(() => {
    if (!isHoldingRef.current) return;
    isHoldingRef.current = false;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      setVoicePhase('idle');
    }
  }, []);

  // Primary "Scan Problem" handler: blurs camera, runs Decisions -> Neon + Scale Anchor Guard + TTS
  const handleScanProblem = useCallback(
    async (overrideOptOut?: boolean) => {
      const effectiveOptOut = overrideOptOut ?? scaleOptOut;
      stopAudioPlayback();
      setVoiceNotice(null);
      setMotionVideoUrl(null);
      setSheetOpen(false);
      onStartScan();

      const frame = captureFrameDataUrl();
      if (!frame) {
        onScanFailed("We couldn't capture a clear image. Hold steady and try again.");
        return;
      }

      try {
        const resp = await fetch('/api/analyze-buffer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frames: [{ timestampMs: Date.now(), dataUrl: frame }],
            ingestMode: 'webrtc_15fps',
            scaleAnchor: 'none',
            hasWebXRDepth: false,
            scaleOptOut: effectiveOptOut,
            preferredLanguage: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
            stillDurationMs: 3200,
            userQuestion:
              'Identify the main part, check for any scale object (quarter, credit card, thumb), and explain the safest next step in simple everyday terms.',
          }),
        });

        const data = await resp.json();
        if (!resp.ok) {
          throw new Error('Could not complete the scan right now.');
        }

        const spoken = typeof data.spokenText === 'string' ? data.spokenText : '';
        if (spoken) {
          setSpokenReply(spoken);
          setSpokenLanguage(null);
        }

        const hotspot = buildHotspotFromDiagnosis({
          diagnosis: data.diagnosis,
          scaleCalibration: data.scaleCalibration ?? null,
          spokenText: spoken,
          voiceInstruction: data.voiceInstruction,
          sourceMode: 'scan',
        });
        onScanSucceeded(hotspot);
        setSheetOpen(true);

        // Speak the scale calibration confirmation / anchor request / opt-out notice aloud!
        if (typeof data.audioBase64 === 'string' && data.audioBase64.length > 32) {
          const audioUrl = base64ToBlobUrl(data.audioBase64, data.audioMimeType || 'audio/wav');
          await playAudioObjectUrl(audioUrl);
        } else if (spoken) {
          speakFallbackBrowserVoice(spoken);
        }
      } catch {
        onScanFailed(
          "We couldn't get a clear look just now. Add a little more light, hold steady, and tap Scan Problem again."
        );
      }
    },
    [
      captureFrameDataUrl,
      onScanFailed,
      onScanSucceeded,
      onStartScan,
      playAudioObjectUrl,
      scaleOptOut,
      speakFallbackBrowserVoice,
      stopAudioPlayback,
    ]
  );

  // User clicks "Continue Without Scaling" inside the AI Fix sheet:
  // Updates text card immediately AND speaks aloud why using a scale object matters.
  const handleOptOutScale = useCallback(() => {
    setScaleOptOut(true);
    if (activeHotspot) {
      const optedOutCalibration = resolveScaleCalibration({
        detectedObject: 'none',
        scaleCalibrated: false,
        explicitOptOut: true,
        localizedWhyScaleMatters: activeHotspot.scaleCalibration?.whyScaleMatters,
      });
      onScanSucceeded({
        ...activeHotspot,
        scaleCalibration: optedOutCalibration,
      });
    }
    void speakNoticeText(WHY_SCALE_MATTERS_SPOKEN);
  }, [activeHotspot, onScanSucceeded, speakNoticeText]);

  // User clicks "Re-Scan with Object" after placing a quarter, card, or thumb beside the part
  const handleRescanWithAnchor = useCallback(() => {
    setScaleOptOut(false);
    void handleScanProblem(false);
  }, [handleScanProblem]);

  // User changes their mind after opting out and wants to calibrate with an object
  const handleReenableScale = useCallback(() => {
    setScaleOptOut(false);
    if (activeHotspot) {
      const needsAnchorCalibration = resolveScaleCalibration({
        detectedObject: 'none',
        scaleCalibrated: false,
        explicitOptOut: false,
      });
      onScanSucceeded({
        ...activeHotspot,
        scaleCalibration: needsAnchorCalibration,
      });
    }
  }, [activeHotspot, onScanSucceeded]);

  // Optional "Show Me How" motion clip from backend
  const handleRequestMotionVideo = async () => {
    if (!activeHotspot?.motionPrompt) return;
    setLoadingMotionVideo(true);
    try {
      const frame = captureFrameDataUrl();
      const resp = await fetch('/api/generate-pip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: activeHotspot.motionPrompt,
          referenceFrameDataUrl: frame,
          duration: '6s',
        }),
      });
      const data = await resp.json();
      if (resp.ok && (data.videoDataUrl || data.videoUri)) {
        setMotionVideoUrl(data.videoDataUrl || data.videoUri);
      }
    } finally {
      setLoadingMotionVideo(false);
    }
  };

  const isScanning = scanPhase === 'scanning';
  const isThinkingVoice = voicePhase === 'thinking';
  const isRecording = voicePhase === 'recording';
  const isSpeaking = voicePhase === 'speaking';
  const isBusy = isScanning || isThinkingVoice;

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black text-white select-none">
      {/* Hidden <audio> element that automatically plays Gemini's binary WAV speech response */}
      <audio
        ref={audioPlayerRef}
        className="hidden"
        onEnded={() => setVoicePhase('idle')}
        onError={() => setVoicePhase('idle')}
      />

      {/* Full-Screen "Magic Window" Camera Feed (blurs smoothly while scanning or thinking) */}
      <div
        className={`absolute inset-0 transition-all duration-300 ${
          isBusy ? 'scale-105 blur-md' : 'scale-100 blur-0'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover ${
            cameraReady ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />

        {!cameraReady && (
          <canvas
            ref={fallbackCanvasRef}
            data-testid="live-camera-canvas"
            aria-label="Live repair viewfinder"
            className="absolute inset-0 h-full w-full"
          />
        )}
      </div>

      {/* Soft screen-fill light ring when Flashlight is toggled on a device without hardware torch */}
      {flashlightOn && !torchSupported && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 border-[10px] border-amber-100/40 shadow-[inset_0_0_90px_rgba(255,248,220,0.28)] transition-opacity duration-200"
        />
      )}

      {/* Measured top & bottom scrims for crisp iOS-camera contrast */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/75 via-black/30 to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-44 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
        aria-hidden="true"
      />

      {/* TOP CONTROL: Brand Logo + Flashlight Toggle (zero technical settings) */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-5 pt-5 sm:px-8 sm:pt-6">
        <BrandMark
          compact
          onClick={
            onOpenAdmin
              ? () => {
                  stopAudioPlayback();
                  onOpenAdmin();
                }
              : undefined
          }
          title="Open Admin Platform"
        />

        <button
          type="button"
          onClick={onToggleFlashlight}
          aria-pressed={flashlightOn}
          aria-label={flashlightOn ? 'Turn flashlight off' : 'Turn flashlight on'}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
            flashlightOn
              ? 'bg-amber-400 text-neutral-950 shadow-lg shadow-amber-400/25'
              : 'bg-black/55 border border-white/15 text-white hover:bg-black/70'
          }`}
        >
          {flashlightOn ? (
            <Flashlight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <FlashlightOff className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="whitespace-nowrap">{flashlightOn ? 'Flashlight On' : 'Flashlight'}</span>
        </button>
      </header>

      {/* Highlighted Part Overlay after EITHER Scan Problem or Hold to Explain */}
      {scanPhase === 'result' && activeHotspot && (
        <div
          className="absolute z-20"
          style={{
            left: `${activeHotspot.xPct}%`,
            top: `${activeHotspot.yPct}%`,
            width: `${activeHotspot.wPct}%`,
            height: `${activeHotspot.hPct}%`,
          }}
        >
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={`View repair instructions for ${activeHotspot.label}`}
            className="relative h-full w-full min-h-[56px] rounded-2xl border-2 border-amber-400 bg-amber-400/15 hover:bg-amber-400/25 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1 text-xs font-semibold text-amber-300 whitespace-nowrap shadow-md">
              {activeHotspot.label}
            </span>
          </button>
        </div>
      )}

      {/* Human-Readable Blurred Scanning / Listening Overlay */}
      {isScanning && <ScanningOverlay />}
      {isThinkingVoice && <ScanningOverlay customMessage="Listening to your question..." />}

      {/* Live Push-to-Talk Recording Cue */}
      {isRecording && (
        <div
          role="status"
          aria-live="assertive"
          className="pointer-events-none absolute inset-x-4 bottom-28 z-20 mx-auto flex max-w-xs items-center justify-center gap-2.5 rounded-full bg-red-600/95 px-5 py-2.5 text-sm font-semibold text-white shadow-2xl backdrop-blur-md"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-white animate-ping" aria-hidden="true" />
          <span className="tabular-nums">{formatRecordingDuration(recordingMs)}</span>
          <span className="text-white/90">Release when finished</span>
        </div>
      )}

      {/* Spoken AI Mechanic Caption Card (shown when sheet is closed) */}
      {!sheetOpen && !isRecording && !isBusy && spokenReply && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-x-4 bottom-28 z-20 mx-auto max-w-md rounded-2xl bg-neutral-950/90 border border-white/15 px-4 py-3.5 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => (isSpeaking ? stopAudioPlayback() : void handleReplayAudio())}
              disabled={!hasReplyAudio && !spokenReply}
              aria-label={isSpeaking ? 'Stop spoken response' : 'Replay spoken response'}
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                isSpeaking
                  ? 'bg-amber-400 text-neutral-950 animate-pulse'
                  : 'bg-white/12 text-amber-400 hover:bg-white/20'
              }`}
            >
              {isSpeaking ? (
                <Square className="h-4 w-4 fill-current" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
                {isSpeaking ? 'Speaking' : 'Mechanic Guidance'}
                {spokenLanguage ? ` · ${spokenLanguage}` : ''}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-white">{spokenReply}</p>
              {activeHotspot && (
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="mt-1.5 text-xs font-semibold text-amber-300 underline underline-offset-2 hover:text-amber-200 cursor-pointer"
                >
                  Open Step-by-Step AI Fix
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                stopAudioPlayback();
                setSpokenReply(null);
              }}
              aria-label="Dismiss spoken response"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Plain-English Recovery Notice for Scan or Microphone Errors */}
      {!isRecording && !isBusy && (voiceNotice || (scanPhase === 'error' && errorMessage)) && (
        <div
          role="alert"
          className="absolute inset-x-4 bottom-28 z-20 mx-auto max-w-sm rounded-2xl bg-neutral-950/90 border border-white/15 px-5 py-3.5 text-center shadow-2xl backdrop-blur-xl"
        >
          <p className="text-sm font-medium text-white leading-relaxed">
            {voiceNotice || errorMessage}
          </p>
        </div>
      )}

      {/* BOTTOM CONTROL DOCK: "Scan Problem" + Push-to-Talk "Hold to Explain" */}
      {!sheetOpen && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-7 sm:px-6 sm:pb-10">
          <div className="flex w-full max-w-md items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void handleScanProblem()}
              disabled={isBusy || isRecording}
              className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3.5 text-sm sm:text-base font-bold tracking-tight text-neutral-950 shadow-2xl shadow-black/50 hover:bg-neutral-100 active:scale-[0.97] transition-all disabled:opacity-55 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400"
            >
              <ScanSearch className="h-5 w-5 shrink-0 text-neutral-950" aria-hidden="true" />
              <span>{isScanning ? 'Scanning...' : 'Scan Problem'}</span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                void handleStartTalking();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                handleStopTalking();
              }}
              onPointerCancel={() => handleStopTalking()}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                  e.preventDefault();
                  void handleStartTalking();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handleStopTalking();
                }
              }}
              disabled={isBusy}
              aria-pressed={isRecording}
              aria-label="Hold to explain the problem out loud"
              className={`touch-none inline-flex min-h-[56px] flex-1 items-center justify-center gap-2.5 rounded-full px-5 py-3.5 text-sm sm:text-base font-bold tracking-tight shadow-2xl transition-all disabled:opacity-55 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400 ${
                isRecording
                  ? 'scale-[1.03] bg-red-500 text-white shadow-red-500/40 ring-4 ring-red-400/35'
                  : 'border border-white/25 bg-black/70 text-white backdrop-blur-xl hover:bg-black/85 active:scale-[0.98]'
              }`}
            >
              <Mic
                className={`h-5 w-5 shrink-0 ${isRecording ? 'text-white' : 'text-amber-400'}`}
                aria-hidden="true"
              />
              <span>
                {isRecording
                  ? `Listening ${formatRecordingDuration(recordingMs)}`
                  : isThinkingVoice
                    ? 'Thinking...'
                    : 'Hold to Explain'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Step-by-Step Repair Instruction Sheet (Unified for Scan Problem & Hold to Explain) */}
      {scanPhase === 'result' && activeHotspot && sheetOpen && (
        <InstructionSheet
          hotspot={activeHotspot}
          primaryActionLabel="Scan Again"
          onPrimaryAction={() => {
            setSheetOpen(false);
            setMotionVideoUrl(null);
            onResetScan();
          }}
          onClose={() => setSheetOpen(false)}
          motionVideoUrl={motionVideoUrl}
          loadingMotionVideo={loadingMotionVideo}
          onRequestMotionVideo={
            activeHotspot.motionPrompt ? () => void handleRequestMotionVideo() : undefined
          }
          isSpeaking={isSpeaking}
          hasAudio={hasReplyAudio || Boolean(spokenReply)}
          onReplayAudio={() => void handleReplayAudio()}
          onStopAudio={stopAudioPlayback}
          onRescanWithAnchor={handleRescanWithAnchor}
          onOptOutScale={handleOptOutScale}
          onReenableScale={handleReenableScale}
        />
      )}
    </div>
  );
};
