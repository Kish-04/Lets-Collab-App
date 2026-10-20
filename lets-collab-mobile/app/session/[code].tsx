import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import io, { Socket } from 'socket.io-client';
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  RTCView,
  mediaDevices,
} from 'react-native-webrtc';
import {
  ArrowLeft,
  ClipboardList,
  MessageSquare,
  Mic,
  MicOff,
  MonitorPlay,
  PhoneOff,
  SendHorizontal,
  ShieldAlert,
  SwitchCamera,
  Video,
  VideoOff,
  X,
} from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { BACKEND_URL, getStoredAuthToken, getStoredEmail } from '../../lib/api';
import { E2EChatSession, WrappedKeyring, isE2EMessage } from '../../lib/e2eChat';
import { DataChannelLike, listen } from '../../lib/peerEvents';
import { ExamPanel } from '../../components/ExamPanel';
import { ExamCodeSync } from '../../lib/exam/codeSync';
import { ExamAnswer, ExamQuestion, isExamQuestion } from '../../lib/exam/types';
import { ProctoringViolation, useOnDeviceProctoring } from '../../lib/proctoring';
import {
  ChatMessage,
  IceServer,
  MediaStreamIds,
  PermissionLevel,
  SessionMode,
  fetchIceServers,
  normalizeRoomCode,
} from '../../lib/liveSession';

/**
 * Mobile participant ("controller" in the web app / signaling server).
 *
 * Protocol mirrors the web controller in app/session/page.tsx (`setupSocket`, `createPC`):
 *   -> join-room(roomCode, 'controller', meta)
 *   <- join-pending / join-approved / join-denied / room-not-found
 *   <- offer {offer, fromId, mediaStreamIds}   -> answer {answer, roomId, targetId, mediaStreamIds}
 *   <-> ice-candidate {candidate, roomId, targetId}
 *   <-> chat-message {roomId, text: "e2e1:<epoch>:<b64>"} (end-to-end encrypted, lib/e2eChat.ts)
 *   -> e2e-announce {roomId, publicKey}   <- e2e-key-share {fromId, payload}   -> e2e-key-request {roomId}
 *   -> anti-cheat-alert / system-alert (supervised rooms only)
 *   <- new-exam-question ExamQuestion, session-state.examQuestions (supervised rooms only)
 *   -> controller-draft-answer / controller-submit-answer {questionId, answer, roomId}
 *   <-> ircp-crdt data channel: Yjs doc 'exam-code' (live code view for the host)
 *   -> leave-session
 * The host creates the offer and the ircp-* data channels; we only answer.
 */

type Phase = 'preparing' | 'connecting' | 'pending' | 'approved' | 'connected' | 'ended';
type RemoteStreams = { main: MediaStream | null; secondary: MediaStream | null };

const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  view: 'VIEW ONLY',
  mouse: 'MOUSE',
  keyboard: 'KEYBOARD',
  full: 'FULL CONTROL',
};

