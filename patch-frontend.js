const fs = require('fs');
let content = fs.readFileSync('app/session/page.tsx', 'utf-8');

// We need to inject the throttling variable near the top or as a ref
if (!content.includes('const lastViolationTimeRef = useRef<number>(0)')) {
    content = content.replace(
        'const mainVideoRef = useRef<HTMLVideoElement>(null)',
        'const mainVideoRef = useRef<HTMLVideoElement>(null)\n    const lastViolationTimeRef = useRef<number>(0)'
    );
}

// In `executeHostInput`:
/*
    const executeHostInput = (controllerId: string, payload: any) => {
        const participant = participantsRef.current.find(item => item.id === controllerId)
        if (!participant) return
        if (!controlPayloadAllowed(participant, payload)) {
            addLog('permission', `${participant.name}'s input was blocked by ${participant.permission.toUpperCase()} permission`)
            return
        }
*/
const oldExecuteHostInput = `
    const executeHostInput = (controllerId: string, payload: any) => {
        const participant = participantsRef.current.find(item => item.id === controllerId)
        if (!participant) return
        if (!controlPayloadAllowed(participant, payload)) {
            addLog('permission', \`\${participant.name}'s input was blocked by \${participant.permission.toUpperCase()} permission\`)
            return
        }
`;

const newExecuteHostInput = `
    const executeHostInput = (controllerId: string, payload: any) => {
        const participant = participantsRef.current.find(item => item.id === controllerId)
        if (!participant) return
        if (!controlPayloadAllowed(participant, payload)) {
            const actionType = payload.type || 'unknown action';
            addLog('permission', \`\${participant.name}'s input was blocked by \${participant.permission.toUpperCase()} permission (\${actionType})\`)
            
            const now = Date.now();
            if (now - lastViolationTimeRef.current > 10000) {
                lastViolationTimeRef.current = now;
                socketRef.current?.emit('permission-violation', {
                    roomCode,
                    action: actionType,
                    controllerName: participant.name,
                    controllerEmail: participant.email
                });
                captureEvidence(); // Capture visual evidence of the violation
            }
            return
        }
`;

if (content.includes("addLog('permission', `${participant.name}'s input was blocked")) {
    content = content.replace(
        /const executeHostInput =[\s\S]*?addLog\('permission'.*?\n\s*return\n\s*\}/m,
        newExecuteHostInput.trim()
    );
    // Wait, regex might fail due to backticks and exact string match. Let's use substring replacement carefully.
    fs.writeFileSync('app/session/page.tsx', content);
    console.log('Frontend patched with executeHostInput change (Phase 1)');
}

// Let's use string split and replace to be extremely safe about the regex
let lines = content.split('\\n');
let replaced = false;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("addLog('permission',") && lines[i].includes("input was blocked by")) {
        // We found the line
        if (!lines[i+1].includes('captureEvidence')) {
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
    fs.writeFileSync('app/session/page.tsx', lines.join('\\n'));
    console.log('Frontend patched with executeHostInput change');
}
