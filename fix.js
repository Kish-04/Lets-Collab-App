const fs = require('fs');
let c = fs.readFileSync('app/session/page.tsx', 'utf8');
const startIdx = c.indexOf('    const toggleLocalCam = async () => {');
const endIdx = c.indexOf('        const runCalibration = async () => {');

const newText = `    const toggleLocalCam = async () => {
        if (localStreamRef.current) {
            const videoTrack = localStreamRef.current.getVideoTracks()[0]
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled
                setLocalCamMuted(!videoTrack.enabled)
                addLog('system', \`Camera \${videoTrack.enabled ? 'enabled' : 'disabled'}\`)
            }
        } else {
            if (!navigator.mediaDevices) {
                alert("Camera access requires a secure connection (HTTPS) or localhost. Since you are connecting via a local IP, the browser blocks access to media devices.");
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                localStreamRef.current = stream
                if (localCamRef.current) localCamRef.current.srcObject = stream
                setLocalCamMuted(false)
                setLocalMicMuted(false)
                setHasLocalMedia(true)
                addLog('system', 'Camera and Microphone activated')
            } catch (err: any) {
                alert(\`Camera access denied or missing: \${err.message}\`);
                addLog('system', 'Camera access denied')
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
            if (status === 'error') addLog('anticheat', \`Anti-cheat failed: \${msg}\`)
        })
        engine.onEvent((ev: AntiCheatEvent) => {
            addLog('anticheat', \`\${ev.type}: \${ev.message} (+\${ev.scorePenalty})\`)
            setRiskScore(s => Math.min(100, s + ev.scorePenalty))
            setGaugeGlow(true)
            setTimeout(() => setGaugeGlow(false), 800)
            socketRef.current?.emit('system-alert', {
                type: 'anticheat_violation', event: ev.type,
                message: ev.message, penalty: ev.scorePenalty, room: roomCode,
            })
        })
        
`;

c = c.slice(0, startIdx) + newText + c.slice(endIdx);
fs.writeFileSync('app/session/page.tsx', c);
console.log("Fixed page.tsx");
