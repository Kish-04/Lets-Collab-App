const fs = require('fs');
let c = fs.readFileSync('app/session/page.tsx', 'utf8');

const targetStr = '<video ref={localCamRef} autoPlay playsInline muted className={cn("w-full h-full object-cover", localCamMuted && "opacity-0")} />';
const replacement = targetStr + '\n                            <canvas ref={antiCheatCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none object-cover" />' +
    '\n                            {riskScore > 0 && <div className="absolute top-0 left-0 right-0 bg-red-600/80 text-white text-xs font-bold text-center py-0.5">VIOLATION: {riskScore} PTS</div>}';

c = c.replace(targetStr, replacement);
fs.writeFileSync('app/session/page.tsx', c);
console.log("Fixed HUD and canvas");
