"use client"

declare global {
    interface Window {
        ipcRenderer?: {
            send: (channel: string, data: any) => void
            on: (channel: string, func: (...args: any[]) => void) => void
        }
    }
}

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type { FormEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from 'react'
import { io, Socket } from "socket.io-client"
import { motion } from "framer-motion"
import { User, Copy, Check, MousePointer2, Keyboard, Maximize2, Minimize2, Video, VideoOff, Mic, MicOff, Settings, ShieldAlert, Monitor, Gamepad2, ArrowLeftRight, Square, Eye, MousePointer, X,
    MessageSquare, Send, Camera, Disc, Clipboard, ClipboardX, Copy as CopyIcon, Maximize, Minimize, Crosshair, Zap, Radio, AlertTriangle, Link, Volume2,
    VolumeX, ChevronDown, ChevronUp, ArrowLeft, XCircle, LogOut, Brain, PenTool, RefreshCw, Bot, PanelLeft, ShieldOff, Activity
} from 'lucide-react'
import {
    StatusBadge, RoomCodeDisplay, DataCard, TerminalLine,
    SectionHeader, DangerButton, GlowButton, LiveDot, AppLogo
} from "@/components/ircp/shared"
import { PermissionRequestModal } from "@/components/ircp/permission-modal"

import { VoiceChanger, VoiceFilter } from "@/lib/VoiceChanger"
import { VirtualAvatar, AvatarStyle } from "@/lib/VirtualAvatar"
import { Avatar3D, isAvatar3DStyle } from "@/lib/Avatar3D"
import { VirtualBackground, BackgroundStyle } from "@/lib/VirtualBackground"
import { CRDT_CHANNEL } from "@/lib/CrdtSync"
import { dataChannelManager } from "@/lib/DataChannelManager"
import { FileTransfer } from "@/components/ircp/FileTransfer"
import { WhiteboardOverlay } from "@/components/ircp/WhiteboardOverlay"
// Removed direct import to use dynamic import instead
import { AiSupervisor } from "@/components/ircp/supervisor/AiSupervisor"
import { SessionRecorder } from "@/lib/SessionRecorder"
import { FederatedFeatures, FederatedLearner } from "@/lib/FederatedLearner"
import { buildContribution, createRoundKeys, HeldShare, maskVector, openShares, prepareShares, revealShares, RoundKeys, RoundPeer } from "@/lib/secureAggregation"

import dynamic from 'next/dynamic'
const PetCanvas = dynamic(() => import('@/components/ircp/pet/PetCanvas').then(m => m.PetCanvas), { ssr: false })
const StandaloneCanvas = dynamic<{ peerId?: string; isHost: boolean; sessionMode?: string | null; onClose: () => void }>(() => import('@/components/ircp/StandaloneCanvas').then(m => m.StandaloneCanvas as any), { ssr: false })

import { ExamHostDashboard, ExamQuestion } from '@/components/ircp/exam/ExamHostDashboard'
import { ExamControllerOverlay } from '@/components/ircp/exam/ExamControllerOverlay'

import { AntiCheatEngine, AntiCheatEvent } from "@/lib/AntiCheatEngine"
import { useFaceProctoring } from "@/hooks/useFaceProctoring"
import { useObjectProctoring } from "@/hooks/useObjectProctoring"
import { useAudioProctoring } from "@/hooks/useAudioProctoring"
import { cn, getBackendUrl, fetchIceServers, getStoredAuthToken } from "@/lib/utils"
import { askPet } from "@/lib/askPet"
import { SessionActivityPanel, type ActivityEntry } from "@/components/ircp/SessionActivityPanel"
import { ClipboardSync, CLIPBOARD_CHANNEL } from "@/components/ircp/ClipboardSync"
import { E2EChatSession, RosterMember, WrappedKeyring, isE2EMessage } from "@/lib/E2EChat"
import {
    APPEARANCE_CHANGE_EVENT, APPEARANCE_LOCK_EVENT, AppearanceConfig,
    readPersonalAppearance, SessionMode
} from "@/lib/appearance"

type Role = "host" | "controller" | "admin"
type PermissionLevel = "view" | "mouse" | "keyboard" | "full"
type ConnectionState = "idle" | "waiting" | "connecting" | "connected"
// Server room events carry only a local "HH:MM:SS"; anchor them to today so they sort with device logs
function roomTimeToIso(time: string) {
    const match = /^(d{1,2}):(d{2}):(d{2})$/.exec(String(time || ''))
    if (!match) return new Date().toISOString()
    const at = new Date()
    at.setHours(Number(match[1]), Number(match[2]), Number(match[3]), 0)
    return at.toISOString()
}

type LogEntry = {
    time: string // ISO 8601 string
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
    time: string // ISO 8601 string
    senderId: string
    senderName: string
    role: "host" | "controller" | "admin"
    text: string
}
type EvidenceItem = {
    id?: string
    time?: string // ISO 8601 string
    timestamp?: string // ISO 8601 string
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

const quickChatEmojis = ['👍', '👎', '🙏', '✅', '❌', '🔥', '😂', '🎉', '💡', '🤔', '🚀', '❤️', '👀', '✨']

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
// Secure aggregation: per-update L2 clip bound and optional Gaussian noise (DP-FedAvg style)
const FL_CLIP_NORM = 1
const FL_NOISE_MULTIPLIER = Number(process.env.NEXT_PUBLIC_FL_DP_NOISE || 0)

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
        initialRoom ? "join" : createDirect ? null : (joinDirect ? "join" : searchParams.get("role") === "admin" ? null : "choose")
    )
    const [joinInput, setJoinInput] = useState(initialRoom || "")
    const [setupError, setSetupError] = useState("")
    const startedAtRef = useRef(0)

    // ── Malpractice Detection (OS-Level Focus Loss) ───────────────────────────
    // ── Session state ───────────────────────────────────────────────────────────
    const roleParam = searchParams.get("role")
    const [role, setRole] = useState<Role>((roleParam as Role) || (initialRoom || joinDirect ? "controller" : "host"))
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
    const [shareSources, setShareSources] = useState<any[]>([])
    const [showSharePicker, setShowSharePicker] = useState(false)
    const [mouseEnabled, setMouseEnabled] = useState(false)
    const [keyboardEnabled, setKeyboardEnabled] = useState(false)
    const [hudVisible, setHudVisible] = useState(true)
    const [isSwitching, setIsSwitching] = useState(false)
    const [linkCopied, setLinkCopied] = useState(false)
    const [showPermModal, setShowPermModal] = useState(false)
    const [requestingUser, setRequestingUser] = useState<any>(null)
    const [participants, setParticipants] = useState<Participant[]>([])
    const [panicShortcuts, setPanicShortcuts] = useState<string[]>([])
    const [panicNotice, setPanicNotice] = useState<string | null>(null)
    const [pendingJoinRequests, setPendingJoinRequests] = useState<JoinRequest[]>([])
    const [selectedControllerId, setSelectedControllerId] = useState<string | null>(null)
    const [clipboardAllowed, setClipboardAllowed] = useState(false)
    // chatMessages holds messages exactly as relayed (e2e ciphertext); decryption happens for display only
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
    const [decryptedChat, setDecryptedChat] = useState<Record<string, string | null>>({})
    const [e2eKeyVersion, setE2eKeyVersion] = useState(0)
    const [e2eFingerprint, setE2eFingerprint] = useState('')
    const e2eRef = useRef<E2EChatSession | null>(null)
    const e2eAnnouncedRef = useRef(false)
    const e2eRosterRef = useRef<RosterMember[]>([])
    const e2eQueueRef = useRef<Promise<void>>(Promise.resolve())
    const e2eKeyRequestAtRef = useRef(0)
    const [chatInput, setChatInput] = useState("")
    const [chatOpen, setChatOpen] = useState(false)
    const [activityOpen, setActivityOpen] = useState(false)
    // Host only: the room log and risk score kept by the server
    const [roomEvents, setRoomEvents] = useState<{ time: string; type: string; message: string }[]>([])
    const [roomRisk, setRoomRisk] = useState<number | null>(null)
    const [showPet, setShowPet] = useState(true)

    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).ipcRenderer) {
            (window as any).ipcRenderer.send('set-pet-enabled', showPet)
        }
    }, [showPet])
    const [showExamDashboard, setShowExamDashboard] = useState(true)
    const [petState, setPetState] = useState<'Idle' | 'Thinking' | 'Warning'>('Idle')
    const [petMessage, setPetMessage] = useState<string>('')
    const petTimerRef = useRef<NodeJS.Timeout | null>(null)
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
    const [logFilter, setLogFilter] = useState<'all' | 'anticheat' | 'system'>('all')
    const [observerCount, setObserverCount] = useState(0)
    const [observationRequest, setObservationRequest] = useState<string | null>(null)
    const [roleSwapRequest, setRoleSwapRequest] = useState<{ requesterId: string, requesterName: string } | null>(null)
    const [voiceFilter, setVoiceFilter] = useState<VoiceFilter>('none')
    const [avatarStyle, setAvatarStyle] = useState<AvatarStyle>('none')
    const [avatarError, setAvatarError] = useState<string | null>(null)
    const customAvatarObjectUrlRef = useRef<string | null>(null)
    const prevAvatarStyleRef = useRef<AvatarStyle>('none')
    
    const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>('none')

    // ── Glassmorphic UI Inactivity State ─────────────────────────────────────
    const [isUiVisible, setIsUiVisible] = useState(true)
    const [isSidebarOpen, setIsSidebarOpen] = useState(true)
    const uiTimerRef = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
        const resetTimer = () => {
            setIsUiVisible(true)
            if (uiTimerRef.current) clearTimeout(uiTimerRef.current)
            uiTimerRef.current = setTimeout(() => {
                // Only hide if we are connected/streaming (active session)
                if (connectionState === 'connected' || isStreaming) {
                    setIsUiVisible(false)
                }
            }, 3000)
        }

        window.addEventListener('mousemove', resetTimer)
        window.addEventListener('keydown', resetTimer)
        window.addEventListener('touchstart', resetTimer)
        
        resetTimer()

        return () => {
            window.removeEventListener('mousemove', resetTimer)
            window.removeEventListener('keydown', resetTimer)
            window.removeEventListener('touchstart', resetTimer)
            if (uiTimerRef.current) clearTimeout(uiTimerRef.current)
        }
    }, [connectionState, isStreaming])
    const [customBackgroundUrl, setCustomBackgroundUrl] = useState<string | null>(null)
    const [bgError, setBgError] = useState<string | null>(null)
    const customBgObjectUrlRef = useRef<string | null>(null)
    const prevBackgroundStyleRef = useRef<BackgroundStyle>('none')
    const [isCanvasMode, setIsCanvasMode] = useState(false)
    const [messages, setMessages] = useState<any[]>([])
    const [systemWarning, setSystemWarning] = useState<string | null>(null)

    const captureScreenshotEvidence = async (video: HTMLVideoElement | null, label: string): Promise<string | undefined> => {
        if (!video || video.videoWidth === 0 || video.videoHeight === 0) return undefined;
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(undefined);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(async (blob) => {
                if (!blob) return resolve(undefined);
                try {
                    const formData = new FormData();
                    formData.append('evidenceFile', blob, `violation-${Date.now()}.png`);
                    formData.append('roomCode', roomCodeRef.current || joinInput || '');
                    formData.append('label', label);
                    const token = getStoredAuthToken();
                    const res = await fetch(`${getBackendUrl()}/api/admin/upload-violation-screenshot`, {
                        method: 'POST',
                        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                        body: formData
                    });
                    const data = await res.json();
                    if (data.success && data.url) {
                        resolve(data.url);
                    } else {
                        resolve(undefined);
                    }
                } catch (e) {
                    console.error('Screenshot evidence upload failed', e);
                    resolve(undefined);
                }
            }, 'image/png');
        });
    };

    const logScrollRef = useRef<HTMLDivElement>(null)

    // Exam State
    const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([])
    const [examResults, setExamResults] = useState<Record<string, boolean>>({})
    const [examLiveAnswers, setExamLiveAnswers] = useState<Record<string, Record<string, any>>>({})
    // ── Refs ──────────────────────────────────────────────────────────────────
    const mainVideoRef = useRef<HTMLVideoElement>(null)
    const backgroundInputRef = useRef<HTMLInputElement>(null)
    const avatarInputRef = useRef<HTMLInputElement>(null)
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
    const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
    const localStreamRef = useRef<MediaStream | null>(null)
    const activeLocalStreamRef = useRef<MediaStream | null>(null)
    const screenStreamRef = useRef<MediaStream | null>(null)
    const voiceChangerRef = useRef<VoiceChanger | null>(null)
    const virtualAvatarRef = useRef<VirtualAvatar | null>(null)
    const avatar3DRef = useRef<Avatar3D | null>(null)
    const virtualBackgroundRef = useRef<VirtualBackground | null>(null)
    const sessionRecorderRef = useRef<SessionRecorder | null>(null)
    const engineRef = useRef<AntiCheatEngine | null>(null)
    const federatedLearnerRef = useRef<FederatedLearner | null>(null)
    // Ephemeral round key and frozen contribution, kept only until the masked update is sent
    // Per-round secrets (ephemeral key, self-mask seed, received shares), kept only until the round ends
    const flRoundStateRef = useRef<Map<number, {
        keys: RoundKeys
        seed: Uint8Array
        contribution: Float64Array
        peers?: RoundPeer[]
        held?: Map<string, HeldShare>
    }>>(new Map())
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
            if (!virtualBackgroundRef.current) {
                virtualBackgroundRef.current = new VirtualBackground();
                virtualBackgroundRef.current.onLoadError = (err) => {
                    setBgError(err instanceof Error ? err.message : 'Background model failed to load');
                };
            }
            virtualBackgroundRef.current.setBackgroundStyle(backgroundStyle, backgroundStyle === 'custom' && customBackgroundUrl ? customBackgroundUrl : undefined);
            
            if (currentVideoSource) {
                const bgStream = virtualBackgroundRef.current.start(currentVideoSource);
                if (!hiddenBgVideoRef.current) {
                    hiddenBgVideoRef.current = document.createElement('video');
                    hiddenBgVideoRef.current.autoplay = true;
                    hiddenBgVideoRef.current.playsInline = true;
                    hiddenBgVideoRef.current.muted = true;
                }
                hiddenBgVideoRef.current.srcObject = bgStream;
                hiddenBgVideoRef.current.play().catch(e => {
                    if (e.name !== 'AbortError') console.error("Could not play hidden bg stream", e);
                });
                currentVideoSource = hiddenBgVideoRef.current;
                
                const finalStream = new MediaStream();
                processedStream.getAudioTracks().forEach(t => finalStream.addTrack(t));
                bgStream.getVideoTracks().forEach(t => finalStream.addTrack(t));
                processedStream = finalStream;
            }
        } else {
            virtualBackgroundRef.current?.stop();
        }

        const updateSenders = (stream: MediaStream) => {
            const pCs = currentRoleRef.current === 'host' ? Array.from(hostPcRefs.current.entries()) : [['host', pcRef.current]];
            pCs.forEach(async ([targetId, pc]) => {
                if (!pc || (pc as RTCPeerConnection).signalingState === 'closed') return;
                const rtcPc = pc as RTCPeerConnection;
                const senders = rtcPc.getSenders();
                let needsRenegotiation = false;
                
                const audioTrack = stream.getAudioTracks()[0];
                if (audioTrack) {
                    const audioSender = senders.find(s => s.track?.kind === 'audio' && s.track !== screenStreamRef.current?.getAudioTracks()[0]);
                    if (audioSender) audioSender.replaceTrack(audioTrack);
                    else {
                        rtcPc.addTrack(audioTrack, stream);
                        needsRenegotiation = true;
                    }
                }
                
                const videoTrack = stream.getVideoTracks()[0];
                if (videoTrack) {
                    const videoSender = senders.find(s => s.track?.kind === 'video' && s.track !== screenStreamRef.current?.getVideoTracks()[0]);
                    if (videoSender) videoSender.replaceTrack(videoTrack);
                    else {
                        rtcPc.addTrack(videoTrack, stream);
                        needsRenegotiation = true;
                    }
                }

                if (needsRenegotiation) {
                    const negotiate = async () => {
                        try {
                            const offer = await rtcPc.createOffer();
                            await rtcPc.setLocalDescription(offer);
                            socketRef.current?.emit('offer', {
                                offer,
                                roomId: roomCodeRef.current || joinInput,
                                targetId: targetId === 'host' ? undefined : targetId,
                                mediaStreamIds: getLocalMediaStreamIds(),
                            });
                        } catch (err) {
                            console.error('[DEBUG] Renegotiation failed:', err);
                        }
                    };

                    if (rtcPc.signalingState === 'stable') {
                        negotiate();
                    } else {
                        const onSignalingStateChange = () => {
                            if (rtcPc.signalingState === 'stable') {
                                rtcPc.removeEventListener('signalingstatechange', onSignalingStateChange);
                                negotiate();
                            }
                        };
                        rtcPc.addEventListener('signalingstatechange', onSignalingStateChange);
                    }
                }
            });
            
            if (localPreviewRef.current) {
                localPreviewRef.current.srcObject = stream;
            }
            activeLocalStreamRef.current = stream;
        };

        if (avatarStyle !== 'none') {
            let avatarStream: MediaStream | null = null;
            if (isAvatar3DStyle(avatarStyle)) {
                // 3D avatars replace the camera entirely: only the rendered character is sent
                virtualAvatarRef.current?.stop();
                if (!avatar3DRef.current) {
                    avatar3DRef.current = new Avatar3D();
                    avatar3DRef.current.onLoadError = () => setAvatarError('3D face tracking failed to load');
                }
                avatar3DRef.current.setStyle(avatarStyle);
                if (currentVideoSource) avatarStream = avatar3DRef.current.start(currentVideoSource);
            } else {
                avatar3DRef.current?.stop();
                if (!virtualAvatarRef.current) virtualAvatarRef.current = new VirtualAvatar();
                virtualAvatarRef.current.setAvatarStyle(avatarStyle);
                if (currentVideoSource) avatarStream = virtualAvatarRef.current.start(currentVideoSource);
            }

            if (avatarStream) {
                const finalStream = new MediaStream();
                processedStream.getAudioTracks().forEach(t => finalStream.addTrack(t));
                avatarStream.getVideoTracks().forEach(t => finalStream.addTrack(t));
                updateSenders(finalStream);
            }
        } else {
            virtualAvatarRef.current?.stop();
            avatar3DRef.current?.stop();
            updateSenders(processedStream);
        }
        
        
    }, [voiceFilter, avatarStyle, backgroundStyle, customBackgroundUrl, hasLocalMedia]);

    useEffect(() => () => {
        avatar3DRef.current?.dispose();
        avatar3DRef.current = null;
    }, []);
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
    // Virtual background resource cleanup
    useEffect(() => {
        return () => {
            if (customBgObjectUrlRef.current) {
                URL.revokeObjectURL(customBgObjectUrlRef.current);
                customBgObjectUrlRef.current = null;
            }
        };
    }, []);

    // Virtual avatar resource cleanup
    useEffect(() => {
        return () => {
            if (customAvatarObjectUrlRef.current) {
                URL.revokeObjectURL(customAvatarObjectUrlRef.current);
                customAvatarObjectUrlRef.current = null;
            }
        };
    }, []);

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

    // The host takes clipboard text only from controllers it allowed; a controller only has the host
    const clipboardAcceptFrom = useCallback((peerId: string) => {
        if (role !== 'host') return true
        const participant = participants.find(p => p.id === peerId || p.socketId === peerId)
        return Boolean(participant?.clipboardAllowed)
    }, [role, participants])
    const clipboardPeerName = useCallback((peerId: string) => {
        if (role !== 'host') return 'the host'
        return participants.find(p => p.id === peerId || p.socketId === peerId)?.name || 'a participant'
    }, [role, participants])

    const activityEntries = useMemo<ActivityEntry[]>(() => [
        ...sessionLogs.map(entry => ({ ...entry, source: 'device' as const })),
        ...(role === 'host' ? roomEvents.map(entry => ({ ...entry, source: 'room' as const })) : []),
    ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)), [sessionLogs, roomEvents, role])

    const addLog = useCallback((type: LogEntry['type'], message: string) => {
        setSessionLogs(prev => [...prev, { time: new Date().toISOString(), type, message }].slice(-100))
    }, [])

    const ensureFederatedLearner = useCallback(() => {
        if (!federatedLearnerRef.current) federatedLearnerRef.current = new FederatedLearner()
        return federatedLearnerRef.current
    }, [])

    const recordFederatedSample = useCallback((features: FederatedFeatures, label: number) => {
        ensureFederatedLearner().addSample(features.map(clamp01) as FederatedFeatures, label)
    }, [ensureFederatedLearner])

    const currentNetworkInstability = useCallback(() => {
        const networkInstability = clamp01(((packetLossRef.current || 0) / 12) + (latencyRef.current / 450))
        const frameDrop = streamFpsRef.current === null ? 0 : clamp01((24 - streamFpsRef.current) / 24)
        return Math.max(networkInstability, frameDrop)
    }, [])

    // Features: [visual signal, environment/focus signal, audio signal]. Live network quality is
    // included so the shared model can learn that detections during bad connections are less reliable.
    const federatedFeaturesForEvent = useCallback((eventType: string): FederatedFeatures => {
        const network = currentNetworkInstability()
        if (['NO_FACE', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'PHONE_DETECTED'].includes(eventType)) return [1, network, 0.15]
        if (['VOICE_DETECTED', 'TALKING_DETECTED', 'STRESS_DETECTED', 'EMOTION_ANOMALY'].includes(eventType)) return [0.35, network, 1]
        if (eventType === 'TAB_SWITCHED') return [0.2, 1, 0.1]
        return [0.2, Math.max(0.2, network), 0.2]
    }, [currentNetworkInstability])

    // Once the room has a trained/aggregated model, scale each penalty by its violation confidence (0.5x-1.5x)
    const federatedPenalty = useCallback((features: FederatedFeatures, basePenalty: number) => {
        const learner = federatedLearnerRef.current
        if (!learner?.hasLearned() || basePenalty <= 0) return { penalty: basePenalty, confidence: null as number | null }
        const confidence = learner.predict(features)
        return { penalty: Math.max(1, Math.round(basePenalty * (0.5 + confidence))), confidence }
    }, [])

    const reportMalpractice = useCallback((reason: string, penalty = 15, features: FederatedFeatures = [0.7, 0.2, 0.6]) => {
        socketRef.current?.emit('system-alert', {
            room: roomCodeRef.current,
            type: 'anticheat_violation',
            event: 'PROCTORING_ALERT',
            message: reason,
            penalty,
            // Lets an admin's false-positive verdict come back as a training label for this device
            features: features.map(clamp01),
        })
        recordFederatedSample(features, 1)
        addLog('anticheat', `Malpractice detected: ${reason}`)
    }, [addLog, recordFederatedSample])

    const getLocalMediaStreamIds = () => ({
        screen: screenStreamRef.current?.id || null,
        camera: activeLocalStreamRef.current?.id || localStreamRef.current?.id || null,
    })

    const assignVideoStream = (video: HTMLVideoElement | null, stream: MediaStream) => {
        if (!video) return
        if (video.srcObject !== stream) video.srcObject = stream
        video.play().catch(() => { })
    }

    useEffect(() => {
        if (sessionMode !== 'supervised' || connectionState !== 'connected') return
        const timer = window.setInterval(() => {
            recordFederatedSample([0, currentNetworkInstability(), 0], 0)
        }, 30000)
        return () => window.clearInterval(timer)
    }, [sessionMode, connectionState, recordFederatedSample, currentNetworkInstability])

    const mediaStreamPromiseRef = useRef<Promise<MediaStream> | null>(null)

    const acquireLocalMedia = useCallback(async (videoRequired = true) => {
        if (localStreamRef.current) return localStreamRef.current
        if (mediaStreamPromiseRef.current) return mediaStreamPromiseRef.current

        if (!navigator.mediaDevices) {
            throw new Error("Media devices not available (requires HTTPS/localhost).")
        }

        (window as any).isRequestingPermissions = true;
        mediaStreamPromiseRef.current = navigator.mediaDevices.getUserMedia({ 
            video: videoRequired, 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        })

        try {
            const stream = await mediaStreamPromiseRef.current
            localStreamRef.current = stream
            setHasLocalMedia(true)
            return stream
        } catch (err: any) {
            if (videoRequired && (err.name === 'NotReadableError' || err.name === 'TrackStartError' || err.message?.includes('Timeout'))) {
                addLog('system', 'Camera is in use by another application or tab. Falling back to Audio-only...');
                try {
                    const fallbackStream = await navigator.mediaDevices.getUserMedia({ 
                        video: false, 
                        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
                    });
                    localStreamRef.current = fallbackStream;
                    setHasLocalMedia(true);
                    return fallbackStream;
                } catch (fallbackErr: any) {
                    addLog('system', `Camera & Mic blocked by OS/Hardware: ${fallbackErr.name} - ${fallbackErr.message}`);
                    throw fallbackErr;
                }
            } else {
                addLog('system', `Camera/Mic blocked by OS/Hardware: ${err.name} - ${err.message}`);
                throw err;
            }
        } finally {
            (window as any).isRequestingPermissions = false;
            mediaStreamPromiseRef.current = null
        }
    }, [])

    const stopLocalMedia = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop())
            localStreamRef.current = null
            activeLocalStreamRef.current = null
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
        // Audio proctoring listens to this track, so a candidate may not mute it (same rule as the camera)
        if (sessionMode === 'supervised' && role === 'controller' && !localMicMuted) {
            addLog('system', 'Microphone cannot be muted during a supervised session.');
            return;
        }
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
                addLog('system', `Microphone access denied: ${err.message}`)
            }
        }
    }

    const toggleLocalCam = async () => {
        if (sessionMode === 'supervised' && role === 'controller' && !localCamMuted) {
            addLog('system', 'Camera cannot be disabled during a supervised session.');
            return;
        }
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
        if (typeof window !== 'undefined' && (window as any).ipcRenderer) {
            (window as any).ipcRenderer.send('toggle-fullscreen');
            setIsFullscreen(!isFullscreen);
        } else {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.log);
            } else {
                if (document.exitFullscreen) document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.log);
            }
        }
    }

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') {
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
            const features = federatedFeaturesForEvent(ev.type)
            const { penalty, confidence } = federatedPenalty(features, ev.scorePenalty)
            addLog('anticheat', `${ev.type}: ${ev.message} (+${penalty}${confidence === null ? '' : `, FL confidence ${confidence.toFixed(2)}`})`)
            recordFederatedSample(features, ev.scorePenalty > 0 ? 1 : 0)
            setRiskScore(s => Math.min(100, s + penalty))
            setGaugeGlow(true)
            setTimeout(() => setGaugeGlow(false), 800)
            captureScreenshotEvidence(localCamRef.current, ev.message).then(url => {
                socketRef.current?.emit('system-alert', {
                    type: 'anticheat_violation', event: ev.type,
                    message: ev.message, penalty, room: roomCode,
                    evidenceUrl: url,
                    features: features.map(clamp01),
                })
            });
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
    }, [sessionMode, role, addLog, federatedFeaturesForEvent, federatedPenalty, recordFederatedSample, stopLocalMedia])

    useEffect(() => {
        if (engineRef.current) engineRef.current.setConfig(aiConfig)
    }, [aiConfig])

    const selectedParticipant = participants.find(participant => participant.id === selectedControllerId) || participants[0] || null
    const selectedPermission = selectedParticipant?.permission || permission
    const selectedClipboardAllowed = selectedParticipant?.clipboardAllowed ?? clipboardAllowed

    const startStats = (pc: RTCPeerConnection) => {
        if (statsTimerRef.current) clearInterval(statsTimerRef.current) // one stats loop, not one per peer/role swap
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
                            return [...prev, { time: new Date().toISOString(), type: 'system' as const, message: msg }].slice(-100);
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
        const local = activeLocalStreamRef.current || localStreamRef.current
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

    // The host keeps one connection per controller; everyone else has a single connection
    const peerKey = (fromId?: string) => currentRoleRef.current === 'host' && fromId ? fromId : 'remote'
    const peerConnectionFor = (fromId?: string) => currentRoleRef.current === 'host' && fromId
        ? hostPcRefs.current.get(fromId)
        : pcRef.current
    const flushPendingIce = async (pc: RTCPeerConnection, fromId?: string) => {
        const key = peerKey(fromId)
        const queued = pendingIceRef.current.get(key)
        if (!queued) return
        pendingIceRef.current.delete(key)
        for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { })
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

            // Clipboard text, peer to peer; gated by the controller's clipboard permission
            const clipboardChannel = pc.createDataChannel(CLIPBOARD_CHANNEL, { ordered: true })
            dataChannelManager.attachChannel(clipboardChannel, targetId, CLIPBOARD_CHANNEL)

            // Reliable, ordered channel for Yjs CRDT sync (whiteboard, exam code mirror)
            const crdtChannel = pc.createDataChannel(CRDT_CHANNEL, { ordered: true })
            dataChannelManager.attachChannel(crdtChannel, targetId, CRDT_CHANNEL)
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
        let iceRestarts = 0
        pc.onconnectionstatechange = () => {
            if (['connected', 'completed'].includes(pc.connectionState)) {
                setConnectionState('connected')
                iceRestarts = 0
            }
            // The host (offerer) recovers failed paths with an ICE restart using fresh TURN credentials,
            // e.g. after a network switch or when the original relay became unreachable
            if (pc.connectionState === 'failed' && currentRoleRef.current === 'host' && targetId && iceRestarts < 3) {
                iceRestarts += 1
                addLog('system', `Connection to peer failed; restarting ICE (attempt ${iceRestarts})`)
                fetchIceServers()
                    .then(async (freshServers) => {
                        iceServersRef.current = freshServers
                        pc.setConfiguration({ ...pc.getConfiguration(), iceServers: freshServers })
                        if (pc.signalingState !== 'stable') return
                        const offer = await pc.createOffer({ iceRestart: true })
                        await pc.setLocalDescription(offer)
                        socketRef.current?.emit('offer', {
                            offer,
                            roomId: roomCodeRef.current,
                            targetId,
                            mediaStreamIds: getLocalMediaStreamIds(),
                        })
                    })
                    .catch(err => addLog('system', `ICE restart failed: ${err?.message || err}`))
            }
        }
        startStats(pc)
        startQualityStats(pc, targetId || 'primary')
        return pc
    }

    const setupSocket = useCallback((asRole: Role, code?: string) => {
        const token = getStoredAuthToken() || undefined
        const backendUrl = getBackendUrl()
        console.log('[DEBUG] setupSocket called, role:', asRole, 'backendUrl:', backendUrl)

        const socket = io(backendUrl, { 
            withCredentials: true,
            auth: token ? { token } : undefined
        })
        socketRef.current = socket;
        (window as any)._socket = socket;
        (window as any)._roomCode = roomCodeRef;
        socket.on('connect', () => {
            e2eAnnouncedRef.current = false
            if (asRole === 'host' && roomCodeRef.current) {
                // Reconnected after a drop: take the existing room back instead of opening a new one
                socket.emit('resume-host', { roomId: roomCodeRef.current })
            } else if (asRole === 'host') {
                socket.emit('create-room', { name: localStorage.getItem('ircp_name') || 'Host', mode: sessionModeRef.current, appearance: readPersonalAppearance() })
            } else if (asRole === 'admin') {
                const room = code || joinInput
                setRoomCode(room)
                socket.emit('join-room', room, 'admin', { name: 'Administrator' })
                setConnectionState('connecting')
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
            router.push('/app');
        })
        socket.on('removed-from-session', (data: any) => {
            alert('You have been removed: ' + (data.reason || 'No reason provided'));
            router.push('/app');
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
            announceE2E(socket, state.roomCode)
            setObserverCount(state.observerCount || 0)
            if (Array.isArray(state.events)) setRoomEvents(state.events.map((event: any) => ({ ...event, time: roomTimeToIso(event.time) })))
            if (typeof state.riskScore === 'number') setRoomRisk(state.riskScore)
            setExamQuestions(state.examQuestions || [])
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
                let pc = currentRoleRef.current === 'host' ? hostPcRefs.current.get(payload.fromId) : pcRef.current;
                if (!pc || pc.signalingState === 'closed') {
                    pc = await createPC(payload.fromId);
                }
                await pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
                await flushPendingIce(pc, payload.fromId)
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
            try {
                // The server always sets fromId, but only the host keeps one connection per peer;
                // a controller's single connection is pcRef (renegotiations it starts answer here)
                const pc = peerConnectionFor(payload?.fromId)
                if (!pc) return
                await pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
                await flushPendingIce(pc, payload?.fromId)
            } catch (err) {
                console.error('[DEBUG] Error setting remote answer:', err);
            }
        })
        socket.on('ice-candidate', async (payload: any) => {
            if (!payload?.candidate) return
            const pc = peerConnectionFor(payload.fromId)
            // Candidates can arrive before the connection exists or before its remote description is
            // set; queue them instead of dropping them, or relay-only (TURN) connections fail
            if (!pc || !pc.remoteDescription) {
                const key = peerKey(payload.fromId)
                pendingIceRef.current.set(key, [...(pendingIceRef.current.get(key) || []), payload.candidate].slice(-100))
                return
            }
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {})
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
        // Administrators observing a collaboration room wait for the host's consent
        socket.on('observation-pending', () => addLog('system', 'Waiting for the host to approve your observation request'))
        socket.on('observation-denied', () => {
            alert('The host declined your observation request.')
            router.push('/admin')
        })
        socket.on('observation-granted', () => { setConnectionState('connecting'); addLog('system', 'Host approved observation') })
        socket.on('room-event', (event: { time: string; type: string; message: string }) => {
            setRoomEvents(prev => [...prev, { ...event, time: roomTimeToIso(event.time) }].slice(-200))
        })
        socket.on('chat-message', (message: ChatMessage) => {
            setChatMessages(prev => [...prev, message].slice(-100))
        })
        // Host: hand the wrapped group key to members that lack it, rotating when someone left
        socket.on('e2e-roster', ({ hostId, members }: { hostId: string; members: RosterMember[] }) => {
            e2eRosterRef.current = members
            if (hostId === socket.id) runE2EHostPass(socket)
        })
        socket.on('e2e-key-request', ({ memberId }: { memberId: string }) => {
            e2eRef.current?.resetShare(memberId)
            runE2EHostPass(socket)
        })
        socket.on('e2e-key-share', ({ payload }: { payload: WrappedKeyring }) => {
            const session = e2eRef.current
            if (!session) return
            e2eQueueRef.current = e2eQueueRef.current.then(async () => {
                try {
                    await session.receiveKeyring(payload)
                    setE2eFingerprint(await session.hostFingerprint())
                    setE2eKeyVersion(v => v + 1)
                } catch {
                    addLog('system', 'Received a chat key that could not be unwrapped')
                }
            })
        })
        socket.on('system-warning', (message: string) => {
            setSystemWarning(message)
            addLog('system', `ADMIN WARNING: ${message}`)
            const audio = new Audio('/alert.mp3') // Try to play an alert sound if it exists
            audio.play().catch(() => {})
        })
        socket.on('controller-observation-ended', ({ adminId }: { adminId: string }) => {
            observerPcRefs.current.get(adminId)?.close()
            observerPcRefs.current.delete(adminId)
        })
        socket.on('controller-observation-requested', async ({ adminId }: { adminId: string }) => {
            try {
                if (currentRoleRef.current !== 'controller') return
                const stream = activeLocalStreamRef.current || localStreamRef.current
                if (!stream) {
                    socketRef.current?.emit('controller-observation-unavailable', { adminId, reason: 'The participant has no camera stream to share.' })
                    return
                }
                observerPcRefs.current.get(adminId)?.close()
                addLog('system', 'An administrator is viewing your camera (supervised session)')
                
                const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })
                observerPcRefs.current.set(adminId, pc)
                stream.getTracks().forEach(t => pc.addTrack(t, stream))
                
                pc.onicecandidate = e => {
                    if (e.candidate) {
                        socketRef.current?.emit('controller-observation-ice-candidate', { adminId, candidate: e.candidate })
                    }
                }
                
                const offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                socketRef.current?.emit('controller-observation-offer', { adminId, offer })
            } catch (err) {
                console.error("Failed to establish controller observation", err)
            }
        })
        socket.on('fl-round-open', async ({ round, baseRound }: { round: number; baseRound: number }) => {
            if (sessionModeRef.current !== 'supervised' || !['host', 'controller'].includes(currentRoleRef.current)) return
            const learner = ensureFederatedLearner()
            if (learner.getModelRound() !== baseRound) {
                socket.emit('fl-sync-request', { roomId: roomCodeRef.current })
                addLog('system', `Skipping federated round ${round}: syncing to the latest global model first`)
                return
            }
            try {
                if (learner.getPendingSampleCount() >= 2) await learner.trainLocalModel(10)
                const contribution = buildContribution(await learner.getDelta(), learner.getSamplesSinceSync(), FL_CLIP_NORM, FL_NOISE_MULTIPLIER)
                const keys = await createRoundKeys()
                flRoundStateRef.current.set(round, { keys, seed: crypto.getRandomValues(new Uint8Array(32)), contribution })
                socket.emit('fl-join', {
                    roomId: roomCodeRef.current,
                    round,
                    publicKey: keys.publicKey,
                    baseRound,
                    vectorLength: contribution.length,
                    // The seeded initial model is public; it lets the server start the first round
                    initWeights: baseRound === 0 ? learner.getBaseWeights() : undefined,
                })
                addLog('system', `Joined secure federated round ${round} with ${learner.getSamplesSinceSync()} local sample(s)`)
            } catch (err: any) {
                addLog('system', `Could not join federated round ${round}: ${err?.message || err}`)
            }
        })
        socket.on('federated-update-accepted', ({ round, pendingContributors }: { round: number; pendingContributors: number }) => {
            addLog('system', `Federated round ${round}: ${pendingContributors} participant(s) joined`)
        })
        // Stage 2: Shamir-share our masking key and self-mask seed with every participant
        socket.on('fl-round-keys', async ({ round, peers }: { round: number; peers: RoundPeer[] }) => {
            const state = flRoundStateRef.current.get(round)
            if (!state) return
            try {
                state.peers = peers
                const { shares } = await prepareShares({ keys: state.keys, selfSeed: state.seed, peers, roomId: roomCodeRef.current || '', round })
                socket.emit('fl-shares', { roomId: roomCodeRef.current, round, shares })
            } catch (err: any) {
                addLog('system', `Key sharing failed for round ${round}: ${err?.message || err}`)
            }
        })
        // Stage 3: open the shares addressed to us and submit the masked update
        socket.on('fl-round-masking', async ({ round, peers, shares }: { round: number; peers: RoundPeer[]; shares: { from: string; ct: string }[] }) => {
            const state = flRoundStateRef.current.get(round)
            if (!state?.peers || !socket.id) return
            try {
                state.held = await openShares({ keys: state.keys, received: shares, peers: state.peers, roomId: roomCodeRef.current || '', round })
                const masked = await maskVector({ values: state.contribution, keys: state.keys, selfSeed: state.seed, selfId: socket.id, peers, roomId: roomCodeRef.current || '', round })
                socket.emit('fl-submit', { roomId: roomCodeRef.current, round, masked })
                addLog('system', `Submitted masked update for round ${round} (${peers.length} participants; the server only sees the sum)`)
            } catch (err: any) {
                addLog('system', `Masking failed for round ${round}: ${err?.message || err}`)
            }
        })
        // Stage 4: reveal exactly what the server needs to unmask the sum (never both secrets of one peer)
        socket.on('fl-unmask', ({ round, survivors, dropped }: { round: number; survivors: string[]; dropped: string[] }) => {
            const state = flRoundStateRef.current.get(round)
            flRoundStateRef.current.delete(round)
            if (!state?.held || !state.peers) return
            const known = new Set(state.peers.map(p => p.id))
            if (![...survivors, ...dropped].every(id => known.has(id))) return
            try {
                const shares = revealShares(state.held, survivors, dropped)
                socket.emit('fl-unmask-shares', { roomId: roomCodeRef.current, round, shares })
                if (dropped.length) addLog('system', `Federated round ${round}: helping recover ${dropped.length} dropped participant(s)`)
            } catch (err: any) {
                addLog('system', `Refused to unmask round ${round}: ${err?.message || err}`)
            }
        })
        socket.on('fl-round-aborted', ({ round, reason }: { round: number; reason: string }) => {
            flRoundStateRef.current.delete(round)
            addLog('system', `Federated round ${round} aborted: ${reason}`)
        })
        // An admin marked one of our alerts a false positive: learn it as a negative example. Several copies
        // outweigh the positive sample recorded when the detector fired, so the next round reduces such alarms.
        socket.on('fl-label-correction', ({ features, label }: { features: number[]; label: number }) => {
            if (!Array.isArray(features) || features.length !== 3) return
            const learner = ensureFederatedLearner()
            for (let i = 0; i < 3; i++) learner.addSample(features.map(clamp01) as FederatedFeatures, label)
            addLog('system', 'An administrator marked one of your alerts as a false positive; it will be used as a training label in the next federated round')
        })
        socket.on('fl-model-sync', async ({ round, weights }: { round: number; weights: number[] }) => {
            const ok = await ensureFederatedLearner().applyGlobal(weights, round)
            if (ok) addLog('system', `Synced to global federated model from round ${round}`)
        })
        socket.on('federated-aggregate', async ({ round, weights, contributorCount, sampleCount }: any) => {
            const ok = await ensureFederatedLearner().applyGlobal(weights, round)
            addLog(
                'system',
                ok
                    ? `Secure federated round ${round} applied: ${contributorCount} participant(s), ${sampleCount} sample(s)`
                    : `Federated round ${round} received but model shape did not match`
            )
        })
        socket.on('federated-error', ({ message }: { message: string }) => addLog('system', `Federated learning: ${message}`))
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
            router.push('/app')
        })
        socket.on('disconnect', (reason: string) => {
            if (reason === 'io client disconnect') return
            // The server keeps the seat (host or controller) for a grace period; the call itself is
            // rebuilt after reconnecting, so drop the stale peer connections now
            hostPcRefs.current.forEach(pc => pc.close())
            hostPcRefs.current.clear()
            pcRef.current?.close()
            pcRef.current = null
            pendingIceRef.current.clear()
            addLog('system', 'Connection to the session server lost; reconnecting...')
            if (currentRoleRef.current !== 'host') setConnectionState('connecting')
        })
        socket.on('resume-failed', ({ reason }: { reason?: string } = {}) => {
            alert(reason || 'The session ended while you were disconnected.')
            router.push('/app')
        })
        socket.on('host-reconnecting', () => {
            addLog('system', 'The host lost connection; waiting for them to come back...')
            // The host comes back on a new connection and sends a fresh offer
            pcRef.current?.close()
            pcRef.current = null
            pendingIceRef.current.clear()
            setConnectionState('connecting')
        })
        socket.on('host-resumed', () => addLog('system', 'The host is back; reconnecting the call'))
        socket.on('stats-update', (data: any) => {
            if (data) {
                setPacketLoss(data.packetLoss);
                setStreamFps(data.fps);
            }
        });
        socket.on('new-exam-question', (question: ExamQuestion) => {
            setExamQuestions(prev => prev.some(q => q.id === question.id) ? prev : [...prev, question]);
        });
        socket.on('exam-answer-result', ({ questionId, correct }: { questionId: string; correct: boolean }) => {
            setExamResults(prev => ({ ...prev, [questionId]: correct }))
            addLog('system', correct ? 'Your submitted answer was marked correct' : 'Your submitted answer was marked incorrect')
        });
        socket.on('host-live-answer-update', ({ questionId, controllerId, controllerName, answer }) => {
            setExamLiveAnswers(prev => {
                const newLive = { ...prev };
                if (!newLive[questionId]) newLive[questionId] = {};
                newLive[questionId][controllerId] = { ...answer, controllerName };
                return newLive;
            });
        });
            
        socket.on('role-swap-requested', ({ fromId, fromName }: { fromId: string, fromName: string }) => {
            setRoleSwapRequest({ requesterId: fromId, requesterName: fromName });
        })
        socket.on('role-swap-rejected', () => {
            alert('Your role swap request was rejected.');
        })
        socket.on('role-swap-completed', ({ newHostId, oldHostId, roomState }: any) => {
            addLog('system', 'Role swap completed, reconnecting streams...')
            
            // Release hardware locks (camera/mic) before swapping
            stopLocalMedia()
            
            // Tear down existing connections
            if (pcRef.current) {
                pcRef.current.close()
                pcRef.current = null
            }
            hostPcRefs.current.forEach(pc => pc.close())
            hostPcRefs.current.clear()
            observerPcRefs.current.forEach(pc => pc.close())
            observerPcRefs.current.clear()
            hostInputChannelRefs.current.clear()
            controllerInputChannelRef.current = null
            dataChannelManager.clearAll()
            
            // Stop screen sharing if active
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(t => t.stop())
                screenStreamRef.current = null
                setIsStreaming(false)
            }

            // Flip role
            const newRole = socket.id === newHostId ? 'host' : 'controller'
            setRole(newRole)
            currentRoleRef.current = newRole
            setConnectionState('waiting')

            // Update state from server
            setRoomCode(roomState.roomCode)
            setSessionMode(roomState.mode)
            setPermission(roomState.permission)
            setParticipants(roomState.participants || [])
            
            // If we became the controller, renegotiate
            if (newRole === 'controller') {
                setConnectionState('connecting')
                socket.emit('join-room', roomState.roomCode, 'controller', { name: localStorage.getItem('ircp_name') || 'Controller' })
            }
        })
    }, [joinInput, addLog, router])

    // Leaving the page (Leave, End, kicked, back button) must release the camera, mic and screen
    // capture, close every peer connection and leave the room; otherwise they keep running.
    useEffect(() => () => {
        const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop())
        stopTracks(screenStreamRef.current)
        stopTracks(activeLocalStreamRef.current)
        stopTracks(localStreamRef.current)
        pcRef.current?.close()
        hostPcRefs.current.forEach(pc => pc.close())
        hostPcRefs.current.clear()
        observerPcRefs.current.forEach(pc => pc.close())
        observerPcRefs.current.clear()
        if (statsTimerRef.current) clearInterval(statsTimerRef.current)
        statsTimerRefs.current.forEach(timer => clearInterval(timer))
        statsTimerRefs.current.clear()
        pendingIceRef.current.clear()
        socketRef.current?.disconnect()
        socketRef.current = null
    }, [])

    // Sync Pet state with Electron Floating Window
    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).ipcRenderer) {
            (window as any).ipcRenderer.send('pet-state-update', { petState, petMessage })
        }
    }, [petState, petMessage])

    useEffect(() => {
        if (setupMode === null && !socketRef.current) {
            setupSocket(role, joinInput || undefined)
        }
    }, [setupMode, role, joinInput, setupSocket])

    // Panic revoke: drops EVERY controller to View Only at once. In the desktop app the main process
    // has already locked remote input and released held keys/buttons before this runs.
    const panicRevokeAll = (source: string) => {
        if (currentRoleRef.current !== 'host') return
        window.ipcRenderer?.send('set-remote-input-lock', true)
        // Block in this renderer immediately as well, without waiting for the server's room state
        participantsRef.current = participantsRef.current.map(p => ({ ...p, permission: 'view' as const }))
        setParticipants(prev => prev.map(p => ({ ...p, permission: 'view' as const })))
        setPermission('view')
        if (roomCodeRef.current) {
            socketRef.current?.emit('access-granted', 'view', { reason: 'panic' }, roomCodeRef.current)
        }
        addLog('permission', `Panic revoke (${source}): all remote control revoked, every controller is now View Only`)
        setPanicNotice(`Remote control revoked (${source}). All controllers are View Only.`)
        window.setTimeout(() => setPanicNotice(null), 6000)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('Control Revoked', { body: 'All controllers were switched to View Only.' })
        }
    }
    const panicRevokeRef = useRef(panicRevokeAll)
    panicRevokeRef.current = panicRevokeAll

    useEffect(() => {
        // Desktop: global shortcut handled by the Electron main process (works even when unfocused)
        if (typeof window !== 'undefined' && (window as any).ipcRenderer && !(window as any)._panicListenerAdded) {
            (window as any)._panicListenerAdded = true;
            (window as any).ipcRenderer.on('panic-revoke-control', (info: { source?: string } = {}) => {
                window.dispatchEvent(new CustomEvent('panic-revoke', { detail: info?.source || 'Shift+Esc' }));
            });
        }
        (window as any).api?.getPanicShortcuts?.().then((keys: string[]) => setPanicShortcuts(Array.isArray(keys) ? keys : []))

        const onPanic = (event: Event) => panicRevokeRef.current(String((event as CustomEvent).detail || 'Shift+Esc'))
        // Browser host: same shortcut while the window is focused
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && event.shiftKey) {
                event.preventDefault()
                panicRevokeRef.current('Shift+Esc')
            }
        }
        window.addEventListener('panic-revoke', onPanic)
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('panic-revoke', onPanic)
            window.removeEventListener('keydown', onKeyDown)
        }
    }, []);

    const startSharingProcess = async () => {
        if (typeof window !== 'undefined' && (window as any).api && (window as any).api.getShareableSources) {
            try {
                const sources = await (window as any).api.getShareableSources();
                if (sources && sources.length > 0) {
                    setShareSources(sources);
                    setShowSharePicker(true);
                    return;
                }
            } catch (e) {
                console.warn('Failed to get sources via API', e);
            }
        }
        startSharing();
    }

    const startSharing = async () => {
        console.log('[DEBUG] startSharing CALLED!');
        try {
            console.log('[DEBUG] Calling getDisplayMedia...');
            (window as any).isRequestingPermissions = true;
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(t => t.stop());
            }
            let screen;
            try {
                screen = await navigator.mediaDevices.getDisplayMedia({ 
                    video: { frameRate: { ideal: 60, max: 144 } }, 
                    audio: true 
                });
            } catch (mediaErr) {
                console.warn('[DEBUG] getDisplayMedia with audio/high-framerate failed, falling back to basic video only', mediaErr);
                try {
                    screen = await navigator.mediaDevices.getDisplayMedia({ 
                        video: true 
                    });
                } catch (fallbackErr) {
                    console.error('[DEBUG] Fallback getDisplayMedia failed', fallbackErr);
                    addLog('system', `Screen sharing failed or was cancelled`);
                    return;
                }
            }
            
            if (!screen) {
                return;
            }
            console.log('[DEBUG] getDisplayMedia SUCCESS!');
            
            // Multi-Monitor Detection
            if (sessionMode === 'supervised') {
                const track = screen.getVideoTracks()[0];
                const settings = track.getSettings();
                if (settings.width && settings.height) {
                    const aspectRatio = settings.width / settings.height;
                    if (aspectRatio > 2.4) { // Typical dual monitor (e.g. 3840x1080)
                        track.stop();
                        const message = "Multi-monitor setup detected. Please disconnect extra monitors and share a single screen.";
                        reportMalpractice(`Multi-Monitor: ${message}`, 30, [1, 0, 0]);
                        setPetState('Warning');
                        setPetMessage(message);
                        if (petTimerRef.current) clearTimeout(petTimerRef.current);
                        petTimerRef.current = setTimeout(() => { setPetState('Idle'); setPetMessage(''); }, 8000);
                        return; // Abort screen sharing
                    }
                }
            }

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
        } finally {
            (window as any).isRequestingPermissions = false;
        }
    }

    const stopSharing = () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop())
            screenStreamRef.current = null
            setIsStreaming(false)
            addLog('system', 'Screen sharing stopped manually')
        }
    }

    const updatePermission = (nextPermission: PermissionLevel) => {
        setPermission(nextPermission)
        // Granting control again lifts a panic lock in the desktop app
        if (role === 'host' && nextPermission !== 'view') window.ipcRenderer?.send('set-remote-input-lock', false)
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
        
        const now = Date.now();
        if (type === 'mousemove') {
            if (now - lastMouseMoveTimeRef.current < 16) return;
            lastMouseMoveTimeRef.current = now;
        } else if (type === 'wheel') {
            if (now - lastWheelTimeRef.current < 16) return;
            lastWheelTimeRef.current = now;
        }

        const rect = event.currentTarget.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
        const button = 'button' in event ? event.button : 0;
        
        if (type === 'mousedown') pressedMouseButtonsRef.current.add(button);
        else if (type === 'mouseup') pressedMouseButtonsRef.current.delete(button);

        sendControlPayload({
            room: roomCodeRef.current,
            type,
            x,
            y,
            button,
            deltaY: 'deltaY' in event ? event.deltaY : 0,
        })
    }

    const pressedKeysRef = useRef<Set<string>>(new Set());
    const pressedMouseButtonsRef = useRef<Set<number>>(new Set());
    const lastMouseMoveTimeRef = useRef<number>(0);
    const lastWheelTimeRef = useRef<number>(0);

    useEffect(() => {
        if (role !== 'controller' || connectionState !== 'connected' || !keyboardEnabled) return
        const shouldIgnore = (target: EventTarget | null) => {
            const element = target as HTMLElement | null
            return Boolean(element && (
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || 
                element.closest('input, textarea, select')
            ))
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
            
            if (type === 'keydown') pressedKeysRef.current.add(event.key);
            else pressedKeysRef.current.delete(event.key);

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
        
        const releaseAllInputs = () => {
            pressedKeysRef.current.forEach(key => {
                sendControlPayload({
                    room: roomCodeRef.current,
                    type: 'keyup',
                    key,
                    code: '', // fallback since we don't store code
                    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
                });
            });
            pressedKeysRef.current.clear();

            pressedMouseButtonsRef.current.forEach(button => {
                sendControlPayload({
                    room: roomCodeRef.current,
                    type: 'mouseup',
                    x: 0,
                    y: 0,
                    button,
                    deltaY: 0,
                });
            });
            pressedMouseButtonsRef.current.clear();
        }

        const onKeyDown = (event: KeyboardEvent) => sendKey(event, 'keydown')
        const onKeyUp = (event: KeyboardEvent) => sendKey(event, 'keyup')
        
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener('blur', releaseAllInputs)
        
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
            window.removeEventListener('blur', releaseAllInputs)
            releaseAllInputs()
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

    const toggleRecording = () => {
        if (!isRecording) {
            if (!mainVideoRef.current || (!mainVideoRef.current.srcObject && !localCamRef.current?.srcObject && !remoteCamRef.current?.srcObject)) {
                addLog('system', 'Cannot start recording: No active media streams to record.')
                alert('Please start screen sharing or enable your camera before recording.')
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
        const video = mainVideoRef.current
        if (!video || !video.srcObject) {
            addLog('system', 'Cannot capture evidence: No active screen stream to capture.')
            return
        }
        if (video.videoWidth === 0 || video.videoHeight === 0) {
            addLog('system', 'Cannot capture evidence: Stream is not ready yet.')
            return
        }
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        
        canvas.toBlob(async (blob) => {
            if (!blob) return
            try {
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `evidence-${Date.now()}.png`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                setTimeout(() => URL.revokeObjectURL(url), 1000)
                addLog('system', 'Evidence captured and downloaded to your computer.')
            } catch (err: any) {
                console.error("Upload failed", err)
                addLog('system', `Evidence capture failed: ${err.message}`)
            }
        }, 'image/png')
    }

    // Asks the server to open a secure aggregation round; every eligible participant trains and joins
    const runFederatedEpoch = () => {
        socketRef.current?.emit('fl-round-start', { roomId: roomCodeRef.current })
        addLog('system', 'Requested a secure federated training round')
    }

    // Announces this participant's public chat key once it is a member of the room
    const announceE2E = (socket: Socket, room?: string) => {
        if (!room) return
        let session = e2eRef.current
        if (!session || session.roomId !== room) {
            session = new E2EChatSession(room)
            e2eRef.current = session
            e2eAnnouncedRef.current = false
        }
        if (e2eAnnouncedRef.current) return
        e2eAnnouncedRef.current = true
        session.init().then(publicKey => socket.emit('e2e-announce', { roomId: room, publicKey }))
    }

    const runE2EHostPass = (socket: Socket) => {
        const session = e2eRef.current
        if (!session || !session.publicKey || !socket.id) return
        e2eQueueRef.current = e2eQueueRef.current.then(async () => {
            const shares = await session.hostHandleRoster(socket.id!, e2eRosterRef.current)
            shares.forEach(share => socket.emit('e2e-key-share', { roomId: session.roomId, ...share }))
            setE2eFingerprint(await session.hostFingerprint())
            setE2eKeyVersion(v => v + 1)
        }).catch(err => addLog('system', `Chat key distribution failed: ${err?.message || err}`))
    }

    useEffect(() => {
        let cancelled = false
        const session = e2eRef.current
        ;(async () => {
            const next: Record<string, string | null> = {}
            for (const message of chatMessages) {
                if (isE2EMessage(message.text)) next[message.id] = session ? await session.decrypt(message.text) : null
            }
            if (cancelled) return
            setDecryptedChat(next)
            // Missing a key (e.g. after a reload): ask the host to re-share, at most every 5s
            const missing = Object.values(next).some(value => value === null)
            if (missing && currentRoleRef.current !== 'host' && roomCodeRef.current && Date.now() - e2eKeyRequestAtRef.current > 5000) {
                e2eKeyRequestAtRef.current = Date.now()
                socketRef.current?.emit('e2e-key-request', { roomId: roomCodeRef.current })
            }
        })()
        return () => { cancelled = true }
    }, [chatMessages, e2eKeyVersion])

    const sendChatMessage = async (event?: FormEvent) => {
        event?.preventDefault()
        const text = chatInput.trim()
        const activeRoom = roomCodeRef.current
        if (!text || !activeRoom) return
        const session = e2eRef.current
        if (!session?.hasKey()) {
            addLog('system', 'Chat is waiting for the end-to-end encryption key from the host')
            return
        }
        const encryptedText = await session.encrypt(text);
        socketRef.current?.emit('chat-message', { roomId: activeRoom, text: encryptedText })
        setChatInput('')
        setChatOpen(true)

        if (text.toLowerCase().startsWith('@pet')) {
            setPetState('Thinking')
            // The answer is shown only to the asker (the room got the encrypted @pet message itself)
            const showPetLine = (line: string) => setChatMessages(prev => [...prev, {
                id: `pet-${Date.now()}`,
                time: new Date().toISOString(),
                senderId: 'system',
                senderName: 'System',
                role: 'admin',
                text: line,
            }])
            try {
                showPetLine(`🐶 [Pet AI]: ${await askPet(text.replace(/^@pet/i, '').trim() || 'Hello!')}`)
            } catch (err: any) {
                showPetLine(`🐶 [Pet AI]: ${err?.message || 'The pet assistant is unavailable right now.'}`)
            } finally {
                setPetState('Idle')
            }
        }
    }

    useFaceProctoring(
        localCamRef,
        sessionMode,
        role,
        (type, message) => {
            reportMalpractice(`Proctoring [${type}]: ${message}`, 20, [0.8, 0, 0.2]);
            setPetState('Warning');
            setPetMessage(message);
            if (petTimerRef.current) clearTimeout(petTimerRef.current);
            petTimerRef.current = setTimeout(() => {
                setPetState('Idle');
                setPetMessage('');
            }, 8000);
            
            setChatMessages(prev => [...prev, {
                id: Date.now().toString(),
                time: new Date().toISOString(),
                senderId: 'system',
                senderName: 'System',
                role: 'admin',
                text: `⚠️ [System Warning]: ${message}`
            }]);
        }
    );

    const tabSwitchCountRef = useRef(0);

    useObjectProctoring(
        localCamRef,
        sessionMode,
        role,
        (type, message) => {
            reportMalpractice(`Proctoring [${type}]: ${message}`, 20, [0.8, 0, 0.2]);
            setPetState('Warning');
            setPetMessage(message);
            if (petTimerRef.current) clearTimeout(petTimerRef.current);
            petTimerRef.current = setTimeout(() => {
                setPetState('Idle');
                setPetMessage('');
            }, 8000);
            
            setChatMessages(prev => [...prev, {
                id: Date.now().toString(),
                time: new Date().toISOString(),
                senderId: 'system',
                senderName: 'System',
                role: 'admin',
                text: `⚠️ [System Warning]: ${message}`
            }]);
        }
    );

    useAudioProctoring(
        localStreamRef,
        sessionMode,
        role,
        (type, message) => {
            reportMalpractice(`Proctoring [${type}]: ${message}`, 15, [0.8, 0, 0.2]);
            setPetState('Warning');
            setPetMessage(message);
            if (petTimerRef.current) clearTimeout(petTimerRef.current);
            petTimerRef.current = setTimeout(() => {
                setPetState('Idle');
                setPetMessage('');
            }, 8000);
            
            setChatMessages(prev => [...prev, {
                id: Date.now().toString(),
                time: new Date().toISOString(),
                senderId: 'system',
                senderName: 'System',
                role: 'admin',
                text: `⚠️ [System Warning]: ${message}`
            }]);
        }
    );

    useEffect(() => {
        // One policy for leaving the exam window: warn on the first switch, end the session on the second.
        // blur and visibilitychange both fire for a single switch, so events within 2 s count once;
        // permission prompts and file pickers are not switches.
        if (sessionMode !== 'supervised' || role !== 'controller' || connectionState !== 'connected') return;
        let lastViolationAt = 0;

        const onFocusLost = (reason: string) => {
            if ((window as any).isRequestingPermissions || (window as any).isSelectingFile) return;
            const now = Date.now();
            if (now - lastViolationAt < 2000) return;
            lastViolationAt = now;
            tabSwitchCountRef.current += 1;
            void captureScreenshotEvidence(localCamRef.current, reason);
            if (tabSwitchCountRef.current >= 2) {
                reportMalpractice(`App Focus Fatal: ${reason} (second switch). Session terminated.`, 100, [1, 0, 0]);
                router.push('/app?terminated=tab_switch');
            } else {
                const message = 'App switch detected! Please keep this window active. A second violation will terminate your session.';
                reportMalpractice(`App Switch: ${reason}. ${message}`, 50, [1, 0, 0]);
                setPetState('Warning');
                setPetMessage(message);
                if (petTimerRef.current) clearTimeout(petTimerRef.current);
                petTimerRef.current = setTimeout(() => { setPetState('Idle'); setPetMessage(''); }, 8000);
            }
        };
        const onBlur = () => onFocusLost('Application lost focus (external app/click)');
        const onVisibilityChange = () => { if (document.visibilityState === 'hidden') onFocusLost('Tab switch or minimized app'); };

        window.addEventListener('blur', onBlur);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [sessionMode, role, connectionState, reportMalpractice, router]);

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller') return;
        
        const preventCopyPaste = (e: ClipboardEvent) => {
            e.preventDefault();
            const message = 'Copy/Paste is disabled during supervised sessions.';
            reportMalpractice(`Clipboard: ${message}`, 10, [0.5, 0, 0]);
            setPetState('Warning');
            setPetMessage(message);
            if (petTimerRef.current) clearTimeout(petTimerRef.current);
            petTimerRef.current = setTimeout(() => { setPetState('Idle'); setPetMessage(''); }, 8000);
        };

        document.addEventListener('copy', preventCopyPaste);
        document.addEventListener('paste', preventCopyPaste);
        return () => {
            document.removeEventListener('copy', preventCopyPaste);
            document.removeEventListener('paste', preventCopyPaste);
        };
    }, [sessionMode, role, reportMalpractice]);

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
                    <button onClick={() => router.push('/app')} className="mt-4 text-xs text-[var(--text-dim)] hover:text-[var(--text-primary)]">Cancel</button>
                </div>
            </div>
        )
    }

    return (
        <div ref={containerRef} className="h-screen overflow-hidden bg-[var(--bg)] relative text-[var(--text-primary)] font-sans">
            {/* SYSTEM WARNING TOAST */}
            {systemWarning && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 bg-[var(--red)]/20 border border-[var(--red)] text-[var(--red)] px-6 py-4 rounded-xl shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-10">
                    <AlertTriangle className="h-6 w-6 shrink-0" />
                    <div>
                        <p className="font-bold text-sm">ADMINISTRATOR WARNING</p>
                        <p className="text-sm opacity-90">{systemWarning}</p>
                    </div>
                    <button onClick={() => setSystemWarning(null)} className="ml-4 p-2 hover:bg-[var(--red)]/20 rounded-lg transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>
            )}

            {/* FLOATING HEADER (DYNAMIC ISLAND) */}
            <motion.header 
                drag
                dragMomentum={false}
                dragConstraints={containerRef}
                className={cn(
                "absolute top-4 left-1/2 -translate-x-1/2 h-[52px] flex items-center justify-between px-6 rounded-full border border-[var(--border)]/60 bg-[var(--surface)]/40 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] z-50 transition-colors duration-500 cursor-move",
                !isUiVisible && "opacity-0 -translate-y-8 pointer-events-none scale-95"
            )}>
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
                    {(role === 'host' || role === 'controller') && (
                        <ClipboardSync
                            canSend={role === 'host' || clipboardAllowed}
                            acceptFrom={clipboardAcceptFrom}
                            describePeer={clipboardPeerName}
                            onLog={message => addLog('system', message)}
                        />
                    )}
                    <button
                        onClick={() => { setActivityOpen(open => !open); setChatOpen(false) }}
                        aria-label="Toggle Session Activity"
                        aria-pressed={activityOpen}
                        title="Session activity"
                        className={cn("relative p-1.5 rounded-lg border transition-colors", activityOpen ? "bg-[var(--accent)] text-black border-transparent" : "text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]")}
                    >
                        <Activity className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => { setChatOpen(open => !open); setActivityOpen(false) }}
                        aria-label="Toggle Session Chat"
                        className={cn("relative p-1.5 rounded-lg border transition-colors", chatOpen ? "bg-[var(--accent)] text-black border-transparent" : "text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]")}
                    >
                        <MessageSquare className="w-4 h-4" />
                        {chatMessages.length > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--red)] px-1 text-[9px] font-bold text-[var(--text-primary)]">
                                {Math.min(chatMessages.length, 99)}
                            </span>
                        )}
                    </button>
                    <button 
                        onClick={toggleLocalMic} 
                        className={cn("relative p-2 rounded-full border transition-all duration-300 hover:scale-110 active:scale-95 shadow-sm", 
                            !localMicMuted ? "bg-[var(--accent)] text-black border-transparent shadow-[0_0_15px_var(--accent-glow)]" : "bg-[var(--surface)]/50 text-[var(--red)] border-[var(--border)]"
                        )}
                    >
                        {localMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                    <button 
                        onClick={toggleLocalCam} 
                        disabled={sessionMode === 'supervised' && role === 'controller' && !localCamMuted}
                        aria-label="Toggle Camera" 
                        className={cn("relative p-2 rounded-full border transition-all duration-300 hover:scale-110 active:scale-95 shadow-sm", 
                            (sessionMode === 'supervised' && role === 'controller' && !localCamMuted) ? "opacity-50 cursor-not-allowed" : "", 
                            !localCamMuted ? "bg-[var(--accent)] text-black border-transparent shadow-[0_0_15px_var(--accent-glow)]" : "bg-[var(--surface)]/50 text-[var(--red)] border-[var(--border)]"
                        )}
                    >
                        {localCamMuted ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                    </button>
                    <button onClick={toggleFullscreen} aria-label="Toggle Fullscreen" className="p-1.5 rounded-lg border text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setIsCanvasMode(!isCanvasMode)} className={cn("p-1.5 rounded-lg border hover:text-[var(--text-primary)] transition-colors", isCanvasMode ? "bg-[var(--accent)] text-black border-transparent" : "text-[var(--text-secondary)] border-[var(--border)]")} title="Toggle Canvas Mode">
                        <PenTool className="w-4 h-4" />
                    </button>
                    {sessionMode !== 'supervised' && (
                        <button onClick={() => setShowPet(!showPet)} className={cn("p-1.5 rounded-lg border hover:text-[var(--text-primary)] transition-colors", showPet ? "bg-[var(--accent)] text-black border-transparent" : "text-[var(--text-secondary)] border-[var(--border)]")} title="Toggle AI Pet">
                            <Bot className="w-4 h-4" />
                        </button>
                    )}
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={cn("p-1.5 rounded-lg border hover:text-[var(--text-primary)] transition-colors", isSidebarOpen ? "bg-[var(--accent)] text-black border-transparent" : "text-[var(--text-secondary)] border-[var(--border)]")} title="Toggle Sidebar">
                        <PanelLeft className="w-4 h-4" />
                    </button>
                    {role === 'host' && sessionMode === 'supervised' && (
                        <button onClick={() => setShowExamDashboard(!showExamDashboard)} className={cn("p-1.5 rounded-lg border hover:text-[var(--text-primary)] transition-colors", showExamDashboard ? "bg-[var(--accent)] text-black border-transparent" : "text-[var(--text-secondary)] border-[var(--border)]")} title="Toggle Exam Dashboard">
                            <Clipboard className="w-4 h-4" />
                        </button>
                    )}
                    {role === 'controller' && typeof window !== 'undefined' && (window as any).ipcRenderer && (
                        <GlowButton 
                            onClick={() => socketRef.current?.emit('request-role-swap', { roomId: roomCodeRef.current || joinInput })}
                            size="sm"
                        >SWAP ROLES</GlowButton>
                    )}
                    {role === 'host' && isStreaming && (
                        <GlowButton 
                            onClick={stopSharing}
                            size="sm"
                            className="bg-[var(--amber)] hover:shadow-[0_0_20px_rgba(255,191,0,0.4)] text-black"
                        >STOP SHARING</GlowButton>
                    )}
                    {role === 'host' ? (
                        <DangerButton onClick={() => setShowKillConfirm(true)} size="sm">END SESSION</DangerButton>
                    ) : (
                        <DangerButton onClick={() => setShowLeaveConfirm(true)} size="sm">LEAVE ROOM</DangerButton>
                    )}
                </div>
            </motion.header>

            {/* FLOATING SIDEBAR */}
            <aside className={cn(
                "absolute left-4 top-[80px] bottom-4 w-[280px] rounded-2xl border border-[var(--border)]/60 bg-[var(--surface)]/30 backdrop-blur-xl flex flex-col overflow-y-auto shadow-[0_8px_32px_rgba(0,0,0,0.4)] z-40 transition-all duration-500 group",
                (!isUiVisible || !isSidebarOpen) ? "opacity-0 -translate-x-8 pointer-events-none" : "hover:bg-[var(--surface)]/50 hover:backdrop-blur-2xl"
            )}>
                <div className="px-4 py-4 transition-opacity duration-300 opacity-60 group-hover:opacity-100">
                        {role === 'host' && pendingJoinRequests.length > 0 && (
                            <div className="mb-4">
                                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--accent)] font-bold block mb-2">Pending Requests ({pendingJoinRequests.length})</span>
                                <div className="space-y-2">
                                    {pendingJoinRequests.map(req => (
                                        <div key={req.id} className="p-2.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/20">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-bold text-[var(--text-primary)] truncate pr-2">{req.name}</span>
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
                        {roleSwapRequest && (
                            <div className="mb-4 rounded-xl border border-[var(--accent)] bg-[var(--accent)]/10 p-4 shadow-lg">
                                <p className="mb-2 text-xs font-bold text-[var(--accent)]">Role Swap Request</p>
                                <p className="mb-3 text-[11px] text-[var(--text-secondary)]">{roleSwapRequest.requesterName} has requested to swap roles with you.</p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            socketRef.current?.emit('accept-role-swap', { targetId: roleSwapRequest.requesterId, roomId: roomCodeRef.current || joinInput })
                                            setRoleSwapRequest(null)
                                        }}
                                        className="flex-1 rounded bg-[var(--success)]/20 py-1.5 text-xs font-bold text-[var(--success)]"
                                    >
                                        Accept
                                    </button>
                                    <button
                                        onClick={() => {
                                            socketRef.current?.emit('reject-role-swap', { requesterId: roleSwapRequest.requesterId, roomId: roomCodeRef.current || joinInput })
                                            setRoleSwapRequest(null)
                                        }}
                                        className="flex-1 rounded bg-[var(--danger)]/20 py-1.5 text-xs font-bold text-[var(--danger)]"
                                    >
                                        Reject
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
                                                    "w-full rounded-lg border px-3 py-2 text-left transition-colors flex flex-col",
                                                    selectedParticipant?.id === participant.id
                                                        ? "border-[var(--accent)] bg-[var(--accent)]/10"
                                                        : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/40"
                                                )}
                                            >
                                                <div className="flex items-center justify-between gap-2 w-full">
                                                    <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{participant.name}</span>
                                                    <span className="font-mono text-[10px] uppercase text-[var(--accent)]">{participant.permission}</span>
                                                </div>
                                                <p className="mt-1 truncate text-[10px] text-[var(--text-dim)] w-full">{participant.email || participant.socketId}</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {participants.length > 0 && selectedParticipant && (
                                    <button
                                        onClick={() => socketRef.current?.emit('request-role-swap', { targetId: selectedParticipant.id, roomId: roomCodeRef.current || joinInput })}
                                        className="w-full flex items-center justify-center gap-2 mt-3 px-3 py-2 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 text-xs font-bold transition-colors"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        Swap Roles with {selectedParticipant.name}
                                    </button>
                                )}
                            </div>
                        )}
                        {role === 'controller' && (
                            <button
                                onClick={() => socketRef.current?.emit('request-role-swap', { roomId: roomCodeRef.current || joinInput })}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 mb-4 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 text-xs font-bold transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Request Role Swap
                            </button>
                        )}
                        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-dim)] font-bold block mb-3">Permission</span>
                        {role === 'host' && (
                            <div className="mb-3">
                                <button
                                    onClick={() => panicRevokeAll('button')}
                                    className="w-full h-10 flex items-center justify-center gap-2 rounded-lg bg-[var(--red)]/15 text-[var(--red)] border border-[var(--red)]/40 hover:bg-[var(--red)]/25 text-xs font-bold transition-colors"
                                >
                                    <ShieldOff className="w-4 h-4" />
                                    Revoke all control
                                </button>
                                <p className="mt-1.5 text-[10px] text-[var(--text-dim)]">
                                    Emergency shortcut: <span className="font-mono text-[var(--text-secondary)]">{(panicShortcuts.length ? panicShortcuts : ['Shift+Escape']).map(key => key.replace('CommandOrControl', 'Ctrl')).join(' or ')}</span>
                                    {typeof window !== 'undefined' && (window as any).api?.getPanicShortcuts && panicShortcuts.length === 0 ? ' (only while this window is focused)' : ''}
                                </p>
                            </div>
                        )}
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
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[10px] text-[var(--text-secondary)] block">Virtual Avatar</label>
                                            {avatarError && <span className="text-[9px] text-[var(--red)] truncate ml-2 max-w-[150px]">{avatarError}</span>}
                                        </div>
                                        <select 
                                            value={avatarStyle}
                                            onChange={(e) => {
                                                const val = e.target.value as AvatarStyle;
                                                setAvatarError(null);
                                                if (val === 'custom') {
                                                    prevAvatarStyleRef.current = avatarStyle;
                                                    avatarInputRef.current?.click();
                                                } else {
                                                    setAvatarStyle(val);
                                                }
                                            }}
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
                                            <option value="robot3d">3D Robot</option>
                                            <option value="alien3d">3D Alien</option>
                                            <option value="bear3d">3D Bear</option>
                                            <option value="custom">Custom...</option>
                                        </select>
                                        <input 
                                            type="file" 
                                            ref={avatarInputRef} 
                                            className="hidden" 
                                            accept="image/*"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) {
                                                    if (avatarStyle !== 'custom') {
                                                        setAvatarStyle(prevAvatarStyleRef.current);
                                                    } else if (!customAvatarObjectUrlRef.current) {
                                                        setAvatarStyle('none');
                                                    }
                                                    return;
                                                }
                                                
                                                if (!file.type.startsWith('image/')) {
                                                    setAvatarError('Please select a valid image file');
                                                    setAvatarStyle(prevAvatarStyleRef.current);
                                                    e.target.value = '';
                                                    return;
                                                }
                                                
                                                if (file.size > 10 * 1024 * 1024) {
                                                    setAvatarError('Image too large (max 10MB)');
                                                    setAvatarStyle(prevAvatarStyleRef.current);
                                                    e.target.value = '';
                                                    return;
                                                }

                                                if (customAvatarObjectUrlRef.current) {
                                                    URL.revokeObjectURL(customAvatarObjectUrlRef.current);
                                                }
                                                const url = URL.createObjectURL(file);
                                                customAvatarObjectUrlRef.current = url;
                                                setAvatarStyle('custom');
                                                setAvatarError(null);
                                                e.target.value = '';
                                            }} 
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[10px] text-[var(--text-secondary)] block">Virtual Background</label>
                                            {bgError && <span className="text-[9px] text-[var(--red)] truncate ml-2 max-w-[150px]">{bgError}</span>}
                                        </div>
                                        <select 
                                            value={backgroundStyle}
                                            onChange={(e) => {
                                                const val = e.target.value as BackgroundStyle;
                                                setBgError(null);
                                                if (val === 'custom') {
                                                    prevBackgroundStyleRef.current = backgroundStyle;
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
                                            <option value="custom">Custom...</option>
                                        </select>
                                        <input 
                                            type="file" 
                                            ref={backgroundInputRef} 
                                            className="hidden" 
                                            accept="image/*"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) {
                                                    if (backgroundStyle !== 'custom') {
                                                        setBackgroundStyle(prevBackgroundStyleRef.current);
                                                    } else if (!customBackgroundUrl) {
                                                        setBackgroundStyle('none');
                                                    }
                                                    return;
                                                }
                                                
                                                if (!file.type.startsWith('image/')) {
                                                    setBgError('Please select a valid image file');
                                                    setBackgroundStyle(prevBackgroundStyleRef.current);
                                                    e.target.value = '';
                                                    return;
                                                }
                                                
                                                if (file.size > 10 * 1024 * 1024) {
                                                    setBgError('Image too large (max 10MB)');
                                                    setBackgroundStyle(prevBackgroundStyleRef.current);
                                                    e.target.value = '';
                                                    return;
                                                }

                                                if (customBgObjectUrlRef.current) {
                                                    URL.revokeObjectURL(customBgObjectUrlRef.current);
                                                }
                                                const url = URL.createObjectURL(file);
                                                customBgObjectUrlRef.current = url;
                                                setCustomBackgroundUrl(url);
                                                setBackgroundStyle('custom');
                                                setBgError(null);
                                                e.target.value = '';
                                            }} 
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </aside>

                <main className="absolute inset-0 bg-[var(--bg)] flex flex-col z-0">
                    <div className="flex-1 relative flex items-center justify-center">
                        {isCanvasMode && (
                            <StandaloneCanvas 
                                isHost={role === 'host'} 
                                peerId={selectedControllerId || undefined} 
                                sessionMode={sessionMode}
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
                                    className={cn(
                                        "w-full h-full object-contain absolute inset-0 transition-transform duration-300",
                                        (role === 'host' && isFullscreen && isStreaming) ? "scale-[0.95]" : "scale-100"
                                    )}
                                />
                                {sessionMode === 'collaboration' && <WhiteboardOverlay isHost={role === 'host'} />}
                            </>
                        )}
                        {role === 'host' && !isStreaming && (
                            <GlowButton onClick={startSharingProcess} size="lg" className="px-8 py-3 rounded-full pointer-events-auto">START SHARING</GlowButton>
                        )}
                        
                        {/* PiP / Remote Camera Container */}
                        <div className="absolute bottom-4 right-4 flex flex-col gap-3 z-[500] pointer-events-none">
                            {role === 'host' ? (
                                participants
                                    .filter(participant => remoteCameraStreams[participant.id])
                                    .map(participant => (
                                        <div key={participant.id} className="w-48 h-36 bg-[var(--bg)] border-2 border-[var(--border)] rounded-xl overflow-hidden shadow-2xl relative pointer-events-auto">
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
                                            <div className="absolute bottom-0 left-0 right-0 truncate bg-black/65 px-2 py-1 text-[10px] font-bold text-[var(--text-primary)]">
                                                {participant.name}
                                            </div>
                                        </div>
                                    ))
                            ) : (
                                <div className={cn(
                                    "transition-all duration-300 pointer-events-auto",
                                    mainVideoRef.current?.srcObject
                                        ? "w-48 h-36 bg-[var(--bg)] border-2 border-[var(--border)] rounded-xl overflow-hidden shadow-2xl relative opacity-100"
                                        : "w-48 h-36 bg-[var(--bg)] border-2 border-[var(--border)] rounded-xl overflow-hidden shadow-2xl relative opacity-0 pointer-events-none"
                                )}>
                                    <video ref={remoteCamRef} autoPlay playsInline className={cn(
                                        "w-full h-full",
                                        mainVideoRef.current?.srcObject ? "object-cover" : "object-contain"
                                    )} />
                                </div>
                            )}

                            {/* Local Camera PiP */}
                            <div className={cn(
                                "w-48 h-36 bg-[var(--bg)] border-2 border-[var(--border)] rounded-xl overflow-hidden shadow-2xl relative transition-opacity pointer-events-auto",
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
                                {localCamMuted && <div className="absolute inset-0 flex items-center justify-center text-[var(--text-dim)]"><VideoOff className="w-6 h-6" /></div>}

                        </div>
                        </div>

            {/* Exam Host Dashboard */}
            {role === 'host' && sessionMode === 'supervised' && showExamDashboard && (
                <motion.div 
                    drag 
                    dragMomentum={false}
                    className="absolute right-4 top-20 z-[500] transition-shadow duration-300 shadow-[0_0_20px_rgba(0,0,0,0.5)] rounded-2xl bg-[var(--surface)] backdrop-blur-2xl border border-[var(--border)] overflow-hidden flex flex-col"
                    style={{ width: '32rem', height: 'calc(100vh - 120px)' }}
                >
                    <div className="w-full h-full flex flex-col">
                        <div className="cursor-move h-4 w-full flex items-center justify-center bg-[var(--elevated)] border-b border-[var(--border)] hover:bg-[var(--elevated)]/80 transition-colors">
                            <div className="w-8 h-1 rounded-full bg-white/20"></div>
                        </div>
                        <div className="flex-1 overflow-hidden flex flex-col" onPointerDown={(e) => e.stopPropagation()}>
                            <ExamHostDashboard 
                                onPushQuestion={(q) => socketRef.current?.emit('host-push-question', { ...q, roomId: roomCodeRef.current || joinInput })}
                                liveAnswers={examLiveAnswers}
                                localStream={localStreamRef.current}
                            />
                        </div>
                    </div>
                </motion.div>
            )}

            {role === 'controller' && sessionMode === 'supervised' && examQuestions.length > 0 && (
                <div className="absolute inset-0 z-[500] pointer-events-none flex items-center justify-center">
                    <div className="pointer-events-auto w-full h-full max-w-4xl">
                        <ExamControllerOverlay 
                            questions={examQuestions} 
                            results={examResults}
                            onDraftUpdate={(qId, answer) => socketRef.current?.emit('controller-draft-answer', { questionId: qId, answer, roomId: roomCodeRef.current || joinInput })}
                            onSubmit={(qId, answer) => {
                                socketRef.current?.emit('controller-submit-answer', { questionId: qId, answer, roomId: roomCodeRef.current || joinInput });
                                // Keep the question on screen briefly so the server's grading result can show
                                setTimeout(() => setExamQuestions(prev => prev.filter(q => q.id !== qId)), 3000);
                            }}
                        />
                    </div>
                </div>
            )}

                        {/* Malpractice Warnings Removed as per user request */}
                    </div>
                </main>

            {activityOpen && (
                <SessionActivityPanel
                    entries={activityEntries}
                    isHost={role === 'host'}
                    riskScore={roomRisk}
                    onClose={() => setActivityOpen(false)}
                />
            )}

            {chatOpen && (
                <div className="fixed right-4 top-16 z-[500] flex h-[min(560px,calc(100vh-5rem))] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
                    <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-[var(--accent)]" />
                            <span className="text-sm font-bold text-[var(--text-primary)]">Session Chat</span>
                            <span
                                title={e2eFingerprint ? `End-to-end encrypted. Compare this host key fingerprint with other participants: ${e2eFingerprint}` : 'Waiting for the end-to-end encryption key'}
                                className={cn("rounded px-1.5 py-0.5 font-mono text-[9px]", e2eFingerprint ? "bg-[var(--success)]/15 text-[var(--success)]" : "bg-[var(--amber)]/15 text-[var(--amber)]")}
                            >
                                {e2eFingerprint ? `E2E ${e2eFingerprint.slice(0, 9)}` : 'E2E pending'}
                            </span>
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
                                                <span className="shrink-0 font-mono text-[9px] text-[var(--text-dim)]">{isNaN(new Date(message.time).getTime()) ? message.time : new Date(message.time).toLocaleTimeString([], { hour12: false })}</span>
                                            </div>
                                            <p className="break-words text-sm leading-relaxed text-[var(--text-primary)] font-emoji">
                                                {isE2EMessage(message.text)
                                                    ? (decryptedChat[message.id] ?? 'Encrypted message (waiting for the key)')
                                                    : message.text}
                                            </p>
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
                                    className="flex h-7 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg)] text-sm hover:border-[var(--accent)] font-emoji"
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
                                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-emoji"
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
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md flex-col text-[var(--text-primary)] font-mono">
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
                                router.push('/app');
                            }} className="flex-1 py-2.5 rounded-lg bg-[var(--red)] text-[var(--text-primary)] font-bold hover:brightness-110">End Now</button>
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
                                router.push('/app');
                            }} className="flex-1 py-2.5 rounded-lg bg-[var(--red)] text-[var(--text-primary)] font-bold hover:brightness-110">Leave Now</button>
                        </div>
                    </div>
                </div>
            )}

            {panicNotice && (
                <div role="alert" className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 rounded-xl border border-[var(--red)]/50 bg-[var(--bg)]/95 px-4 py-3 text-sm font-semibold text-[var(--red)] shadow-2xl backdrop-blur">
                    <ShieldOff className="w-4 h-4" />
                    {panicNotice}
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
                        if (nextPermission !== 'view') window.ipcRenderer?.send('set-remote-input-lock', false)
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

            {showSharePicker && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
                    <div className="w-full max-w-4xl bg-[var(--surface)] border border-[var(--border)] rounded-xl flex flex-col h-[80vh] overflow-hidden shadow-2xl">
                        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--background)]">
                            <h2 className="text-xl font-bold font-display text-[var(--text-primary)]">Select screen or window to share</h2>
                            <button onClick={() => setShowSharePicker(false)} className="text-[var(--text-dim)] hover:text-[var(--text-primary)]">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg)]">
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                                {shareSources.map((source) => (
                                    <div 
                                        key={source.id}
                                        onClick={async () => {
                                            setShowSharePicker(false);
                                            if ((window as any).api && (window as any).api.setShareSource) {
                                                await (window as any).api.setShareSource(source.id);
                                            }
                                            startSharing();
                                        }}
                                        className="flex flex-col group cursor-pointer bg-[var(--surface)] rounded-lg overflow-hidden border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-[0_0_15px_rgba(0,212,255,0.3)] transition-all duration-200"
                                    >
                                        <div className="aspect-video bg-[var(--bg)] flex items-center justify-center overflow-hidden p-2 relative">
                                            {source.thumbnail ? (
                                                <img src={source.thumbnail} alt={source.name} className="max-w-full max-h-full object-contain rounded drop-shadow-md" />
                                            ) : (
                                                <div className="text-[var(--text-dim)] flex flex-col items-center">
                                                    <Monitor className="w-8 h-8 mb-2 opacity-50" />
                                                    <span className="text-xs">No preview</span>
                                                </div>
                                            )}
                                            {source.isScreen && (
                                                <div className="absolute top-2 right-2 bg-[var(--accent)] text-black text-[10px] font-bold px-2 py-0.5 rounded uppercase">Entire Screen</div>
                                            )}
                                        </div>
                                        <div className="p-3 border-t border-[var(--border)] bg-[var(--background)] group-hover:bg-[var(--elevated)]">
                                            <p className="text-sm font-semibold text-[var(--text-primary)] truncate" title={source.name}>{source.name}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {(showPet || sessionMode === 'supervised') && <PetCanvas petState={petState} sessionMode={sessionMode} petMessage={petMessage} isCanvasMode={isCanvasMode} />}
        </div>
    )
}
