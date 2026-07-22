const fs = require('fs');
let content = fs.readFileSync('app/session/page.tsx', 'utf-8');

// 1. Click to copy
content = content.replace(
  'const [roomCode, setRoomCode] = useState<string | null>(null)',
  'const [roomCode, setRoomCode] = useState<string | null>(null)\n    const [copied, setCopied] = useState(false)'
);
content = content.replace(
  'import { ShieldAlert, Users, Video, VideoOff, Mic, MicOff, Settings, X, Plus, TerminalSquare, Search, Copy, Check } from \'lucide-react\'',
  'import { ShieldAlert, Users, Video, VideoOff, Mic, MicOff, Settings, X, Plus, TerminalSquare, Search, Copy, Check, MessageSquare, Maximize, Minimize } from \'lucide-react\''
);

content = content.replace(
  'await navigator.clipboard.writeText(roomCode);',
  'await navigator.clipboard.writeText(roomCode);\n                                setCopied(true);\n                                setTimeout(() => setCopied(false), 2000);'
);

content = content.replace(
  '>{roomCode || \'---\'}</div>',
  '>{copied ? <><Check className="w-3 h-3 inline mr-1" /> Copied</> : <><Copy className="w-3 h-3 inline mr-1" /> {roomCode || \'---\'}</>}</div>'
);

// 2. Fullscreen mode
content = content.replace(
  'const [sidebarOpen, setSidebarOpen] = useState(true)',
  'const [sidebarOpen, setSidebarOpen] = useState(true)\n    const [isFullscreen, setIsFullscreen] = useState(false)\n    const videoContainerRef = useRef<HTMLDivElement>(null)'
);

content = content.replace(
  'const toggleFullscreen = () => {',
  'const toggleFullscreen = () => {\n        if (!document.fullscreenElement) {\n            videoContainerRef.current?.requestFullscreen().catch(err => console.log(err));\n            setIsFullscreen(true);\n        } else {\n            document.exitFullscreen();\n            setIsFullscreen(false);\n        }\n    }\n\n    const handleFullscreenChange = () => {\n        setIsFullscreen(!!document.fullscreenElement);\n    }\n\n    useEffect(() => {\n        document.addEventListener(\'fullscreenchange\', handleFullscreenChange);\n        return () => document.removeEventListener(\'fullscreenchange\', handleFullscreenChange);\n    }, []);'
);

content = content.replace(
  '<div className="flex-1 relative bg-black flex flex-col items-center justify-center">',
  '<div ref={videoContainerRef} className="flex-1 relative bg-black flex flex-col items-center justify-center">'
);

content = content.replace(
  '<video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />',
  '<video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />\n                            {role === \'controller\' && (\n                                <button onClick={toggleFullscreen} className="absolute top-4 right-4 bg-black/50 hover:bg-black/80 text-white p-2 rounded-lg transition-colors backdrop-blur-sm z-50">\n                                    {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}\n                                </button>\n                            )}'
);

// 3. Chat feature
content = content.replace(
  'const [connectionState, setConnectionState] = useState<\'idle\' | \'waiting\' | \'connected\' | \'failed\' | \'denied\'>(\'idle\')',
  'const [connectionState, setConnectionState] = useState<\'idle\' | \'waiting\' | \'connected\' | \'failed\' | \'denied\'>(\'idle\')\n    const [chatOpen, setChatOpen] = useState(false)\n    const [chatMessages, setChatMessages] = useState<Array<{sender: string, text: string, time: Date}>>([])\n    const [chatInput, setChatInput] = useState(\'\')\n    const chatScrollRef = useRef<HTMLDivElement>(null)\n\n    useEffect(() => {\n        if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;\n    }, [chatMessages])'
);

content = content.replace(
  'socket.on(\'chain-log\', () => {',
  'socket.on(\'chat-message\', (msg) => {\n            setChatMessages(prev => [...prev, { sender: msg.senderName, text: msg.text, time: new Date() }])\n        })\n\n        socket.on(\'chain-log\', () => {'
);

content = content.replace(
  'const handleEndSession = () => {',
  'const sendChatMessage = (e?: React.FormEvent) => {\n        if (e) e.preventDefault();\n        if (!chatInput.trim()) return;\n        socketRef.current?.emit(\'chat-message\', { roomId: roomCodeRef.current || joinInput, text: chatInput, senderName: role === \'host\' ? \'Host\' : \'Controller\' });\n        setChatInput(\'\');\n    }\n\n    const handleEndSession = () => {'
);

content = content.replace(
  '<button onClick={() => setSidebarOpen(!sidebarOpen)}',
  '<button onClick={() => setChatOpen(!chatOpen)} className="p-2 hover:bg-[var(--elevated)] rounded-lg transition-colors">\n                                <MessageSquare className="w-5 h-5 text-[var(--text-secondary)]" />\n                            </button>\n                            <button onClick={() => setSidebarOpen(!sidebarOpen)}'
);

content = content.replace(
  '{/* SIDEBAR (Host Only) */}',
  `{/* CHAT SIDEBAR */}
                {chatOpen && (
                    <div className="w-80 border-l border-[var(--border)] bg-[var(--surface)] flex flex-col z-40">
                        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center">
                            <h3 className="font-semibold font-display flex items-center gap-2">
                                <MessageSquare className="w-4 h-4 text-[var(--violet)]" />
                                Session Chat
                            </h3>
                            <button onClick={() => setChatOpen(false)} className="p-1 hover:bg-[var(--elevated)] rounded">
                                <X className="w-4 h-4 text-[var(--text-secondary)]" />
                            </button>
                        </div>
                        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                            {chatMessages.length === 0 ? (
                                <p className="text-sm text-[var(--text-dim)] text-center mt-4">No messages yet.</p>
                            ) : chatMessages.map((m, i) => (
                                <div key={i} className={"flex flex-col " + (m.sender === (role==='host'?'Host':'Controller') ? "items-end" : "items-start")}>
                                    <span className="text-[10px] text-[var(--text-dim)] mb-1">{m.sender} • {m.time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    <div className={"px-3 py-2 rounded-lg text-sm max-w-[90%] " + (m.sender === (role==='host'?'Host':'Controller') ? "bg-[var(--violet)] text-white" : "bg-[var(--elevated)] text-[var(--text-primary)]")}>
                                        {m.text}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-3 border-t border-[var(--border)]">
                            <form onSubmit={sendChatMessage} className="flex gap-2">
                                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message..." className="flex-1 bg-[var(--elevated)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--violet)] transition-colors" />
                                <button type="submit" className="bg-[var(--violet)] hover:bg-[#8B5CF6] text-white px-3 py-2 rounded transition-colors">
                                    Send
                                </button>
                            </form>
                        </div>
                    </div>
                )}

                {/* SIDEBAR (Host Only) */}`
);

fs.writeFileSync('app/session/page.tsx', content);
console.log('Modifications applied');