export default function LiveSessionScreen() {
  useKeepAwake();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code: string }>();
  const roomCode = normalizeRoomCode(params.code);

  const [phase, setPhase] = useState<Phase>('preparing');
  const [statusMessage, setStatusMessage] = useState('Preparing session...');
  const [endMessage, setEndMessage] = useState('');
  const [mode, setMode] = useState<SessionMode>('collaboration');
  const [permission, setPermission] = useState<PermissionLevel>('view');
  const [participantCount, setParticipantCount] = useState(0);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>({ main: null, secondary: null });
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [frontCamera, setFrontCamera] = useState(true);
  const [systemWarning, setSystemWarning] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  /** Plaintext of e2e1 messages by id (null = cannot decrypt yet). `messages` keeps the raw ciphertext. */
  const [decryptedChat, setDecryptedChat] = useState<Record<string, string | null>>({});
  const [e2eFingerprint, setE2eFingerprint] = useState('');
  const [e2eKeyVersion, setE2eKeyVersion] = useState(0);
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([]);
  const [examAnswers, setExamAnswers] = useState<Record<string, ExamAnswer>>({});
  const [examOpen, setExamOpen] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceServersRef = useRef<IceServer[]>([]);
  const pendingCandidatesRef = useRef<any[]>([]);
  const remoteIdsRef = useRef<MediaStreamIds>({});
  const hostIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const publishRef = useRef<{ audio: boolean; video: boolean }>({ audio: false, video: false });
  const dataChannelsRef = useRef<DataChannelLike[]>([]);
  const renegotiatePendingRef = useRef(false);
  const phaseRef = useRef<Phase>('preparing');
  const modeRef = useRef<SessionMode>('collaboration');
  const endedRef = useRef(false);
  const supervisedMediaReportedRef = useRef(false);
  const chatOpenRef = useRef(false);
  const e2eRef = useRef<E2EChatSession | null>(null);
  const e2eAnnouncedRef = useRef(false);
  const e2eKeyRequestAtRef = useRef(0);
  const submittedQuestionIdsRef = useRef<Set<string>>(new Set());
  const examAnswersRef = useRef<Record<string, ExamAnswer>>({});
  const draftTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const codeSyncRef = useRef<ExamCodeSync | null>(null);
  const proctoringUnavailableReportedRef = useRef(false);
  const examQuestionCountRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) setUnread(0); }, [chatOpen]);

  const isSupervised = mode === 'supervised';

  // ---------------------------------------------------------------- helpers

  const getLocalMediaStreamIds = (): MediaStreamIds => ({
    screen: null,
    camera: localStreamRef.current?.id || null,
  });

  const teardownMedia = useCallback(() => {
    dataChannelsRef.current.forEach(channel => { try { channel.close(); } catch { } });
    dataChannelsRef.current = [];
    if (pcRef.current) {
      try { pcRef.current.close(); } catch { }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      try { localStreamRef.current.release(); } catch { }
      localStreamRef.current = null;
    }
    pendingCandidatesRef.current = [];
    setLocalStream(null);
    setRemoteStreams({ main: null, secondary: null });
    setMicOn(false);
    setCamOn(false);
  }, []);

  const endSession = useCallback((message: string, notifyServer = false) => {
    if (endedRef.current) return;
    endedRef.current = true;
    const socket = socketRef.current;
    if (socket) {
      if (notifyServer && socket.connected) socket.emit('leave-session');
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    }
    teardownMedia();
    setEndMessage(message);
    setPhase('ended');
  }, [teardownMedia]);

  const leaveToDashboard = useCallback(() => {
    endSession('You left the session.', true);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [endSession]);

  const confirmLeave = useCallback(() => {
    if (phaseRef.current === 'ended') {
      leaveToDashboard();
      return;
    }
    Alert.alert('Leave session?', 'You will be disconnected from the host.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: leaveToDashboard },
    ]);
  }, [leaveToDashboard]);

  /** Same payload as the web `reportMalpractice` (system-alert, type anticheat_violation). */
  const reportMalpractice = useCallback((reason: string, penalty = 15) => {
    socketRef.current?.emit('system-alert', {
      room: roomCode,
      type: 'anticheat_violation',
      event: 'PROCTORING_ALERT',
      message: reason,
      penalty,
    });
  }, [roomCode]);

  // ---------------------------------------------------------------- exam (supervised)

  const getCodeSync = () => {
    if (!codeSyncRef.current) codeSyncRef.current = new ExamCodeSync();
    return codeSyncRef.current;
  };

  /** Pending (not yet submitted) questions, de-duplicated by id. The server may deliver a push twice. */
  const mergeExamQuestions = useCallback((incoming: unknown[], replace: boolean) => {
    setExamQuestions(prev => {
      const next = replace ? [] : [...prev];
      for (const item of incoming) {
        if (!isExamQuestion(item)) continue;
        if (submittedQuestionIdsRef.current.has(item.id)) continue;
        if (next.some(q => q.id === item.id)) continue;
        next.push(item);
      }
      return next;
    });
  }, []);

  const setAnswer = (questionId: string, answer: ExamAnswer) => {
    examAnswersRef.current = { ...examAnswersRef.current, [questionId]: answer };
    setExamAnswers(examAnswersRef.current);
  };

  /** Same event and payload as the web overlay's onDraftUpdate, debounced while typing. */
  const sendDraft = useCallback((questionId: string, answer: ExamAnswer, delayMs: number) => {
    const timers = draftTimersRef.current;
    const pending = timers.get(questionId);
    if (pending) clearTimeout(pending);
    const emit = () => {
      timers.delete(questionId);
      socketRef.current?.emit('controller-draft-answer', { questionId, answer, roomId: roomCode });
    };
    if (delayMs <= 0) emit();
    else timers.set(questionId, setTimeout(emit, delayMs));
  }, [roomCode]);

  const handleExamText = (question: ExamQuestion, text: string) => {
    if (question.type === 'code') getCodeSync().applyLocalText(question.id, text);
    const answer = { ...examAnswersRef.current[question.id], text };
    setAnswer(question.id, answer);
    sendDraft(question.id, answer, 400);
  };

  const handleExamOption = (question: ExamQuestion, option: string) => {
    const answer = { text: option };
    setAnswer(question.id, answer);
    sendDraft(question.id, answer, 0);
  };

  /** Same as the web overlay's handleSubmit + page.tsx onSubmit: emit, then drop the question locally. */
  const submitExamAnswer = useCallback((question: ExamQuestion) => {
    const pending = draftTimersRef.current.get(question.id);
    if (pending) {
      clearTimeout(pending);
      draftTimersRef.current.delete(question.id);
    }
    const answer = examAnswersRef.current[question.id]
      || { text: question.type === 'code' ? question.starterCode || '' : '' };
    socketRef.current?.emit('controller-submit-answer', { questionId: question.id, answer, roomId: roomCode });
    submittedQuestionIdsRef.current.add(question.id);
    setExamQuestions(prev => prev.filter(q => q.id !== question.id));
  }, [roomCode]);

  const confirmSubmitAll = () => {
    Alert.alert('Submit all answers?', 'Every open question will be submitted with its current answer.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Submit all', style: 'destructive', onPress: () => examQuestions.forEach(submitExamAnswer) },
    ]);
  };

  // Seed each code question's shared Y.Text with its starter code (web: handleEditorMount), and
  // keep the TextInput in sync if the host's sync-reply restores content after a reconnect.
  useEffect(() => {
    const sync = getCodeSync();
    examQuestions.forEach(question => {
      if (question.type !== 'code' || examAnswersRef.current[question.id]?.text !== undefined) return;
      const seeded = sync.seed(question.id, question.starterCode || '');
      setAnswer(question.id, { ...examAnswersRef.current[question.id], text: seeded });
    });
    // Like the web overlay, the questions take over the screen as soon as any are pending.
    if (examQuestions.length === 0) setExamOpen(false);
    else if (examQuestionCountRef.current === 0) setExamOpen(true);
    examQuestionCountRef.current = examQuestions.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examQuestions]);

  useEffect(() => {
    const off = getCodeSync().onRemoteChange((questionId, text) => {
      if (examAnswersRef.current[questionId]?.text === text) return;
      setAnswer(questionId, { ...examAnswersRef.current[questionId], text });
    });
    return () => {
      off();
      draftTimersRef.current.forEach(timer => clearTimeout(timer));
      draftTimersRef.current.clear();
      codeSyncRef.current?.destroy();
      codeSyncRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------- local media

  const acquireLocalMedia = useCallback(async (wantVideo: boolean): Promise<MediaStream | null> => {
    const existing = localStreamRef.current;
    if (existing && (!wantVideo || existing.getVideoTracks().length > 0)) return existing;

    let wantAudio = true;
    if (Platform.OS === 'android') {
      const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
      if (wantVideo) wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
      const result = await PermissionsAndroid.requestMultiple(wanted);
      const audioOk = result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      const videoOk = !wantVideo || result[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
      if (!audioOk && !videoOk) return null;
      if (!videoOk) wantVideo = false;
      wantAudio = audioOk;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: wantAudio,
        video: wantVideo ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 } : false,
      });
    } catch (err) {
      console.warn('getUserMedia failed, trying audio only', err);
      try {
        stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (fallbackErr) {
        console.warn('Microphone unavailable', fallbackErr);
        return null;
      }
    }

    // Replace a previous (audio-only) stream if we upgraded to video.
    if (existing && existing !== stream) {
      existing.getTracks().forEach(track => track.stop());
      try { existing.release(); } catch { }
    }
    if (endedRef.current) {
      stream.getTracks().forEach(track => track.stop());
      return null;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setFrontCamera(true);
    return stream;
  }, []);

  // ---------------------------------------------------------------- WebRTC

  const sendOffer = useCallback(async (pc: RTCPeerConnection) => {
    if (pc.signalingState !== 'stable') {
      renegotiatePendingRef.current = true;
      return;
    }
    renegotiatePendingRef.current = false;
    try {
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      // Same shape as the web controller's renegotiation offer (no targetId -> server routes to host).
      socketRef.current?.emit('offer', {
        offer: { type: offer.type, sdp: offer.sdp },
        roomId: roomCode,
        mediaStreamIds: getLocalMediaStreamIds(),
      });
    } catch (err) {
      console.warn('Renegotiation failed', err);
    }
  }, [roomCode]);

  /** Attach any published local track that is not yet on the connection. Returns true if one was added. */
  const addPublishedTracks = (pc: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) return false;
    let added = false;
    stream.getTracks().forEach(track => {
      const kind = track.kind === 'video' ? 'video' : 'audio';
      if (!publishRef.current[kind]) return;
      if (pc.getSenders().some(sender => sender.track?.id === track.id)) return;
      pc.addTrack(track, stream);
      added = true;
    });
    return added;
  };

  const needsRenegotiation = (pc: RTCPeerConnection) =>
    pc.getTransceivers().some(t => Boolean(t.sender.track) && !t.mid);

  /** Called after local media changes (e.g. camera enabled mid-call), like the web `updateSenders`. */
  const syncLocalTracks = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || pc.signalingState === 'closed' || !pc.remoteDescription) return;
    const added = addPublishedTracks(pc);
    if (added || needsRenegotiation(pc)) await sendOffer(pc);
  }, [sendOffer]);

  const createPC = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcRef.current = pc;

    // The host creates ircp-input / ircp-file / ircp-draw / ircp-chat / ircp-crdt.
    // ircp-crdt carries the live exam-code view (Yjs). Remote input, file transfer and drawing are
    // not supported on mobile yet; we accept those channels so negotiation completes, and close them on leave.
    listen(pc, 'datachannel', event => {
      dataChannelsRef.current.push(event.channel);
      getCodeSync().attach(event.channel);
    });

    listen(pc, 'icecandidate', event => {
      if (!event.candidate) return;
      socketRef.current?.emit('ice-candidate', {
        candidate: event.candidate.toJSON(),
        roomId: roomCode,
        targetId: hostIdRef.current || undefined,
      });
    });

    listen(pc, 'track', event => {
      const stream = event.streams && event.streams.length > 0 ? event.streams[0] : null;
      if (!stream) return;
      const ids = remoteIdsRef.current;
      const isScreen = Boolean(ids.screen && stream.id === ids.screen);
      const isCamera = Boolean(ids.camera && stream.id === ids.camera);
      setRemoteStreams(prev => {
        // Same routing as the web controller's ontrack: screen -> main view, host camera -> secondary.
        if (isCamera) return { ...prev, secondary: stream };
        if (isScreen || !prev.main || prev.main.id === stream.id) return { ...prev, main: stream };
        if (!prev.secondary || prev.secondary.id === stream.id) return { ...prev, secondary: stream };
        return { ...prev, main: stream };
      });
      setPhase('connected');
    });

    listen(pc, 'connectionstatechange', () => {
      if (pc.connectionState === 'connected') setPhase('connected');
      if (pc.connectionState === 'failed') setStatusMessage('Media connection failed. Check your network.');
    });

    listen(pc, 'signalingstatechange', () => {
      if (pc.signalingState === 'stable' && renegotiatePendingRef.current) {
        void sendOffer(pc);
      }
    });

    return pc;
  }, [roomCode, sendOffer]);

  const flushPendingCandidates = async (pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { });
    }
  };

  const handleOffer = useCallback(async (payload: any) => {
    try {
      remoteIdsRef.current = payload.mediaStreamIds || {};
      hostIdRef.current = payload.fromId || hostIdRef.current;
      let pc = pcRef.current;
      if (!pc || pc.signalingState === 'closed') pc = createPC();

      if (pc.signalingState === 'have-local-offer') {
        // Glare with our own renegotiation: the host wins, we retry after this exchange.
        renegotiatePendingRef.current = true;
        await pc.setLocalDescription(new RTCSessionDescription({ type: 'rollback', sdp: '' } as any)).catch(() => { });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      await flushPendingCandidates(pc);
      addPublishedTracks(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('answer', {
        answer: { type: answer.type, sdp: answer.sdp },
        roomId: roomCode,
        targetId: payload.fromId,
        mediaStreamIds: getLocalMediaStreamIds(),
      });
      if (needsRenegotiation(pc)) await sendOffer(pc);
    } catch (err) {
      console.warn('Error handling offer', err);
      setStatusMessage('Could not establish the media connection.');
    }
  }, [createPC, roomCode, sendOffer]);

  // ---------------------------------------------------------------- chat

  /**
   * Same as the web `announceE2E`: once we are a room member (first session-state), create this
   * session's ECDH key pair and announce the public key. The room id is the server's normalized code.
   */
  const announceE2E = (socket: Socket, room?: string) => {
    if (!room) return;
    let session = e2eRef.current;
    if (!session || session.roomId !== room) {
      session = new E2EChatSession(room);
      e2eRef.current = session;
      e2eAnnouncedRef.current = false;
      setE2eFingerprint('');
    }
    if (e2eAnnouncedRef.current) return;
    e2eAnnouncedRef.current = true;
    socket.emit('e2e-announce', { roomId: room, publicKey: session.publicKey });
  };

  // Decrypt for display only; re-run when messages or keys change. Ask the host to re-share keys
  // (at most every 5 s) if an e2e1 message uses an epoch we do not hold. The phone is never the host.
  useEffect(() => {
    const session = e2eRef.current;
    const next: Record<string, string | null> = {};
    for (const message of messages) {
      if (isE2EMessage(message.text)) next[message.id] = session ? session.decrypt(message.text) : null;
    }
    setDecryptedChat(next);
    const missing = Object.values(next).some(value => value === null);
    if (missing && session && Date.now() - e2eKeyRequestAtRef.current > 5000) {
      e2eKeyRequestAtRef.current = Date.now();
      socketRef.current?.emit('e2e-key-request', { roomId: session.roomId });
    }
  }, [messages, e2eKeyVersion]);

  const e2eReady = Boolean(e2eFingerprint) && Boolean(e2eRef.current?.hasKey());

  const sendChatMessage = () => {
    const text = chatInput.trim();
    const session = e2eRef.current;
    if (!text || !socketRef.current) return;
    if (!session?.hasKey()) {
      Alert.alert('Chat not ready', 'Waiting for the end-to-end encryption key from the host.');
      return;
    }
    setChatInput('');
    socketRef.current.emit('chat-message', { roomId: session.roomId, text: session.encrypt(text) });
  };

  // ---------------------------------------------------------------- socket lifecycle

  useEffect(() => {
    if (!roomCode) {
      endSession('Invalid room code.');
      return;
    }
    let cancelled = false;

    const start = async () => {
      const token = await getStoredAuthToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const email = await getStoredEmail();
      setStatusMessage('Fetching network configuration...');
      iceServersRef.current = await fetchIceServers();
      if (cancelled) return;

      setPhase('connecting');
      setStatusMessage('Connecting to session server...');
      const socket = io(BACKEND_URL, {
        auth: { token },
        transports: ['websocket'],
        // A mobile network blip must not end an exam: retry for about half a minute before giving up
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 15000,
      });
      socketRef.current = socket;
      let everConnected = false;

      socket.on('connect', () => {
        everConnected = true;
        // A (re)connected socket is a new room member: announce the chat key again on the next session-state.
        e2eAnnouncedRef.current = false;
        socket.emit('join-room', roomCode, 'controller', {
          name: email ? email.split('@')[0] : 'Mobile participant',
          device: `Let's Collab Mobile (${Platform.OS === 'ios' ? 'iOS' : 'Android'})`,
        });
        setStatusMessage('Requesting to join...');
      });

      socket.on('connect_error', (err: any) => {
        // Before the first connection there is nothing to resume; afterwards the manager keeps retrying
        if (!everConnected) endSession(`Could not reach the session server: ${err?.message || 'connection error'}`);
      });
      socket.io.on('reconnect_failed', () => endSession('Connection to the session server was lost.'));

      socket.on('disconnect', (reason: string) => {
        if (reason === 'io client disconnect') return;
        if (reason === 'io server disconnect') {
          endSession('The session server closed the connection.');
          return;
        }
        // Temporary loss: the server drops this member, so the call is rebuilt after re-joining.
        // Keep the camera and mic (supervised rooms need them); close only the peer connection.
        dataChannelsRef.current.forEach(channel => { try { channel.close(); } catch { } });
        dataChannelsRef.current = [];
        if (pcRef.current) {
          try { pcRef.current.close(); } catch { }
          pcRef.current = null;
        }
        pendingCandidatesRef.current = [];
        setRemoteStreams({ main: null, secondary: null });
        setPhase('connecting');
        setStatusMessage('Connection lost. Reconnecting...');
      });

      socket.on('join-pending', async ({ mode: roomMode }: { mode?: SessionMode }) => {
        const nextMode: SessionMode = roomMode === 'supervised' ? 'supervised' : 'collaboration';
        setMode(nextMode);
        modeRef.current = nextMode;
        setPhase('pending');
        setStatusMessage('Waiting for the host to approve your request...');
        if (nextMode === 'supervised') {
          // Supervised rooms require camera + mic (web: AntiCheatEngine calibration acquires both).
          // Acquire now, before the call is live, so permission prompts can't trip the app-switch check.
          publishRef.current = { audio: true, video: true };
          const stream = await acquireLocalMedia(true);
          setCamOn(Boolean(stream?.getVideoTracks().length));
          setMicOn(Boolean(stream?.getAudioTracks().length));
          void syncLocalTracks();
        }
      });

      socket.on('join-approved', ({ permission: approved }: { permission?: PermissionLevel }) => {
        if (approved) setPermission(approved);
        setPhase(prev => (prev === 'connected' ? prev : 'approved'));
        setStatusMessage('Approved. Waiting for the host stream...');
        if (modeRef.current === 'supervised' && !supervisedMediaReportedRef.current) {
          const hasCamera = Boolean(localStreamRef.current?.getVideoTracks().length);
          if (!hasCamera) {
            supervisedMediaReportedRef.current = true;
            reportMalpractice('Camera unavailable or denied on mobile participant', 15);
          }
        }
      });

      socket.on('join-denied', ({ reason }: { reason?: string } = {}) => {
        endSession(reason || 'Host denied the connection request.');
      });
      socket.on('room-not-found', () => endSession('Room not found or unavailable.'));
      socket.on('session-error', (err: any) => endSession(`Session error: ${err?.message || err?.reason || 'Unknown error'}`));
      socket.on('removed-from-session', (data: any) => endSession(`You have been removed: ${data?.reason || 'No reason provided'}`));
      socket.on('kill-session', () => endSession('The session has ended.'));
      socket.on('role-swap-completed', ({ newHostId }: { newHostId?: string }) => {
        if (newHostId === socket.id) endSession('Hosting a session is not supported on mobile yet.', true);
      });

      socket.on('session-state', async (state: any) => {
        if (state?.mode) {
          const nextMode: SessionMode = state.mode === 'supervised' ? 'supervised' : 'collaboration';
          setMode(nextMode);
          modeRef.current = nextMode;
        }
        if (state?.permission) setPermission(state.permission);
        setParticipantCount(Array.isArray(state?.participants) ? state.participants.length : 0);
        // Same as the web controller: session-state carries every question pushed so far (late joiners).
        if (Array.isArray(state?.examQuestions)) mergeExamQuestions(state.examQuestions, true);
        if (Array.isArray(state?.messages)) {
          const incoming = state.messages as ChatMessage[];
          setMessages(prev => {
            const known = new Set(incoming.map(m => m.id));
            return [...incoming, ...prev.filter(m => !known.has(m.id))].slice(-100);
          });
        }
        // session-state only reaches room members, so this is the point to announce our chat key.
        announceE2E(socket, typeof state?.roomCode === 'string' ? state.roomCode : roomCode);
      });

      socket.on('access-granted', (next: PermissionLevel) => setPermission(next));

      socket.on('offer', (payload: any) => { void handleOffer(payload); });

      socket.on('answer', async (payload: any) => {
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'have-local-offer') return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
          await flushPendingCandidates(pc);
        } catch (err) {
          console.warn('Error setting remote answer', err);
        }
      });

      socket.on('ice-candidate', async (payload: any) => {
        if (!payload?.candidate) return;
        const pc = pcRef.current;
        if (!pc || !pc.remoteDescription) {
          pendingCandidatesRef.current.push(payload.candidate);
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => { });
      });

      socket.on('chat-message', (message: ChatMessage) => {
        setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message].slice(-100)));
        if (!chatOpenRef.current && message.senderId !== socket.id) setUnread(n => n + 1);
      });

      socket.on('e2e-key-share', ({ payload }: { payload: WrappedKeyring }) => {
        const session = e2eRef.current;
        if (!session) return;
        try {
          session.receiveKeyring(payload);
          setE2eFingerprint(session.hostFingerprint());
          setE2eKeyVersion(v => v + 1);
        } catch (err) {
          console.warn('Received a chat key that could not be unwrapped', err);
        }
      });

      socket.on('system-warning', (message: string) => setSystemWarning(message));

      socket.on('new-exam-question', (question: unknown) => {
        if (!isExamQuestion(question) || submittedQuestionIdsRef.current.has(question.id)) return;
        mergeExamQuestions([question], false);
        setExamOpen(true);
        setChatOpen(false);
      });
    };

    start().catch(err => endSession(`Could not start the session: ${err?.message || err}`));

    return () => {
      cancelled = true;
      endSession('You left the session.', true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ---------------------------------------------------------------- proctoring (supervised)

  // Mirror of the web "Anti-cheat focus tracking for supervised controllers" effect:
  // leaving the app == TAB_SWITCHED -> anti-cheat-alert (penalty 100) and the session is terminated.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'background') return;
      if (modeRef.current !== 'supervised' || phaseRef.current !== 'connected') return;
      const socket = socketRef.current;
      const reason = 'Mobile app moved to the background (app switch or home screen)';
      socket?.emit('anti-cheat-alert', {
        roomId: roomCode,
        type: 'anticheat_violation',
        reason: 'tab-switch',
        message: reason,
        penalty: 100,
      });
      endSession(`Session Terminated: ${reason}`, true);
    });
    return () => subscription.remove();
  }, [roomCode, endSession]);

  // On-device AI proctoring of the camera track that is already being sent (no second camera session).
  const cameraTrack = useMemo(() => localStream?.getVideoTracks()[0] ?? null, [localStream]);
  const reportProctoringViolation = useCallback((violation: ProctoringViolation) => {
    if (modeRef.current !== 'supervised' || endedRef.current) return;
    // Same payload as the web AntiCheatEngine onEvent handler, minus evidenceUrl: the web uploads a
    // webcam snapshot as evidence, but on mobile no frame ever leaves the device outside the call.
    socketRef.current?.emit('system-alert', {
      type: 'anticheat_violation',
      event: violation.type,
      message: violation.message,
      penalty: violation.penalty,
      room: roomCode,
    });
  }, [roomCode]);
  const proctoring = useOnDeviceProctoring(
    isSupervised && camOn && (phase === 'approved' || phase === 'connected'),
    cameraTrack,
    reportProctoringViolation,
  );

  // Tell the invigilator (once, no penalty) when this phone cannot run the AI checks, instead of
  // silently reporting nothing.
  useEffect(() => {
    if (proctoring.state !== 'unavailable' && proctoring.state !== 'error') return;
    if (proctoringUnavailableReportedRef.current || modeRef.current !== 'supervised') return;
    proctoringUnavailableReportedRef.current = true;
    socketRef.current?.emit('system-alert', {
      type: 'system',
      event: 'PROCTORING_UNAVAILABLE',
      message: `On-device AI proctoring unavailable on mobile participant: ${proctoring.message}`,
      penalty: 0,
      room: roomCode,
    });
  }, [proctoring.state, proctoring.message, roomCode]);

  // Android hardware back -> confirm leave instead of silently unmounting.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (examOpen) setExamOpen(false);
      else confirmLeave();
      return true;
    });
    return () => sub.remove();
  }, [confirmLeave, examOpen]);

  // ---------------------------------------------------------------- controls

  const toggleMic = async () => {
    let stream = localStreamRef.current;
    const track = stream?.getAudioTracks()[0];
    if (track && publishRef.current.audio) {
      track.enabled = !track.enabled;
      setMicOn(track.enabled);
      return;
    }
    if (!stream) stream = await acquireLocalMedia(false);
    const audio = stream?.getAudioTracks()[0];
    if (!audio) {
      Alert.alert('Microphone unavailable', 'Allow microphone access in Settings to talk in this session.');
      return;
    }
    audio.enabled = true;
    publishRef.current.audio = true;
    setMicOn(true);
    await syncLocalTracks();
  };

  const toggleCamera = async () => {
    if (isSupervised && camOn) {
      Alert.alert('Camera required', 'Camera cannot be disabled during a supervised session.');
      return;
    }
    let stream = localStreamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (track && publishRef.current.video) {
      track.enabled = !track.enabled;
      setCamOn(track.enabled);
      return;
    }
    const hadAudio = Boolean(stream?.getAudioTracks()[0]) && publishRef.current.audio;
    stream = await acquireLocalMedia(true);
    const video = stream?.getVideoTracks()[0];
    if (!video) {
      Alert.alert('Camera unavailable', 'Allow camera access in Settings to share your video.');
      return;
    }
    video.enabled = true;
    publishRef.current.video = true;
    setCamOn(true);
    if (hadAudio) {
      // A new stream replaced the audio-only one: keep the mic state and swap the audio sender's track.
      const pc = pcRef.current;
      const audio = stream?.getAudioTracks()[0];
      const audioSender = pc?.getSenders().find(sender => sender.track?.kind === 'audio');
      if (audio) audio.enabled = micOn;
      if (audio && audioSender) await audioSender.replaceTrack(audio).catch(() => { });
    }
    await syncLocalTracks();
  };

  const flipCamera = async () => {
    if (isSupervised) {
      Alert.alert('Front camera required', 'The front camera must stay on during a supervised session.');
      return;
    }
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const nextFront = !frontCamera;
    try {
      await track.applyConstraints({ facingMode: nextFront ? 'user' : 'environment' });
    } catch {
      track._switchCamera();
    }
    setFrontCamera(nextFront);
  };

  // ---------------------------------------------------------------- render

  const primaryStream = remoteStreams.main || remoteStreams.secondary;
  const hostCamStream = remoteStreams.main ? remoteStreams.secondary : null;
  const showLocalPreview = Boolean(localStream && camOn && localStream.getVideoTracks().length > 0);
  const inCall = phase === 'approved' || phase === 'connected';
  const hasExam = isSupervised && inCall && examQuestions.length > 0;
  // RTCViews are native surfaces that can draw above RN views, so the PiPs are hidden under the exam.
  const showExam = hasExam && examOpen;

  if (phase === 'ended') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <View style={[styles.endCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.iconWrapper, { backgroundColor: 'rgba(255, 59, 92, 0.1)', borderColor: 'rgba(255, 59, 92, 0.2)' }]}>
            <PhoneOff color={colors.red} size={20} />
          </View>
          <Text style={[styles.cardLabel, { color: colors.textDim }]}>SESSION {roomCode || '—'}</Text>
          <Text style={[styles.endTitle, { color: colors.textPrimary }]}>Session closed</Text>
          <Text style={[styles.endMessage, { color: colors.textSecondary }]}>{endMessage}</Text>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
          >
            <ArrowLeft color="#080810" size={16} style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>Back to dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      {/* Host stream (screen share, or camera if no screen is shared) */}
      {primaryStream ? (
        <RTCView streamURL={primaryStream.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" zOrder={0} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.centered, { backgroundColor: colors.bg }]}>
          {inCall ? (
            <MonitorPlay color={colors.textDim} size={40} />
          ) : (
            <ActivityIndicator color={colors.accent} size="large" />
          )}
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            {inCall ? 'Waiting for the host to share their screen or camera...' : statusMessage}
          </Text>
          <Text style={[styles.cardLabel, { color: colors.textDim, marginTop: 8 }]}>ROOM {roomCode}</Text>
        </View>
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: colors.glassCard, borderColor: colors.border }]}>
            <View style={[styles.liveDot, { backgroundColor: phase === 'connected' ? colors.emerald : colors.amber }]} />
            <Text style={[styles.badgeText, { color: colors.textPrimary }]}>{roomCode}</Text>
          </View>
          <View
            style={[
              styles.badge,
              isSupervised
                ? { backgroundColor: 'rgba(255, 59, 92, 0.15)', borderColor: 'rgba(255, 59, 92, 0.35)' }
                : { backgroundColor: colors.glassCard, borderColor: colors.border },
            ]}
          >
            {isSupervised && <ShieldAlert color={colors.red} size={12} style={{ marginRight: 4 }} />}
            <Text style={[styles.badgeText, { color: isSupervised ? colors.red : colors.textSecondary }]}>
              {isSupervised ? 'SUPERVISED' : 'COLLAB'}
            </Text>
          </View>
          {inCall && (
            <View style={[styles.badge, { backgroundColor: colors.glassCard, borderColor: colors.border }]}>
              <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                {PERMISSION_LABELS[permission] || permission.toUpperCase()}
                {participantCount > 1 ? ` · ${participantCount}` : ''}
              </Text>
            </View>
          )}
        </View>

        {isSupervised && (
          <View style={[styles.banner, { backgroundColor: 'rgba(255, 59, 92, 0.12)', borderColor: 'rgba(255, 59, 92, 0.3)' }]}>
            <Text style={[styles.bannerText, { color: colors.red }]}>
              Proctored exam: keep this app open. Leaving the app ends your session.
            </Text>
            {proctoring.state !== 'idle' && (
              <Text
                style={[
                  styles.bannerSubText,
                  { color: proctoring.state === 'active' ? colors.emerald : proctoring.state === 'loading' ? colors.textSecondary : colors.amber },
                ]}
              >
                {proctoring.message}
              </Text>
            )}
          </View>
        )}

        {systemWarning && (
          <View style={[styles.banner, styles.bannerRow, { backgroundColor: 'rgba(240, 165, 0, 0.15)', borderColor: 'rgba(240, 165, 0, 0.35)' }]}>
            <Text style={[styles.bannerText, { color: colors.amber, flex: 1 }]}>{systemWarning}</Text>
            <TouchableOpacity onPress={() => setSystemWarning(null)} hitSlop={10}>
              <X color={colors.amber} size={16} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Picture-in-picture: own camera + host camera */}
      <View style={[styles.pipColumn, { top: insets.top + (isSupervised ? 130 : 60) }]}>
        {showLocalPreview && localStream && !showExam && (
          <View style={[styles.pip, { borderColor: colors.accent }]}>
            <RTCView streamURL={localStream.toURL()} style={styles.pipVideo} objectFit="cover" mirror={frontCamera} zOrder={1} />
            <Text style={styles.pipLabel}>YOU</Text>
          </View>
        )}
        {hostCamStream && !showExam && (
          <View style={[styles.pip, { borderColor: colors.violet }]}>
            <RTCView streamURL={hostCamStream.toURL()} style={styles.pipVideo} objectFit="cover" zOrder={1} />
            <Text style={styles.pipLabel}>HOST</Text>
          </View>
        )}
      </View>

      {/* Chat panel */}
      {chatOpen && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.chatWrapper}
          pointerEvents="box-none"
        >
          <View style={[styles.chatPanel, { backgroundColor: colors.glassCard, borderColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.chatHeader}>
              <View style={styles.chatTitleRow}>
                <Text style={[styles.chatTitle, { color: colors.textPrimary }]}>Room chat</Text>
                <View
                  accessibilityLabel={e2eFingerprint
                    ? `End-to-end encrypted. Host key fingerprint ${e2eFingerprint}`
                    : 'Waiting for the end-to-end encryption key'}
                  style={[
                    styles.e2eBadge,
                    { backgroundColor: e2eFingerprint ? 'rgba(0, 229, 160, 0.15)' : 'rgba(240, 165, 0, 0.15)' },
                  ]}
                >
                  <Text style={[styles.e2eBadgeText, { color: e2eFingerprint ? colors.emerald : colors.amber }]}>
                    {e2eFingerprint ? `E2E ${e2eFingerprint.slice(0, 9)}` : 'E2E pending'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setChatOpen(false)} hitSlop={10}>
                <X color={colors.textSecondary} size={18} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={messages}
              keyExtractor={item => item.id}
              style={styles.chatList}
              contentContainerStyle={{ paddingVertical: 4 }}
              ListEmptyComponent={<Text style={[styles.chatEmpty, { color: colors.textDim }]}>No messages yet.</Text>}
              renderItem={({ item }) => {
                const mine = item.senderId === socketRef.current?.id;
                return (
                  <View style={[styles.msgRow, mine && styles.msgRowMine]}>
                    <View
                      style={[
                        styles.msgBubble,
                        mine
                          ? { backgroundColor: 'rgba(0, 212, 255, 0.15)', borderColor: 'rgba(0, 212, 255, 0.35)' }
                          : { backgroundColor: colors.elevated, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.msgMeta, { color: colors.textDim }]}>
                        {mine ? 'You' : item.senderName} · {item.role.toUpperCase()} · {item.time}
                      </Text>
                      <Text style={[styles.msgText, { color: colors.textPrimary }]}>
                        {isE2EMessage(item.text)
                          ? (decryptedChat[item.id] ?? 'Encrypted message (waiting for the key)')
                          : item.text}
                      </Text>
                    </View>
                  </View>
                );
              }}
            />
            <View style={styles.chatInputRow}>
              <TextInput
                value={chatInput}
                onChangeText={setChatInput}
                placeholder={!inCall
                  ? 'Chat opens once you are approved'
                  : e2eReady ? 'Message the room...' : 'Waiting for the encryption key...'}
                placeholderTextColor={colors.textDim}
                editable={inCall && e2eReady}
                onSubmitEditing={sendChatMessage}
                returnKeyType="send"
                maxLength={1000}
                style={[styles.chatInput, { color: colors.textPrimary, backgroundColor: colors.elevated, borderColor: colors.border }]}
              />
              <TouchableOpacity
                onPress={sendChatMessage}
                disabled={!inCall || !e2eReady || !chatInput.trim()}
                style={[styles.sendBtn, { backgroundColor: colors.accent, opacity: !inCall || !e2eReady || !chatInput.trim() ? 0.5 : 1 }]}
              >
                <SendHorizontal color="#080810" size={18} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Exam questions (supervised) */}
      {showExam && (
        <ExamPanel
          questions={examQuestions}
          answers={examAnswers}
          topInset={insets.top}
          bottomInset={insets.bottom}
          onChangeText={handleExamText}
          onSelectOption={handleExamOption}
          onSubmit={submitExamAnswer}
          onSubmitAll={confirmSubmitAll}
          onMinimize={() => setExamOpen(false)}
        />
      )}

      {/* Controls */}
      {!chatOpen && !showExam && (
        <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.controlBar, { backgroundColor: colors.glassCard, borderColor: colors.border }]}>
            <ControlButton onPress={toggleMic} active={micOn} colors={colors} label={micOn ? 'Mute' : 'Unmute'}>
              {micOn ? <Mic color={colors.textPrimary} size={20} /> : <MicOff color={colors.red} size={20} />}
            </ControlButton>
            <ControlButton
              onPress={toggleCamera}
              active={camOn}
              colors={colors}
              disabled={isSupervised && camOn}
              label={camOn ? 'Camera off' : 'Camera on'}
            >
              {camOn ? <Video color={colors.textPrimary} size={20} /> : <VideoOff color={colors.red} size={20} />}
            </ControlButton>
            <ControlButton onPress={flipCamera} active colors={colors} disabled={!camOn || isSupervised} label="Flip camera">
              <SwitchCamera color={colors.textPrimary} size={20} />
            </ControlButton>
            <ControlButton onPress={() => setChatOpen(true)} active colors={colors} label="Chat" badge={unread}>
              <MessageSquare color={colors.textPrimary} size={20} />
            </ControlButton>
            {hasExam && (
              <ControlButton onPress={() => setExamOpen(true)} active colors={colors} label="Exam questions" badge={examQuestions.length}>
                <ClipboardList color={colors.accent} size={20} />
              </ControlButton>
            )}
            <TouchableOpacity
              onPress={confirmLeave}
              accessibilityLabel="Leave session"
              style={[styles.controlBtn, { backgroundColor: colors.red, borderColor: colors.red }]}
            >
              <PhoneOff color="#fff" size={20} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function ControlButton({
  children,
  onPress,
  active,
  disabled,
  colors,
  label,
  badge = 0,
}: {
  children: React.ReactNode;
  onPress: () => void;
  active: boolean;
  disabled?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  label: string;
  badge?: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={[
        styles.controlBtn,
        {
          backgroundColor: active ? colors.elevated : 'rgba(255, 59, 92, 0.12)',
          borderColor: active ? colors.borderBright : 'rgba(255, 59, 92, 0.35)',
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {children}
      {badge > 0 && (
        <View style={[styles.badgeCount, { backgroundColor: colors.red }]}>
          <Text style={styles.badgeCountText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  statusText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    maxWidth: 280,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: 'SpaceMono',
    fontSize: 10,
    letterSpacing: 1.5,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  banner: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  bannerSubText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    marginTop: 4,
  },
  pipColumn: {
    position: 'absolute',
    right: 16,
    gap: 10,
  },
  pip: {
    width: 104,
    height: 144,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#0f0f1a',
  },
  pipVideo: {
    flex: 1,
  },
  pipLabel: {
    position: 'absolute',
    bottom: 4,
    left: 6,
    color: '#fff',
    fontFamily: 'SpaceMono',
    fontSize: 9,
    letterSpacing: 1,
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  controlBar: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 48,
    borderWidth: 1,
  },
  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeCount: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeCountText: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
  },
  chatWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    justifyContent: 'flex-end',
  },
  chatPanel: {
    maxHeight: '60%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  chatTitle: {
    fontFamily: 'Inter_900Black',
    fontSize: 16,
  },
  chatTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  e2eBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  e2eBadgeText: {
    fontFamily: 'SpaceMono',
    fontSize: 9,
  },
  chatList: {
    flexGrow: 0,
    minHeight: 120,
  },
  chatEmpty: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  msgRow: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  msgRowMine: {
    justifyContent: 'flex-end',
  },
  msgBubble: {
    maxWidth: '85%',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  msgMeta: {
    fontFamily: 'SpaceMono',
    fontSize: 9,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  msgText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  chatInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
  },
  cardLabel: {
    fontFamily: 'SpaceMono',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  endTitle: {
    fontFamily: 'Inter_900Black',
    fontSize: 24,
    marginBottom: 8,
  },
  endMessage: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: {
    color: '#080810',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
});
