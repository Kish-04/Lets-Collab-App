import { useEffect, useRef } from 'react';

// Supervised-exam checks of the candidate's environment and behaviour that do not need the camera or
// microphone. Everything here only DETECTS and reports: no key is blocked or swallowed (remote control
// and accessibility shortcuts must keep working).
//
// Desktop app only (window.ipcRenderer from preload.js):
//  - 'system-event' BLUR_EVENT (main window lost focus) and CLIPBOARD_CHANGE (clipboard text changed,
//    e.g. copied from another program), sent by main.js
//  - 'set-clipboard-guard': main.js clears the clipboard whenever it changes, on only while this runs
//  - 'enable-kiosk-mode' { scan: true }: main.js looks for remote-desktop / screen-recording programs
//    and remote (RDP) sessions every 10 s and answers with 'anticheat-alert'

type IpcBridge = {
    send: (channel: string, data?: unknown) => void
    on: (channel: string, fn: (...args: any[]) => void) => (() => void) | void
}

// GPU renderer strings that only virtual machines report
const VM_RENDERER = /vmware|virtualbox|vbox|parallels|qemu|virgl|hyper-v|microsoft basic render/i;

export function detectVirtualMachineRenderer(): string | null {
    try {
        const canvas = document.createElement('canvas');
        const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        if (!gl) return null;
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return VM_RENDERER.test(renderer) ? renderer : null;
    } catch {
        return null;
    }
}

export function useEnvironmentProctoring(
    sessionMode: string | null,
    role: string | null,
    connectionState: string,
    onViolation: (type: string, message: string) => void
) {
    const onViolationRef = useRef(onViolation);
    onViolationRef.current = onViolation;

    useEffect(() => {
        if (sessionMode !== 'supervised' || role !== 'controller' || connectionState !== 'connected') return;
        const report = (type: string, message: string) => onViolationRef.current(type, message);
        const cleanups: Array<() => void> = [];

        // Full screen: report leaving it (only after the candidate was in full screen)
        let wasFullscreen = Boolean(document.fullscreenElement);
        const onFullscreenChange = () => {
            const now = Boolean(document.fullscreenElement);
            if (wasFullscreen && !now && document.visibilityState === 'visible') {
                report('fullscreen_exit', 'You exited full screen — please return to full screen.');
            }
            wasFullscreen = now;
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        cleanups.push(() => document.removeEventListener('fullscreenchange', onFullscreenChange));

        // Shortcuts that open developer tools, take screenshots or switch windows. Listening only.
        const onKeyDown = (event: KeyboardEvent) => {
            const key = event.key || '';
            const lower = key.toLowerCase();
            const mod = event.ctrlKey || event.metaKey;
            if (key === 'F12' || (mod && event.shiftKey && ['i', 'j', 'c'].includes(lower)) || (event.metaKey && event.altKey && ['i', 'j', 'c'].includes(lower))) {
                report('devtools', 'A developer-tools shortcut was pressed — developer tools are not allowed during the exam.');
            } else if (key === 'PrintScreen' || (event.metaKey && event.shiftKey && ['s', '3', '4', '5'].includes(lower))) {
                report('screen_capture', 'A screenshot shortcut was pressed — screenshots are not allowed during the exam.');
            } else if ((event.altKey && key === 'Tab') || (event.metaKey && key === 'Tab') || key === 'Meta' || key === 'OS') {
                report('suspicious_shortcut', 'A window-switching key was pressed — please stay in the exam window.');
            }
        };
        // PrintScreen is usually only delivered on key up
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'PrintScreen') report('screen_capture', 'A screenshot key was pressed — screenshots are not allowed during the exam.');
        };
        window.addEventListener('keydown', onKeyDown, { capture: true, passive: true });
        window.addEventListener('keyup', onKeyUp, { capture: true, passive: true });
        cleanups.push(() => {
            window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions);
            window.removeEventListener('keyup', onKeyUp, { capture: true } as EventListenerOptions);
        });

        // Virtual machine hint (GPU renderer string), reported once per exam
        const vm = detectVirtualMachineRenderer();
        if (vm) report('virtual_machine', `This device appears to be a virtual machine (graphics: ${vm.slice(0, 80)}).`);

        // The page reports renderer blur itself; the desktop main-process blur is a backup for focus
        // changes the renderer did not see (e.g. another always-on-top program taking focus)
        let lastRendererBlur = 0;
        const onBlur = () => { lastRendererBlur = Date.now(); };
        window.addEventListener('blur', onBlur);
        cleanups.push(() => window.removeEventListener('blur', onBlur));

        const ipc = (window as any).ipcRenderer as IpcBridge | undefined;
        if (ipc) {
            const off1 = ipc.on('system-event', (event: { type?: string; message?: string } = {}) => {
                if (event.type === 'BLUR_EVENT') {
                    // Give the renderer's own blur event a moment to arrive before deciding it was missed
                    setTimeout(() => {
                        if (Date.now() - lastRendererBlur > 2500 && document.hasFocus() === false) {
                            report('tab_switched', 'The exam window lost focus to another program.');
                        }
                    }, 300);
                } else if (event.type === 'CLIPBOARD_CHANGE') {
                    report('clipboard', 'The clipboard changed during the exam (text copied from another program).');
                }
            });
            const off2 = ipc.on('anticheat-alert', (alert: { type?: string; message?: string } = {}) => {
                const type = String(alert.type || 'REMOTE_DESKTOP');
                report(type === 'BANNED_PROCESS' ? 'remote_desktop' : type.toLowerCase(), String(alert.message || 'A forbidden program is running.').slice(0, 200));
            });
            ipc.send('set-clipboard-guard', true);
            ipc.send('enable-kiosk-mode', { scan: true });
            cleanups.push(() => {
                if (typeof off1 === 'function') off1();
                if (typeof off2 === 'function') off2();
                ipc.send('set-clipboard-guard', false);
                ipc.send('enable-kiosk-mode', { scan: false });
            });
        }

        return () => cleanups.forEach(fn => fn());
    }, [sessionMode, role, connectionState]);
}
