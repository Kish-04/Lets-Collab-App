const fs = require('fs');
let content = fs.readFileSync('app/session/page.tsx', 'utf-8');

if (!content.includes('CHAT SIDEBAR')) {
    const sidebarJSX = `
                {/* CHAT SIDEBAR */}
                {chatOpen && (
                    <div className="w-80 border-l border-[var(--border)] bg-[var(--surface)] flex flex-col z-40 fixed right-0 top-[52px] bottom-0 shadow-2xl">
                        <div className="p-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--elevated)]">
                            <h3 className="font-semibold font-display flex items-center gap-2">
                                <MessageSquare className="w-4 h-4 text-[var(--violet)]" />
                                Session Chat
                            </h3>
                            <button onClick={() => setChatOpen(false)} className="p-1 hover:bg-[var(--surface)] rounded">
                                <XCircle className="w-4 h-4 text-[var(--text-secondary)]" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {chatMessages.length === 0 ? (
                                <p className="text-sm text-[var(--text-dim)] text-center mt-4">No messages yet.</p>
                            ) : chatMessages.map((m, i) => (
                                <div key={i} className={"flex flex-col " + (m.sender === (role==='host'?'Host':'Controller') ? "items-end" : "items-start")}>
                                    <span className="text-[10px] text-[var(--text-dim)] mb-1">{m.sender}</span>
                                    <div className={"px-3 py-2 rounded-lg text-sm max-w-[90%] " + (m.sender === (role==='host'?'Host':'Controller') ? "bg-[var(--violet)] text-white" : "bg-[var(--elevated)] text-[var(--text-primary)]")}>
                                        {m.content || m.text}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)]">
                            <div className="flex gap-2">
                                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => {
                                    if(e.key === 'Enter') {
                                        if (!chatInput.trim()) return;
                                        socketRef.current?.emit('chat-message', { roomId: roomCode, text: chatInput, senderName: role === 'host' ? 'Host' : 'Controller' });
                                        setChatInput('');
                                    }
                                }} placeholder="Type a message..." className="flex-1 bg-[var(--elevated)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--violet)] transition-colors" />
                            </div>
                        </div>
                    </div>
                )}
        </div>
    )
}`;

    // We will replace the last occurrence of '</div>\n    )\n}'
    let lastIndex = content.lastIndexOf('        </div>\n    )\n}');
    if (lastIndex !== -1) {
        content = content.substring(0, lastIndex) + sidebarJSX + '\n}';
        fs.writeFileSync('app/session/page.tsx', content);
        console.log('Sidebar injected.');
    } else {
        console.log('Could not find the end of the file structure!');
    }
} else {
    console.log('Sidebar already exists!');
}
