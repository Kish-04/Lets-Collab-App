const fs = require('fs');
let content = fs.readFileSync('app/session/page.tsx', 'utf-8');

let lines = content.split('\n');
let replaced = false;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("addLog('permission',") && lines[i].includes("input was blocked by")) {
        // We found the line
        if (i + 1 < lines.length && !lines[i+1].includes('captureEvidence')) {
            lines[i] = `            const actionType = payload.type || 'unknown action';
            addLog('permission', \`\${participant.name}'s input was blocked by \${participant.permission.toUpperCase()} permission (\${actionType})\`)
            
            const now = Date.now();
            if (now - lastViolationTimeRef.current > 10000) {
                lastViolationTimeRef.current = now;
                socketRef.current?.emit('permission-violation', {
                    roomCode: roomCodeRef.current,
                    action: actionType,
                    controllerName: participant.name,
                    controllerEmail: participant.email
                });
                captureEvidence();
            }`;
            replaced = true;
        }
        break;
    }
}
if (replaced) {
    fs.writeFileSync('app/session/page.tsx', lines.join('\n'));
    console.log('Frontend patched with executeHostInput change');
} else {
    console.log('No replacement made. Line might not be found or captureEvidence already exists.');
}
