const fs = require('fs');
let content = fs.readFileSync('app/session/page.tsx', 'utf-8');

const correctImports = `import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from 'react'
import { io, Socket } from "socket.io-client"
import {
    Monitor, Gamepad2, ArrowLeftRight, Square, Eye, MousePointer,
    Keyboard, Zap, Radio, Check, AlertTriangle, Link, Volume2,
    VolumeX, Maximize2, Minimize2, ChevronDown, ChevronUp, ArrowLeft,
    XCircle, Mic, MicOff, Video, VideoOff, LogOut, MessageSquare,
    Send, Camera, Disc, Clipboard, ClipboardX, Copy, Maximize, Minimize
} from "lucide-react"
import {
    StatusBadge, RoomCodeDisplay, DataCard, TerminalLine,
    SectionHeader, DangerButton, GlowButton, LiveDot
} from "@/components/ircp/shared"`;

content = content.replace(
    'import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react"\nimport { PermissionRequestModal }',
    'import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react"\n' + correctImports + '\nimport { PermissionRequestModal }'
);

fs.writeFileSync('app/session/page.tsx', content);
console.log('Imports fixed!');
