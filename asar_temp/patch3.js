const fs = require('fs');
let content = fs.readFileSync('app/session/page.tsx', 'utf-8');

if (!content.includes('const toggleFullscreen = () => {')) {
    const fullscreenLogic = `
    const videoContainerRef = useRef<HTMLDivElement>(null)

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            videoContainerRef.current?.requestFullscreen().catch(err => console.log(err));
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    }

    const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
    }

    useEffect(() => {
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);
`;
    // Insert after const handleEndSession = () => { ... }
    content = content.replace(
        'const handleEndSession = () => {',
        fullscreenLogic + '\n    const handleEndSession = () => {'
    );
}

if (!content.includes('ref={videoContainerRef}')) {
    content = content.replace(
        '<div className="flex-1 relative bg-black flex flex-col items-center justify-center">',
        '<div ref={videoContainerRef} className="flex-1 relative bg-black flex flex-col items-center justify-center">'
    );
}

if (!content.includes('<Maximize')) {
    content = content.replace(
        '<video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />',
        '<video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />\n                            {role === \'controller\' && (\n                                <button onClick={toggleFullscreen} className="absolute top-4 right-4 bg-black/50 hover:bg-black/80 text-white p-2 rounded-lg transition-colors backdrop-blur-sm z-50">\n                                    {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}\n                                </button>\n                            )}'
    );
}

fs.writeFileSync('app/session/page.tsx', content);
console.log('Fullscreen patch complete.');
