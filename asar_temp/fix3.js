const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'app/session/page.tsx');
let lines = fs.readFileSync(p, 'utf8').split('\n');

const missingLines = `                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = \`session-recording-\${Date.now()}.webm\`
                    a.click()
                    URL.revokeObjectURL(url)
                    addLog('recording', 'Recording saved to local device')
                }
                mediaRecorder.start()
                setIsRecording(true)
                addLog('system', 'Recording started')
            } catch (err: any) {
                addLog('system', \`Recording failed: \${err.message}\`)
            }
        } else {
            mediaRecorderRef.current?.stop()
            setIsRecording(false)
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
            formData.append('evidenceFile', blob, \`evidence-\${Date.now()}.png\`)
            try {
                const token = getStoredAuthToken()
                const res = await fetch(\`\${getBackendUrl()}/api/admin/upload-evidence\`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        ...(token ? { 'Authorization': \`Bearer \${token}\` } : {})
                    },
                    body: formData
                })
                const data = await res.json()
                if (data.success) {
                    addLog('recording', \`Evidence captured and saved: \${data.url}\`)
                    alert('Evidence captured successfully and uploaded to MinIO! DebugRoom: ' + data.debugRoom);
                } else {
                    alert('Evidence capture failed: ' + data.message);
                }
            } catch (err) {
                console.error("Upload failed", err)
            }
        }, 'image/png')
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
                    />`.split('\n');

let startIndex = -1;
let endIndex = -1;
for (let i=0; i<lines.length; i++) {
    if (lines[i].includes("const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })")) {
        startIndex = i;
    }
    if (startIndex !== -1 && i > startIndex && lines[i].includes('<button')) {
        endIndex = i;
        break;
    }
}

if (startIndex !== -1 && endIndex !== -1) {
    lines.splice(startIndex + 1, endIndex - startIndex - 1, ...missingLines);
    fs.writeFileSync(p, lines.join('\n'), 'utf8');
    console.log('Successfully injected lines');
} else {
    console.log('Failed to find boundaries');
}
