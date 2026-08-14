import React, { useState, useRef } from 'react';
import MonacoEditor from '@monaco-editor/react';

export interface ExamQuestion {
    id: string;
    type: 'freeform' | 'mc' | 'poll' | 'code';
    prompt: string;
    options?: string[];
    language?: string;
    starterCode?: string;
    voicePrompt?: string;
    answerKey?: string;
}

const defaultSnippets: Record<string, string> = {
    python: 'def solve():\n    pass\n\nif __name__ == "__main__":\n    solve()',
    javascript: 'function solve() {\n\n}\n\nsolve();',
    java: 'public class Main {\n    public static void main(String[] args) {\n        \n    }\n}',
    c: '#include <stdio.h>\n\nint main() {\n    return 0;\n}',
    cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    return 0;\n}',
    rust: 'fn main() {\n    \n}',
    go: 'package main\n\nimport "fmt"\n\nfunc main() {\n    \n}',
    typescript: 'function solve(): void {\n\n}\n\nsolve();',
    html: '<!DOCTYPE html>\n<html>\n<head>\n    <title>Page Title</title>\n</head>\n<body>\n    \n</body>\n</html>'
};

interface ExamHostDashboardProps {
    onPushQuestion: (question: ExamQuestion) => void;
    liveAnswers: Record<string, Record<string, any>>; 
    localStream?: MediaStream | null;
}

