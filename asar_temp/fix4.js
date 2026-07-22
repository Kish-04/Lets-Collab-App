const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'app/session/page.tsx');
let lines = fs.readFileSync(p, 'utf8').split('\n');

const missingLines = `        socket.on('offer', async (payload: any) => {
            const pc = pcRef.current && pcRef.current.signalingState !== 'closed' ? pcRef.current : await createPC()
            await pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socket.emit('answer', { answer, roomId: code || roomCodeRef.current || joinInput, targetId: payload.fromId })
        })`;

let insertIndex = -1;
for (let i=0; i<lines.length; i++) {
    if (lines[i].includes("socket.on('answer'")) {
        insertIndex = i;
        break;
    }
}

if (insertIndex !== -1) {
    lines.splice(insertIndex, 0, missingLines);
    fs.writeFileSync(p, lines.join('\n'), 'utf8');
    console.log('Successfully injected lines');
} else {
    console.log('Failed to find boundary');
}
