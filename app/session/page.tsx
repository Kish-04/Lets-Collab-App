"use client"

declare global {
    interface Window {
        ipcRenderer?: {
            send: (channel: string, data: any) => void
            on: (channel: string, func: (...args: any[]) => void) => void
        }
    }
}

import { useState, useEffect, useRef, useCallback } from "react"
import type { FormEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from 'react'
import { io, Socket } from "socket.io-client"
import { User, Copy, Check, MousePointer2, Keyboard, Maximize2, Minimize2, Video, VideoOff, Mic, MicOff, Settings, ShieldAlert, Monitor, Gamepad2, ArrowLeftRight, Square, Eye, MousePointer,
    MessageSquare, Send, Camera, Disc, Clipboard, ClipboardX, Copy as CopyIcon, Maximize, Minimize, Crosshair, Zap, Radio, AlertTriangle, Link, Volume2,
    VolumeX, ChevronDown, ChevronUp, ArrowLeft, XCircle, LogOut, Brain, PenTool
} from 'lucide-react'
import {
    StatusBadge, RoomCodeDisplay, DataCard, TerminalLine,
    SectionHeader, DangerButton, GlowButton, LiveDot, AppLogo
} from "@/components/ircp/shared"
import { PermissionRequestModal } from "@/components/ircp/permission-modal"

import { VoiceChanger, VoiceFilter } from "@/lib/VoiceChanger"
import { VirtualAvatar, AvatarStyle } from "@/lib/VirtualAvatar"
import { VirtualBackground, BackgroundStyle } from "@/lib/VirtualBackground"
import { dataChannelManager } from "@/lib/DataChannelManager"
import { FileTransfer } from "@/components/ircp/FileTransfer"
import { WhiteboardOverlay } from "@/components/ircp/WhiteboardOverlay"
import { StandaloneCanvas } from "@/components/ircp/StandaloneCanvas"
import { AiSupervisor } from "@/components/ircp/supervisor/AiSupervisor"
import { SessionRecorder } from "@/lib/SessionRecorder"
import { FederatedFeatures, FederatedLearner } from "@/lib/FederatedLearner"

import dynamic from 'next/dynamic'

import { AntiCheatEngine, AntiCheatEvent } from "@/lib/AntiCheatEngine"
import { cn, getBackendUrl, fetchIceServers, getStoredAuthToken } from "@/lib/utils"
import {
    APPEARANCE_CHANGE_EVENT, APPEARANCE_LOCK_EVENT, AppearanceConfig,
    readPersonalAppearance, SessionMode
} from "@/lib/appearance"

type Role = "host" | "controller"
type PermissionLevel = "view" | "mouse" | "keyboard" | "full"
type ConnectionState = "idle" | "waiting" | "connecting" | "connected"
type LogEntry = {
    time: string
    type: "system" | "user" | "input" | "permission" | "anticheat" | "chain" | "chat" | "quality" | "recording"
    message: string
}
type ParticipantQuality = {
    latency: number | null
    fps: number | null
    packetLoss: number | null
    health: "excellent" | "good" | "fair" | "poor" | "unknown"
}
type Participant = {
    id: string
    socketId: string
    name: string
    email?: string | null
    initials?: string
    role: "controller"
    permission: PermissionLevel
    clipboardAllowed: boolean
    joinedAt: number
    quality?: ParticipantQuality
}
type JoinRequest = {
    id: string
    socketId: string
    name: string
    email?: string | null
    initials?: string
    device?: string
    ip?: string
    requestedAt: number
}
type ChatMessage = {
    id: string
    time: string
    senderId: string
    senderName: string
    role: "host" | "controller" | "admin"
    text: string
}
type EvidenceItem = {
    id?: string
    time?: string
    timestamp?: string
    type: string
    by?: string
    label?: string
    message?: string
}

const permissionLevels = [
    { id: "view" as const, label: "View Only", icon: Eye },
    { id: "mouse" as const, label: "Mouse Only", icon: MousePointer },
    { id: "keyboard" as const, label: "Keyboard Only", icon: Keyboard },
    { id: "full" as const, label: "Full Control", icon: Zap },
]

const quickChatEmojis = ['👍', '🙏', '✅', '🔥', '😂', '🎉']

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

function formatDuration(s: number) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function ConnectionQualityMeter({ latency }: { latency: number }) {
    const bars = 4
    const active = latency < 50 ? 4 : latency < 100 ? 3 : latency < 150 ? 2 : 1
    const color = latency < 50 ? "var(--emerald)" : latency < 150 ? "var(--amber)" : "var(--red)"
    return (
        <div className="flex items-end gap-0.5 h-4">
            {Array.from({ length: bars }).map((_, i) => (
                <div key={i} className="w-1 rounded-sm transition-all"
                    style={{ height: `${((i + 1) / bars) * 100}%`, backgroundColor: i < active ? color : "var(--border)" }} />
            ))}
        </div>
    )
}

function hasTurnServer(servers: RTCIceServer[]) {
    return servers.some(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
        return urls.some(url => typeof url === 'string' && /^turns?:/i.test(url))
    })
}

export default function SessionPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[var(--bg)] flex items-center justify-center text-[var(--text-dim)] font-mono">Loading Session...</div>}>
            <SessionContent />
        </Suspense>
    )
}

function SessionContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialRoom = searchParams.get("room")
    const createDirect = searchParams.get("create") === "true"
    const joinDirect = searchParams.get("join") === "true"
    const requestedMode: SessionMode = searchParams.get("mode") === "supervised" ? "supervised" : "collaboration"

    // ── Setup state ───────────────────────────────────────────────────────────
    const [setupMode, setSetupMode] = useState<"choose" | "join" | null>(
        initialRoom ? "join" : createDirect ? null : (joinDirect ? "join" : "choose")
    )
    const [joinInput, setJoinInput] = useState(initialRoom || "")
    const [setupError, setSetupError] = useState("")
    const startedAtRef = useRef(0)

    // ── Malpractice Detection (OS-Level Focus Loss) ───────────────────────────
    // ── Session state ───────────────────────────────────────────────────────────
    const [role, setRole] = useState<Role>(initialRoom || joinDirect ? "controller" : "host")
    const [sessionMode, setSessionMode] = useState<SessionMode>(requestedMode)
    const [roomCode, setRoomCode] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [connectionState, setConnectionState] = useState<ConnectionState>("idle")
    const [isCalibrating, setIsCalibrating] = useState(false)
    const [permission, setPermission] = useState<PermissionLevel>("view")
    const [isStreaming, setIsStreaming] = useState(false)
    const [duration, setDuration] = useState(0)
    const [latency, setLatency] = useState(0)
    const [riskScore, setRiskScore] = useState(0)
    const [peerCount, setPeerCount] = useState(0)
    const [sessionLogs, setSessionLogs] = useState<LogEntry[]>([])
    const [statusMessage, setStatusMessage] = useState("")
    const [showKillConfirm, setShowKillConfirm] = useState(false)
    const iceServersRef = useRef<RTCIceServer[]>([])

    useEffect(() => {
        fetchIceServers().then(servers => {
            console.log('[DEBUG] Fetched ICE Servers:', servers);
            iceServersRef.current = servers;
        });
    }, []);
    const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [audioMuted, setAudioMuted] = useState(false)
    const [systemAudioOn, setSystemAudioOn] = useState(false)
    const [pipCollapsed, setPipCollapsed] = useState(false)
    const [videoStats, setVideoStats] = useState("")
    const [mouseEnabled, setMouseEnabled] = useState(false)
    const [keyboardEnabled, setKeyboardEnabled] = useState(false)
    const [hudVisible, setHudVisible] = useState(true)
    const [isSwitching, setIsSwitching] = useState(false)
    const [linkCopied, setLinkCopied] = useState(false)
    const [showPermModal, setShowPermModal] = useState(false)
    const [requestingUser, setRequestingUser] = useState<any>(null)
    const [participants, setParticipants] = useState<Participant[]>([])
    const [pendingJoinRequests, setPendingJoinRequests] = useState<JoinRequest[]>([])
    const [selectedControllerId, setSelectedControllerId] = useState<string | null>(null)
    const [clipboardAllowed, setClipboardAllowed] = useState(false)
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
    const [chatInput, setChatInput] = useState("")
    const [chatOpen, setChatOpen] = useState(false)
    const [remoteCameraStreams, setRemoteCameraStreams] = useState<Record<string, MediaStream>>({})
    const [evidence, setEvidence] = useState<EvidenceItem[]>([])
    const [packetLoss, setPacketLoss] = useState<number | null>(null)
    const [streamFps, setStreamFps] = useState<number | null>(null)
    const [connectionHealth, setConnectionHealth] = useState<ParticipantQuality["health"]>("unknown")
    const [isRecording, setIsRecording] = useState(false)
    const [antiCheatStatus, setAntiCheatStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
    const [antiCheatMsg, setAntiCheatMsg] = useState("")
    const [localMicMuted, setLocalMicMuted] = useState(true)
    const [localCamMuted, setLocalCamMuted] = useState(true)
    const [hasLocalMedia, setHasLocalMedia] = useState(false)
    const [gaugeGlow, setGaugeGlow] = useState(false)
    const [malpracticeWarnings, setMalpracticeWarnings] = useState<string[]>([])
    const [logFilter, setLogFilter] = useState<'all' | 'anticheat' | 'system'>('all')
    const [observerCount, setObserverCount] = useState(0)
    const [observationRequest, setObservationRequest] = useState<string | null>(null)
    const [voiceFilter, setVoiceFilter] = useState<VoiceFilter>('none')
    const [avatarStyle, setAvatarStyle] = useState<AvatarStyle>('none')
    const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>('none')
    const [customBackgroundUrl, setCustomBackgroundUrl] = useState<string | null>(null)
    const [isCanvasMode, setIsCanvasMode] = useState(false)
    const logScrollRef = useRef<HTMLDivElement>(null)
    // ── Refs ──────────────────────────────────────────────────────────────────
    const mainVideoRef = useRef<HTMLVideoElement>(null)
    const backgroundInputRef = useRef<HTMLInputElement>(null)
    const lastViolationTimeRef = useRef<number>(0)  // screen share / remote screen
    const localCamRef = useRef<HTMLVideoElement>(null)  // your camera (PiP)
    const localPreviewRef = useRef<HTMLVideoElement>(null)
    const antiCheatCamRef = useRef<HTMLVideoElement>(null)  // dedicated anti-cheat camera
    const antiCheatCanvasRef = useRef<HTMLCanvasElement>(null) // dedicated anti-cheat canvas overlay
    const remoteCamRef = useRef<HTMLVideoElement>(null)  // peer camera
    const remoteCamRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
    const socketRef = useRef<Socket | null>(null)
    const pcRef = useRef<RTCPeerConnection | null>(null)
    const hostPcRefs = useRef<Map<string, RTCPeerConnection>>(new Map())
    const localStreamRef = useRef<MediaStream | null>(null)
    const screenStreamRef = useRef<MediaStream | null>(null)
    const voiceChangerRef = useRef<VoiceChanger | null>(null)
    const virtualAvatarRef = useRef<VirtualAvatar | null>(null)
    const virtualBackgroundRef = useRef<VirtualBackground | null>(null)
    const sessionRecorderRef = useRef<SessionRecorder | null>(null)
    const engineRef = useRef<AntiCheatEngine | null>(null)
    const federatedLearnerRef = useRef<FederatedLearner | null>(null)
    const hiddenBgVideoRef = useRef<HTMLVideoElement | null>(null)
    const chatScrollRef = useRef<HTMLDivElement>(null)

    // ── Apply Voice and Avatar Effects ────────────────────────────────────────
    useEffect(() => {
        if (!hasLocalMedia || !localStreamRef.current) return;
        
        let processedStream = localStreamRef.current;
        
        if (voiceFilter !== 'none') {
            if (!voiceChangerRef.current) voiceChangerRef.current = new VoiceChanger();
            processedStream = voiceChangerRef.current.processStream(processedStream, voiceFilter);
        } else {
            voiceChangerRef.current?.stop();
            voiceChangerRef.current = null;
        }

        let currentVideoSource = localCamRef.current;

        if (backgroundStyle !== 'none') {
            if (!virtualBackgroundRef.current) virtualBackgroundRef.current = new VirtualBackground();
            virtualBackgroundRef.current.setBackgroundStyle(backgroundStyle, backgroundStyle === 'custom' && customBackgroundUrl ? customBackgroundUrl : undefined);
            
            if (currentVideoSource && currentVideoSource.readyState >= 2) {
                const bgStream = virtualBackgroundRef.current.start(currentVideoSource);
                if (!hiddenBgVideoRef.current) {
                    hiddenBgVideoRef.current = document.createElement('video');
                    hiddenBgVideoRef.current.autoplay = true;
                    hiddenBgVideoRef.current.playsInline = true;
                    hiddenBgVideoRef.current.muted = true;
                }
                hiddenBgVideoRef.current.srcObject = bgStream;
                hiddenBgVideoRef.current.play().catch(e => console.error("Could not play hidden bg stream", e));
                currentVideoSource = hiddenBgVideoRef.current;
                
                const finalStream = new MediaStream();
                processedStream.getAudioTracks().forEach(t => finalStream.addTrack(t));
                bgStream.getVideoTracks().forEach(t => finalStream.addTrack(t));
                processedStream = finalStream;
            }
        } else {
            virtualBackgroundRef.current?.stop();
            virtualBackgroundRef.current = null;
        }

        if (avatarStyle !== 'none') {
            if (!virtualAvatarRef.current) virtualAvatarRef.current = new VirtualAvatar();
            virtualAvatarRef.current.setAvatarStyle(avatarStyle);
            
            if (currentVideoSource && (currentVideoSource.readyState >= 2 || currentVideoSource === hiddenBgVideoRef.current)) {
                const avatarStream = virtualAvatarRef.current.start(currentVideoSource);
                const finalStream = new MediaStream();
                processedStream.getAudioTracks().forEach(t => finalStream.addTrack(t));
                avatarStream.getVideoTracks().forEach(t => finalStream.addTrack(t));
                processedStream = finalStream;
            }
        } else {
            virtualAvatarRef.current?.stop();
            virtualAvatarRef.current = null;
        }

        const pCs = currentRoleRef.current === 'host' ? Array.from(hostPcRefs.current.values()) : [pcRef.current];
        pCs.forEach(pc => {
            if (!pc || pc.signalingState === 'closed') return;
            const senders = pc.getSenders();
            
            const audioTrack = processedStream.getAudioTracks()[0];
            if (audioTrack) {
                const audioSender = senders.find(s => s.track?.kind === 'audio' && s.track !== screenStreamRef.current?.getAudioTracks()[0]);
                if (audioSender) audioSender.replaceTrack(audioTrack);
            }
            
            const videoTrack = processedStream.getVideoTracks()[0];
            if (videoTrack) {
                const videoSender = senders.find(s => s.track?.kind === 'video' && s.track !== screenStreamRef.current?.getVideoTracks()[0]);
                if (videoSender) videoSender.replaceTrack(videoTrack);
            }
        });
        
        if (localPreviewRef.current) {
            localPreviewRef.current.srcObject = processedStream;
        }
        
        
    }, [voiceFilter, avatarStyle, backgroundStyle, customBackgroundUrl, hasLocalMedia]);
    const [aiConfig, setAiConfig] = useState({
        eyeTrackingThreshold: 0.80,
        emotionSensitivity: 0.65,
        audioVolumeThreshold: 0.05,
        headPoseMargin: 0.50
    })
    const [showAiSettings, setShowAiSettings] = useState(false)
    const hudTimerRef = useRef<NodeJS.Timeout | null>(null)
    const statsTimerRef = useRef<NodeJS.Timeout | null>(null)
    const statsTimerRefs = useRef<Map<string, NodeJS.Timeout>>(new Map())
    const containerRef = useRef<HTMLDivElement>(null)
    const currentRoleRef = useRef<Role>("host")
    const sessionModeRef = useRef<SessionMode>(requestedMode)
    const roomCodeRef = useRef<string | null>(null)
    const participantsRef = useRef<Participant[]>([])
    const clipboardAllowedRef = useRef(false)
    const remoteMediaStreamIdsRef = useRef<{ screen?: string | null; camera?: string | null }>({})
    const latencyRef = useRef(0)
    const packetLossRef = useRef<number | null>(null)
    const streamFpsRef = useRef<number | null>(null)
    const riskScoreRef = useRef(0)
    const observerPcRefs = useRef<Map<string, RTCPeerConnection>>(new Map())
    const observerIdsRef = useRef<Set<string>>(new Set())
    const hostInputChannelRefs = useRef<Map<string, RTCDataChannel>>(new Map())
    const controllerInputChannelRef = useRef<RTCDataChannel | null>(null)

    useEffect(() => { currentRoleRef.current = role }, [role])
    useEffect(() => { sessionModeRef.current = sessionMode }, [sessionMode])
    useEffect(() => { roomCodeRef.current = roomCode }, [roomCode])
    useEffect(() => { participantsRef.current = participants }, [participants])
    useEffect(() => { clipboardAllowedRef.current = clipboardAllowed }, [clipboardAllowed])
    useEffect(() => { latencyRef.current = latency }, [latency])
    useEffect(() => { packetLossRef.current = packetLoss }, [packetLoss])
    useEffect(() => { streamFpsRef.current = streamFps }, [streamFps])
    useEffect(() => { riskScoreRef.current = riskScore }, [riskScore])

    useEffect(() => {
        const activeIds = new Set(participants.map(participant => participant.id))
        setRemoteCameraStreams(previous => {
            const next = Object.fromEntries(Object.entries(previous).filter(([id]) => activeIds.has(id)))
            return Object.keys(next).length === Object.keys(previous).length ? previous : next
        })
        Array.from(remoteCamRefs.current.keys()).forEach(id => {
            if (!activeIds.has(id)) remoteCamRefs.current.delete(id)
        })
    }, [participants])

    useEffect(() => {
        Object.entries(remoteCameraStreams).forEach(([controllerId, stream]) => {
            const video = remoteCamRefs.current.get(controllerId)
            if (!video) return
            if (video.srcObject !== stream) video.srcObject = stream
            video.play().catch(() => { })
        })
    }, [remoteCameraStreams])

    useEffect(() => {
        if (!chatOpen) return
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight })
    }, [chatMessages, chatOpen])

    useEffect(() => {
        if (role !== 'host') return
        setSelectedControllerId(previous => {
            if (previous && participants.some(participant => participant.id === previous)) return previous
            return participants[0]?.id || null
        })
    }, [participants, role])
    
    useEffect(() => {
        if (isStreaming && mainVideoRef.current && screenStreamRef.current && role === 'host') {
            mainVideoRef.current.srcObject = screenStreamRef.current;
        }
    }, [isStreaming, role])

    useEffect(() => {
        if (!roomCode) {
            setDuration(0)
            return
        }
        const startedAt = Date.now()
        const timer = window.setInterval(() => setDuration(Math.floor((Date.now() - startedAt) / 1000)), 1000)
        return () => window.clearInterval(timer)
    }, [roomCode])

    useEffect(() => {
        const timer = window.setInterval(() => {
            const socket = socketRef.current
            if (!socket?.connected) return
            const startedAt = performance.now()
            socket.emit('ping-ircp')
            socket.once('pong-ircp', () => setLatency(Math.round(performance.now() - startedAt)))
        }, 3000)
        return () => window.clearInterval(timer)
    }, [])

    const addLog = useCallback((type: LogEntry['type'], message: string) => {
        setSessionLogs(prev => [...prev, { time: new Date().toLocaleTimeString('en-US', { hour12: false }), type, message }].slice(-100))
    }, [])

    const ensureFederatedLearner = useCallback(() => {
        if (!federatedLearnerRef.current) federatedLearnerRef.current = new FederatedLearner()
        return federatedLearnerRef.current
    }, [])

    const recordFederatedSample = useCallback((features: FederatedFeatures, label: number) => {
        ensureFederatedLearner().addSample(features.map(clamp01) as FederatedFeatures, label)
    }, [ensureFederatedLearner])

    const federatedFeaturesForEvent = useCallback((eventType: string): FederatedFeatures => {
        if (['NO_FACE', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'PHONE_DETECTED'].includes(eventType)) return [1, 0, 0.15]
        if (['VOICE_DETECTED', 'TALKING_DETECTED', 'STRESS_DETECTED', 'EMOTION_ANOMALY'].includes(eventType)) return [0.35, 0, 1]
        if (eventType === 'TAB_SWITCHED') return [0.2, 1, 0.1]
        return [0.2, 0.2, 0.2]
    }, [])

    const reportMalpractice = useCallback((reason: string, penalty = 15, features: FederatedFeatures = [0.7, 0.2, 0.6]) => {
        setMalpracticeWarnings(prev => [...prev, reason].slice(-3))
        window.setTimeout(() => {
            setMalpracticeWarnings(prev => prev.filter(warning => warning !== reason))
        }, 5000)
        socketRef.current?.emit('anticheat-alert', {
            roomId: roomCodeRef.current,
            controllerId: socketRef.current?.id,
            type: 'anticheat_violation',
            reason,
            penalty,
        })
        recordFederatedSample(features, 1)
        addLog('anticheat', `Malpractice detected: ${reason}`)
    }, [addLog, recordFederatedSample])

    const getLocalMediaStreamIds = useCallback(() => ({
        screen: screenStreamRef.current?.id || null,
        camera: localStreamRef.current?.id || null,
    }), [])

    const assignVideoStream = useCallback((video: HTMLVideoElement | null, stream: MediaStream) => {
        if (!video) return
        if (video.srcObject !== stream) video.srcObject = stream
        video.play().catch(() => { })
    }, [])

    useEffect(() => {
        if (sessionMode !== 'supervised' || connectionState !== 'connected') return
        const timer = window.setInterval(() => {
            const networkInstability = clamp01(((packetLossRef.current || 0) / 12) + (latencyRef.current / 450))
            const frameDrop = streamFpsRef.current === null ? 0 : clamp01((24 - streamFpsRef.current) / 24)
            recordFederatedSample([0, Math.max(networkInstability, frameDrop), 0], 0)
        }, 30000)
        return () => window.clearInterval(timer)
    }, [sessionMode, connectionState, recordFederatedSample])

    const mediaStreamPromiseRef = useRef<Promise<MediaStream> | null>(null)

    const acquireLocalMedia = useCallback(async (videoRequired = true) => {
        if (localStreamRef.current) return localStreamRef.current
        if (mediaStreamPromiseRef.current) return mediaStreamPromiseRef.current

        if (!navigator.mediaDevices) {
            throw new Error("Media devices not available (requires HTTPS/localhost).")
        }

        mediaStreamPromiseRef.current = navigator.mediaDevices.getUserMedia({ 
            video: videoRequired, 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        })

        try {
            const stream = await mediaStreamPromiseRef.current
            localStreamRef.current = stream
            setHasLocalMedia(true)
            return stream
        } finally {
            mediaStreamPromiseRef.current = null
        }
    }, [])

    const stopLocalMedia = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop())
            localStreamRef.current = null
            setHasLocalMedia(false)
            setLocalCamMuted(true)
            setLocalMicMuted(true)
        }
    }, [])

    useEffect(() => {
        return () => {
            stopLocalMedia()
        }
    }, [stopLocalMedia])

    useEffect(() => {
        if (connectionState === 'idle') {
            stopLocalMedia()
        }
    }, [connectionState, stopLocalMedia])

    const toggleLocalMic = async () => {
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0]
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled
                setLocalMicMuted(!audioTrack.enabled)
                addLog('system', `Microphone ${audioTrack.enabled ? 'enabled' : 'muted'}`)
            }
        } else {
            try {
                await acquireLocalMedia(false)
                setLocalMicMuted(false)
                addLog('system', 'Microphone activated')
            } catch (err: any) {
                alert(err.message)
                addLog('system', 'Microphone access denied')
            }
        }
    }

    const toggleLocalCam = async () => {
        if (localStreamRef.current) {
            const videoTrack = localStreamRef.current.getVideoTracks()[0]
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled
                setLocalCamMuted(!videoTrack.enabled)
                addLog('system', `Camera ${videoTrack.enabled ? 'enabled' : 'disabled'}`)
            }
        } else {
            try {
                const stream = await acquireLocalMedia(true)
                if (localCamRef.current) localCamRef.current.srcObject = stream
                setLocalCamMuted(false)
                setLocalMicMuted(false)
                addLog('system', 'Camera and Microphone activated')
            } catch (err: any) {
                console.error(`Camera access denied or missing: ${err.message}`);
                addLog('system', `Camera access denied: ${err.message}`);
            }
        }
    }

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(err => console.log(err));
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().then(() => setIsFullscreen(false)).catch(err => console.log(err));
            }
        }
    }

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'host') {
            engineRef.current?.stop()
            engineRef.current = null
            setAntiCheatStatus('idle')
            return
        }
        const engine = new AntiCheatEngine()
        engineRef.current = engine
        engine.setConfig(aiConfig)
        engine.onStatusChange((status, msg) => {
            setAntiCheatStatus(status)
            setAntiCheatMsg(msg)
            if (status === 'ready') addLog('system', 'Visible supervised monitoring is active')
            if (status === 'error') addLog('anticheat', `Anti-cheat failed: ${msg}`)
        })
        engine.onEvent((ev: AntiCheatEvent) => {
            addLog('anticheat', `${ev.type}: ${ev.message} (+${ev.scorePenalty})`)
            recordFederatedSample(federatedFeaturesForEvent(ev.type), ev.scorePenalty > 0 ? 1 : 0)
            setRiskScore(s => Math.min(100, s + ev.scorePenalty))
            setGaugeGlow(true)
            setTimeout(() => setGaugeGlow(false), 800)
            socketRef.current?.emit('system-alert', {
                type: 'anticheat_violation', event: ev.type,
                message: ev.message, penalty: ev.scorePenalty, room: roomCode,
            })
        })
        
        const runCalibration = async () => {
            setIsCalibrating(true);
            await engine.initialize();
            
            // Try to acquire actual mic/cam just for the calibration/proctoring phase
            let tempStream: MediaStream | undefined;
            try {
                tempStream = await acquireLocalMedia(true);
                if (localCamRef.current) {
                    localCamRef.current.srcObject = tempStream;
                }
                setLocalCamMuted(false);
                setLocalMicMuted(false);
            } catch (err) {
                addLog('system', 'Camera/Mic denied during calibration.');
            }

            // Create a temporary video element for the landmarker if localCamRef isn't rendered yet
            const videoEl = localCamRef.current || document.createElement('video');
            if (!localCamRef.current && tempStream) {
                videoEl.srcObject = tempStream;
                videoEl.play().catch(()=> { });
            }

            await engine.calibrate(videoEl, tempStream);
            setIsCalibrating(false);
            
            // After calibration, start the engine loop
            engine.start(videoEl, antiCheatCanvasRef.current || undefined, tempStream);
        };
        
        runCalibration();
        
        return () => {
            engine.stop()
            stopLocalMedia()
        }
    }, [sessionMode, role, addLog, federatedFeaturesForEvent, recordFederatedSample, stopLocalMedia])

    useEffect(() => {
        if (engineRef.current) engineRef.current.setConfig(aiConfig)
    }, [aiConfig])

    const selectedParticipant = participants.find(participant => participant.id === selectedControllerId) || participants[0] || null
    const selectedPermission = selectedParticipant?.permission || permission
    const selectedClipboardAllowed = selectedParticipant?.clipboardAllowed ?? clipboardAllowed

    const startStats = (pc: RTCPeerConnection) => {
        statsTimerRef.current = setInterval(async () => {
            const stats = await pc.getStats().catch(() => null)
            if (!stats) return
            stats.forEach((r: any) => {
                const kind = currentRoleRef.current === 'host' ? 'outbound-rtp' : 'inbound-rtp'
                if (r.type === kind && r.kind === 'video') {
                    const fps = Math.round(r.framesPerSecond || 0)
                    const w = r.frameWidth || 0
                    const h = r.frameHeight || 0
                    if (w && h) setVideoStats(`${w}×${h} · ${fps}fps`)
                }
            })
        }, 2000)
    }

    const startQualityStats = (pc: RTCPeerConnection, peerId = "primary") => {
        const existing = statsTimerRefs.current.get(`quality-${peerId}`)
        if (existing) clearInterval(existing)
        const timer = setInterval(async () => {
            const stats = await pc.getStats().catch(() => null)
            if (!stats) return
            let fps = 0
            let packetLossValue = 0
            let loggedCandidatePair = false;
            stats.forEach((r: any) => {
                const kind = currentRoleRef.current === 'host' ? 'outbound-rtp' : 'inbound-rtp'
                if (r.type === kind && r.kind === 'video') {
                    fps = Math.round(r.framesPerSecond || 0)
                    if (currentRoleRef.current === 'controller') {
                        const received = Number(r.packetsReceived || 0)
                        const lost = Number(r.packetsLost || 0)
                        const total = received + lost
                        packetLossValue = total > 0 ? Math.max(0, Math.round((lost / total) * 1000) / 10) : 0
                    }
                }
                if (r.type === 'candidate-pair' && r.state === 'succeeded' && !loggedCandidatePair) {
                    const localCandidate = stats.get(r.localCandidateId)
                    const remoteCandidate = stats.get(r.remoteCandidateId)
                    if (localCandidate && remoteCandidate) {
                        setSessionLogs(prev => {
                            const msg = `[ICE] Active Pair - Local: ${localCandidate.candidateType}, Remote: ${remoteCandidate.candidateType}`
                            if (prev.length > 0 && prev[prev.length-1].message === msg) return prev;
                            return [...prev, { time: new Date().toLocaleTimeString('en-US', { hour12: false }), type: 'system' as const, message: msg }].slice(-100);
                        })
                        loggedCandidatePair = true;
                    }
                }
            })
            if (currentRoleRef.current !== 'controller') return
            const health: ParticipantQuality["health"] =
                latency > 180 || packetLossValue > 8 ? 'poor'
                    : latency > 110 || packetLossValue > 3 ? 'fair'
                        : latency > 60 || packetLossValue > 1 ? 'good'
                            : 'excellent'
            setStreamFps(fps || null)
            setPacketLoss(packetLossValue)
            setConnectionHealth(health)
            socketRef.current?.emit('quality-update', {
                roomId: roomCodeRef.current,
                quality: { latency, fps, packetLoss: packetLossValue, health },
            })
        }, 2500)
        statsTimerRefs.current.set(`quality-${peerId}`, timer)
    }

    const addMediaTracksToPeer = (pc: RTCPeerConnection) => {
        const screen = screenStreamRef.current
        if (screen) {
            screen.getTracks().forEach(track => {
                const alreadyAdded = pc.getSenders().some(sender => sender.track === track)
                if (!alreadyAdded) pc.addTrack(track, screen)
            })
        }
        const local = localStreamRef.current
        if (local) {
            local.getTracks().forEach(track => {
                const alreadyAdded = pc.getSenders().some(sender => sender.track === track)
                if (!alreadyAdded) pc.addTrack(track, local)
            })
        }
    }

    const controlPayloadAllowed = (participant: Participant, payload: any) => {
        const isMouse = ['mousemove', 'mousedown', 'mouseup', 'wheel'].includes(payload?.type)
        const isKeyboard = ['keydown', 'keyup'].includes(payload?.type)
        const isGamepad = payload?.type === 'gamepad-state'
        const key = String(payload?.key || '').toLowerCase()
        const code = String(payload?.code || '').toLowerCase()
        const hasClipboardModifier = Boolean(payload?.modifiers?.ctrl || payload?.modifiers?.meta)
        const isClipboardShortcut = hasClipboardModifier && ['c', 'v', 'x'].some(shortcut => key === shortcut || code === `key${shortcut}`)

        if (isKeyboard && isClipboardShortcut && !participant.clipboardAllowed) return false
        return participant.permission === 'full'
            || (participant.permission === 'mouse' && (isMouse || isGamepad))
            || (participant.permission === 'keyboard' && isKeyboard)
    }

    const executeHostInput = (controllerId: string, payload: any) => {
        const participant = participantsRef.current.find(item => item.id === controllerId)
        if (!participant) return
        if (!controlPayloadAllowed(participant, payload)) {
            const actionType = payload.type || 'unknown action';
            addLog('permission', `${participant.name}'s input was blocked by ${participant.permission.toUpperCase()} permission (${actionType})`)
            
            const violationNow = Date.now();
            if (violationNow - lastViolationTimeRef.current > 10000) {
                lastViolationTimeRef.current = violationNow;
                socketRef.current?.emit('permission-violation', {
                    roomCode: roomCodeRef.current,
                    action: actionType,
                    controllerId,
                    controllerName: participant.name,
                    controllerEmail: participant.email
                });
                captureEvidence();
            }
            return
        }

        ;(window as any).__lastControlPayload = payload
        if (window.ipcRenderer) {
            window.ipcRenderer.send('execute-input', payload)
        }
    }

    const attachInputChannel = (channel: RTCDataChannel, controllerId: string) => {
        channel.onopen = () => addLog('quality', 'Low-latency input channel ready')
        channel.onclose = () => addLog('quality', 'Low-latency input channel closed')

        if (currentRoleRef.current === 'host') {
            hostInputChannelRefs.current.set(controllerId, channel)
            channel.onmessage = event => {
                try {
                    const payload = JSON.parse(String(event.data))
                    executeHostInput(controllerId, payload)
                } catch {
                    addLog('quality', 'Ignored malformed input channel payload')
                }
            }
            return
        }

        controllerInputChannelRef.current = channel
    }

    const negotiateWithController = async (controllerId: string) => {
        const pc = await createPC(controllerId)
        addMediaTracksToPeer(pc)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socketRef.current?.emit('offer', {
            offer,
            roomId: roomCodeRef.current,
            targetId: controllerId,
            mediaStreamIds: getLocalMediaStreamIds(),
        })
    }

    const negotiateWithObserver = async (observerId: string) => {
        if (!screenStreamRef.current) {
            addLog('system', 'Admin observation is waiting for host screen sharing to start')
            return
        }
        let pc = observerPcRefs.current.get(observerId)
        if (!pc || pc.signalingState === 'closed') {
            pc = new RTCPeerConnection({
                iceServers: iceServersRef.current,
                iceTransportPolicy: process.env.NEXT_PUBLIC_FORCE_TURN === 'true' && hasTurnServer(iceServersRef.current) ? 'relay' : 'all',
            })
            observerPcRefs.current.set(observerId, pc)
            pc.onicecandidate = event => {
                if (event.candidate) socketRef.current?.emit('observer-ice-candidate', { targetId: observerId, candidate: event.candidate })
            }
        }
        addMediaTracksToPeer(pc)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socketRef.current?.emit('observer-offer', { observerId, offer })
    }

    const createPC = async (targetId?: string) => {
        let servers = iceServersRef.current;
        if (!servers || servers.length === 0) {
            servers = await fetchIceServers();
            iceServersRef.current = servers;
        }

        const existingPc = currentRoleRef.current === 'host' && targetId
            ? hostPcRefs.current.get(targetId)
            : pcRef.current
        if (existingPc && existingPc.signalingState !== 'closed') {
            addMediaTracksToPeer(existingPc)
            return existingPc
        }

        const forceRelay = process.env.NEXT_PUBLIC_FORCE_TURN === 'true' && hasTurnServer(servers)
        const pc = new RTCPeerConnection({
            iceServers: servers,
            iceTransportPolicy: forceRelay ? 'relay' : 'all',
        })
        if (typeof window !== 'undefined') (window as any)._pc = pc;
        if (currentRoleRef.current === 'host' && targetId) hostPcRefs.current.set(targetId, pc)
        else pcRef.current = pc

        if (currentRoleRef.current === 'host' && targetId) {
            const channel = pc.createDataChannel('ircp-input', { ordered: false, maxRetransmits: 0 })
            attachInputChannel(channel, targetId)
            
            const fileChannel = pc.createDataChannel('ircp-file', { ordered: true })
            dataChannelManager.attachChannel(fileChannel, targetId, 'ircp-file')
            
            const drawChannel = pc.createDataChannel('ircp-draw', { ordered: false, maxRetransmits: 0 })
            dataChannelManager.attachChannel(drawChannel, targetId, 'ircp-draw')
            
            const chatChannel = pc.createDataChannel('ircp-chat', { ordered: true })
            dataChannelManager.attachChannel(chatChannel, targetId, 'ircp-chat')
        } else {
            pc.ondatachannel = event => {
                if (event.channel.label === 'ircp-input') attachInputChannel(event.channel, targetId || 'host')
                else if (event.channel.label.startsWith('ircp-')) {
                    dataChannelManager.attachChannel(event.channel, targetId || 'host', event.channel.label)
                }
            }
        }

        pc.onicecandidate = (e) => {
            if (e.candidate) socketRef.current?.emit('ice-candidate', { candidate: e.candidate, roomId: roomCodeRef.current || joinInput, targetId })
        }

        pc.ontrack = (event) => {
            console.log(`[DEBUG] ontrack fired! kind: ${event.track.kind}, streams: ${event.streams ? event.streams.length : 'no streams'}`);
            try {
                const stream = event.streams && event.streams.length > 0 ? event.streams[0] : new MediaStream([event.track]);
                if (!stream) return;

                if (currentRoleRef.current === 'host') {
                    const controllerId = targetId || stream.id;
                    setRemoteCameraStreams(previous => (
                        previous[controllerId] === stream ? previous : { ...previous, [controllerId]: stream }
                    ));
                } else {
                    const remoteIds = remoteMediaStreamIdsRef.current;
                    const isScreenStream = Boolean(remoteIds.screen && stream.id === remoteIds.screen);
                    const isCameraStream = Boolean(remoteIds.camera && stream.id === remoteIds.camera);

                    if (isCameraStream) {
                        assignVideoStream(remoteCamRef.current, stream);
                    } else if (isScreenStream || !mainVideoRef.current?.srcObject || mainVideoRef.current.srcObject === stream) {
                        assignVideoStream(mainVideoRef.current, stream);
                    } else if (!remoteCamRef.current?.srcObject || remoteCamRef.current.srcObject === stream) {
                        assignVideoStream(remoteCamRef.current, stream);
                    } else {
                        assignVideoStream(mainVideoRef.current, stream);
                    }
                }
            } catch (err) {
                console.error('[DEBUG] Error inside ontrack:', err);
            }
            setConnectionState('connected')
            setStatusMessage('')
        }
        pc.onconnectionstatechange = () => {
            if (['connected', 'completed'].includes(pc.connectionState)) setConnectionState('connected')
        }
        startStats(pc)
        startQualityStats(pc, targetId || 'primary')
        return pc
    }

    const setupSocket = useCallback((asRole: Role, code?: string) => {
        const token = getStoredAuthToken() || undefined

        const socket = io(getBackendUrl(), { 
            withCredentials: true,
            auth: token ? { token } : undefined
        })
        socketRef.current = socket;
        (window as any)._socket = socket;
        (window as any)._roomCode = roomCodeRef;
        socket.on('connect', () => {
            if (asRole === 'host') {
                socket.emit('create-room', { name: localStorage.getItem('ircp_name') || 'Host', mode: sessionModeRef.current, appearance: readPersonalAppearance() })
            } else {
                const room = code || joinInput
                setRoomCode(room)
                socket.emit('join-room', room, 'controller', { name: localStorage.getItem('ircp_name') || 'Controller' })
                setConnectionState('connecting')
            }
        })
        socket.on('room-created', ({ roomCode: rc }: { roomCode: string }) => { setRoomCode(rc); setConnectionState('waiting') })
        socket.on('session-error', (err: any) => {
            alert('Session Error: ' + (err.message || err.reason || 'Unknown error'));
            window.location.href = '/app';
        })
        socket.on('removed-from-session', (data: any) => {
            alert('You have been removed: ' + (data.reason || 'No reason provided'));
            window.location.href = '/app';
        })
        socket.on('connect_error', (err: any) => {
            console.error('Socket connection error:', err);
            addLog('system', `Socket connection failed: ${err.message}`);
        })
        socket.on('input-event', (payload: any) => {
            if (currentRoleRef.current === 'host' && window.ipcRenderer) {
                window.ipcRenderer.send('execute-input', payload)
            }
        })
        socket.on('session-state', (state: any) => {
            setRoomCode(state.roomCode); 
            if (state.mode) setSessionMode(state.mode);
            setPermission(state.permission); 
            setParticipants(state.participants || [])
            setPendingJoinRequests(state.pendingRequests || [])
            setChatMessages(state.messages || [])
            setObserverCount(state.observerCount || 0)
        })
        socket.on('join-approved', ({ permission: approvedPermission, clipboardAllowed: approvedClipboard }: any) => {
            setPermission(approvedPermission)
            ;(window as any).__lastPermission = approvedPermission
            setMouseEnabled(approvedPermission === 'full' || approvedPermission === 'mouse')
            setKeyboardEnabled(approvedPermission === 'full' || approvedPermission === 'keyboard')
            setClipboardAllowed(Boolean(approvedClipboard))
            setConnectionState('connecting')
        })
        socket.on('controller-joined', async ({ controllerId }: any) => {
            await negotiateWithController(controllerId)
        })
        socket.on('offer', async (payload: any) => {
            console.log('[DEBUG] Received offer:', payload.offer.type);
            try {
                remoteMediaStreamIdsRef.current = payload.mediaStreamIds || {}
                const pc = pcRef.current && pcRef.current.signalingState !== 'closed' ? pcRef.current : await createPC()
                await pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
                addMediaTracksToPeer(pc)
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                socket.emit('answer', {
                    answer,
                    roomId: code || roomCodeRef.current || joinInput,
                    targetId: payload.fromId,
                    mediaStreamIds: getLocalMediaStreamIds(),
                })
                console.log('[DEBUG] Answer sent successfully');
            } catch (err) {
                console.error('[DEBUG] Error handling offer:', err);
            }
        })
        socket.on('answer', async (payload: any) => {
            const pc = payload?.fromId ? hostPcRefs.current.get(payload.fromId) : pcRef.current
            await pc?.setRemoteDescription(new RTCSessionDescription(payload.answer))
        })
        socket.on('ice-candidate', async (payload: any) => {
            const pc = currentRoleRef.current === 'host' && payload?.fromId ? hostPcRefs.current.get(payload.fromId) : pcRef.current
            await pc?.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {})
        })
        socket.on('access-granted', (nextPermission: PermissionLevel, options: { clipboardAllowed?: boolean } = {}) => {
            setPermission(nextPermission)
            ;(window as any).__lastPermission = nextPermission
            setMouseEnabled(nextPermission === 'full' || nextPermission === 'mouse')
            setKeyboardEnabled(nextPermission === 'full' || nextPermission === 'keyboard')
            if (typeof options.clipboardAllowed === 'boolean') setClipboardAllowed(options.clipboardAllowed)
            addLog('permission', `Access changed to ${nextPermission.toUpperCase()}`)
        })
        socket.on('access-denied', () => addLog('permission', 'Access request denied by host'))
        socket.on('clipboard-policy', ({ allowed }: { allowed: boolean }) => {
            setClipboardAllowed(Boolean(allowed))
            addLog('permission', `Clipboard shortcuts ${allowed ? 'enabled' : 'blocked'}`)
        })
        socket.on('input-blocked', ({ reason }: { reason: string }) => addLog('permission', reason))
        socket.on('request-access', (payload: any) => {
            setRequestingUser({
                ...payload,
                name: payload.name || 'Controller',
                initials: payload.initials || 'C',
                device: payload.device || 'Remote device',
                ip: payload.ip || 'Unknown IP',
            })
            setShowPermModal(true)
        })
        socket.on('admin-observer-joined', async ({ observerId }: { observerId: string }) => {
            observerIdsRef.current.add(observerId)
            setObserverCount(observerIdsRef.current.size)
            await negotiateWithObserver(observerId)
        })
        socket.on('admin-observation-request', ({ observerId }: { observerId: string }) => {
            setObservationRequest(observerId)
            addLog('system', 'Administrator requested visible screen observation')
        })
        socket.on('observer-answer', async ({ observerId, answer }: { observerId: string; answer: RTCSessionDescriptionInit }) => {
            const pc = observerPcRefs.current.get(observerId)
            await pc?.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => { })
        })
        socket.on('observer-ice-candidate', async ({ fromId, candidate }: { fromId: string; candidate: RTCIceCandidateInit }) => {
            const pc = observerPcRefs.current.get(fromId)
            await pc?.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { })
        })
        socket.on('chat-message', (message: ChatMessage) => setChatMessages(prev => [...prev, message].slice(-100)))
        socket.on('federated-update-accepted', ({ round, pendingContributors }: { round: number; pendingContributors: number }) => {
            addLog('system', `Federated update accepted for round ${round} (${pendingContributors} pending)`)
        })
        socket.on('federated-aggregate', async ({ round, weights, contributorCount, sampleCount, loss }: any) => {
            const ok = await ensureFederatedLearner().setSerializedWeights(weights)
            addLog(
                'system',
                ok
                    ? `Federated round ${round} applied from ${contributorCount} contributor(s), ${sampleCount} sample(s), loss ${loss ?? 'n/a'}`
                    : `Federated round ${round} received but model shape did not match`
            )
        })
        socket.on('federated-error', ({ message }: { message: string }) => addLog('system', `Federated update failed: ${message}`))
        socket.on('evidence-event', (item: EvidenceItem) => {
            setEvidence(prev => [item, ...prev].slice(0, 80))
            if (item.type === 'join' && item.message?.includes('disconnected') && Notification.permission === 'granted') {
                new Notification('User Disconnected', { body: item.message || "" })
            } else if (item.type === 'join' && item.message?.includes('disconnected') && Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') new Notification('User Disconnected', { body: item.message || "" })
                })
            }
        })
        socket.on('join-denied', ({ reason }: { reason?: string }) => {
            alert(reason || 'Host denied the connection request.')
            router.push('/app')
        })
        socket.on('room-not-found', () => {
            setSetupError('Room not found or unavailable.')
            setSetupMode('join')
        })
        socket.on('kill-session', () => {
            alert('The session has ended.')
            window.location.href = '/app'
        })
        socket.on('session-error', (err: any) => {
            alert('Session Error: ' + err.message);
        })
    }, [joinInput, addLog, router])

    useEffect(() => {
        if (setupMode === null && !socketRef.current) {
            setupSocket(role, joinInput || undefined)
        }
    }, [setupMode, role, joinInput, setupSocket])

    const startSharing = async () => {
        console.log('[DEBUG] startSharing CALLED!');
        try {
            console.log('[DEBUG] Calling getDisplayMedia...');
            const screen = await navigator.mediaDevices.getDisplayMedia({ 
                video: { frameRate: { ideal: 120, max: 144 } }, 
                audio: true 
            })
            console.log('[DEBUG] getDisplayMedia SUCCESS!');
            screenStreamRef.current = screen
            setIsStreaming(true)
            setTimeout(() => {
                if (mainVideoRef.current) {
                    mainVideoRef.current.srcObject = screenStreamRef.current
                    mainVideoRef.current.play().catch(() => { })
                }
            }, 100)
            screen.getVideoTracks()[0]?.addEventListener('ended', () => {
                setIsStreaming(false)
                addLog('system', 'Screen sharing stopped')
            })
            
            // Renegotiate with all existing participants using existing PCs
            console.log(`[DEBUG] startSharing: renegotiating with ${participantsRef.current.length} participants`);
            participantsRef.current.forEach(async (p) => {
                const existingPc = hostPcRefs.current.get(p.id)
                console.log(`[DEBUG] Participant ${p.id}, has existingPc: ${!!existingPc}`);
                if (existingPc && existingPc.signalingState !== 'closed') {
                    addMediaTracksToPeer(existingPc)
                    const offer = await existingPc.createOffer()
                    await existingPc.setLocalDescription(offer)
                    console.log(`[DEBUG] Emitting offer to ${p.id}`);
                    socketRef.current?.emit('offer', {
                        offer,
                        roomId: roomCodeRef.current,
                        targetId: p.id,
                        mediaStreamIds: getLocalMediaStreamIds(),
                    })
                } else {
                    console.log(`[DEBUG] Negotiating new PC for ${p.id}`);
                    await negotiateWithController(p.id)
                }
            })
            console.log(`[DEBUG] startSharing: renegotiating with ${observerIdsRef.current.size} observers`);
            observerIdsRef.current.forEach(async (observerId) => {
                const pc = observerPcRefs.current.get(observerId)
                if (pc && pc.signalingState !== 'closed') {
                    addMediaTracksToPeer(pc)
                    const offer = await pc.createOffer()
                    await pc.setLocalDescription(offer)
                    console.log(`[DEBUG] Emitting offer to observer ${observerId}`);
                    socketRef.current?.emit('observer-offer', { observerId, offer })
                } else {
                    console.log(`[DEBUG] Negotiating new PC for observer ${observerId}`);
                    await negotiateWithObserver(observerId)
                }
            })
        } catch (err: any) {
            console.error('[Host Console] startSharing Error:', err.name, err.message, err.stack)
            addLog('system', `Screen sharing failed: ${err.message}`)
        }
    }

    const updatePermission = (nextPermission: PermissionLevel) => {
        setPermission(nextPermission)
        if (role === 'host' && roomCode) {
            socketRef.current?.emit('access-granted', nextPermission, {
                targetId: selectedParticipant?.id,
                clipboardAllowed: selectedParticipant?.clipboardAllowed ?? clipboardAllowed,
            }, roomCode)
        }
    }

    const updateClipboardPolicy = (allowed: boolean) => {
        if (role !== 'host' || !roomCode) return
        socketRef.current?.emit('clipboard-policy', {
            roomId: roomCode,
            targetId: selectedParticipant?.id,
            allowed,
        })
    }

    const sendControlPayload = (payload: any) => {
        const channel = controllerInputChannelRef.current
        if (!channel || channel.readyState !== 'open') {
            addLog('quality', 'Input channel is not ready yet')
            return
        }
        channel.send(JSON.stringify(payload))
    }

    const emitMouse = (event: ReactMouseEvent<HTMLVideoElement> | ReactWheelEvent<HTMLVideoElement>, type: 'mousemove' | 'mousedown' | 'mouseup' | 'wheel') => {
        if (role !== 'controller' || !mouseEnabled || connectionState !== 'connected') return
        const rect = event.currentTarget.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
        sendControlPayload({
            room: roomCodeRef.current,
            type,
            x,
            y,
            button: 'button' in event ? event.button : 0,
            deltaY: 'deltaY' in event ? event.deltaY : 0,
        })
    }

    useEffect(() => {
        if (role !== 'controller' || connectionState !== 'connected' || !keyboardEnabled) return
        const shouldIgnore = (target: EventTarget | null) => {
            const element = target as HTMLElement | null
            return Boolean(element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
        }
        const sendKey = (event: KeyboardEvent, type: 'keydown' | 'keyup') => {
            if (shouldIgnore(event.target)) return
            const modifier = event.ctrlKey || event.metaKey
            const lowerKey = event.key.toLowerCase()
            if (!clipboardAllowed && modifier && ['c', 'v', 'x'].includes(lowerKey)) {
                event.preventDefault()
                addLog('permission', 'Clipboard shortcut blocked by host policy')
                return
            }
            event.preventDefault()
            sendControlPayload({
                room: roomCodeRef.current,
                type,
                key: event.key,
                code: event.code,
                modifiers: {
                    shift: event.shiftKey,
                    ctrl: event.ctrlKey,
                    alt: event.altKey,
                    meta: event.metaKey,
                },
            })
        }
        const onKeyDown = (event: KeyboardEvent) => sendKey(event, 'keydown')
        const onKeyUp = (event: KeyboardEvent) => sendKey(event, 'keyup')
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
        }
    }, [role, connectionState, keyboardEnabled, clipboardAllowed, addLog])

    // Gamepad API polling for ViGEmBus
    useEffect(() => {
        if (role !== 'controller' || connectionState !== 'connected' || !mouseEnabled) return;
        
        let animationFrameId: number;
        let lastGamepadState = '';
        
        const pollGamepad = () => {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            const gp = gamepads[0];
            if (gp) {
                const axes = gp.axes.map(a => Number(a.toFixed(3)));
                const buttons = gp.buttons.map(b => ({ pressed: b.pressed, value: Number(b.value.toFixed(3)) }));
                
                // Only send if state changed significantly to prevent spam
                const currentState = JSON.stringify({ axes, buttons });
                if (currentState !== lastGamepadState) {
                    lastGamepadState = currentState;
                    sendControlPayload({
                        room: roomCodeRef.current,
                        type: 'gamepad-state',
                        axes,
                        buttons
                    });
                }
            }
            animationFrameId = requestAnimationFrame(pollGamepad);
        };
        
        animationFrameId = requestAnimationFrame(pollGamepad);
        return () => cancelAnimationFrame(animationFrameId);
    }, [role, connectionState, mouseEnabled]);

    // Anti-cheat focus tracking for supervised controllers
    useEffect(() => {
        if (role !== 'controller' || sessionMode !== 'supervised' || connectionState !== 'connected') return;

        const onBlur = () => reportMalpractice('Application lost focus (external app/click)', 15, [0.15, 1, 0.1]);
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                reportMalpractice('Tab switch or minimized app detected', 15, [0.2, 1, 0.1]);
            }
        };

        window.addEventListener('blur', onBlur);
        document.addEventListener('visibilitychange', onVisibilityChange);
        
        return () => {
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [role, sessionMode, connectionState, reportMalpractice]);

    const toggleRecording = () => {
        if (!isRecording) {
            if (!mainVideoRef.current) {
                addLog('system', 'Cannot start recording: No screen stream active')
                return
            }
            if (!sessionRecorderRef.current) sessionRecorderRef.current = new SessionRecorder()
            const remoteVideo = role === 'host' && selectedControllerId
                ? remoteCamRefs.current.get(selectedControllerId) || null
                : remoteCamRef.current
            
            const started = sessionRecorderRef.current.startRecording(
                mainVideoRef.current,
                localCamRef.current,
                remoteVideo,
                (url) => {
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `session-recording-${Date.now()}.webm`
                    a.click()
                    addLog('recording', 'Recording saved to local device')
                }
            )
            
            if (started) {
                setIsRecording(true)
                addLog('recording', 'Advanced Multi-stream Recording started')
            }
        } else {
            sessionRecorderRef.current?.stopRecording()
            setIsRecording(false)
            addLog('recording', 'Recording stopped, preparing download...')
        }
    }

    const captureEvidence = async () => {
        if (!mainVideoRef.current) return
        const canvas = document.createElement('canvas')
        canvas.width = mainVideoRef.current.videoWidth
        canvas.height = mainVideoRef.current.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(mainVideoRef.current, 0, 0, canvas.width, canvas.height)
        
        canvas.toBlob(async (blob) => {
            if (!blob) return
            const formData = new FormData()
            if (roomCode) formData.append('room', roomCode)
            formData.append('evidenceFile', blob, `evidence-${Date.now()}.png`)
            try {
                const token = getStoredAuthToken()
                const res = await fetch(`${getBackendUrl()}/api/admin/upload-evidence`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: formData
                })
                const data = await res.json()
                if (data.success) {
                    addLog('recording', `Evidence captured and saved: ${data.url}`)
                } else {
                    addLog('system', 'Evidence capture failed: ' + data.message)
                }
            } catch (err) {
                console.error("Upload failed", err)
            }
        }, 'image/png')
    }

    const runFederatedEpoch = async () => {
        const learner = ensureFederatedLearner()
        let sampleCount = learner.getPendingSampleCount()

        if (sampleCount === 0) {
            const networkInstability = clamp01(((packetLossRef.current || 0) / 12) + (latencyRef.current / 450))
            const riskSignal = clamp01(riskScoreRef.current / 100)
            learner.addSample([riskSignal, networkInstability, riskSignal], riskScoreRef.current >= 30 ? 1 : 0)
            sampleCount = learner.getPendingSampleCount()
            addLog('system', 'Queued one live telemetry snapshot for federated training')
        }

        addLog('system', 'Starting local Federated Training Epoch...')
        const loss = await learner.trainLocalModel(10)
        
        addLog('system', `Training complete. Final Loss: ${loss === null ? 'n/a' : Number(loss).toFixed(4)}. Extracting weights...`)
        const weights = await learner.getSerializedWeights()
        
        socketRef.current?.emit('federated-update', {
            roomId: roomCodeRef.current,
            weights,
            sampleCount,
            loss,
            modelVersion: 'anti-cheat-v1',
        })
        addLog('system', `Submitted ${weights.length} model weights from ${sampleCount} telemetry sample(s) to the aggregator.`)
    }

    const sendChatMessage = (event?: FormEvent) => {
        event?.preventDefault()
        const text = chatInput.trim()
        const activeRoom = roomCodeRef.current
        if (!text || !activeRoom) return
        socketRef.current?.emit('chat-message', { roomId: activeRoom, text })
        setChatInput('')
        setChatOpen(true)
    }

    if (setupMode === "join") {
        return (
            <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4 font-sans">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 max-w-sm w-full text-center">
                    <h2 className="text-2xl font-display font-bold text-[var(--text-primary)] mb-6">Join Session</h2>
                    <input
                        type="text"
                        placeholder="Enter 8-digit Room Code"
                        maxLength={8}
                        value={joinInput}
                        onChange={e => setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        className="w-full text-center font-mono font-bold tracking-[0.2em] text-[var(--accent)] bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 mb-6 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)] outline-none transition-all"
                    />
                    <button 
                        onClick={() => {
                            if (joinInput.length > 0) setSetupMode(null)
                        }}
                        className="w-full py-3 rounded-lg bg-[var(--accent)] text-black font-bold hover:brightness-110 transition-all"
                    >
                        Join Room
                    </button>
                    <button onClick={() => router.push('/app')} className="mt-4 text-xs text-[var(--text-dim)] hover:text-white">Cancel</button>
                </div>
            </div>
        )
    }

    return (
        <div ref={containerRef} className="h-screen overflow-hidden bg-[var(--bg)] flex flex-col text-[var(--text-primary)] font-sans">
            <header className="h-[52px] flex items-center justify-between px-4 border-b border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center gap-3">
                    <div onClick={async () => { 
                        if(roomCode) {
                            try {
                                const fallbackCopy = () => {
                                    const textArea = document.createElement("textarea");
                                    textArea.value = roomCode;
                                    textArea.style.position = "fixed";
                                    document.body.appendChild(textArea);
                                    textArea.select();
                                    document.execCommand('copy');
                                    textArea.remove();
                                };

                                if (navigator.clipboard) {
                                    try {
                                        await navigator.clipboard.writeText(roomCode);
                                    } catch (e) {
                                        fallbackCopy();
                                    }
                                } else {
                                    fallbackCopy();
                                }
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                                addLog('system', 'Room code copied to clipboard');
                            } catch (err) {
                                addLog('system', 'Clipboard access denied by browser');
                            }
                        } 
                    }} className="font-mono text-[12px] text-[var(--text-secondary)] bg-[var(--background)] px-2 py-1 rounded cursor-pointer hover:text-[var(--text)] transition-colors">{copied ? <><Check className="w-3 h-3 inline mr-1" /> Copied</> : <><Copy className="w-3 h-3 inline mr-1" /> {roomCode || '---'}</>}</div>
                    <div className="flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-secondary)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                        <span>{formatDuration(duration)}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2.5">
                    <button
                        onClick={() => setChatOpen(open => !open)}
                        aria-label="Toggle Session Chat"
                        className={cn("relative p-1.5 rounded-lg border transition-colors", chatOpen ? "bg-[var(--accent)] text-black border-transparent" : "text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]")}
                    >
                        <MessageSquare className="w-4 h-4" />
                        {chatMessages.length > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--red)] px-1 text-[9px] font-bold text-white">
                                {Math.min(chatMessages.length, 99)}
                            </span>
                        )}
                    </button>
                    <button onClick={toggleLocalMic} className={cn("p-1.5 rounded-lg border", localMicMuted ? "text-[var(--red)]" : "text-[var(--text-secondary)]")}>{localMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}</button>
                    <button onClick={toggleLocalCam} aria-label="Toggle Camera" className={cn("p-1.5 rounded-lg border", localCamMuted ? "text-[var(--red)]" : "text-[var(--text-secondary)]")}>{localCamMuted ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}</button>
                    <button onClick={toggleFullscreen} aria-label="Toggle Fullscreen" className="p-1.5 rounded-lg border text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setIsCanvasMode(!isCanvasMode)} className={cn("p-1.5 rounded-lg border hover:text-[var(--text-primary)] transition-colors", isCanvasMode ? "bg-[var(--accent)] text-black border-transparent" : "text-[var(--text-secondary)] border-[var(--border)]")} title="Toggle Canvas Mode">
                        <PenTool className="w-4 h-4" />
                    </button>
                    {role === 'host' ? (
                        <button onClick={() => setShowKillConfirm(true)} className="h-9 px-4 rounded-full bg-[var(--red)] text-white text-xs font-bold">END SESSION</button>
                    ) : (
                        <button onClick={() => setShowLeaveConfirm(true)} className="h-9 px-4 rounded-full bg-[var(--red)] text-white text-xs font-bold">LEAVE ROOM</button>
                    )}
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                <aside className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col overflow-y-auto">
                    <div className="px-4 py-4 border-b border-[var(--border)]">
                        {role === 'host' && pendingJoinRequests.length > 0 && (
                            <div className="mb-4">
                                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--accent)] font-bold block mb-2">Pending Requests ({pendingJoinRequests.length})</span>
                                <div className="space-y-2">
                                    {pendingJoinRequests.map(req => (
                                        <div key={req.id} className="p-2.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-bold text-white truncate pr-2">{req.name}</span>
                                                <span className="text-[10px] text-[var(--text-dim)] font-mono">{req.device || 'Unknown'}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={() => socketRef.current?.emit('respond-join', { controllerId: req.id, approved: true, permission: 'view' }, roomCode)}
                                                    className="flex-1 py-1.5 bg-[var(--success)]/20 text-[var(--success)] hover:bg-[var(--success)]/30 rounded text-xs font-bold transition-colors"
                                                >
                                                    Approve
                                                </button>
                                                <button 
                                                    onClick={() => socketRef.current?.emit('respond-join', { controllerId: req.id, approved: false }, roomCode)}
                                                    className="flex-1 py-1.5 bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30 rounded text-xs font-bold transition-colors"
                                                >
                                                    Deny
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {role === 'host' && observationRequest && (
                            <div className="mb-4 rounded-lg border border-[var(--amber)]/30 bg-[var(--amber)]/10 p-3">
                                <p className="mb-2 text-xs font-bold text-[var(--amber)]">Admin observation request</p>
                                <p className="mb-3 text-[11px] text-[var(--text-secondary)]">An administrator wants visible access to the live screen.</p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            socketRef.current?.emit('respond-observation', { observerId: observationRequest, approved: true }, roomCode)
                                            setObservationRequest(null)
                                        }}
                                        className="flex-1 rounded bg-[var(--success)]/20 py-1.5 text-xs font-bold text-[var(--success)]"
                                    >
                                        Allow
                                    </button>
                                    <button
                                        onClick={() => {
                                            socketRef.current?.emit('respond-observation', { observerId: observationRequest, approved: false }, roomCode)
                                            setObservationRequest(null)
                                        }}
                                        className="flex-1 rounded bg-[var(--danger)]/20 py-1.5 text-xs font-bold text-[var(--danger)]"
                                    >
                                        Deny
                                    </button>
                                </div>
                            </div>
                        )}
                        {role === 'host' && (
                            <div className="mb-4">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-dim)] font-bold">Controllers</span>
                                    <span className="font-mono text-[10px] text-[var(--text-dim)]">{observerCount} observer(s)</span>
                                </div>
                                {participants.length === 0 ? (
                                    <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-dim)]">No approved controllers yet.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {participants.map(participant => (
                                            <button
                                                key={participant.id}
                                                onClick={() => setSelectedControllerId(participant.id)}
                                                className={cn(
                                                    "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                                                    selectedParticipant?.id === participant.id
                                                        ? "border-[var(--accent)] bg-[var(--accent)]/10"
                                                        : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/40"
                                                )}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{participant.name}</span>
                                                    <span className="font-mono text-[10px] uppercase text-[var(--accent)]">{participant.permission}</span>
                                                </div>
                                                <p className="mt-1 truncate text-[10px] text-[var(--text-dim)]">{participant.email || participant.socketId}</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-dim)] font-bold block mb-3">Permission</span>
                        {role === 'host' && (
                            <button onClick={() => setShowAiSettings(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 text-xs font-bold transition-colors">
                                <Zap className="w-4 h-4" />
                                AI Calibrate
                            </button>
                        )}
                        <div className="space-y-1 mt-3">
                            {permissionLevels.map(lvl => {
                                const Icon = lvl.icon;
                                return (
                                    <button key={lvl.id} onClick={() => updatePermission(lvl.id)} className={cn("w-full h-11 flex items-center gap-3 px-3", selectedPermission === lvl.id ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--text-dim)]")}>
                                        <Icon className="w-4 h-4" />
                                        <span className="text-[13px] font-medium">{lvl.label}</span>
                                    </button>
                                );
                            })}
                            {role === 'host' && selectedParticipant && (
                                <button
                                    onClick={() => updateClipboardPolicy(!selectedClipboardAllowed)}
                                    className={cn(
                                        "w-full h-11 flex items-center gap-3 px-3 text-left",
                                        selectedClipboardAllowed ? "text-[var(--success)] bg-[var(--success)]/10" : "text-[var(--text-dim)]"
                                    )}
                                >
                                    {selectedClipboardAllowed ? <Clipboard className="w-4 h-4" /> : <ClipboardX className="w-4 h-4" />}
                                    <span className="text-[13px] font-medium">{selectedClipboardAllowed ? "Clipboard Allowed" : "Clipboard Blocked"}</span>
                                </button>
                            )}
                            <button onClick={toggleRecording} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 text-xs font-bold transition-colors">
                                {isRecording ? (
                                    <>
                                        <Square className="w-4 h-4 fill-current" />
                                        <span className="hidden sm:inline">Stop Rec</span>
                                    </>
                                ) : (
                                    <>
                                        <Radio className="w-4 h-4" />
                                        <span className="hidden sm:inline">Record</span>
                                    </>
                                )}
                            </button>
                            {true && (
                                <button onClick={captureEvidence} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 text-xs font-bold transition-colors">
                                    <Eye className="w-4 h-4" />
                                    <span className="hidden sm:inline">Capture</span>
                                </button>
                            )}
                            {sessionMode === 'supervised' && role === 'host' && (
                                <button onClick={runFederatedEpoch} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 text-xs font-bold transition-colors">
                                    <Brain className="w-4 h-4" />
                                    <span className="hidden sm:inline">Train FL Epoch</span>
                                </button>
                            )}
                        </div>
                        {(sessionMode === 'collaboration' || sessionMode === 'supervised') && (
                            <div className="mt-4 border-t border-[var(--border)] pt-4">
                                <FileTransfer />
                            </div>
                        )}
                        {sessionMode === 'collaboration' && (
                            <div className="mt-4 border-t border-[var(--border)] pt-4">
                                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-dim)] font-bold block mb-3">Fun Filters</span>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-[10px] text-[var(--text-secondary)] block mb-1">Voice Changer</label>
                                        <select 
                                            value={voiceFilter}
                                            onChange={(e) => setVoiceFilter(e.target.value as VoiceFilter)}
                                            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                                        >
                                            <option value="none">Normal Voice</option>
                                            <option value="robot">Robot</option>
                                            <option value="alien">Alien</option>
                                            <option value="radio">Radio</option>
                                            <option value="megaphone">Megaphone</option>
                                            <option value="deep">Deep / Witness Protection</option>
                                            <option value="chipmunk">Chipmunk</option>
                                            <option value="echo">Canyon Echo</option>
                                            <option value="male">Male EQ</option>
                                            <option value="female">Female EQ</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-[var(--text-secondary)] block mb-1">Virtual Avatar</label>
                                        <select 
                                            value={avatarStyle}
                                            onChange={(e) => setAvatarStyle(e.target.value as AvatarStyle)}
                                            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                                        >
                                            <option value="none">Normal Camera</option>
                                            <option value="cyberpunk">Cyberpunk Visor</option>
                                            <option value="neon">Neon Mask</option>
                                            <option value="pixel">8-Bit Pixel Face</option>
                                            <option value="hologram">Hologram</option>
                                            <option value="sketch">Sketch Outline</option>
                                            <option value="synthwave">Synthwave</option>
                                            <option value="anime">Anime</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-[var(--text-secondary)] block mb-1">Virtual Background</label>
                                        <select 
                                            value={backgroundStyle}
                                            onChange={(e) => {
                                                const val = e.target.value as BackgroundStyle;
                                                if (val === 'custom') {
                                                    backgroundInputRef.current?.click();
                                                } else {
                                                    setBackgroundStyle(val);
                                                }
                                            }}
                                            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                                        >
                                            <option value="none">Normal Background</option>
                                            <option value="blur">Blur Background</option>
                                            <option value="office">Office Room</option>
                                            <option value="beach">Tropical Beach</option>
                                            <option value="space">Outer Space</option>
                                            <option value="matrix">Matrix</option>
                                            <option value="custom">Choose your own...</option>
                                        </select>
                                        <input 
                                            type="file" 
                                            ref={backgroundInputRef} 
                                            className="hidden" 
                                            accept="image/*"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    const url = URL.createObjectURL(file);
                                                    setCustomBackgroundUrl(url);
                                                    setBackgroundStyle('custom');
                                                } else {
                                                    if (backgroundStyle === 'custom' && !customBackgroundUrl) {
                                                        setBackgroundStyle('none');
                                                    }
                                                }
                                                e.target.value = '';
                                            }} 
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </aside>

                <main className="flex-1 flex flex-col bg-[var(--bg)]">
                    <div className="flex-1 bg-black relative flex items-center justify-center">
                        {isCanvasMode && (
                            <StandaloneCanvas 
                                isHost={role === 'host'} 
                                peerId={selectedControllerId || undefined} 
                                onClose={() => setIsCanvasMode(false)} 
                            />
                        )}
                        {(connectionState === 'connected' || (role === 'controller' && connectionState === 'connecting') || (role === 'host' && isStreaming)) && (
                            <>
                                <video
                                    ref={mainVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    onMouseMove={event => emitMouse(event, 'mousemove')}
                                    onMouseDown={event => emitMouse(event, 'mousedown')}
                                    onMouseUp={event => emitMouse(event, 'mouseup')}
                                    onWheel={event => emitMouse(event, 'wheel')}
                                    className="w-full h-full object-contain absolute inset-0"
                                />
                                {sessionMode === 'collaboration' && <WhiteboardOverlay isHost={role === 'host'} />}
                            </>
                        )}
                        {role === 'host' && !isStreaming && (
                            <button onClick={startSharing} className="px-6 py-2 bg-[var(--accent)] text-black font-bold rounded-full">START SHARING</button>
                        )}
                        
                        {/* PiP / Remote Camera Container */}
                        <div className="absolute bottom-4 right-4 flex flex-col gap-3 z-50 pointer-events-none">
                            {role === 'host' ? (
                                participants
                                    .filter(participant => remoteCameraStreams[participant.id])
                                    .map(participant => (
                                        <div key={participant.id} className="w-48 h-36 bg-black border-2 border-[var(--border)] rounded-xl overflow-hidden shadow-2xl relative pointer-events-auto">
                                            <video
                                                ref={node => {
                                                    if (node) {
                                                        remoteCamRefs.current.set(participant.id, node)
                                                        assignVideoStream(node, remoteCameraStreams[participant.id])
                                                    } else {
                                                        remoteCamRefs.current.delete(participant.id)
                                                    }
                                                }}
                                                autoPlay
                                                playsInline
                                                className="h-full w-full object-cover"
                                            />
                                            <div className="absolute bottom-0 left-0 right-0 truncate bg-black/65 px-2 py-1 text-[10px] font-bold text-white">
                                                {participant.name}
                                            </div>
                                        </div>
                                    ))
                            ) : (
                                <div className={cn(
                                    "transition-all duration-300 pointer-events-auto",
                                    mainVideoRef.current?.srcObject
                                        ? "w-48 h-36 bg-black border-2 border-[var(--border)] rounded-xl overflow-hidden shadow-2xl relative opacity-100"
                                        : "w-48 h-36 bg-black border-2 border-[var(--border)] rounded-xl overflow-hidden shadow-2xl relative opacity-0 pointer-events-none"
                                )}>
                                    <video ref={remoteCamRef} autoPlay playsInline className={cn(
                                        "w-full h-full",
                                        mainVideoRef.current?.srcObject ? "object-cover" : "object-contain"
                                    )} />
                                </div>
                            )}

                            {/* Local Camera PiP */}
                            <div className={cn(
                                "w-48 h-36 bg-black border-2 border-[var(--border)] rounded-xl overflow-hidden shadow-2xl relative transition-opacity pointer-events-auto",
                                !hasLocalMedia ? "opacity-0 pointer-events-none" : "opacity-100"
                            )}>
                                {/* The raw camera is visually hidden but must not use display:none so AI pipelines keep getting frames */}
                                <video ref={localCamRef} autoPlay playsInline muted className="absolute opacity-0 pointer-events-none w-1 h-1" />
                                {/* The preview shows the filtered result */}
                                <video ref={localPreviewRef} autoPlay playsInline muted className={cn("w-full h-full object-cover", localCamMuted && "opacity-0")} />
                                
                                <canvas ref={antiCheatCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none object-cover" />
                                <AiSupervisor
                                    isActive={role === 'controller' && sessionMode === 'supervised' && hasLocalMedia && !localCamMuted}
                                    status={antiCheatStatus}
                                />
                                {riskScore > 0 && <div className="absolute top-0 left-0 right-0 bg-red-600/80 text-white text-xs font-bold text-center py-0.5">VIOLATION: {riskScore} PTS</div>}
                                {localCamMuted && <div className="absolute inset-0 flex items-center justify-center text-[var(--text-dim)]"><VideoOff className="w-6 h-6" /></div>}

                        </div>
                        </div>

                        {/* Malpractice Warnings (Bottom-Left) */}
                        <div className="absolute bottom-4 left-56 z-50 flex flex-col gap-2 pointer-events-none">
                            {malpracticeWarnings.map((warning, idx) => (
                                <div key={idx} className="flex items-center gap-2 bg-red-900/90 border border-red-500 text-white px-4 py-2 rounded-lg shadow-lg font-bold text-sm animate-[slideIn_0.3s_ease-out]">
                                    <AlertTriangle className="h-4 w-4 shrink-0" /> MALPRACTICE DETECTED: {warning}
                                </div>
                            ))}
                        </div>
                    </div>
                </main>
            </div>

            {chatOpen && (
                <div className="fixed right-4 top-16 z-[90] flex h-[min(560px,calc(100vh-5rem))] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
                    <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-[var(--accent)]" />
                            <span className="text-sm font-bold text-[var(--text-primary)]">Session Chat</span>
                        </div>
                        <button
                            onClick={() => setChatOpen(false)}
                            aria-label="Close Session Chat"
                            className="rounded-md p-1 text-[var(--text-dim)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
                        >
                            <XCircle className="h-4 w-4" />
                        </button>
                    </div>
                    <div ref={chatScrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                        {chatMessages.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-center text-xs text-[var(--text-dim)]">
                                No messages yet.
                            </div>
                        ) : (
                            chatMessages.map(message => {
                                const mine = message.senderId === socketRef.current?.id
                                return (
                                    <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                                        <div className={cn(
                                            "max-w-[82%] rounded-lg border px-3 py-2",
                                            mine
                                                ? "border-[var(--accent)]/40 bg-[var(--accent)]/15"
                                                : "border-[var(--border)] bg-[var(--bg)]"
                                        )}>
                                            <div className="mb-1 flex items-center justify-between gap-3">
                                                <span className="truncate text-[10px] font-bold uppercase text-[var(--text-secondary)]">{message.senderName}</span>
                                                <span className="shrink-0 font-mono text-[9px] text-[var(--text-dim)]">{message.time}</span>
                                            </div>
                                            <p className="break-words text-sm leading-relaxed text-[var(--text-primary)]">{message.text}</p>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                    <div className="border-t border-[var(--border)] p-3">
                        <div className="mb-2 flex gap-1">
                            {quickChatEmojis.map(emoji => (
                                <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => setChatInput(value => `${value}${emoji}`)}
                                    className="flex h-7 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg)] text-sm hover:border-[var(--accent)]"
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                        <form onSubmit={sendChatMessage} className="flex gap-2">
                            <input
                                value={chatInput}
                                onChange={event => setChatInput(event.target.value)}
                                maxLength={1000}
                                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                                placeholder="Message everyone"
                            />
                            <button
                                type="submit"
                                disabled={!chatInput.trim()}
                                aria-label="Send Message"
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-black disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Send className="h-4 w-4" />
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {showAiSettings && currentRoleRef.current === 'host' && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--elevated)]">
                            <div className="flex items-center gap-2 text-[var(--accent)]">
                                <Zap className="w-5 h-5" />
                                <h3 className="font-display font-bold text-lg text-[var(--text-primary)]">AI Calibration</h3>
                            </div>
                            <button onClick={() => setShowAiSettings(false)} className="text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors">
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2 flex justify-between">
                                    <span>Eye Tracking Threshold</span>
                                    <span className="text-[var(--accent)]">{aiConfig.eyeTrackingThreshold.toFixed(2)}</span>
                                </label>
                                <input type="range" min="0.5" max="0.95" step="0.05" value={aiConfig.eyeTrackingThreshold}
                                    onChange={e => setAiConfig(c => ({ ...c, eyeTrackingThreshold: parseFloat(e.target.value) }))}
                                    className="w-full accent-[var(--accent)]" />
                                <p className="text-[10px] text-[var(--text-dim)] mt-1">Lower = More sensitive (catches subtle movements). Higher = Less sensitive.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2 flex justify-between">
                                    <span>Emotion Sensitivity</span>
                                    <span className="text-[var(--accent)]">{aiConfig.emotionSensitivity.toFixed(2)}</span>
                                </label>
                                <input type="range" min="0.4" max="0.9" step="0.05" value={aiConfig.emotionSensitivity}
                                    onChange={e => setAiConfig(c => ({ ...c, emotionSensitivity: parseFloat(e.target.value) }))}
                                    className="w-full accent-[var(--accent)]" />
                                <p className="text-[10px] text-[var(--text-dim)] mt-1">Lower = Detects micro-expressions. Higher = Only extreme expressions.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2 flex justify-between">
                                    <span>Head Pose Margin</span>
                                    <span className="text-[var(--accent)]">{aiConfig.headPoseMargin.toFixed(2)}</span>
                                </label>
                                <input type="range" min="0.2" max="1.0" step="0.1" value={aiConfig.headPoseMargin}
                                    onChange={e => setAiConfig(c => ({ ...c, headPoseMargin: parseFloat(e.target.value) }))}
                                    className="w-full accent-[var(--accent)]" />
                                <p className="text-[10px] text-[var(--text-dim)] mt-1">Margin before triggering 'Looking Away'. Higher = More leeway.</p>
                            </div>
                        </div>
                        <div className="p-4 border-t border-[var(--border)] flex justify-end">
                            <button onClick={() => setShowAiSettings(false)} className="px-5 py-2 rounded-lg bg-[var(--accent)] text-black font-bold text-sm hover:brightness-110 transition-all">
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isCalibrating && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md flex-col text-white font-mono">
                    <div className="w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-6"></div>
                    <h2 className="text-2xl font-bold text-[var(--accent)] tracking-widest mb-2">
                        {antiCheatMsg?.toUpperCase() || "LOADING AI MODELS... (50MB)"}
                    </h2>
                    <p className="text-[var(--text-secondary)] text-sm mb-1">Please wait while the AI initializes.</p>
                    <p className="text-[var(--text-dim)] text-xs">This may take a moment on slower connections.</p>
                </div>
            )}

            {/* End Session Confirm Modal */}
            {showKillConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 text-center">
                        <h3 className="text-xl font-bold text-[var(--red)] mb-2">End Session?</h3>
                        <p className="text-sm text-[var(--text-secondary)] mb-6">This will terminate the room and disconnect all participants immediately.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowKillConfirm(false)} className="flex-1 py-2.5 rounded-lg border border-[var(--border)] hover:bg-[var(--elevated)]">Cancel</button>
                            <button onClick={() => {
                                socketRef.current?.emit('kill-session', roomCode);
                                window.location.href = '/app';
                            }} className="flex-1 py-2.5 rounded-lg bg-[var(--red)] text-white font-bold hover:brightness-110">End Now</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Leave Room Confirm Modal */}
            {showLeaveConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 text-center">
                        <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">Leave Room?</h3>
                        <p className="text-sm text-[var(--text-secondary)] mb-6">You are about to disconnect from this session.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowLeaveConfirm(false)} className="flex-1 py-2.5 rounded-lg border border-[var(--border)] hover:bg-[var(--elevated)]">Cancel</button>
                            <button onClick={() => {
                                socketRef.current?.emit('leave-session', roomCode);
                                window.location.href = '/app';
                            }} className="flex-1 py-2.5 rounded-lg bg-[var(--red)] text-white font-bold hover:brightness-110">Leave Now</button>
                        </div>
                    </div>
                </div>
            )}

            {requestingUser && (
                <PermissionRequestModal
                    isOpen={showPermModal}
                    onClose={() => setShowPermModal(false)}
                    requester={{
                        name: requestingUser.name || 'Controller',
                        initials: requestingUser.initials || 'C',
                        device: requestingUser.device || 'Remote device',
                        ip: requestingUser.ip || 'Unknown IP',
                    }}
                    onAllow={(nextPermission, options) => {
                        socketRef.current?.emit('access-granted', nextPermission, {
                            ...options,
                            targetId: requestingUser.controllerId,
                        }, roomCode)
                        setShowPermModal(false)
                        setRequestingUser(null)
                    }}
                    onDeny={() => {
                        socketRef.current?.emit('access-denied', roomCode, requestingUser.controllerId)
                        setShowPermModal(false)
                        setRequestingUser(null)
                    }}
                />
            )}
        </div>
    )
}