export function ExamHostDashboard({ onPushQuestion, liveAnswers, localStream }: ExamHostDashboardProps) {
    const [questionType, setQuestionType] = useState<ExamQuestion['type']>('freeform');
    const [prompt, setPrompt] = useState('');
    const [options, setOptions] = useState<string[]>(['', '']);
    const [language, setLanguage] = useState('python');
    const [starterCode, setStarterCode] = useState(defaultSnippets['python']);
    const [hostOutput, setHostOutput] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [voicePrompt, setVoicePrompt] = useState<string | null>(null);
    const [sentQuestions, setSentQuestions] = useState<ExamQuestion[]>([]);
    const [answerKey, setAnswerKey] = useState<string>('');
    const [currentReviewIndex, setCurrentReviewIndex] = useState<number>(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const toggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            // Only stop the tracks if we created a new stream (not using the shared localStream)
            if (!localStream || mediaRecorderRef.current?.stream !== localStream) {
                mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
            }
            setIsRecording(false);
            return;
        }

        try {
            let stream = localStream;
            if (!stream || stream.getAudioTracks().length === 0) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const mimeType = mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    setVoicePrompt(reader.result as string);
                };
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err) {
            alert('Microphone access denied or not available.');
        }
    };

    const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newLang = e.target.value;
        setLanguage(newLang);
        setStarterCode(defaultSnippets[newLang] || '');
        setHostOutput('');
    };

    const runHostCode = async () => {
        if (!starterCode) return;
        setIsRunning(true);
        setHostOutput('Running...');
        try {
            const res = await fetch('/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    language: language,
                    version: '*', 
                    files: [{ content: starterCode }]
                })
            });
            const data = await res.json();
            const output = data.run ? (data.run.output || data.run.stderr || 'No output') : 'Execution failed';
            setHostOutput(output);
        } catch (err) {
            setHostOutput('Sandbox Error / Network Error');
        } finally {
            setIsRunning(false);
        }
    };

    const handleSend = () => {
        if (!prompt.trim() && !voicePrompt) return;
        
        const q: ExamQuestion = {
            id: Math.random().toString(36).substring(7),
            type: questionType,
            prompt: prompt,
            voicePrompt: voicePrompt || undefined,
            answerKey: answerKey.trim() || undefined
        };
        if (questionType === 'mc' || questionType === 'poll') {
            q.options = options.filter(o => o.trim());
        }
        if (questionType === 'code') {
            q.language = language;
            q.starterCode = starterCode;
        }
        onPushQuestion(q);
        setSentQuestions(prev => {
            setCurrentReviewIndex(prev.length);
            return [...prev, q];
        });
        setPrompt('');
        setVoicePrompt(null);
        setOptions(['', '']);
        setAnswerKey('');
    };

    return (
        <div className="w-full h-full flex flex-col p-6 font-sans text-[var(--text-primary)] overflow-y-auto overflow-x-hidden custom-scrollbar">
            <h2 className="text-2xl font-black mb-6 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent tracking-tight">Exam Dashboard</h2>
            
            <div className="flex flex-col gap-4 mb-8 p-5 bg-[var(--elevated)] border border-[var(--border)]/60 rounded-2xl backdrop-blur-md shadow-inner">
                <h3 className="font-bold text-sm tracking-wide text-[var(--text-primary)] uppercase">Create Question</h3>
                
                <div className="relative">
                    <select 
                        value={questionType}
                        onChange={(e) => setQuestionType(e.target.value as any)}
                        className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer"
                    >
                        <option value="freeform">Freeform (Text/Voice)</option>
                        <option value="mc">Multiple Choice</option>
                        <option value="poll">Live Poll</option>
                        <option value="code">Coding</option>
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-primary)]">▼</div>
                </div>

                <div className="relative">
                    <textarea 
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Type your question..."
                        className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl p-4 pb-16 text-sm min-h-[100px] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all resize-none shadow-inner"
                    />
                    
                    {voicePrompt && (
                        <div className="absolute bottom-12 left-4 right-4 flex items-center gap-2 bg-[var(--bg)]/60 p-1.5 rounded-lg border border-[var(--border)]/60 backdrop-blur-md">
                            <audio src={voicePrompt} controls className="h-6 w-full" />
                            <button onClick={() => setVoicePrompt(null)} className="text-red-400 hover:text-red-300 px-2 font-bold shrink-0">×</button>
                        </div>
                    )}

                    <button 
                        onClick={toggleRecording}
                        className={`absolute bottom-2 right-2 px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-2 transition-all ${isRecording ? 'bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)] animate-pulse' : 'bg-[var(--elevated)] text-[var(--text-primary)] border border-[var(--border)]/60 hover:bg-[var(--elevated)]/80 hover:text-[var(--text-primary)]'}`}
                    >
                        {isRecording ? (
                            <><span className="w-2 h-2 rounded-full bg-red-400" /> Recording...</>
                        ) : (
                            <>🎤 Record Voice</>
                        )}
                    </button>
                </div>

                {(questionType === 'mc' || questionType === 'poll') && (
                    <div className="flex flex-col gap-3">
                        {options.map((opt, i) => (
                            <input 
                                key={i}
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                    const newOpts = [...options];
                                    newOpts[i] = e.target.value;
                                    setOptions(newOpts);
                                }}
                                placeholder={`Option ${i + 1}`}
                                className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                            />
                        ))}
                        <button 
                            onClick={() => setOptions([...options, ''])}
                            className="text-xs font-semibold text-blue-400 text-left hover:text-blue-300 transition-colors py-1 flex items-center gap-1"
                        >
                            <span className="text-lg">+</span> Add Option
                        </button>
                    </div>
                )}

                {questionType === 'code' && (
                    <div className="flex flex-col gap-3">
                        <div className="relative">
                            <select 
                                value={language}
                                onChange={handleLanguageChange}
                                className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer"
                            >
                                <option value="python">Python</option>
                                <option value="javascript">JavaScript</option>
                                <option value="typescript">TypeScript</option>
                                <option value="java">Java</option>
                                <option value="c">C</option>
                                <option value="cpp">C++</option>
                                <option value="rust">Rust</option>
                                <option value="go">Go</option>
                                <option value="html">HTML</option>
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-primary)]">▼</div>
                        </div>
                        
                        <div className="h-64 border border-[var(--border)]/60 rounded-xl overflow-hidden shadow-inner bg-[var(--bg)]/60 relative">
                            <MonacoEditor
                                height="100%"
                                language={language}
                                theme="vs-dark"
                                value={starterCode}
                                onChange={(val) => setStarterCode(val || '')}
                                options={{ minimap: { enabled: false }, fontSize: 13, padding: { top: 12 } }}
                            />
                        </div>
                        
                        <div className="flex justify-end mt-1">
                            <button 
                                onClick={runHostCode}
                                disabled={isRunning}
                                className="bg-green-500/10 text-green-400 border border-green-500/30 px-4 py-1.5 rounded-lg font-bold text-xs hover:bg-green-500/20 transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                                {isRunning ? 'Running...' : '▶ Run Code'}
                            </button>
                        </div>

                        {hostOutput && (
                            <div className="p-3 bg-[var(--bg)]/80 border border-[var(--border)] rounded-xl font-mono text-[11px] text-green-400/90 whitespace-pre-wrap max-h-32 overflow-y-auto shadow-inner custom-scrollbar">
                                {hostOutput}
                            </div>
                        )}
                    </div>
                )}

                {questionType !== 'poll' && (
                    <div className="mt-2">
                        <input 
                            type="text"
                            value={answerKey}
                            onChange={(e) => setAnswerKey(e.target.value)}
                            placeholder="Correct Answer (Optional) - Used for Auto-Grading"
                            className="w-full bg-[var(--bg)]/70 border border-[var(--border)]/60 rounded-xl px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                        />
                    </div>
                )}
                <button 
                    onClick={handleSend}
                    className="mt-2 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-[var(--text-primary)] font-bold py-3 rounded-xl shadow-lg hover:shadow-blue-500/25 hover:from-blue-500 hover:to-indigo-500 transition-all active:scale-[0.98]"
                >
                    Push to Controllers
                </button>
            </div>

            <h3 className="font-bold text-sm tracking-wide text-[var(--text-primary)] uppercase mb-4">Live Responses</h3>
            <div className="flex flex-col gap-4 pr-2">
                {sentQuestions.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-[var(--text-primary)] text-sm italic bg-[var(--elevated)] rounded-2xl border border-[var(--border)] border-dashed">
                        Waiting for active questions...
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between bg-[var(--elevated)] border border-[var(--border)]/60 rounded-xl p-3 shadow-inner">
                            <button 
                                onClick={() => setCurrentReviewIndex(Math.max(0, currentReviewIndex - 1))}
                                disabled={currentReviewIndex === 0}
                                className="px-3 py-1 bg-[var(--bg)] text-[var(--text-primary)] rounded-lg disabled:opacity-50 border border-[var(--border)]/60 hover:bg-[var(--elevated)] transition-colors text-sm font-bold"
                            >
                                ← Prev
                            </button>
                            <span className="text-sm font-medium text-[var(--text-primary)]">
                                Question {currentReviewIndex + 1} of {sentQuestions.length}
                            </span>
                            <button 
                                onClick={() => setCurrentReviewIndex(Math.min(sentQuestions.length - 1, currentReviewIndex + 1))}
                                disabled={currentReviewIndex === sentQuestions.length - 1}
                                className="px-3 py-1 bg-[var(--bg)] text-[var(--text-primary)] rounded-lg disabled:opacity-50 border border-[var(--border)]/60 hover:bg-[var(--elevated)] transition-colors text-sm font-bold"
                            >
                                Next →
                            </button>
                        </div>

                        {(() => {
                            const qObj = sentQuestions[currentReviewIndex];
                            if (!qObj) return null;
                            const userAnswers = liveAnswers[qObj.id] || {};
                            const hasAnswers = Object.keys(userAnswers).length > 0;
                            
                            return (
                                <div key={qObj.id} className="bg-[var(--elevated)] border border-[var(--border)]/60 rounded-2xl p-4 shadow-sm">
                                    <div className="text-[var(--text-primary)] mb-3 font-mono text-[10px] tracking-wider uppercase">
                                        Question: {qObj.prompt}
                                    </div>
                                    
                                    {!hasAnswers ? (
                                        <div className="text-sm text-[var(--text-secondary)] italic text-center py-4">No submissions yet.</div>
                                    ) : (
                                        <div className="flex flex-col gap-3">
                                            {Object.entries(userAnswers).map(([controllerId, ans]) => (
                                                <div key={controllerId} className="bg-[var(--bg)]/70 border border-[var(--border)] p-3 rounded-xl">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="font-semibold text-sm text-blue-300">{ans.controllerName}</span>
                                                        <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${ans.isFinal ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                                                            {ans.isFinal ? 'Submitted' : 'Drafting'}
                                                        </span>
                                                    </div>
                                                    {qObj?.type === 'code' ? (
                                                        <div className="h-48 border border-[var(--border)]/60 rounded-xl overflow-hidden shadow-inner bg-[var(--bg)]/60 mt-2">
                                                            <MonacoEditor
                                                                height="100%"
                                                                language={qObj.language || 'javascript'}
                                                                theme="vs-dark"
                                                                value={ans.text || ''}
                                                                options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, padding: { top: 12 } }}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="text-sm text-[var(--text-primary)] break-words whitespace-pre-wrap">{ans.text || (ans.options && ans.options.join(', '))}</div>
                                                    )}
                                                    
                                                    {ans.audio && (
                                                        <div className="mt-3 bg-[var(--bg)]/70 p-1.5 rounded-lg border border-[var(--border)] shadow-inner">
                                                            <audio src={ans.audio} controls className="h-8 w-full" />
                                                        </div>
                                                    )}

                                                    {ans.output && (
                                                        <div className="mt-3 p-2 bg-[var(--bg)]/60 border border-[var(--border)] text-green-400 font-mono text-[11px] rounded-lg shadow-inner">
                                                            {ans.output}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </>
                )}
            </div>
            <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
            `}} />
        </div>
    );
}
